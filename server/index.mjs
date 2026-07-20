// MIT License - Copyright (c) fintonlabs.com
// Minimal persistence + AI-compose proxy for steprail.
// All user-tunable config lives in the Settings UI and persists to data/settings.json.
import express from 'express'
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { approve, armSchedules, createRun, getLastTrigger, getRun, getReportData, listRuns, queueStats, rerunRun, resumeRun, scopedGlobals, scopeSettings, startWorker, stopWorker, traceAsOtlp } from './queue.mjs'
import { decryptSecret, decryptSettings, encryptSecret, encryptSettingsInPlace, rotateSettingsInPlace } from './secrets.mjs'
import { executeStep, resolveConn } from './executors.mjs'
import { resolveConfigWith, seedVars, validateStep } from '../shared/enginecore.mjs'
import { toolCoreById } from '../shared/toolcore.mjs'
import { optionsFromResponse, parseFormFields, renderFormHtml, renderFormSuccessHtml } from '../shared/formcore.mjs'
import { fetchJsonSafely } from './safefetch.mjs'
import { securityHeaders, makeLimiter, startRateLimitSweeper, FORM_CSP } from './security.mjs'
import { getDoc, setDoc, drainWrites, closeStore } from './store.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.STEPRAIL_DATA_DIR || path.join(__dirname, '..', 'data')
const FLOWS_FILE = path.join(DATA_DIR, 'flows.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const PORT = process.env.PORT || 8452

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
try { fs.chmodSync(DATA_DIR, 0o700) } catch { /* pre-existing dir on odd fs */ }

// Persistence now lives in SQLite (WAL, atomic). readJson/writeJson keep their
// signature but store each JSON document by its filename stem, so every caller
// is unchanged. One-time import of any pre-SQLite JSON files below.
const keyOf = file => path.basename(file, '.json')
const readJson = (file, fallback) => getDoc(keyOf(file), fallback)
const writeJson = (file, value) => setDoc(keyOf(file), value)

const app = express()
// Rate limiting keys on req.ip. By default that's the socket IP (unspoofable).
// Only trust X-Forwarded-For when the operator sets STEPRAIL_TRUST_PROXY (they
// run behind a real proxy) — otherwise a client could forge the header to dodge
// the limiter. Value is a hop count or express trust-proxy string.
if (process.env.STEPRAIL_TRUST_PROXY) {
  const v = process.env.STEPRAIL_TRUST_PROXY
  app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v)
}
app.use(securityHeaders)
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf } }))
app.use(express.urlencoded({ extended: true }))

// Per-IP rate limits on the reachable/expensive surfaces. Generous enough for
// real use, tight enough to blunt floods and abuse.
startRateLimitSweeper()
app.use('/hooks', makeLimiter({ windowMs: 60_000, max: 120, name: 'webhook calls' }))
app.use('/forms', makeLimiter({ windowMs: 60_000, max: 60, name: 'form requests' }))
app.use('/mcp', makeLimiter({ windowMs: 60_000, max: 120, name: 'MCP calls' }))
app.use('/api/form-options', makeLimiter({ windowMs: 60_000, max: 30, name: 'option lookups' }))
app.use('/api/compose', makeLimiter({ windowMs: 60_000, max: 20, name: 'compose requests' }))

// Optional operator auth: once an access token is set in Settings, every
// /api/* call must carry it. /hooks/* stays open for external senders (gate
// those with per-path secrecy), and health + settings-flags stay readable so
// the UI can prompt for the token instead of going dark.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next()
  if (req.path === '/api/health' || req.path === '/api/ready' || req.path === '/api/metrics' ||
      (req.method === 'GET' && req.path === '/api/settings')) return next()
  const stored = readJson(SETTINGS_FILE, {}).apiToken
  if (!stored) return next()
  let token = ''
  try { token = decryptSecret(stored) } catch { /* key changed — nothing can match */ }
  const given = Buffer.from(req.get('x-api-token') || '')
  const want = Buffer.from(token)
  if (token && given.length === want.length && timingSafeEqual(given, want)) return next()
  res.status(401).json({ error: 'This steprail server requires an access token — set it in Settings on this browser.' })
})

const startedAt = Date.now()
// Liveness: the process is up.
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round((Date.now() - startedAt) / 1000), version: '0.1.0' })
})

// Readiness: the datastore is actually reachable (probe it). A load balancer
// should route only when this is 200.
app.get('/api/ready', (_req, res) => {
  try {
    getDoc('__ready_probe', null) // a real read against SQLite
    res.json({ ready: true })
  } catch (err) {
    res.status(503).json({ ready: false, error: String(err?.message || err) })
  }
})

// Prometheus/OpenMetrics — fleet-level health to complement the per-run traces.
app.get('/api/metrics', (_req, res) => {
  const s = queueStats()
  const up = Math.round((Date.now() - startedAt) / 1000)
  const g = (name, help, value, labels = '') =>
    `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name}${labels} ${value}\n`
  res.type('text/plain; version=0.0.4').send(
    g('steprail_up', 'process liveness', 1) +
    g('steprail_uptime_seconds', 'seconds since start', up) +
    g('steprail_worker_alive', 'worker loop running', s.workerAlive ? 1 : 0) +
    '# HELP steprail_queue_events queued/waiting/running/failed events\n# TYPE steprail_queue_events gauge\n' +
    `steprail_queue_events{state="queued"} ${s.eventsQueued}\n` +
    `steprail_queue_events{state="waiting"} ${s.eventsWaiting}\n` +
    `steprail_queue_events{state="running"} ${s.eventsRunning}\n` +
    `steprail_queue_events{state="failed"} ${s.eventsFailed}\n` +
    g('steprail_runs_total', 'runs recorded', s.runsTotal) +
    g('steprail_runs_running', 'runs in progress', s.runsRunning),
  )
})

