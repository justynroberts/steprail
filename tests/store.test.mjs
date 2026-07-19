// MIT License - Copyright (c) fintonlabs.com
// The SQLite document store: round-trip, defaults, legacy-JSON migration, and
// durability across a reopen (simulated restart). Runs in an isolated temp dir.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-store-'))
before(() => { process.env.STEPRAIL_DATA_DIR = dir })
after(() => fs.rmSync(dir, { recursive: true, force: true }))

// Fresh module instance each time (new DB connection) to simulate a restart.
const freshStore = () => import(`../server/store.mjs?bust=${Math.random().toString(36).slice(2)}`)

test('getDoc returns the fallback when a key is absent', async () => {
  const s = await freshStore()
  assert.deepEqual(s.getDoc('nope', { a: 1 }), { a: 1 })
})

test('setDoc then getDoc round-trips JSON', async () => {
  const s = await freshStore()
  s.setDoc('thing', { hello: 'world', n: [1, 2, 3] })
  assert.deepEqual(s.getDoc('thing', null), { hello: 'world', n: [1, 2, 3] })
})

test('data survives a store reopen (restart-safe)', async () => {
  const a = await freshStore()
  a.setDoc('queue', { events: [{ id: 'e1', state: 'queued' }] })
  const b = await freshStore() // new connection to the same DB file
  assert.deepEqual(b.getDoc('queue', {}).events, [{ id: 'e1', state: 'queued' }])
})

test('importLegacyJson migrates a JSON file once, never clobbering live data', async () => {
  const s = await freshStore()
  const file = path.join(dir, 'legacy.json')
  fs.writeFileSync(file, JSON.stringify([{ name: 'old' }]))
  assert.equal(s.importLegacyJson('legacy', file), true)
  assert.deepEqual(s.getDoc('legacy', []), [{ name: 'old' }])
  // Second call is a no-op — the row already exists.
  s.setDoc('legacy', [{ name: 'live' }])
  assert.equal(s.importLegacyJson('legacy', file), false)
  assert.deepEqual(s.getDoc('legacy', []), [{ name: 'live' }])
})
