// MIT License - Copyright (c) fintonlabs.com
// Durable persistence with a pluggable backend. Each logical document (flows,
// settings, versions, projects, queue) is one JSON row. The API is synchronous
// (getDoc/setDoc/hasDoc) so every caller stays unchanged.
//
//   Default   — SQLite (WAL): synchronous, atomic, crash-safe, zero-config.
//   Postgres  — set STEPRAIL_DB_URL=postgres://…  An external managed database
//               (backups, monitoring). Reads serve from an in-memory cache
//               loaded at boot; writes are serialized write-behind and drained
//               on graceful shutdown. Still single-instance — multi-instance HA
//               (a normalised event table + SKIP LOCKED) is a later feature.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The node:sqlite API surface we use is stable; silence only its experimental
// warning. Must run before node:sqlite loads, so that import is dynamic below.
const _emitWarning = process.emitWarning.bind(process)
process.emitWarning = (warning, ...rest) => {
  const msg = typeof warning === 'string' ? warning : warning?.message
  if (typeof msg === 'string' && msg.includes('SQLite is an experimental')) return
  return _emitWarning(warning, ...rest)
}

export const DATA_DIR = process.env.STEPRAIL_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
export const DB_FILE = path.join(DATA_DIR, 'steprail.db')

const PG_URL = (process.env.STEPRAIL_DB_URL || process.env.DATABASE_URL || '').trim()
const usePostgres = /^postgres(ql)?:\/\//i.test(PG_URL)

let getDoc, setDoc, hasDoc, drainWrites, closeStore

if (usePostgres) {
  // ---- Postgres backend: in-memory cache + serialized write-behind ----
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString: PG_URL, max: 4 })
  await pool.query(
    'CREATE TABLE IF NOT EXISTS steprail_documents (key text PRIMARY KEY, value jsonb NOT NULL, updated_at bigint NOT NULL)',
  )
  const cache = new Map()
  const { rows } = await pool.query('SELECT key, value FROM steprail_documents')
  for (const r of rows) cache.set(r.key, r.value) // jsonb comes back already parsed

  let chain = Promise.resolve() // one write at a time, in order
  const persist = (key, value) => {
    const snapshot = JSON.stringify(value)
    chain = chain
      .then(() => pool.query(
        'INSERT INTO steprail_documents (key, value, updated_at) VALUES ($1, $2::jsonb, $3) ' +
        'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at',
        [key, snapshot, Date.now()],
      ))
      .catch(err => console.error(`steprail: postgres write failed for "${key}" — ${err.message}`))
  }

  // structuredClone gives every reader an independent copy (matching SQLite's
  // JSON round-trip), so callers can't mutate the cache by reference.
  getDoc = (key, fallback) => (cache.has(key) ? structuredClone(cache.get(key)) : fallback)
  setDoc = (key, value) => { cache.set(key, structuredClone(value)); persist(key, value) }
  hasDoc = key => cache.has(key)
  drainWrites = () => chain
  closeStore = async () => { await chain; await pool.end() }
  console.log('steprail: persistence backend = postgres (single-instance)')
} else {
  // ---- SQLite backend (default): synchronous, WAL ----
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB_FILE)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)')
  try { fs.chmodSync(DB_FILE, 0o600) } catch { /* odd fs */ }

  const sel = db.prepare('SELECT value FROM documents WHERE key = ?')
  const up = db.prepare(
    'INSERT INTO documents (key, value, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  )
  getDoc = (key, fallback) => {
    const row = sel.get(key)
    if (!row) return fallback
    try { return JSON.parse(row.value) } catch { return fallback }
  }
  setDoc = (key, value) => up.run(key, JSON.stringify(value), Date.now())
  hasDoc = key => sel.get(key) !== undefined
  drainWrites = () => Promise.resolve() // SQLite writes are synchronous already
  closeStore = async () => { try { db.close() } catch { /* already closed */ } }
}

export { getDoc, setDoc, hasDoc, drainWrites, closeStore }

// One-time import of a pre-SQLite JSON file into its document row. Only when
// the row is absent, so it never clobbers live data.
export function importLegacyJson(key, file) {
  if (hasDoc(key)) return false
  try {
    setDoc(key, JSON.parse(fs.readFileSync(file, 'utf8')))
    return true
  } catch {
    return false
  }
}

export function schemaVersion() {
  return getDoc('__schema_version', 1)
}

// Migrate any pre-SQLite JSON files at module load — BEFORE the queue or the
// API read their documents (both import this module, whose body runs first).
for (const key of ['flows', 'settings', 'versions', 'projects', 'queue']) {
  if (importLegacyJson(key, path.join(DATA_DIR, `${key}.json`))) {
    console.log(`steprail: migrated ${key}.json → store`)
  }
}