// Flows carry a projectId (the tenant boundary). Pre-projects data has none:
// backfill to "default" on read so nothing is ever orphaned.
app.get('/api/flows', (_req, res) => {
  res.json(readJson(FLOWS_FILE, []).map(f => ({ ...f, projectId: f.projectId || 'default' })))
})
// Every meaningful save keeps the PREVIOUS state as a version (capped at 20
// per flow, coalesced to at most one per 10 minutes so debounced autosave
// doesn't flood the history). One bad edit to a live flow is one click back.
const VERSIONS_FILE = path.join(DATA_DIR, 'versions.json')
const flowFingerprint = f => JSON.stringify({ n: f.name, s: f.steps, v: f.vars || {}, t: f.tags || [] })

app.put('/api/flows', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'expected an array of flows' })
  const old = readJson(FLOWS_FILE, [])
  const versions = readJson(VERSIONS_FILE, {})
  let versionsDirty = false
  for (const next of req.body) {
    const prev = old.find(f => f.id === next.id)
    if (!prev || flowFingerprint(prev) === flowFingerprint(next)) continue
    const list = versions[next.id] || []
    const last = list[list.length - 1]
    if (last && Date.now() - last.at < 10 * 60_000) continue
    list.push({ at: Date.now(), name: prev.name, steps: prev.steps, vars: prev.vars, tags: prev.tags })
    versions[next.id] = list.slice(-20)
    versionsDirty = true
  }
  if (versionsDirty) writeJson(VERSIONS_FILE, versions)
  writeJson(FLOWS_FILE, req.body)
  armSchedules(req.body)
  res.json({ ok: true })
})

app.get('/api/flows/:id/versions', (req, res) => {
  const list = readJson(VERSIONS_FILE, {})[req.params.id] || []
  res.json([...list].reverse().map(v => ({ at: v.at, name: v.name, stepCount: (v.steps || []).length })))
})

app.post('/api/flows/:id/restore', (req, res) => {
  const versions = readJson(VERSIONS_FILE, {})
  const list = versions[req.params.id] || []
  const version = list.find(v => v.at === Number(req.body?.at))
  if (!version) return res.status(404).json({ error: 'no such version' })
  const flows = readJson(FLOWS_FILE, [])
  const flow = flows.find(f => f.id === req.params.id)
  if (!flow) return res.status(404).json({ error: 'no such flow' })
  // The state being replaced becomes a version too — restore is always undoable.
  list.push({ at: Date.now(), name: flow.name, steps: flow.steps, vars: flow.vars, tags: flow.tags })
  versions[req.params.id] = list.slice(-20)
  writeJson(VERSIONS_FILE, versions)
  Object.assign(flow, { name: version.name, steps: version.steps, vars: version.vars, tags: version.tags, updatedAt: Date.now() })
  writeJson(FLOWS_FILE, flows)
  armSchedules(flows)
  res.json({ flow })
})

app.get('/api/flows/:id/last-trigger', (req, res) => {
  res.json({ trigger: getLastTrigger(req.params.id) })
})

app.post('/api/runs/:id/rerun', (req, res) => {
  const run = rerunRun(req.params.id)
  if (!run) return res.status(404).json({ error: 'no such run' })
  res.json({ runId: run.id })
})

app.post('/api/runs/:id/resume', (req, res) => {
  const run = resumeRun(req.params.id)
  if (!run) return res.status(400).json({ error: 'nothing to resume — the run is still going, gone, or fully succeeded (use re-run)' })
  res.json({ runId: run.id })
})

// Import a flow in the portable JSON format (the same shape the UI exports
// and LLMs author — docs/LLM-AUTHORING.md). Hydration mirrors the client's
// tolerant rules: unknown tools/keys are dropped with warnings, never a
// hard failure when recovery is sane. Used by the CLI.
const importUid = () => Math.random().toString(36).slice(2, 9)
function hydratePortableSteps(portable, warnings, depth = 0) {
  const steps = []
  for (const p of Array.isArray(portable) ? portable : []) {
    if (!p || typeof p !== 'object' || typeof p.tool !== 'string') {
      warnings.push('Skipped a step with no "tool" field.')
      continue
    }
    const tool = toolCoreById(p.tool)
    if (!tool) {
      warnings.push(`Skipped unknown tool "${p.tool}".`)
      continue
    }
    const step = { id: importUid(), toolId: tool.id, name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : tool.name, config: {} }
    if (p.critical === false) step.critical = false
    if ((tool.id === 'trigger.webhook' || tool.id === 'trigger.git') && !p.config?.path) {
      step.config.path = `/hooks/${randomUUID()}`
    }
    for (const [key, value] of Object.entries(p.config || {})) {
      if (!tool.fields.some(f => f.key === key)) {
        warnings.push(`"${step.name}": dropped unknown config key "${key}".`)
        continue
      }
      step.config[key] = typeof value === 'object' ? JSON.stringify(value) : String(value)
    }
    if (Array.isArray(p.branches) && p.branches.length) {
      if (!tool.branching) warnings.push(`"${step.name}": ${tool.name} does not branch — lanes ignored.`)
      else if (depth >= 3) warnings.push(`"${step.name}": branch nesting deeper than 3 — lanes ignored.`)
      else {
        step.branches = p.branches.map((b, i) => ({
          id: importUid(),
          label: typeof b?.label === 'string' && b.label.trim() ? b.label.trim() : `Lane ${String.fromCharCode(65 + i)}`,
          steps: hydratePortableSteps(Array.isArray(b?.steps) ? b.steps : [], warnings, depth + 1),
        }))
      }
    }
    steps.push(step)
  }
  return steps
}

