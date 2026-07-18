// MIT License - Copyright (c) fintonlabs.com
// Test harness: boots a real steprail server on a throwaway data dir and a
// free port, so the suite exercises the same code paths production runs —
// no mocks, and the developer's own data/ is never touched.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function bootServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steprail-test-'))
  const port = 8600 + (process.pid % 300)
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
    env: { ...process.env, PORT: String(port), STEPRAIL_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', d => { log += d })
  child.stderr.on('data', d => { log += d })

  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${base}/api/health`)
      if (r.ok) break
    } catch { /* not up yet */ }
    if (i === 49) throw new Error(`server did not come up on :${port}\n${log}`)
    await sleep(200)
  }

  const headers = { 'content-type': 'application/json' }
  const api = {
    base,
    get: p => fetch(base + p).then(r => r.json()),
    post: (p, body) => fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body ?? {}) }),
    postJson: (p, body) => fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body ?? {}) }).then(r => r.json()),
    put: (p, body) => fetch(base + p, { method: 'PUT', headers, body: JSON.stringify(body) }).then(r => r.json()),
    // Start a run from a flow snapshot and poll until it settles.
    run: async (flow, trigger) => {
      const { runId } = await api.postJson('/api/runs', { flow, speed: 'instant', ...(trigger ? { trigger } : {}) })
      return api.waitRun(runId)
    },
    waitRun: async runId => {
      for (let i = 0; i < 100; i++) {
        const run = await api.get(`/api/runs/${runId}`)
        if (!run.running) return { ...run, id: runId }
        await sleep(200)
      }
      throw new Error(`run ${runId} never finished`)
    },
  }

  const stop = () => {
    child.kill()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
  return { api, stop, dataDir }
}

// A minimal internal-format flow (the shape POST /api/runs takes).
let uid = 0
export const step = (toolId, name, config = {}, extra = {}) =>
  ({ id: `t${++uid}`, toolId, name, config, ...extra })
export const flowOf = (steps, extra = {}) =>
  ({ id: `tf${++uid}`, name: `test flow ${uid}`, projectId: 'default', steps, ...extra })
