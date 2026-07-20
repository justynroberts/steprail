// MIT License - Copyright (c) fintonlabs.com
// Integration tests against a real server on a throwaway data dir. These
// pin down the behaviors that are easiest to silently regress: portable
// import hydration, flow versioning, the run lifecycle (loops, critical,
// resume/re-run, pinned triggers), and strict project scoping.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bootServer, flowOf, step } from './helpers.mjs'

let api, stop

before(async () => { ({ api, stop } = await bootServer()) })
after(() => stop())

// ---------- import (portable format → server hydration) ----------

test('import: hydrates steps, generates webhook paths, keeps critical:false', async () => {
  const r = await api.postJson('/api/flows/import', { flow: {
    name: 'Import hydration',
    steps: [
      { tool: 'trigger.webhook', name: 'Hook' },
      { tool: 'data.transform', name: 'Optional', critical: false, config: { code: 'return { ok: 1 }' } },
      { tool: 'no.such.tool', name: 'Bogus' },
      { tool: 'data.transform', name: 'Odd', config: { code: 'return {}', nonsense: 'x' } },
    ],
  } })
  assert.equal(r.steps, 3)
  assert.ok(r.warnings.some(w => w.includes('no.such.tool')))
  assert.ok(r.warnings.some(w => w.includes('nonsense')))
  const flow = (await api.get('/api/flows')).find(f => f.id === r.id)
  assert.match(flow.steps[0].config.path, /^\/hooks\//)
  assert.equal(flow.steps[1].critical, false)
  assert.ok(!('critical' in flow.steps[2]))
})

test('import: rejects a flow with no usable steps', async () => {
  const res = await api.post('/api/flows/import', { flow: { name: 'empty', steps: [{ tool: 'nope' }] } })
  assert.equal(res.status, 400)
})

// ---------- versioning ----------

test('versioning: edit stores previous state, coalesces, restore is undoable', async () => {
  const imp = await api.postJson('/api/flows/import', { flow: {
    name: 'Versioned', steps: [{ tool: 'data.transform', name: 'Only', config: { code: 'return { v: 1 }' } }],
  } })
  const all = await api.get('/api/flows')
  const idx = all.findIndex(f => f.id === imp.id)

  all[idx] = { ...all[idx], name: 'Versioned EDITED' }
  await api.put('/api/flows', all)
  let vers = await api.get(`/api/flows/${imp.id}/versions`)
  assert.equal(vers.length, 1)
  assert.equal(vers[0].name, 'Versioned')

  all[idx] = { ...all[idx], name: 'Versioned EDITED 2' }
  await api.put('/api/flows', all)
  vers = await api.get(`/api/flows/${imp.id}/versions`)
  assert.equal(vers.length, 1, 'second edit within 10 minutes coalesces')

  const rest = await api.postJson(`/api/flows/${imp.id}/restore`, { at: vers[0].at })
  assert.equal(rest.flow.name, 'Versioned')
  vers = await api.get(`/api/flows/${imp.id}/versions`)
  assert.equal(vers.length, 2, 'the replaced state becomes a version too')
  assert.equal(vers[0].name, 'Versioned EDITED 2')
})

// ---------- run lifecycle ----------

test('run: transform chain passes output downstream', async () => {
  const run = await api.run(flowOf([
    step('data.transform', 'A', { code: 'return { n: 21 }' }),
    step('data.transform', 'B', { code: 'return { doubled: input.output.n * 2 }' }),
  ]))
  const outs = Object.values(run.outputs)
  assert.ok(outs.some(o => JSON.stringify(o).includes('42')))
  assert.equal(Object.keys(run.errors).length, 0)
})

test('run: a failing step reports a plain-language error', async () => {
  const f = flowOf([step('data.transform', 'Boom', { code: "throw new Error('nope')" })])
  const run = await api.run(f)
  assert.match(Object.values(run.errors)[0], /nope/)
})

test('reports: a finished run lands in the persistent 30-day rollup', async () => {
  await api.run(flowOf([step('data.transform', 'A', { code: 'return { ok: 1 }' })]))
  const rep = await api.get('/api/reports')
  assert.ok(rep.stats.totalRuns >= 1, 'total runs counted')
  assert.equal(rep.stats.byDay.length, 30, '30-day chart window')
  const today = new Date().toISOString().slice(0, 10)
  const bucket = rep.stats.byDay.find(d => d.date === today)
  assert.ok(bucket && bucket.runs >= 1, "today's bucket has the run")
})

test('webhook: fires a run, payload reaches steps, last-trigger is pinned', async () => {
  const imp = await api.postJson('/api/flows/import', { flow: {
    name: 'Hooked',
    steps: [
      { tool: 'trigger.webhook', name: 'In' },
      { tool: 'data.transform', name: 'Greet', config: { code: "return { greeting: 'hello ' + input.body.who }" } },
    ],
  } })
  const flow = (await api.get('/api/flows')).find(f => f.id === imp.id)
  await api.post(flow.steps[0].config.path, { who: 'world' })
  let summary
  for (let i = 0; i < 50; i++) {
    const runs = await api.get(`/api/runs?flowId=${imp.id}`)
    summary = runs[0]
    if (summary && !summary.running) break
    await new Promise(r => setTimeout(r, 200))
  }
  const run = await api.waitRun(summary.id)
  assert.ok(JSON.stringify(run.outputs).includes('hello world'))

  const lt = await api.get(`/api/flows/${imp.id}/last-trigger`)
  assert.equal(lt.trigger.body.who, 'world')

  // Re-run replays the same trigger payload.
  const rr = await api.postJson(`/api/runs/${summary.id}/rerun`)
  const rerun = await api.waitRun(rr.runId)
  assert.ok(JSON.stringify(rerun.outputs).includes('hello world'))
})

test('resume: keeps the succeeded prefix, re-executes from the failure', async () => {
  const first = step('data.transform', 'First', { code: 'return { done: true }' })
  const breaks = step('data.transform', 'Breaks', { code: "throw new Error('deliberate')" })
  const f = flowOf([first, breaks])
  const run = await api.run(f)
  assert.equal(run.statuses[breaks.id], 'error')

  const res = await api.postJson(`/api/runs/${run.id}/resume`)
  const resumed = await api.waitRun(res.runId)
  assert.equal(resumed.statuses[first.id], 'success', 'copied, not re-run')
  assert.equal(resumed.statuses[breaks.id], 'error', 're-attempted')
  // Copied steps must not get a new span — proof they did not re-execute.
  const trace = await api.get(`/api/runs/${res.runId}/trace?format=otlp`)
  const spans = (trace.resourceSpans || []).flatMap(rs => rs.scopeSpans || []).flatMap(ss => ss.spans || [])
  assert.ok(!spans.some(s => s.name?.includes('First')))
})

test('resume: rejected when the run fully succeeded', async () => {
  const run = await api.run(flowOf([step('data.transform', 'Fine', { code: 'return { ok: true }' })]))
  const res = await api.post(`/api/runs/${run.id}/resume`)
  assert.equal(res.status, 400)
})

// ---------- loops + the critical flag ----------

test('loop: per-iteration entries; critical:false carries every pass to the end', async () => {
  const flaky = step('data.transform', 'Flaky',
    { code: "if ({{loop.index}} === 1) throw new Error('b is bad'); return { did: {{loop.index}} }" },
    { critical: false })
  const done = step('data.transform', 'Done', { code: 'return { done: true }' })
  const run = await api.run(flowOf([
    step('data.transform', 'Items', { code: "return { items: ['a','b','c'] }" }),
    step('logic.loop', 'Each', { items: 'input.output.items' }),
    flaky,
    done,
  ]))
  const flakyEntries = run.entries.filter(e => e.stepId === flaky.id)
  assert.deepEqual(flakyEntries.map(e => e.iter), ['1/3', '2/3', '3/3'])
  assert.deepEqual(flakyEntries.map(e => e.status), ['success', 'error', 'success'])
  assert.ok(flakyEntries.every(e => e.name.includes('·')), 'iteration names are suffixed')
  const doneEntries = run.entries.filter(e => e.stepId === done.id)
  assert.equal(doneEntries.length, 3, 'non-critical failure never stops the lane')
})

test('loop: a critical failure stops that pass and the remaining iterations', async () => {
  const flaky = step('data.transform', 'Flaky',
    { code: "if ({{loop.index}} === 1) throw new Error('b is bad'); return { did: {{loop.index}} }" })
  const done = step('data.transform', 'Done', { code: 'return { done: true }' })
  const run = await api.run(flowOf([
    step('data.transform', 'Items', { code: "return { items: ['a','b','c'] }" }),
    step('logic.loop', 'Each', { items: 'input.output.items' }),
    flaky,
    done,
  ]))
  const flakyEntries = run.entries.filter(e => e.stepId === flaky.id)
  assert.deepEqual(flakyEntries.map(e => e.status), ['success', 'error'], 'no third pass')
})

// ---------- branching ----------

test('branch: routes to the matching lane only', async () => {
  const hit = step('data.transform', 'Hit', { code: 'return { lane: "urgent" }' })
  const miss = step('data.transform', 'Miss', { code: 'return { lane: "routine" }' })
  const run = await api.run(flowOf([
    step('data.transform', 'Classify', { code: "return { label: 'urgent' }" }),
    step('logic.branch', 'Route', { on: 'output.label' }, { branches: [
      { id: 'b1', label: 'urgent', steps: [hit] },
      { id: 'b2', label: 'routine', steps: [miss] },
    ] }),
  ]))
  assert.equal(run.statuses[hit.id], 'success')
  assert.notEqual(run.statuses[miss.id], 'success')
})

// ---------- project scoping ----------

test('projects: {{config.*}} resolves per project, never across', async () => {
  const proj = await api.postJson('/api/projects', { name: 'Tenant B' })
  await api.put('/api/settings', { projectGlobals: {
    default: { env: 'default-env' },
    [proj.id]: { env: 'tenant-b-env' },
  } })
  const probe = pid => api.postJson('/api/test-step', {
    flow: { id: 'p1', name: 'p', projectId: pid, steps: [
      { id: 's1', toolId: 'data.transform', name: 'Env', config: { code: "return { env: '{{config.env}}' }" } },
    ] },
    stepId: 's1',
  })
  // data.transform wraps its return value under `output`.
  assert.equal((await probe('default')).output.output.env, 'default-env')
  assert.equal((await probe(proj.id)).output.output.env, 'tenant-b-env')
})

test('projects: secrets in one project are invisible to another', async () => {
  const proj = await api.postJson('/api/projects', { name: 'Tenant C' })
  const made = await api.postJson('/api/connections', {
    name: 'their-key', type: 'anthropic', secret: 'sk-ant-fake', projectId: proj.id,
  })
  assert.equal(made.projectId, proj.id)
  // A default-project AI step must NOT see Tenant C's key.
  const r = await api.postJson('/api/test-step', {
    flow: { id: 'p2', name: 'p', projectId: 'default', steps: [
      { id: 's1', toolId: 'ai.summarize', name: 'Sum', config: { text: 'hello' } },
    ] },
    stepId: 's1',
  })
  assert.match(r.error, /No Anthropic API key/)
})

test('projects: deleting a project moves its flows and secrets to Default', async () => {
  const proj = await api.postJson('/api/projects', { name: 'Doomed' })
  await api.postJson('/api/flows/import', {
    projectId: proj.id,
    flow: { name: 'Orphan-to-be', steps: [{ tool: 'data.transform', name: 'X', config: { code: 'return {}' } }] },
  })
  const res = await fetch(`${api.base}/api/projects/${proj.id}`, { method: 'DELETE' }).then(r => r.json())
  assert.equal(res.movedFlows, 1)
  const flow = (await api.get('/api/flows')).find(f => f.name === 'Orphan-to-be')
  assert.equal(flow.projectId, 'default')
})

// ---------- kubectl command hardening ----------

test('k8s command mode: refuses cluster/credential-redirection flags', async () => {
  const probe = command => api.postJson('/api/test-step', {
    flow: { id: 'k1', name: 'k', projectId: 'default', steps: [
      { id: 's1', toolId: 'infra.k8s', name: 'K', config: { mode: 'command', context: 'prod', command } },
    ] },
    stepId: 's1',
  })
  // Injected via a token from a webhook payload, these must fail closed.
  for (const cmd of [
    'kubectl get pods --kubeconfig=/tmp/evil',
    'kubectl get pods --server https://evil.example',
    'kubectl describe pod x --token=abc',
  ]) {
    const r = await probe(cmd)
    assert.match(r.error || '', /not allowed in a kubectl command/, cmd)
  }
  // A normal flagged command passes validation (fails later only if kubectl
  // is absent or the context is unknown — both different error texts).
  const ok = await probe('kubectl get pods -n prod -o wide')
  assert.ok(!/not allowed in a kubectl command/.test(ok.error || ''), JSON.stringify(ok).slice(0, 120))
})

// ---------- failure alerts ----------

test('failure alerts: unattended failures post to the NAMED Slack connection', async () => {
  const { createServer } = await import('node:http')
  const hits = { decoy: [], alerts: [] }
  const capture = bucket => createServer((req, res) => {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => { hits[bucket].push(body); res.end('ok') })
  })
  const decoySrv = capture('decoy').listen(0)
  const alertSrv = capture('alerts').listen(0)
  try {
    // Two Slack connections: the decoy is FIRST in the pool — only the name
    // lookup can reach the second one.
    await api.postJson('/api/connections', { name: 'general', type: 'slack', secret: `http://127.0.0.1:${decoySrv.address().port}/` })
    await api.postJson('/api/connections', { name: 'failed-workflows', type: 'slack', secret: `http://127.0.0.1:${alertSrv.address().port}/` })
    await api.put('/api/settings', { failureNotify: 'slack', failureNotifySlack: 'failed-workflows' })

    const imp = await api.postJson('/api/flows/import', { flow: {
      name: 'Alerting flow',
      steps: [
        { tool: 'trigger.webhook', name: 'In' },
        { tool: 'data.transform', name: 'Explodes', config: { code: "throw new Error('kaboom')" } },
      ],
    } })
    const flow = (await api.get('/api/flows')).find(f => f.id === imp.id)
    await api.post(flow.steps[0].config.path, { any: 'thing' })

    for (let i = 0; i < 50 && !hits.alerts.length; i++) await new Promise(r => setTimeout(r, 200))
    assert.equal(hits.alerts.length, 1, 'alert reached the named connection')
    const text = JSON.parse(hits.alerts[0]).text
    assert.match(text, /Alerting flow/)
    assert.match(text, /kaboom/)
    assert.equal(hits.decoy.length, 0, 'the first-in-pool connection was NOT used')
  } finally {
    decoySrv.close()
    alertSrv.close()
    await api.put('/api/settings', { failureNotify: 'off', failureNotifySlack: '' })
  }
})