app.post('/api/flows/import', (req, res) => {
  const portable = req.body?.flow
  if (!portable || typeof portable !== 'object') return res.status(400).json({ error: 'body must be {"flow": <portable flow JSON>, "projectId"?: "..."}' })
  const pid = (req.body.projectId || '').trim() || 'default'
  if (!readProjects().some(p => p.id === pid)) return res.status(400).json({ error: `no project "${pid}"` })
  const warnings = []
  const steps = hydratePortableSteps(portable.steps, warnings)
  if (!steps.length) return res.status(400).json({ error: warnings[0] || 'No usable steps in that flow.' })
  const flows = readJson(FLOWS_FILE, [])
  // Same per-project name dedupe the UI applies.
  const taken = flows.filter(f => (f.projectId || 'default') === pid).map(f => f.name.toLowerCase())
  let name = typeof portable.name === 'string' && portable.name.trim() ? portable.name.trim() : 'Imported flow'
  if (taken.includes(name.toLowerCase())) {
    const base = name.replace(/ \d+$/, '')
    let n = 2
    while (taken.includes(`${base} ${n}`.toLowerCase())) n++
    name = `${base} ${n}`
  }
  const vars = {}
  if (portable.vars && typeof portable.vars === 'object' && !Array.isArray(portable.vars)) {
    for (const [k, v] of Object.entries(portable.vars)) vars[k] = typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  const flow = {
    id: importUid(), name, steps, projectId: pid, updatedAt: Date.now(),
    ...(Object.keys(vars).length ? { vars } : {}),
    ...(Array.isArray(portable.tags) ? { tags: portable.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 12) } : {}),
  }
  flows.unshift(flow)
  writeJson(FLOWS_FILE, flows)
  armSchedules(flows)
  res.json({ id: flow.id, name: flow.name, steps: steps.length, projectId: pid, warnings })
})

// ---------- projects (tenancy segmentation) ----------
// A project segments flows, runs, and secrets. "default" always exists and
// is the fallback home for anything without a projectId. RBAC will later
// bind roles to these ids — this file layout is the contract it builds on.
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json')
const readProjects = () => {
  const list = readJson(PROJECTS_FILE, [])
  if (!list.some(p => p.id === 'default')) {
    list.unshift({ id: 'default', name: 'Default', color: '#5e6ad2', createdAt: Date.now() })
  }
  return list
}

// One-time boot migration to strict per-project scoping: pre-projects
// secrets and the old shared {{config.*}} globals become Default's.
const migrateSettingsToProjects = () => {
  const s = readJson(SETTINGS_FILE, {})
  let dirty = false
  for (const c of s.connections || []) {
    if (!c.projectId) { c.projectId = 'default'; dirty = true }
  }
  if (s.globals !== undefined) {
    if (Object.keys(s.globals || {}).length) {
      // Default's own keys win if both exist.
      s.projectGlobals = { ...(s.projectGlobals || {}), default: { ...s.globals, ...((s.projectGlobals || {}).default || {}) } }
    }
    delete s.globals
    dirty = true
  }
  if (dirty) writeJson(SETTINGS_FILE, s)
}
migrateSettingsToProjects()

// Encryption-at-rest migration: any plaintext secret already on disk gets
// encrypted on boot; from here on secrets are only ever written encrypted.
{
  const s = readJson(SETTINGS_FILE, {})
  let dirty = encryptSettingsInPlace(s)
  // Re-encrypt with the current key if a rotation is in progress.
  if (rotateSettingsInPlace(s)) { dirty = true; console.log('steprail: rotated secrets to the current encryption key') }
  if (dirty) writeJson(SETTINGS_FILE, s)
}

app.get('/api/projects', (_req, res) => res.json(readProjects()))

app.post('/api/projects', (req, res) => {
  const name = (req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'name required' })
  const projects = readProjects()
  if (projects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: `a project named "${name}" already exists` })
  }
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body?.color || '') ? req.body.color : '#5e6ad2'
  const project = { id: Math.random().toString(36).slice(2, 10), name, color, createdAt: Date.now() }
  writeJson(PROJECTS_FILE, [...projects, project])
  res.json(project)
})

app.put('/api/projects/:id', (req, res) => {
  const projects = readProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'no such project' })
  const name = (req.body?.name || '').trim()
  if (name) {
    if (projects.some(p => p.id !== project.id && p.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: `a project named "${name}" already exists` })
    }
    project.name = name
  }
  if (/^#[0-9a-fA-F]{6}$/.test(req.body?.color || '')) project.color = req.body.color
  writeJson(PROJECTS_FILE, projects)
  res.json(project)
})

