// MIT License - Copyright (c) fintonlabs.com
// Guards that protect the outbound-fetch and public surfaces. Offline-only:
// IP-literal checks and the limiter need no network, so CI is deterministic.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBlockedIp, assertPublicHttpUrl } from '../server/safefetch.mjs'
import { makeLimiter } from '../server/security.mjs'
import { optionsFromResponse } from '../shared/formcore.mjs'

test('isBlockedIp: blocks loopback / private / metadata / CGNAT / ULA', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.169.254',
    '100.64.0.1', '::1', 'fd12:3456::1', '::ffff:127.0.0.1']) {
    assert.equal(isBlockedIp(ip), true, `${ip} should be blocked`)
  }
})

test('isBlockedIp: allows public addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
    assert.equal(isBlockedIp(ip), false, `${ip} should be allowed`)
  }
})

test('assertPublicHttpUrl: rejects non-http, loopback and metadata targets', async () => {
  await assert.rejects(() => assertPublicHttpUrl('file:///etc/passwd'))
  await assert.rejects(() => assertPublicHttpUrl('http://127.0.0.1:5432/'))
  await assert.rejects(() => assertPublicHttpUrl('http://localhost:8452/api/settings'))
  await assert.rejects(() => assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/'))
})

test('makeLimiter: allows up to max then returns 429', () => {
  const mw = makeLimiter({ windowMs: 10_000, max: 2, name: 'test' })
  const hit = () => {
    let status = 200
    const res = { setHeader() {}, status(s) { status = s; return this }, json() { return this } }
    let nexted = false
    mw({ ip: '9.9.9.9', socket: {} }, res, () => { nexted = true })
    return { status, nexted }
  }
  assert.deepEqual(hit(), { status: 200, nexted: true })
  assert.deepEqual(hit(), { status: 200, nexted: true })
  assert.equal(hit().status, 429) // third request over the limit
})

test('makeLimiter: separate IPs get separate buckets', () => {
  const mw = makeLimiter({ windowMs: 10_000, max: 1 })
  const hit = ip => {
    const res = { setHeader() {}, status() { return this }, json() { return this } }
    let nexted = false
    mw({ ip, socket: {} }, res, () => { nexted = true })
    return nexted
  }
  assert.equal(hit('1.1.1.1'), true)
  assert.equal(hit('2.2.2.2'), true) // different IP, its own budget
})

test('optionsFromResponse: strings, objects, key-mapping, object-maps, bad path', () => {
  assert.deepEqual(optionsFromResponse({}, ['a', 'b']),
    [{ value: 'a', label: 'a' }, { value: 'b', label: 'b' }])
  assert.deepEqual(optionsFromResponse({}, [{ id: 1, name: 'Ana' }]),
    [{ value: '1', label: 'Ana' }])
  assert.deepEqual(
    optionsFromResponse({ optionsPath: 'data.users', optionsLabel: 'full', optionsValue: 'uuid' },
      { data: { users: [{ uuid: 'x1', full: 'Alice' }] } }),
    [{ value: 'x1', label: 'Alice' }])
  assert.deepEqual(optionsFromResponse({}, { us: 'United States' }),
    [{ value: 'us', label: 'United States' }])
  assert.deepEqual(optionsFromResponse({ optionsPath: 'nope.here' }, { data: {} }), [])
})
