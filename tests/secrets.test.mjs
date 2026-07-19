// MIT License - Copyright (c) fintonlabs.com
// Secret encryption + key rotation. Fresh module instances (cache-busted
// import) pick up the current env key, simulating a restart with a new key.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

const fresh = () => import(`../server/secrets.mjs?b=${Math.random().toString(36).slice(2)}`)
after(() => { delete process.env.STEPRAIL_ENCRYPTION_KEY; delete process.env.STEPRAIL_ENCRYPTION_KEY_PREVIOUS })

test('encrypt/decrypt round-trips with an env key', async () => {
  process.env.STEPRAIL_ENCRYPTION_KEY = 'key-one'
  const s = await fresh()
  const enc = s.encryptSecret('hunter2')
  assert.ok(enc.startsWith('enc:'))
  assert.equal(s.decryptSecret(enc), 'hunter2')
})

test('rotation: old ciphertext decrypts via previous key, then re-encrypts to the new key', async () => {
  process.env.STEPRAIL_ENCRYPTION_KEY = 'key-one'
  const old = await fresh()
  const cipher = old.encryptSecret('s3cret')

  // Rotate: new key current, old key demoted to previous.
  process.env.STEPRAIL_ENCRYPTION_KEY = 'key-two'
  process.env.STEPRAIL_ENCRYPTION_KEY_PREVIOUS = 'key-one'
  const next = await fresh()

  assert.equal(next.decryptSecret(cipher), 's3cret') // fallback to previous key

  const settings = { anthropicKey: cipher, connections: [{ secret: cipher }] }
  assert.equal(next.rotateSettingsInPlace(settings), true)
  assert.notEqual(settings.anthropicKey, cipher) // re-encrypted with the new key
  assert.equal(next.decryptSecret(settings.anthropicKey), 's3cret')
  assert.equal(next.decryptSecret(settings.connections[0].secret), 's3cret')
})