// Deleting a project never destroys work: its flows and secrets move to
// Default. The Default project itself cannot be deleted.
app.delete('/api/projects/:id', (req, res) => {
  if (req.params.id === 'default') return res.status(400).json({ error: 'the Default project cannot be deleted' })
  const projects = readProjects()
  if (!projects.some(p => p.id === req.params.id)) return res.status(404).json({ error: 'no such project' })
  const flows = readJson(FLOWS_FILE, [])
  let movedFlows = 0
  for (const f of flows) {
    if (f.projectId === req.params.id) { f.projectId = 'default'; movedFlows++ }
  }
  if (movedFlows) writeJson(FLOWS_FILE, flows)
  const s = readJson(SETTINGS_FILE, {})
  let movedSecrets = 0
  for (const c of s.connections || []) {
    if (c.projectId === req.params.id) { c.projectId = 'default'; movedSecrets++ }
  }
  // Project config values merge into Default's without clobbering its own keys.
  const pg = s.projectGlobals || {}
  let movedConfig = false
  if (pg[req.params.id]) {
    pg.default = { ...pg[req.params.id], ...(pg.default || {}) }
    delete pg[req.params.id]
    s.projectGlobals = pg
    movedConfig = true
  }
  if (movedSecrets || movedConfig) writeJson(SETTINGS_FILE, s)
  writeJson(PROJECTS_FILE, projects.filter(p => p.id !== req.params.id))
  res.json({ ok: true, movedFlows, movedSecrets })
})

// ---------- runs (queue-backed, real executors) ----------
app.post('/api/runs', (req, res) => {
  const { flow, speed, trigger } = req.body || {}
  if (!flow || !Array.isArray(flow.steps) || !flow.steps.length) {
    return res.status(400).json({ error: 'flow with steps required' })
  }
  // Manual runs may carry a trigger payload — e.g. the run-time form modal
  // collects answers before a form-trigger flow starts.
  const run = createRun(flow, {
    speed: speed || 'realtime',
    trigger: trigger && typeof trigger === 'object' ? trigger : null,
  })
  res.json({ runId: run.id })
})

app.get('/api/reports', (req, res) => res.json(getReportData(req.query.projectId ? String(req.query.projectId) : undefined)))

app.get('/api/runs', (req, res) => {
  if (!req.query.flowId) return res.status(400).json({ error: 'flowId required' })
  res.json(listRuns(String(req.query.flowId)))
})

app.get('/api/runs/:id', (req, res) => {
  const run = getRun(req.params.id)
  if (!run) return res.status(404).json({ error: 'no such run' })
  const { running, statuses, outputs, errors, entries } = run
  res.json({ running, statuses, outputs, errors, entries })
})

app.post('/api/runs/:id/approve/:stepId', (req, res) => {
  const ok = approve(req.params.id, req.params.stepId, req.body?.approver)
  res.status(ok ? 200 : 404).json({ ok })
})

// Test one step for real, in isolation. Tokens resolve from the caller's
// provided upstream outputs (usually the last run) — the server never
// invents data.
app.post('/api/test-step', async (req, res) => {
  const { flow, stepId, upstream } = req.body || {}
  const find = (steps) => {
    for (const s of steps) {
      if (s.id === stepId) return s
      for (const b of s.branches || []) {
        const hit = find(b.steps)
        if (hit) return hit
      }
    }
    return null
  }
  const step = flow && stepId ? find(flow.steps || []) : null
  if (!step) return res.status(400).json({ error: 'flow and stepId required' })
  const problem = validateStep(step)
  if (problem) return res.json({ error: problem })
  const tool = toolCoreById(step.toolId)
  if (!tool) return res.json({ error: `Unknown tool "${step.toolId}"` })
  try {
    // {{config.*}} resolves exactly as in a real run: project values over shared.
    const outputs = { ...seedVars(flow), config: scopedGlobals(readJson(SETTINGS_FILE, {}), flow.projectId), ...(upstream || {}) }
    const config = resolveConfigWith(outputs, step.config)
    const input = upstream?.__input
    const output = await executeStep(step.toolId, config, {
      settings: scopeSettings(decryptSettings(readJson(SETTINGS_FILE, {})), flow.projectId),
      input,
      outputs,
      trigger: null,
      flow,
      approvedBy: 'test',
    })
    res.json({ output })
  } catch (err) {
    res.json({ error: err.message })
  }
})

// ---------- traces (OpenTelemetry) ----------
app.get('/api/runs/:id/trace', (req, res) => {
  const run = getRun(req.params.id)
  if (!run) return res.status(404).json({ error: 'no such run' })
  if (req.query.format === 'otlp') return res.json(traceAsOtlp(run))
  res.json({
    traceId: run.traceId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    root: { name: `flow ${run.flowName}`, start: run.startedAt, end: run.finishedAt || Date.now() },
    spans: run.spans || [],
  })
})

// ---------- steprail as an MCP server ----------
// Stateless streamable-HTTP JSON-RPC: every active flow whose first step is
// an MCP trigger is a callable tool. tools/call runs the flow through the
// queue and returns the final step's output.
const mcpFlows = () =>
  readJson(FLOWS_FILE, []).filter(f => f.active !== false && f.steps?.[0]?.toolId === 'trigger.mcp')

