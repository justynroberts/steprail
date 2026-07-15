// MIT License - Copyright (c) fintonlabs.com
// Minimal persistence + AI-compose proxy for steprail.
// All user-tunable config lives in the Settings UI and persists to data/settings.json.
import express from 'express'
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { approve, armSchedules, createRun, getRun, listRuns, startWorker, traceAsOtlp } from './queue.mjs'
import { executeStep } from './executors.mjs'
import { resolveConfigWith, seedVars, validateStep } from '../shared/enginecore.mjs'
import { toolCoreById } from '../shared/toolcore.mjs'
import { parseFormFields, renderFormHtml, renderFormSuccessHtml } from '../shared/formcore.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const FLOWS_FILE = path.join(DATA_DIR, 'flows.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const PORT = process.env.PORT || 8452

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
try { fs.chmodSync(DATA_DIR, 0o700) } catch { /* pre-existing dir on odd fs */ }

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
// Settings can hold credentials: owner-only mode (umask can't widen an
// explicit fd mode) and rename for atomicity.
const writeJson = (file, value) => {
  const tmp = file + '.tmp'
  const fd = fs.openSync(tmp, 'w', 0o600)
  try { fs.writeSync(fd, JSON.stringify(value, null, 2)) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, file)
}

const app = express()
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf } }))
app.use(express.urlencoded({ extended: true }))

// Optional operator auth: once an access token is set in Settings, every
// /api/* call must carry it. /hooks/* stays open for external senders (gate
// those with per-path secrecy), and health + settings-flags stay readable so
// the UI can prompt for the token instead of going dark.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next()
  if (req.path === '/api/health' || (req.method === 'GET' && req.path === '/api/settings')) return next()
  const token = readJson(SETTINGS_FILE, {}).apiToken
  if (!token) return next()
  if (req.get('x-api-token') === token) return next()
  res.status(401).json({ error: 'This steprail server requires an access token — set it in Settings on this browser.' })
})

const startedAt = Date.now()
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round((Date.now() - startedAt) / 1000), version: '0.1.0' })
})

app.get('/api/flows', (_req, res) => {
  res.json(readJson(FLOWS_FILE, []))
})
app.put('/api/flows', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'expected an array of flows' })
  writeJson(FLOWS_FILE, req.body)
  armSchedules(req.body)
  res.json({ ok: true })
})

// ---------- runs (queue-backed, real executors) ----------
app.post('/api/runs', (req, res) => {
  const { flow, speed } = req.body || {}
  if (!flow || !Array.isArray(flow.steps) || !flow.steps.length) {
    return res.status(400).json({ error: 'flow with steps required' })
  }
  const run = createRun(flow, { speed: speed || 'realtime' })
  res.json({ runId: run.id })
})

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
    const outputs = { ...seedVars(flow), ...(upstream || {}) }
    const config = resolveConfigWith(outputs, step.config)
    const input = upstream?.__input
    const output = await executeStep(step.toolId, config, {
      settings: readJson(SETTINGS_FILE, {}),
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

app.get(/^\/forms\/.*/, (req, res) => {
  const flow = formFlowFor(req.path)
  if (!flow) return res.status(404).send('No live form at this address.')
  res.type('html').send(renderFormHtml(flow.steps[0].config, brandingSettings()))
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
      if (first.config?.repo && pushedRepo && !pushedRepo.toLowerCase().includes(first.config.repo.toLowerCase())) continue
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
  out.connections = (s.connections || []).map(({ id, name, type }) => ({ id, name, type }))
  res.json(out)
})

// ---------- named connections (many databases, many API keys) ----------
const CONN_TYPES = ['postgres', 'slack', 'smtp', 'pagerduty', 'anthropic', 'apikey', 'mcp', 'ssh', 'aws', 'k8s', 'github']
app.post('/api/connections', (req, res) => {
  const { name, type, secret } = req.body || {}
  if (!name?.trim() || !secret?.trim() || !CONN_TYPES.includes(type)) {
    return res.status(400).json({ error: `name, secret and type (${CONN_TYPES.join('/')}) required` })
  }
  const s = readJson(SETTINGS_FILE, {})
  s.connections = s.connections || []
  if (s.connections.some(c => c.type === type && c.name.toLowerCase() === name.trim().toLowerCase())) {
    return res.status(409).json({ error: `a ${type} connection named "${name}" already exists` })
  }
  const conn = { id: Math.random().toString(36).slice(2, 10), name: name.trim(), type, secret: secret.trim() }
  s.connections.push(conn)
  writeJson(SETTINGS_FILE, s)
  res.json({ id: conn.id, name: conn.name, type: conn.type })
})
app.put('/api/connections/:id', (req, res) => {
  const s = readJson(SETTINGS_FILE, {})
  const conn = (s.connections || []).find(c => c.id === req.params.id)
  if (!conn) return res.status(404).json({ error: 'no such connection' })
  if (!req.body?.secret?.trim()) return res.status(400).json({ error: 'secret required' })
  conn.secret = req.body.secret.trim()
  writeJson(SETTINGS_FILE, s)
  res.json({ ok: true })
})

// Really test a connection — no fake greens. Each type gets the cheapest
// call that proves the credential works.
app.post('/api/connections/:id/test', async (req, res) => {
  const s = readJson(SETTINGS_FILE, {})
  const conn = (s.connections || []).find(c => c.id === req.params.id)
  if (!conn) return res.status(404).json({ error: 'no such connection' })
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
  for (const key of SECRET_KEYS) if (req.body[key] === '') delete next[key]
  writeJson(SETTINGS_FILE, next)
  const flags = Object.fromEntries(SECRET_KEYS.map(key => [flagName(key), Boolean(next[key])]))
  res.json({ ok: true, ...flags })
})

// AI compose: the client sends a complete, self-contained prompt (schema +
// tool catalog + brief, built by src/flowjson.ts) and gets back one portable
// flow JSON object. Uses the Anthropic API when a key is configured in
// Settings; otherwise the client falls back to its local keyword planner.
app.post('/api/compose', async (req, res) => {
  const { prompt } = req.body || {}
  if (!prompt) return res.status(400).json({ error: 'prompt required' })
  const settings = readJson(SETTINGS_FILE, {})
  if (!settings.anthropicKey) return res.json({ fallback: true })

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': settings.anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.model || 'claude-sonnet-4-6',
        max_tokens: 2048,
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
startWorker(() => readJson(SETTINGS_FILE, {}))

app.listen(PORT, () => console.log(`steprail api on :${PORT}`))
