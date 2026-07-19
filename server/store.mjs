// MIT License - Copyright (c) fintonlabs.com
// Durable persistence. Each logical document (flows, settings, versions,
// projects, queue) is a single JSON-valued row in SQLite (WAL mode), so every
// write is atomic and crash-safe — no torn files, no half-written queue. The
// API mirrors the old readJson/writeJson so callers are unchanged.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The node:sqlite API surface we use (exec/prepare/get/run) is stable; silence
// only its experimental-feature warning so the log stays clean. The override
// must be installed BEFORE node:sqlite loads, so the import is dynamic.
const _emitWarning = process.emitWarning.bind(process)
process.emitWarning = (warning, ...rest) => {
  const msg = typeof warning === 'string' ? warning : warning?.message
  if (typeof msg === 'string' && msg.includes('SQLite is an experimental')) return
  return _emitWarning(warning, ...rest)
}
const { DatabaseSync } = await import('node:sqlite')

export const DATA_DIR = process.env.STEPRAIL_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
export const DB_FILE = path.join(DATA_DIR, 'steprail.db')

const db = new DatabaseSync(DB_FILE)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA synchronous = NORMAL')
db.exec('PRAGMA busy_timeout = 5000')
db.exec('CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)')
try { fs.chmodSync(DB_FILE, 0o600) } catch { /* odd fs */ }

const selStmt = db.prepare('SELECT value FROM documents WHERE key = ?')
const upStmt = db.prepare(
  'INSERT INTO documents (key, value, updated_at) VALUES (?, ?, ?) ' +
  'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
)

export function getDoc(key, fallback) {
  const row = selStmt.get(key)
  if (!row) return fallback
  try { return JSON.parse(row.value) } catch { return fallback }
}

export function setDoc(key, value) {
  upStmt.run(key, JSON.stringify(value), Date.now())
}

export function hasDoc(key) {
  return selStmt.get(key) !== undefined
}

// One-time import of a pre-SQLite JSON file into its document row. Leaves the
// file in place (harmless, and a safety net) — only imports if the row is
// absent, so it never clobbers live data.
export function importLegacyJson(key, file) {
  if (hasDoc(key)) return false
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    setDoc(key, parsed)
    return true
  } catch {
    return false
  }
}

// A hook so the schema/migration story has a home as it grows (Phase 2+).
export function schemaVersion() {
  return getDoc('__schema_version', 1)
}

// Migrate any pre-SQLite JSON files at module load — BEFORE the queue or the
// API read their documents (both import this module, whose body runs first).
for (const key of ['flows', 'settings', 'versions', 'projects', 'queue']) {
  if (importLegacyJson(key, path.join(DATA_DIR, `${key}.json`))) {
    console.log(`steprail: migrated ${key}.json → SQLite`)
  }
}