const mcpToolFor = flow => {
  const config = flow.steps[0].config
  const inputs = parseFormFields(config.inputs)
  const typeFor = f => (f.type === 'number' ? { type: 'number' } : { type: 'string', description: f.label })
  return {
    name: (config.toolName || flow.name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
    description: config.description || flow.name,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(inputs.map(f => [f.key, typeFor(f)])),
      required: inputs.filter(f => f.required).map(f => f.key),
    },
  }
}

app.post('/mcp', async (req, res) => {
  const { id, method, params } = req.body || {}
  const reply = result => res.json({ jsonrpc: '2.0', id, result })
  const fail = (code, message) => res.json({ jsonrpc: '2.0', id, error: { code, message } })

  if (method === 'initialize') {
    return reply({
      protocolVersion: params?.protocolVersion || '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'steprail', version: '0.1.0' },
    })
  }
  if (method === 'notifications/initialized' || String(method).startsWith('notifications/')) {
    return res.status(202).end()
  }
  if (method === 'tools/list') {
    return reply({ tools: mcpFlows().map(mcpToolFor) })
  }
  if (method === 'tools/call') {
    const flow = mcpFlows().find(f => mcpToolFor(f).name === params?.name)
    if (!flow) return fail(-32602, `No flow exposes a tool named "${params?.name}".`)
    const run = createRun(flow, {
      speed: 'instant',
      trigger: { ...(params?.arguments || {}), trigger: 'mcp', calledAt: new Date().toISOString() },
    })
    // Wait (bounded) for the queue to finish the run.
    const deadline = Date.now() + 110_000
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 300))
      const current = getRun(run.id)
      if (!current || !current.running) break
    }
    const finished = getRun(run.id)
    if (!finished) return fail(-32603, 'The run disappeared.')
    if (finished.running) {
      return reply({ content: [{ type: 'text', text: JSON.stringify({ status: 'still-running', runId: run.id }) }] })
    }
    const failures = finished.entries.filter(e => e.status === 'error')
    if (failures.length) {
      return reply({
        isError: true,
        content: [{ type: 'text', text: failures.map(f => `${f.name}: ${f.error}`).join('\n') }],
      })
    }
    const lastStep = flow.steps[flow.steps.length - 1]
    const output = finished.outputs[lastStep?.id] ?? {}
    return reply({ content: [{ type: 'text', text: JSON.stringify(output) }] })
  }
  fail(-32601, `Method ${method} not supported.`)
})

// ---------- hosted forms ----------
// GET renders the form; POST validates and starts every listening flow with
// the answers flattened into the trigger payload.
const formFlowFor = reqPath => {
  const flows = readJson(FLOWS_FILE, [])
  const clean = reqPath.replace(/\/+$/, '')
  return flows.find(flow => {
    if (flow.active === false) return false
    const first = flow.steps?.[0]
    if (first?.toolId !== 'trigger.form') return false
    return (first.config?.path || '').replace(/\/+$/, '') === clean
  })
}

const brandingSettings = () => readJson(SETTINGS_FILE, {}).branding || {}

// A dynamic-choice lookup makes the server fetch an author-supplied URL. That
// is real SSRF surface, so fetchJsonSafely blocks private/metadata targets,
// refuses redirects, and caps the body. Results cache briefly so a busy public
// form (or a fetch loop) can't hammer the upstream, and we cap the number of
// lookups per render.
const OPTIONS_TTL_MS = 60_000
const MAX_LOOKUPS_PER_RENDER = 5
const optionsCache = new Map() // url -> { at, options }

async function lookupOptions(field) {
  const url = (field.optionsUrl || '').trim()
  if (!url) return null
  const hit = optionsCache.get(url)
  if (hit && Date.now() - hit.at < OPTIONS_TTL_MS) return optionsFromResponse(field, hit.data)
  try {
    const data = await fetchJsonSafely(url, { timeoutMs: 5000, maxBytes: 256 * 1024 })
    optionsCache.set(url, { at: Date.now(), data })
    return optionsFromResponse(field, data)
  } catch {
    return null // falls back to the field's static options
  }
}

async function resolveFormOptions(fields) {
  const dynamic = fields.filter(f => f.type === 'choice' && (f.optionsUrl || '').trim()).slice(0, MAX_LOOKUPS_PER_RENDER)
  const map = {}
  await Promise.all(dynamic.map(async f => {
    const opts = await lookupOptions(f)
    if (opts) map[f.key] = opts
  }))
  return map
}

// Every optionsUrl saved in any flow's form trigger — the allowlist the
// preview endpoint fetches against (never an arbitrary URL from the body).
function savedOptionUrls() {
  const urls = new Set()
  for (const flow of readJson(FLOWS_FILE, [])) {
    const first = flow.steps?.[0]
    if (first?.toolId !== 'trigger.form') continue
    for (const f of parseFormFields(first.config?.fields)) {
      if (f.type === 'choice' && (f.optionsUrl || '').trim()) urls.add(f.optionsUrl.trim())
    }
  }
  return urls
}

app.get(/^\/forms\/.*/, async (req, res) => {
  const flow = formFlowFor(req.path)
  if (!flow) return res.status(404).send('No live form at this address.')
  const config = flow.steps[0].config
  const resolved = await resolveFormOptions(parseFormFields(config.fields))
  res.setHeader('Content-Security-Policy', FORM_CSP)
  res.type('html').send(renderFormHtml(config, brandingSettings(), resolved))
})