// ---------- access token gate (last: it locks the API) ----------

test('api token: locks every /api route except health, unlocks when cleared', async () => {
  await api.put('/api/settings', { apiToken: 'test-token-123' })
  const locked = await fetch(`${api.base}/api/flows`)
  assert.equal(locked.status, 401)
  const health = await fetch(`${api.base}/api/health`)
  assert.equal(health.status, 200, 'health stays open')
  const keyed = await fetch(`${api.base}/api/flows`, { headers: { 'x-api-token': 'test-token-123' } })
  assert.equal(keyed.status, 200)
  // Clearing needs the token too — then the server is open again.
  await fetch(`${api.base}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-api-token': 'test-token-123' },
    body: JSON.stringify({ apiToken: '' }),
  })
  const open = await fetch(`${api.base}/api/flows`)
  assert.equal(open.status, 200)
})

// ---------- form dynamic-option lookups (SSRF surface) ----------
test('form-options: refuses a URL not saved in any flow (no SSRF proxy)', async () => {
  const res = await api.post('/api/form-options', {
    field: { label: 'Region', type: 'choice', optionsUrl: 'http://169.254.169.254/latest/meta-data/' },
  })
  assert.equal(res.status, 403)
})

test('form-options: a malformed field returns empty options, never a crash', async () => {
  const res = await api.postJson('/api/form-options', { field: { type: 'choice', optionsUrl: 'http://x' } })
  assert.deepEqual(res, { options: [] })
})

// ---------- readiness probe ----------
test('readiness: /api/ready reports the datastore is reachable', async () => {
  const r = await api.get('/api/ready')
  assert.equal(r.ready, true)
})

// ---------- metrics ----------
test('metrics: /api/metrics exposes Prometheus gauges (no auth needed)', async () => {
  const res = await fetch(`${api.base}/api/metrics`)
  assert.equal(res.status, 200)
  const body = await res.text()
  assert.match(body, /steprail_up 1/)
  assert.match(body, /steprail_queue_events\{state="queued"\}/)
  assert.match(body, /steprail_runs_total/)
})
