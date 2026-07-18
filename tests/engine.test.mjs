// MIT License - Copyright (c) fintonlabs.com
// Unit tests for the token machinery — pure functions, no server needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpolateWith } from '../shared/enginecore.mjs'
import { parseFormFields } from '../shared/formcore.mjs'

const fleet = {
  'SSH command': {
    hosts: {
      'dev.fintonlabs.com': { stdout: 'disk 42%', code: 0 },
      'manage.fintonlabs.com': { stdout: 'disk 71%', code: 0 },
    },
    ok: true,
  },
  Fetch: { output: { status: 200 } },
}

test('plain token resolves', () => {
  assert.equal(interpolateWith(fleet, 'status was {{Fetch.output.status}}'), 'status was 200')
})

test('greedy dotted-key resolution reaches dotted hostnames', () => {
  assert.equal(interpolateWith(fleet, '{{SSH command.hosts.dev.fintonlabs.com.stdout}}'), 'disk 42%')
})

test('wildcard matches every host, one scalar per line', () => {
  const out = interpolateWith(fleet, '{{SSH command.hosts.*.stdout}}')
  assert.deepEqual(out.split('\n'), ['disk 42%', 'disk 71%'])
})

test('multi-line wildcard matches are labeled with their source key', () => {
  const outputs = { S: { hosts: { h1: { stdout: 'line1\nline2' }, h2: { stdout: 'x\ny' } } } }
  const out = interpolateWith(outputs, '{{S.hosts.*.stdout}}')
  assert.ok(out.includes('── h1') && out.includes('── h2'), out)
})

test('wildcard over objects serializes as a JSON array', () => {
  const parsed = JSON.parse(interpolateWith(fleet, '{{SSH command.hosts.*}}'))
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].stdout, 'disk 42%')
})

test('unresolvable token passes through untouched', () => {
  const t = '{{SSH command.hosts.*.nothing}}'
  assert.equal(interpolateWith(fleet, t), t)
})

test('mixed text around tokens is preserved', () => {
  assert.equal(
    interpolateWith(fleet, 'before {{Fetch.output.status}} after'),
    'before 200 after',
  )
})

test('parseFormFields: accepts the form-builder JSON, rejects garbage', () => {
  const fields = parseFormFields(JSON.stringify([
    { key: 'customer', label: 'Customer', type: 'text', required: true },
    { key: 'amount', label: 'Amount', type: 'number' },
  ]))
  assert.equal(fields.length, 2)
  assert.equal(fields[0].required, true)
  assert.equal(fields[1].type, 'number')
  assert.deepEqual(parseFormFields('customer | Customer | text'), [])
  assert.deepEqual(parseFormFields(''), [])
})