// Preview a single field's dynamic options — used by the in-app form runner and
// the field builder (browsers can't reach a third-party API directly). To keep
// this from becoming an SSRF proxy, we ONLY fetch a URL that is already saved in
// a flow (an operator authored it — same trust as a data.http step). Arbitrary
// URLs from the body are refused.
app.post('/api/form-options', async (req, res) => {
  try {
    const field = req.body?.field
    if (!field || field.type !== 'choice' || !field.optionsUrl) return res.json({ options: [] })
    // parseFormFields drops fields without a label/key — guard for the empty case.
    const [parsed] = parseFormFields(JSON.stringify([field]))
    const url = (parsed?.optionsUrl || '').trim()
    if (!url) return res.json({ options: [] })
    if (!savedOptionUrls().has(url)) {
      return res.status(403).json({ error: 'Save the flow first — dynamic options only load from a URL stored in a form field.', options: [] })
    }
    const opts = await lookupOptions(parsed)
    res.json({ options: opts || [] })
  } catch {
    // The lookup already swallows fetch errors; anything here is unexpected.
    res.status(500).json({ error: 'Could not load options.', options: [] })
  }
})

app.post(/^\/forms\/.*/, (req, res) => {
  const flow = formFlowFor(req.path)
  if (!flow) return res.status(404).send('No live form at this address.')
  const config = flow.steps[0].config
  const fields = parseFormFields(config.fields)
  const answers = {}
  for (const field of fields) {
    const raw = req.body?.[field.key]
    if (field.required && (raw === undefined || String(raw).trim() === '')) {
      return res.status(400).send(`"${field.label}" is required.`)
    }
    answers[field.key] = field.type === 'number' ? Number(raw) || 0 : String(raw ?? '').slice(0, 4000)
  }
  createRun(flow, {
    speed: 'instant',
    trigger: { ...answers, trigger: 'form', submittedAt: new Date().toISOString() },
  })
  res.setHeader('Content-Security-Policy', FORM_CSP)
  res.type('html').send(renderFormSuccessHtml(config, brandingSettings()))
})

// ---------- live webhooks ----------
// Any request to /hooks/<path> starts every flow whose first step is a
// webhook or git-push trigger configured with that path.
app.all(/^\/hooks\/.*/, (req, res) => {
  const flows = readJson(FLOWS_FILE, [])
  const started = []
  for (const flow of flows) {
    if (flow.active === false) continue
    const first = flow.steps?.[0]
    const isWebhook = first?.toolId === 'trigger.webhook'
    const isGit = first?.toolId === 'trigger.git'
    if (!isWebhook && !isGit) continue
    const want = (first.config?.path || '').replace(/\/+$/, '')
    if (!want || req.path.replace(/\/+$/, '') !== want) continue
    // HMAC-SHA256 verification when a signing secret is configured (both webhook and git)
    const secret = first.config?.secret?.trim()
    if (secret) {
      const sig = req.headers['x-hub-signature-256'] || req.headers['x-signature-256'] || req.headers['x-webhook-signature']
      if (!sig) return res.status(401).json({ error: 'signing secret is configured — send X-Hub-Signature-256: sha256=<hmac>' })
      const expected = 'sha256=' + createHmac('sha256', secret).update(req.rawBody ?? Buffer.alloc(0)).digest('hex')
      let valid = false
      try { valid = sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) } catch {}
      if (!valid) return res.status(401).json({ error: 'webhook signature mismatch' })
    }
    if (isGit) {
      // Filter by repo and branch when configured
      const body = req.body ?? {}
      const pushedRepo = body.repository?.full_name || ''
      const pushedRef = body.ref || ''
      const pushedBranch = pushedRef.replace(/^refs\/heads\//, '')
      if (first.config?.repo && first.config.repo.toLowerCase() !== pushedRepo.toLowerCase()) continue
      if (first.config?.branch && pushedBranch && pushedBranch !== first.config.branch) continue
      const run = createRun(flow, {
        speed: 'instant',
        trigger: {
          repo: pushedRepo, branch: pushedBranch, sha: body.after || '',
          message: body.head_commit?.message || '', pusher: body.pusher?.name || '',
          path: req.path,
        },
      })
      started.push({ flow: flow.name, runId: run.id })
    } else {
      const run = createRun(flow, {
        speed: 'instant',
        trigger: { method: req.method, path: req.path, body: req.body ?? {}, query: req.query },
      })
      started.push({ flow: flow.name, runId: run.id })
    }
  }
  if (!started.length) return res.status(404).json({ error: `no flow listens on ${req.path}` })
  res.status(202).json({ started })
})

// Generate a secure random webhook path segment on demand
app.post('/api/webhook-id', (_req, res) => res.json({ id: randomUUID() }))

const BLUEPRINTS_FILE = path.join(DATA_DIR, 'blueprints.json')
app.get('/api/blueprints', (_req, res) => {
  res.json(readJson(BLUEPRINTS_FILE, []))
})
app.put('/api/blueprints', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'expected an array of blueprints' })
  writeJson(BLUEPRINTS_FILE, req.body)
  res.json({ ok: true })
})

// Credential-bearing settings: stored server-side, never returned to the
// browser — only whether each one is set.
const SECRET_KEYS = ['anthropicKey', 'slackWebhookUrl', 'pagerdutyRoutingKey', 'smtpUrl', 'postgresUrl', 'apiToken']
const flagName = k => 'has' + k[0].toUpperCase() + k.slice(1)

