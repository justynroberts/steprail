// MIT License - Copyright (c) fintonlabs.com
// Minimal persistence + AI-compose proxy for newflow.
// All user-tunable config lives in the Settings UI and persists to data/settings.json.
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  res.json({ ok: true })
})

app.get('/api/settings', (_req, res) => {
  const s = readJson(SETTINGS_FILE, {})
  // Never ship the raw key back to the browser, only whether one is set.
  res.json({ ...s, anthropicKey: undefined, hasAnthropicKey: Boolean(s.anthropicKey) })
})
app.put('/api/settings', (req, res) => {
  const current = readJson(SETTINGS_FILE, {})
  const next = { ...current, ...req.body }
  if (req.body.anthropicKey === '') delete next.anthropicKey
  writeJson(SETTINGS_FILE, next)
  res.json({ ok: true, hasAnthropicKey: Boolean(next.anthropicKey) })
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

app.listen(PORT, () => console.log(`newflow api on :${PORT}`))
