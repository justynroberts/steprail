// MIT License - Copyright (c) fintonlabs.com
// Minimal persistence + AI-compose proxy for newflow.
// All user-tunable config lives in the Settings UI and persists to data/settings.json.
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { approve, armSchedules, createRun, getRun, startWorker } from './queue.mjs'
import { executeStep } from './executors.mjs'
import { resolveConfigWith, seedVars, validateStep } from '../shared/enginecore.mjs'
import { toolCoreById } from '../shared/toolcore.mjs'

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
app.use(express.json({ limit: '2mb' }))

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

// ---------- live webhooks ----------
// Any request to /hooks/<path> starts every flow whose first step is a
// webhook trigger configured with that path.
app.all(/^\/hooks\/.*/, (req, res) => {
  const flows = readJson(FLOWS_FILE, [])
  const started = []
  for (const flow of flows) {
    const first = flow.steps?.[0]
    if (first?.toolId !== 'trigger.webhook') continue
    const want = (first.config?.path || '').replace(/\/+$/, '')
    if (want && req.path.replace(/\/+$/, '') === want) {
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
const SECRET_KEYS = ['anthropicKey', 'slackWebhookUrl', 'pagerdutyRoutingKey', 'smtpUrl', 'postgresUrl']
const flagName = k => 'has' + k[0].toUpperCase() + k.slice(1)

app.get('/api/settings', (_req, res) => {
  const s = readJson(SETTINGS_FILE, {})
  const out = { ...s }
  for (const key of SECRET_KEYS) {
    delete out[key]
    out[flagName(key)] = Boolean(s[key])
  }
  res.json(out)
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

app.listen(PORT, () => console.log(`newflow api on :${PORT}`))