app.get('/api/settings', (_req, res) => {
  const s = readJson(SETTINGS_FILE, {})
  const out = { ...s }
  for (const key of SECRET_KEYS) {
    delete out[key]
    out[flagName(key)] = Boolean(s[key])
  }
  // Named connections: metadata only, secrets stay on disk.
  out.connections = (s.connections || []).map(({ id, name, type, projectId }) => ({ id, name, type, projectId }))
  res.json(out)
})

// ---------- named connections (many databases, many API keys) ----------
const CONN_TYPES = ['postgres', 'slack', 'smtp', 'pagerduty', 'anthropic', 'apikey', 'mcp', 'ssh', 'aws', 'k8s', 'github']
app.post('/api/connections', (req, res) => {
  const { name, type, secret, projectId } = req.body || {}
  if (!name?.trim() || !secret?.trim() || !CONN_TYPES.includes(type)) {
    return res.status(400).json({ error: `name, secret and type (${CONN_TYPES.join('/')}) required` })
  }
  // Every secret belongs to exactly one project; absent means Default.
  const pid = (projectId || '').trim() || 'default'
  if (!readProjects().some(p => p.id === pid)) {
    return res.status(400).json({ error: 'no such project' })
  }
  const s = readJson(SETTINGS_FILE, {})
  s.connections = s.connections || []
  // Names are unique per type within a project — different projects may
  // both have a "prod-db".
  if (s.connections.some(c => c.type === type && (c.projectId || 'default') === pid && c.name.toLowerCase() === name.trim().toLowerCase())) {
    return res.status(409).json({ error: `a ${type} connection named "${name}" already exists in this project` })
  }
  const conn = { id: Math.random().toString(36).slice(2, 10), name: name.trim(), type, secret: encryptSecret(secret.trim()), projectId: pid }
  s.connections.push(conn)
  writeJson(SETTINGS_FILE, s)
  res.json({ id: conn.id, name: conn.name, type: conn.type, projectId: conn.projectId })
})
app.put('/api/connections/:id', (req, res) => {
  const s = readJson(SETTINGS_FILE, {})
  const conn = (s.connections || []).find(c => c.id === req.params.id)
  if (!conn) return res.status(404).json({ error: 'no such connection' })
  if (!req.body?.secret?.trim()) return res.status(400).json({ error: 'secret required' })
  conn.secret = encryptSecret(req.body.secret.trim())
  writeJson(SETTINGS_FILE, s)
  res.json({ ok: true })
})

