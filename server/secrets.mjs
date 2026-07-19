// MIT License - Copyright (c) fintonlabs.com
// Encryption at rest for stored credentials. Values are AES-256-GCM
// encrypted before they touch disk and decrypted only in memory at the
// point of use; data/settings.json never holds a plaintext secret.
//
// The key comes from the STEPRAIL_ENCRYPTION_KEY environment variable
// (any string — hashed to 32 bytes), or an auto-generated key file at
// data/.encryption-key (0600). Losing the key means stored secrets cannot
// be recovered — re-enter them in the Secrets page.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KEY_FILE = path.join(process.env.STEPRAIL_DATA_DIR || path.join(__dirname, '..', 'data'), '.encryption-key')
const PREFIX = 'enc:v1:'

let cachedKey = null
function loadKey() {
  if (cachedKey) return cachedKey
  const env = (process.env.STEPRAIL_ENCRYPTION_KEY || '').trim()
  if (env) {
    cachedKey = createHash('sha256').update(env).digest()
    return cachedKey
  }
  try {
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim()
    if (/^[0-9a-f]{64}$/i.test(hex)) {
      cachedKey = Buffer.from(hex, 'hex')
      return cachedKey
    }
  } catch { /* no key yet — generate below */ }
  const key = randomBytes(32)
  const fd = fs.openSync(KEY_FILE, 'w', 0o600)
  try { fs.writeSync(fd, key.toString('hex') + '\n') } finally { fs.closeSync(fd) }
  cachedKey = key
  if (process.env.NODE_ENV === 'production') {
    console.warn('steprail: SECURITY — no STEPRAIL_ENCRYPTION_KEY set; generated one in data/.encryption-key. ' +
      'In production, supply the key from the environment / a secret store (not the data volume). See docs/PRODUCTION-READINESS.md.')
  }
  return cachedKey
}

// Optional previous key (STEPRAIL_ENCRYPTION_KEY_PREVIOUS) enables zero-downtime
// rotation: reads fall back to it, writes use the new key, and a boot pass
// re-encrypts everything so the old key can be retired.
function previousKey() {
  const env = (process.env.STEPRAIL_ENCRYPTION_KEY_PREVIOUS || '').trim()
  return env ? createHash('sha256').update(env).digest() : null
}

export const isEncrypted = value => typeof value === 'string' && value.startsWith(PREFIX)

export function encryptSecret(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext || isEncrypted(plaintext)) return plaintext
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', loadKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return PREFIX + iv.toString('hex') + ':' + cipher.getAuthTag().toString('hex') + ':' + enc.toString('hex')
}

export function decryptSecret(value) {
  if (!isEncrypted(value)) return value // legacy plaintext passes through
  const [ivHex, tagHex, dataHex] = value.slice(PREFIX.length).split(':')
  // Try the current key, then the previous one (rotation window).
  let lastErr
  for (const key of [loadKey(), previousKey()].filter(Boolean)) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
      return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('secret could not be decrypted')
}

// Every field in settings that holds a credential.
export const SECRET_SETTINGS_KEYS = ['anthropicKey', 'slackWebhookUrl', 'pagerdutyRoutingKey', 'smtpUrl', 'postgresUrl', 'apiToken']

// Read-side: a copy of settings with every secret decrypted, for the queue
// worker and API handlers. A value that fails to decrypt (encryption key
// changed) becomes '' so the executor reports the connection as missing
// instead of crashing the worker.
let warnedBadKey = false
const safeDecrypt = value => {
  try {
    return decryptSecret(value)
  } catch {
    if (!warnedBadKey) {
      warnedBadKey = true
      console.error('steprail: a stored secret could not be decrypted — the encryption key (data/.encryption-key or STEPRAIL_ENCRYPTION_KEY) changed. Re-enter secrets in the Secrets page.')
    }
    return ''
  }
}

export function decryptSettings(settings) {
  const out = { ...settings }
  for (const key of SECRET_SETTINGS_KEYS) {
    if (out[key]) out[key] = safeDecrypt(out[key])
  }
  if (Array.isArray(out.connections)) {
    out.connections = out.connections.map(c => (c.secret ? { ...c, secret: safeDecrypt(c.secret) } : c))
  }
  return out
}

// Write-side: encrypt any plaintext secrets in place. Returns true when
// something changed (used by the boot migration to decide whether to save).
export function encryptSettingsInPlace(settings) {
  let dirty = false
  for (const key of SECRET_SETTINGS_KEYS) {
    if (settings[key] && !isEncrypted(settings[key])) {
      settings[key] = encryptSecret(settings[key])
      dirty = true
    }
  }
  for (const c of settings.connections || []) {
    if (c.secret && !isEncrypted(c.secret)) {
      c.secret = encryptSecret(c.secret)
      dirty = true
    }
  }
  return dirty
}

// Rotation: when a previous key is configured, decrypt every secret (falling
// back to the old key) and re-encrypt with the current key. Returns true when
// anything was rewritten. No-op unless STEPRAIL_ENCRYPTION_KEY_PREVIOUS is set.
export function rotateSettingsInPlace(settings) {
  if (!previousKey()) return false
  let dirty = false
  const reenc = v => { if (!isEncrypted(v)) return v; dirty = true; return encryptSecret(decryptSecret(v)) }
  for (const key of SECRET_SETTINGS_KEYS) if (settings[key]) settings[key] = reenc(settings[key])
  for (const c of settings.connections || []) if (c.secret) c.secret = reenc(c.secret)
  return dirty
}