// Really test a connection — no fake greens. Each type gets the cheapest
// call that proves the credential works.
app.post('/api/connections/:id/test', async (req, res) => {
  const s = readJson(SETTINGS_FILE, {})
  const stored = (s.connections || []).find(c => c.id === req.params.id)
  if (!stored) return res.status(404).json({ error: 'no such connection' })
  // Decrypted in memory only, for the duration of the test.
  let conn
  try {
    conn = { ...stored, secret: decryptSecret(stored.secret) }
  } catch {
    return res.json({ ok: false, error: 'Stored secret could not be decrypted — the encryption key changed. Replace the secret below.' })
  }
  const redactErr = e => String(e.message || e).split(conn.secret).join('•••').slice(0, 200)
  try {
    if (conn.type === 'postgres') {
      const { default: pg } = await import('pg')
      const client = new pg.Client({ connectionString: conn.secret, connectionTimeoutMillis: 6000 })
      await client.connect()
      const r = await client.query('SELECT version()')
      await client.end()
      return res.json({ ok: true, note: String(r.rows[0]?.version || 'connected').split(' on ')[0] })
    }
    if (conn.type === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': conn.secret, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(8000),
      })
      if (!r.ok) throw new Error(`API answered ${r.status} — check the key`)
      const data = await r.json()
      return res.json({ ok: true, note: `${data.data?.length || 0} models available` })
    }
    if (conn.type === 'mcp') {
      const { connectMcp } = await import('./mcp.mjs')
      const mcp = await connectMcp(conn.secret)
      const tools = await mcp.listTools()
      mcp.close()
      return res.json({ ok: true, note: `${tools.length} tool${tools.length === 1 ? '' : 's'}: ${tools.slice(0, 4).map(t => t.name).join(', ')}${tools.length > 4 ? '…' : ''}` })
    }
    if (conn.type === 'smtp') {
      const { default: nodemailer } = await import('nodemailer')
      await nodemailer.createTransport(conn.secret).verify()
      return res.json({ ok: true, note: 'SMTP server accepted the credentials' })
    }
    if (conn.type === 'slack') {
      if (!/^https:\/\/hooks\.slack\.com\//.test(conn.secret)) throw new Error('Not a Slack incoming-webhook URL')
      return res.json({ ok: true, note: 'URL looks right — testing for real would post a message' })
    }
    if (conn.type === 'pagerduty') {
      if (!/^[a-zA-Z0-9]{20,}$/.test(conn.secret)) throw new Error('Routing keys are 32 characters — this does not look like one')
      return res.json({ ok: true, note: 'Key shape is valid — testing for real would open an incident' })
    }
    if (conn.type === 'ssh') {
      // Validate PEM key format — connecting needs the actual host from the step
      if (!conn.secret.includes('PRIVATE KEY') && !conn.secret.includes('BEGIN OPENSSH')) {
        throw new Error('Paste the full PEM private key — it should start with -----BEGIN … PRIVATE KEY-----')
      }
      const lines = conn.secret.trim().split('\n').length
      return res.json({ ok: true, note: `Key looks valid (${lines} lines) — host and user are set per step` })
    }
    if (conn.type === 'aws') {
      let creds
      try { creds = JSON.parse(conn.secret) } catch {
        throw new Error('AWS credentials must be JSON: {"accessKeyId":"AKIA…","secretAccessKey":"…","region":"us-east-1"}')
      }
      if (!creds.accessKeyId || !creds.secretAccessKey) {
        throw new Error('JSON must contain accessKeyId and secretAccessKey')
      }
      return res.json({ ok: true, note: `Region: ${creds.region || 'not set'} · key ID: ${creds.accessKeyId.slice(0, 8)}…` })
    }
    if (conn.type === 'k8s') {
      if (!conn.secret.includes('apiVersion') || !conn.secret.includes('clusters')) {
        throw new Error('Paste the full kubeconfig YAML — it should contain apiVersion and clusters')
      }
      const contextMatch = conn.secret.match(/current-context:\s*(.+)/)
      return res.json({ ok: true, note: `Kubeconfig valid${contextMatch ? ` · context: ${contextMatch[1].trim()}` : ''}` })
    }
    if (conn.type === 'github') {
      const r = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${conn.secret}`, 'User-Agent': 'steprail/1.0', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(8000),
      })
      if (!r.ok) throw new Error(`GitHub responded ${r.status} — check the token`)
      const data = await r.json()
      return res.json({ ok: true, note: `Authenticated as ${data.login} · ${data.name || ''}`.trim() })
    }
    return res.json({ ok: true, note: 'Stored — no test available for generic tokens' })
  } catch (err) {
    res.json({ ok: false, error: redactErr(err) })
  }
})

app.delete('/api/connections/:id', (req, res) => {
  const s = readJson(SETTINGS_FILE, {})
  const before = (s.connections || []).length
  s.connections = (s.connections || []).filter(c => c.id !== req.params.id)
  writeJson(SETTINGS_FILE, s)
  res.json({ ok: s.connections.length < before })
})
app.put('/api/settings', (req, res) => {
  const current = readJson(SETTINGS_FILE, {})
  const next = { ...current, ...req.body }
  for (const key of SECRET_KEYS) {
    if (req.body[key] === '') delete next[key]
    // Freshly supplied credentials encrypt before they touch disk.
    else if (typeof req.body[key] === 'string') next[key] = encryptSecret(req.body[key])
  }
  writeJson(SETTINGS_FILE, next)
  const flags = Object.fromEntries(SECRET_KEYS.map(key => [flagName(key), Boolean(next[key])]))
  res.json({ ok: true, ...flags })
})

// AI compose: the client sends a complete, self-contained prompt (schema +
// tool catalog + brief, built by src/flowjson.ts) and gets back one portable
// flow JSON object. Uses the Anthropic API when a key is configured in
// Settings; otherwise the client falls back to its local keyword planner.
app.post('/api/compose', async (req, res) => {
  const { prompt, projectId } = req.body || {}
  if (!prompt) return res.status(400).json({ error: 'prompt required' })
  // Key resolution for authoring: the caller's project's Anthropic connection
  // first, then the system-level key from Setup (works in every project —
  // StepHan is an authoring tool, not per-project flow execution).
  const raw = decryptSettings(readJson(SETTINGS_FILE, {}))
  const settings = scopeSettings(raw, projectId || 'default')
  let key = null
  try { key = resolveConn(settings, 'anthropic', '') } catch { /* fall back below */ }
  if (!key) key = raw.anthropicKey || null
  if (!key) return res.json({ fallback: true })

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        // Flow authoring is one-shot and quality-sensitive — use the strongest
        // model by default, independent of the per-step default (which may be
        // Haiku for cheap in-flow calls). Overridable in Settings.
        model: settings.composeModel || 'claude-opus-4-8',
        max_tokens: 4096,
        system: 'You are StepHan, an expert automation architect for steprail. You output ONE valid JSON flow object and nothing else. Every flow you author is complete and runnable: it ALWAYS starts with a trigger.* step, ALWAYS has at least one real action step after it, and every REQUIRED config key is filled with a sensible concrete value. Prefer the most specific tool for each job. Never emit a trigger with no actions, never leave prose outside the JSON.',
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await r.json()
    if (!r.ok) return res.json({ fallback: true, error: data?.error?.message })
    const text = data?.content?.[0]?.text || ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return res.json({ fallback: true })
    res.json({ flow: JSON.parse(match[0]) })
  } catch (err) {
    res.json({ fallback: true, error: String(err) })
  }
})

// Serve the built client in production.
const dist = path.join(__dirname, '..', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

armSchedules(readJson(FLOWS_FILE, []))
// The worker sees decrypted secrets in memory only; disk stays encrypted.
startWorker(() => decryptSettings(readJson(SETTINGS_FILE, {})))

const server = app.listen(PORT, () => console.log(`steprail api on :${PORT}`))

// Graceful shutdown: stop accepting connections, halt the worker, flush state.
let shuttingDown = false
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`steprail: ${sig} — shutting down cleanly`)
    // Don't hang forever if something won't drain.
    setTimeout(() => process.exit(0), 5000).unref()
    stopWorker()
    server.close(async () => {
      try { await drainWrites(); await closeStore() } catch { /* best effort */ }
      process.exit(0)
    })
  })
}
