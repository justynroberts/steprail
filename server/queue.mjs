// MIT License - Copyright (c) fintonlabs.com
// The event queue. One JSON file, one worker loop; every run is a chain of
// small persisted events, which is what makes waits, approvals, retries and
// restarts trivial. The storage layer is these four functions — swapping in
// Redis or SQLite later changes nothing above them.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { resolveConfigWith, seedVars, validateStep } from '../shared/enginecore.mjs'
import { nextOccurrence, parseSchedule } from '../shared/schedule.mjs'
import { executeStep, resolveConn } from './executors.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const QUEUE_FILE = path.join(process.env.STEPRAIL_DATA_DIR || path.join(__dirname, '..', 'data'), 'queue.json')
const FLOWS_FILE = path.join(process.env.STEPRAIL_DATA_DIR || path.join(__dirname, '..', 'data'), 'flows.json')

const uid = () => Math.random().toString(36).slice(2, 10)
const randHex = n => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')

const readFlowsFile = () => {
  try { return JSON.parse(fs.readFileSync(FLOWS_FILE, 'utf8')) } catch { return [] }
}

// ---------- storage ----------
let db = { events: [], runs: {} }
try {
  db = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'))
} catch { /* fresh queue */ }

const persist = () => {
  const tmp = QUEUE_FILE + '.tmp'
  const fd = fs.openSync(tmp, 'w', 0o600)
  try { fs.writeSync(fd, JSON.stringify(db)) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, QUEUE_FILE)
}

// On boot, events stuck in `running` (crash mid-step) go back to queued.
for (const e of db.events) if (e.state === 'running') e.state = 'queued'

// ---------- run bookkeeping ----------
const PACE = { realtime: 450, fast: 150, instant: 0 }

// `iter` separates repeat executions (loop/until passes) into their OWN
// entries in the run timeline — "worked on pass 1, failed on pass 2" stays
// visible instead of the last pass overwriting the first. Card status and
// outputs (statuses/outputs maps) keep last-write semantics.
function mark(run, step, status, extra = {}, iter = undefined) {
  run.statuses[step.id] = status
  if (extra.output !== undefined) run.outputs[step.id] = extra.output
  if (extra.error) run.errors[step.id] = extra.error
  if (status === 'success') delete run.errors[step.id]
  const existing = run.entries.find(e => e.stepId === step.id && e.iter === iter)
  if (existing) {
    Object.assign(existing, { status, ...extra })
    if (status === 'success') delete existing.error
  } else {
    const name = iter ? `${step.name} · ${iter}` : step.name
    run.entries.push({ stepId: step.id, name, toolId: step.toolId, status, ms: 0, ...(iter ? { iter } : {}), ...extra })
  }
}

// Multi-host outputs (ssh fleets, ansible) expand into one informational
// row per host, so one machine failing is visible in the run timeline even
// when the step as a whole carried on.
function expandHostEntries(run, step, output, iter) {
  const hosts = output?.hosts
  if (!hosts || typeof hosts !== 'object' || Array.isArray(hosts)) return
  for (const [host, r] of Object.entries(hosts).slice(0, 20)) {
    if (!r || typeof r !== 'object') continue
    const bad = r.ok === false || (typeof r.failed === 'number' && r.failed > 0) || (typeof r.unreachable === 'number' && r.unreachable > 0)
    const hostIter = iter ? `${host} · ${iter}` : host
    run.entries.push({
      stepId: step.id,
      name: `${step.name} · ${hostIter}`,
      toolId: step.toolId,
      status: bad ? 'error' : 'success',
      ms: 0,
      iter: hostIter,
      ...(bad && r.error ? { error: r.error } : {}),
    })
  }
}

// Errors are user-facing; configured secrets must never appear in them.
function redact(message) {
  let msg = String(message)
  const settings = readSettings()
  const secrets = [
    ...(settings.connections || []).map(c => c.secret),
    settings.anthropicKey, settings.slackWebhookUrl, settings.pagerdutyRoutingKey,
    settings.smtpUrl, settings.postgresUrl, settings.apiToken,
  ].filter(s => s && s.length > 4)
  for (const secret of secrets) msg = msg.split(secret).join('•••')
  return msg
}

const listAt = (steps, hops) => {
  let list = steps
  for (const hop of hops) {
    const step = list.find(s => s.id === hop.stepId)
    const branch = step?.branches?.find(b => b.id === hop.branchId)
    if (!branch) return null
    list = branch.steps
  }
  return list
}

const markSkippedDeep = (run, step) => {
  mark(run, step, 'skipped')
  for (const b of step.branches || []) b.steps.forEach(s => markSkippedDeep(run, s))
}

function queueAll(run, steps) {
  for (const s of steps) {
    run.statuses[s.id] = 'queued'
    for (const b of s.branches || []) queueAll(run, b.steps)
  }
}

// ---------- projects ----------
// A project is the tenant boundary. Steps resolving a connection see ONLY
// their flow's project's connections — strict scoping, enforced here at
// execution time, not just hidden in the UI. Pre-projects records belong to
// "default" (index.mjs migrates them at boot; the || fallback covers races).
export function scopeSettings(settings, projectId) {
  const pid = projectId || 'default'
  const scoped = { ...settings, connections: (settings.connections || []).filter(c => (c.projectId || 'default') === pid) }
  // The pre-connections single-value credentials (settings.postgresUrl etc.)
  // act as unnamed defaults in resolveConn — they belong to Default only.
  if (pid !== 'default') {
    for (const key of ['postgresUrl', 'slackWebhookUrl', 'smtpUrl', 'pagerdutyRoutingKey', 'anthropicKey']) {
      delete scoped[key]
    }
  }
  return scoped
}

// {{config.*}} values a flow in this project sees. Legacy settings.globals
// only exists until the boot migration folds it into default's config.
export function scopedGlobals(settings, projectId) {
  const pid = projectId || 'default'
  const legacy = pid === 'default' ? settings.globals || {} : {}
  return { ...legacy, ...((settings.projectGlobals || {})[pid] || {}) }
}

// ---------- public API ----------
export function createRun(flow, { speed = 'realtime', trigger = null } = {}) {
  const run = {
    id: `run_${uid()}`,
    flowId: flow.id,
    flowName: flow.name,
    projectId: flow.projectId || 'default',
    flow, // snapshot: mid-run edits never corrupt an execution
    speed,
    trigger,
    running: true,
    statuses: {},
    outputs: {},
    errors: {},
    entries: [],
    laneCounters: {},
    // Seeded once so {{system.*}} (incl. runId) is stable across the run.
    // Config values ride along as {{config.*}}, scoped to the flow's project.
    tokenOutputs: { ...seedVars(flow), config: scopedGlobals(readSettings(), flow.projectId) },
    // OpenTelemetry: the run is a trace, each step becomes a span.
    traceId: randHex(32),
    rootSpanId: randHex(16),
    spans: [],
    startedAt: Date.now(),
  }
  queueAll(run, flow.steps)
  db.runs[run.id] = run
  // Pin the real trigger payload: the editor's token chips and step tests
  // use the last thing that actually arrived, not invented samples.
  if (trigger && flow.id) {
    db.lastTriggers = db.lastTriggers || {}
    db.lastTriggers[flow.id] = trigger
  }
  enqueue(run, { hops: [], index: 0 })
  pruneRuns()
  persist()
  return run
}

export const getLastTrigger = flowId => (db.lastTriggers || {})[flowId] || null

// Re-run: same flow snapshot, same trigger payload — "do that exact run again".
export function rerunRun(id) {
  const old = db.runs[id]
  if (!old) return null
  return createRun(old.flow, { speed: old.speed || 'instant', trigger: old.trigger })
}

// Resume: a new run that KEEPS everything that succeeded and re-executes
// from the first root step whose subtree didn't fully succeed (lane
// failures re-run their branch step). Prior outputs/tokens carry over so
// downstream references resolve identically.
export function resumeRun(id) {
  const old = db.runs[id]
  if (!old || old.running) return null
  const subtreeOk = step => {
    if ((old.statuses[step.id] || 'queued') !== 'success') return false
    return (step.branches || []).every(b => b.steps.every(s => (old.statuses[s.id] || 'queued') === 'success' || old.statuses[s.id] === 'skipped'))
      && !(step.branches || []).some(b => b.steps.some(function bad(s) { return old.statuses[s.id] === 'error' || (s.branches || []).some(x => x.steps.some(bad)) }))
  }
  const startIdx = old.flow.steps.findIndex(s => !subtreeOk(s))
  if (startIdx === -1) return null // everything succeeded — use rerun instead
  const run = createRun(old.flow, { speed: 'instant', trigger: old.trigger })
  // Drop the auto-enqueued start-at-0 event; preload the successful prefix.
  db.events = db.events.filter(e => e.runId !== run.id)
  const copyDeep = step => {
    run.statuses[step.id] = old.statuses[step.id]
    if (old.outputs[step.id] !== undefined) {
      run.outputs[step.id] = old.outputs[step.id]
      run.tokenOutputs[step.name] = old.outputs[step.id]
    }
    for (const b of step.branches || []) b.steps.forEach(copyDeep)
  }
  const prefixIds = new Set()
  const collectIds = step => { prefixIds.add(step.id); (step.branches || []).forEach(b => b.steps.forEach(collectIds)) }
  for (const s of old.flow.steps.slice(0, startIdx)) { copyDeep(s); collectIds(s) }
  run.entries.push(...old.entries.filter(e => prefixIds.has(e.stepId)).map(e => ({ ...e })))
  enqueue(run, { hops: [], index: startIdx })
  persist()
  return run
}

export const getRun = id => db.runs[id]

export function listRuns(flowId) {
  return Object.values(db.runs)
    .filter(r => r.flowId === flowId)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 20)
    .map(r => ({
      id: r.id,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      running: r.running,
      ok: r.entries.filter(e => e.status === 'success').length,
      failed: r.entries.filter(e => e.status === 'error').length,
      waiting: r.entries.filter(e => e.status === 'waiting').length,
      trigger: r.trigger ? r.trigger.trigger || 'webhook' : 'manual',
    }))
}

export function approve(runId, stepId, approver) {
  const event = db.events.find(e => e.runId === runId && e.stepId === stepId && e.state === 'waiting')
  if (!event) return false
  event.state = 'queued'
  event.approvedBy = approver || 'ui'
  event.not_before = 0
  persist()
  return true
}

function enqueue(run, address, extra = {}) {
  const list = listAt(run.flow.steps, address.hops)
  const step = list?.[address.index]
  db.events.push({
    id: uid(),
    runId: run.id,
    kind: 'step.run',
    address,
    stepId: step?.id || null,
    state: 'queued',
    not_before: Date.now() + (PACE[run.speed] ?? 450),
    attempts: 0,
    createdAt: Date.now(),
    ...extra,
  })
}

function pruneRuns() {
  const ids = Object.keys(db.runs).sort((a, b) => db.runs[b].startedAt - db.runs[a].startedAt)
  for (const id of ids.slice(40)) {
    delete db.runs[id]
    db.events = db.events.filter(e => e.runId !== id)
  }
}

// ---------- execution ----------
const DURATION_RE = /^(\d+)\s*(s|m|h|d)$/i
const DURATION_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

// ---------- OpenTelemetry ----------
function endSpan(run, event, step, status, error) {
  run.spans.push({
    spanId: event.spanId,
    parentSpanId: run.rootSpanId,
    name: step.name,
    tool: step.toolId,
    stepId: step.id,
    start: event.spanStart,
    end: Date.now(),
    status,
    error: error || undefined,
    attrs: {
      'steprail.tool': step.toolId,
      'steprail.step_id': step.id,
      'steprail.attempts': (event.attempts || 0) + 1,
      ...(event.loop ? { 'steprail.loop_iteration': event.loop.i } : {}),
    },
    events: event.spanEvents || [],
  })
}

const otlpAttr = ([key, value]) => ({
  key,
  value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: String(value) },
})

export function traceAsOtlp(run) {
  const toSpan = s => ({
    traceId: run.traceId,
    spanId: s.spanId,
    parentSpanId: s.parentSpanId || undefined,
    name: s.name,
    kind: 1,
    startTimeUnixNano: String(s.start) + '000000',
    endTimeUnixNano: String(s.end) + '000000',
    attributes: Object.entries(s.attrs || {}).map(otlpAttr),
    events: (s.events || []).map(e => ({ timeUnixNano: String(e.time) + '000000', name: e.name, attributes: e.note ? [otlpAttr(['note', e.note])] : [] })),
    status: s.status === 'error' ? { code: 2, message: s.error || '' } : { code: 1 },
  })
  const root = {
    spanId: run.rootSpanId,
    name: `flow ${run.flowName}`,
    start: run.startedAt,
    end: run.finishedAt || Date.now(),
    status: Object.keys(run.errors).length ? 'error' : 'ok',
    attrs: { 'steprail.flow': run.flowName, 'steprail.trigger': run.trigger?.trigger || 'manual', 'steprail.run_id': run.id },
  }
  return {
    resourceSpans: [{
      resource: { attributes: [otlpAttr(['service.name', 'steprail'])] },
      scopeSpans: [{ scope: { name: 'steprail', version: '0.1.0' }, spans: [root, ...run.spans].map(toSpan) }],
    }],
  }
}

// The trust feature: a run that fails while nobody is watching (schedule,
// webhook, form, subflow — anything non-manual) announces itself. Manual
// runs stay quiet; the operator is looking at the rail already.
async function notifyFailure(run) {
  const settings = readSettings()
  const mode = settings.failureNotify || 'off'
  if (mode === 'off') return
  const failed = run.entries.filter(e => e.status === 'error')
  const first = failed[0]
  const text = `steprail: flow "${run.flowName}" failed (${run.trigger?.trigger || 'triggered'} run) — ${first ? `${first.name}: ${first.error}` : 'see the run timeline'}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ''}`
  const scoped = scopeSettings(settings, run.projectId)
  if (mode === 'slack' || mode === 'both') {
    try {
      const webhook = resolveConn(scoped, 'slack', '')
      if (webhook) await fetch(webhook, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }), signal: AbortSignal.timeout(8000),
      })
    } catch { /* alerting must never break the queue */ }
  }
  if ((mode === 'email' || mode === 'both') && settings.failureNotifyEmail) {
    try {
      const smtpUrl = resolveConn(scoped, 'smtp', '')
      if (smtpUrl) {
        const { default: nodemailer } = await import('nodemailer')
        await nodemailer.createTransport(smtpUrl).sendMail({
          from: settings.smtpFrom || 'steprail@localhost',
          to: settings.failureNotifyEmail,
          subject: `steprail: "${run.flowName}" failed`,
          text,
        })
      }
    } catch { /* alerting must never break the queue */ }
  }
}

function finalizeRun(run) {
  run.running = false
  run.finishedAt = Date.now()
  if (Object.keys(run.errors).length && run.trigger && run.trigger.trigger !== 'manual') void notifyFailure(run)
  const endpoint = (readSettings().otlpEndpoint || '').trim()
  if (endpoint) {
    const url = endpoint.replace(/\/+$/, '') + '/v1/traces'
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(traceAsOtlp(run)),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => { /* collector down — traces still live in the run */ })
  }
}

function finishLane(run, hops) {
  if (hops.length === 0) {
    finalizeRun(run)
    return
  }
  const parentHops = hops.slice(0, -1)
  const branchStepId = hops[hops.length - 1].stepId
  run.laneCounters[branchStepId] = (run.laneCounters[branchStepId] || 1) - 1
  if (run.laneCounters[branchStepId] <= 0) {
    const parentList = listAt(run.flow.steps, parentHops)
    const idx = parentList.findIndex(s => s.id === branchStepId)
    // Restore the loop/until context the branch step was running under —
    // without this, a branch inside a loop would stop iterating after the
    // first item (the fan-in re-enqueue lost the loop).
    const ctx = (run.laneCtx || {})[branchStepId] || {}
    enqueue(run, { hops: parentHops, index: idx + 1 }, { ...(ctx.loop ? { loop: ctx.loop } : {}), ...(ctx.until ? { until: ctx.until } : {}) })
  }
}

const wrapItem = item => (item !== null && typeof item === 'object' ? item : { value: item })
const LOOP_CAP = 20

async function processEvent(event) {
  const run = db.runs[event.runId]
  if (!run) return
  const { hops, index } = event.address
  const list = listAt(run.flow.steps, hops)
  const step = list?.[index]

  // Past the end of a lane: iterate an active loop, re-check an Until,
  // else the lane is done.
  if (!step) {
    const loop = event.loop
    if (loop && loop.i < loop.items.length - 1) {
      const i = loop.i + 1
      run.tokenOutputs = { ...run.tokenOutputs, item: wrapItem(loop.items[i]), loop: { index: i, count: loop.items.length } }
      enqueue(run, { hops, index: loop.loopIndex + 1 }, { loop: { ...loop, i }, ...(event.until ? { until: event.until } : {}) })
      return
    }
    const until = event.until
    if (until) {
      const lastStep = list[list.length - 1]
      const input = lastStep ? run.outputs[lastStep.id] : undefined
      let satisfied = false
      try {
        satisfied = Boolean(vm.runInNewContext(until.condition, { input, JSON, Math }, { timeout: 200 }))
      } catch (err) {
        satisfied = true // a broken condition must not loop forever
        run.errors[until.stepId] = `Stop condition failed: ${err.message}`
      }
      const untilStep = listAt(run.flow.steps, hops)?.find(s => s.id === until.stepId)
      if (!satisfied && until.i < until.max - 1) {
        if (untilStep) mark(run, untilStep, 'running', { output: { iterations: until.i + 1, satisfied: false } })
        enqueue(run, { hops, index: until.untilIndex + 1 }, { until: { ...until, i: until.i + 1 } })
        return
      }
      if (untilStep) {
        mark(run, untilStep, 'success', { output: { iterations: until.i + 1, satisfied } })
        run.tokenOutputs[untilStep.name] = run.outputs[untilStep.id]
      }
      return finishLane(run, hops)
    }
    return finishLane(run, hops)
  }

  // Every step becomes one span, opened on first attempt.
  if (!event.spanId) {
    event.spanId = randHex(16)
    event.spanStart = Date.now()
  }

  // Repeat passes (loop items, until retries) get their own timeline entry.
  const iter = event.loop ? `${event.loop.i + 1}/${event.loop.items.length}`
    : event.until ? `pass ${event.until.i + 1}` : undefined

  // A step is critical unless explicitly opted out: a non-critical failure
  // is marked in red but the lane carries on.
  const carryOn = err => {
    mark(run, step, 'error', { error: err, ms: Date.now() - started }, iter)
    endSpan(run, event, step, 'error', err)
    run.outputs[step.id] = { error: err }
    run.tokenOutputs = { ...run.tokenOutputs, [step.name]: { error: err } }
    if (step.branches?.length) for (const b of step.branches) b.steps.forEach(s => markSkippedDeep(run, s))
    enqueue(run, { hops, index: index + 1 }, { ...(event.loop ? { loop: event.loop } : {}), ...(event.until ? { until: event.until } : {}) })
  }

  const started = Date.now()
  mark(run, step, 'running', {}, iter)
  persist()

  // Validation failure: plain-language error on the step, skip the rest of
  // this lane — same semantics the editor teaches.
  const problem = validateStep(step)
  if (problem) {
    if (step.critical === false) return carryOn(problem)
    mark(run, step, 'error', { error: problem, ms: Date.now() - started }, iter)
    endSpan(run, event, step, 'error', problem)
    for (const rest of list.slice(index + 1)) markSkippedDeep(run, rest)
    return finishLane(run, hops)
  }

  const outputs = { ...run.tokenOutputs }
  const config = resolveConfigWith(outputs, step.config)

  // Approval: first pass parks the event as `waiting`; the approve API
  // re-queues it and the second pass falls through to the executor.
  if (step.toolId === 'logic.approval' && !event.approvedBy) {
    event.state = 'waiting'
    event.not_before = 0
    event.spanEvents = [...(event.spanEvents || []), { time: Date.now(), name: 'waiting-for-approval', note: config.approver }]
    mark(run, step, 'waiting', { approver: config.approver })
    return
  }

  // Until: opens a repeat context over the rest of this lane; the loop-back
  // decision happens at lane end. The step's final output lands there too.
  if (step.toolId === 'logic.until') {
    const max = Math.max(1, Math.min(25, parseInt(config.max, 10) || 5))
    mark(run, step, 'running', { output: { iterations: 0, satisfied: false } })
    endSpan(run, event, step, 'ok')
    enqueue(run, { hops, index: index + 1 }, { until: { stepId: step.id, untilIndex: index, i: 0, max, condition: config.condition } })
    return
  }

  // Subflow: start the child run, then poll it from the queue — the worker
  // never blocks on a child.
  if (step.toolId === 'logic.subflow') {
    if (!event.subflowRunId) {
      const depth = (run.trigger?.depth || 0) + 1
      if (depth > 3) {
        mark(run, step, 'error', { error: 'Flows are nested more than 3 deep — check for a loop of flows calling each other.', ms: Date.now() - started })
        endSpan(run, event, step, 'error', 'subflow nesting too deep')
        for (const rest of list.slice(index + 1)) markSkippedDeep(run, rest)
        return finishLane(run, hops)
      }
      // Subflows stay inside the tenant: only flows of the same project match.
      const childFlow = readFlowsFile()
        .filter(f => (f.projectId || 'default') === run.projectId)
        .find(f => f.name.toLowerCase() === (config.flow || '').trim().toLowerCase())
      if (!childFlow) {
        mark(run, step, 'error', { error: `No flow named "${config.flow}" — check the name in the flows menu.`, ms: Date.now() - started })
        endSpan(run, event, step, 'error', 'flow not found')
        for (const rest of list.slice(index + 1)) markSkippedDeep(run, rest)
        return finishLane(run, hops)
      }
      // Passed variables override the child's own {{var.*}} values for this run.
      let passedVars = {}
      if (config.vars && config.vars.trim()) {
        try { passedVars = JSON.parse(config.vars) } catch {
          mark(run, step, 'error', { error: 'Variables to pass must be a JSON object like {"region": "eu"}.', ms: Date.now() - started })
          endSpan(run, event, step, 'error', 'bad vars JSON')
          for (const rest of list.slice(index + 1)) markSkippedDeep(run, rest)
          return finishLane(run, hops)
        }
      }
      const childWithVars = { ...childFlow, vars: { ...(childFlow.vars || {}), ...Object.fromEntries(Object.entries(passedVars).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])) } }
      const prev = index > 0 ? run.outputs[list[index - 1].id] : run.trigger
      const child = createRun(childWithVars, { speed: 'instant', trigger: { trigger: 'subflow', from: run.flowName, depth, ...(prev && typeof prev === 'object' ? prev : { input: prev }) } })
      event.subflowRunId = child.id
      event.subflowDeadline = Date.now() + 10 * 60_000
      event.state = 'queued'
      event.not_before = Date.now() + 400
      return
    }
    const child = db.runs[event.subflowRunId]
    if (child?.running && Date.now() < event.subflowDeadline) {
      event.state = 'queued'
      event.not_before = Date.now() + 400
      return
    }
    const failedSteps = child ? child.entries.filter(e => e.status === 'error') : []
    if (!child || failedSteps.length) {
      const why = !child ? 'the child run disappeared' : failedSteps.map(f => `${f.name}: ${f.error}`).join('; ')
      mark(run, step, 'error', { error: `Flow "${config.flow}" failed — ${why}`, ms: Date.now() - started })
      endSpan(run, event, step, 'error', why)
      for (const rest of list.slice(index + 1)) markSkippedDeep(run, rest)
      return finishLane(run, hops)
    }
    const lastRootStep = child.flow.steps[child.flow.steps.length - 1]
    const output = { status: 'finished', result: child.outputs[lastRootStep?.id] ?? null, runId: child.id }
    mark(run, step, 'success', { output, ms: Date.now() - event.spanStart })
    endSpan(run, event, step, 'ok')
    run.tokenOutputs = { ...run.tokenOutputs, [step.name]: output }
    enqueue(run, { hops, index: index + 1 }, { ...(event.loop ? { loop: event.loop } : {}), ...(event.until ? { until: event.until } : {}) })
    return
  }

  // Wait: park the *next* hop in the future. The step itself is instant.
  if (step.toolId === 'logic.wait') {
    const m = DURATION_RE.exec(config.duration || '')
    if (!m) {
      mark(run, step, 'error', { error: `"${config.duration}" is not a duration — use 30s, 15m, 2h or 1d.`, ms: Date.now() - started })
      for (const rest of list.slice(index + 1)) markSkippedDeep(run, rest)
      return finishLane(run, hops)
    }
    const delay = +m[1] * DURATION_MS[m[2].toLowerCase()]
    mark(run, step, 'success', { output: { waiting: config.duration, resumesAt: new Date(Date.now() + delay).toISOString() }, ms: Date.now() - started })
    endSpan(run, event, step, 'ok')
    run.tokenOutputs = { ...run.tokenOutputs, [step.name]: run.outputs[step.id] }
    enqueue(run, { hops, index: index + 1 }, { not_before: Date.now() + delay, ...(event.loop ? { loop: event.loop } : {}), ...(event.until ? { until: event.until } : {}) })
    return
  }

  // Everything else runs its real executor.
  let output
  try {
    const prev = index > 0 ? run.outputs[list[index - 1].id] : hops.length ? run.outputs[hops[hops.length - 1].stepId] : run.trigger
    output = await executeStep(step.toolId, config, {
      settings: scopeSettings(readSettings(), run.projectId),
      input: prev,
      outputs,
      trigger: run.trigger,
      flow: run.flow,
      approvedBy: event.approvedBy,
      trace: { traceId: run.traceId, spanId: event.spanId },
    })
  } catch (err) {
    // Transient-prone tools retry with backoff before the lane gives up.
    const retryable = /^(data\.http|data\.postgres|notify\.|ai\.)/.test(step.toolId)
    if (retryable && event.attempts < 2) {
      event.attempts += 1
      event.state = 'queued'
      event.not_before = Date.now() + event.attempts * 2500
      event.spanEvents = [...(event.spanEvents || []), { time: Date.now(), name: 'retry', note: redact(err.message).slice(0, 200) }]
      const entry = run.entries.find(e => e.stepId === step.id && e.iter === iter)
      if (entry) entry.error = `retrying (attempt ${event.attempts + 1} of 3): ${redact(err.message)}`
      return
    }
    if (step.critical === false) return carryOn(redact(err.message))
    mark(run, step, 'error', { error: redact(err.message), ms: Date.now() - started }, iter)
    endSpan(run, event, step, 'error', redact(err.message))
    for (const rest of list.slice(index + 1)) markSkippedDeep(run, rest)
    return finishLane(run, hops)
  }

  mark(run, step, 'success', { output, ms: Date.now() - started }, iter)
  endSpan(run, event, step, 'ok')
  expandHostEntries(run, step, output, iter)
  run.tokenOutputs = { ...run.tokenOutputs, [step.name]: output }

  if (step.branches?.length) {
    // Remember the loop/until context so finishLane can put it back on the
    // rail once every lane is done (lanes themselves run outside it).
    run.laneCtx = run.laneCtx || {}
    run.laneCtx[step.id] = { loop: event.loop, until: event.until }
    if (step.toolId === 'logic.branch' && output.value !== null && output.value !== undefined) {
      // Real routing: only the lane whose label matches runs.
      const match = step.branches.find(b => String(b.label).toLowerCase() === String(output.value).toLowerCase())
        || step.branches.find(b => /^(else|default|otherwise)$/i.test(b.label))
      run.laneCounters[step.id] = 1
      for (const b of step.branches) {
        if (b === match) continue
        b.steps.forEach(s => markSkippedDeep(run, s))
      }
      if (match) {
        run.outputs[step.id] = { ...output, matched: match.label }
        run.tokenOutputs[step.name] = run.outputs[step.id]
        enqueue(run, { hops: [...hops, { stepId: step.id, branchId: match.id }], index: 0 })
      } else {
        enqueue(run, { hops, index: index + 1 }, { ...(event.loop ? { loop: event.loop } : {}), ...(event.until ? { until: event.until } : {}) })
        run.laneCounters[step.id] = 0
      }
    } else {
      // No routing value: all lanes run in parallel (fan-out / fan-in).
      run.laneCounters[step.id] = step.branches.length
      for (const b of step.branches) enqueue(run, { hops: [...hops, { stepId: step.id, branchId: b.id }], index: 0 })
    }
  } else if (step.toolId === 'logic.loop' && Array.isArray(output.items) && output.items.length) {
    // Real iteration: the rest of this lane runs once per item (capped),
    // sequentially, with {{item.*}} and {{loop.index}} resolving each pass.
    const items = output.items.slice(0, LOOP_CAP)
    run.tokenOutputs = { ...run.tokenOutputs, item: wrapItem(items[0]), loop: { index: 0, count: items.length } }
    enqueue(run, { hops, index: index + 1 }, { loop: { loopIndex: index, i: 0, items } })
  } else {
    enqueue(run, { hops, index: index + 1 }, { ...(event.loop ? { loop: event.loop } : {}), ...(event.until ? { until: event.until } : {}) })
  }
}

// ---------- schedule triggers ----------
// Flows whose first step is a schedule get a standing next-fire timestamp.
let armed = {} // flowId -> { at, timer? }

export function armSchedules(flows) {
  armed = {}
  for (const flow of flows) {
    if (flow.active === false) continue
    const first = flow.steps?.[0]
    if (first?.toolId !== 'trigger.schedule' || !first.config?.schedule) continue
    const at = nextOccurrence(parseSchedule(first.config.schedule), Date.now())
    if (at) armed[flow.id] = { at, flow }
  }
}

export function getReportData(projectId) {
  const inProject = pid => !projectId || (pid || 'default') === projectId
  // Schedule forecast: one row per armed flow, sorted soonest first.
  const schedule = Object.values(armed)
    .filter(({ flow }) => inProject(flow.projectId))
    .map(({ at, flow }) => {
      const first = flow.steps?.[0]
      return {
        flowId: flow.id,
        flowName: flow.name,
        stepCount: flow.steps?.length || 0,
        schedule: first?.config?.schedule || '',
        nextAt: at,
      }
    })
    .sort((a, b) => a.nextAt - b.nextAt)

  // Consumption: aggregate across all runs in memory (scoped to the project).
  const allRuns = Object.values(db.runs).filter(r => inProject(r.projectId))
  const totalRuns = allRuns.length
  let totalSteps = 0, successSteps = 0, errorSteps = 0

  // Group by day (last 14 calendar days) using ISO date strings.
  const dayMap = {}
  const now = Date.now()
  for (let d = 13; d >= 0; d--) {
    const day = new Date(now - d * 86400000).toISOString().slice(0, 10)
    dayMap[day] = { date: day, runs: 0, steps: 0 }
  }

  for (const run of allRuns) {
    const ok = run.entries.filter(e => e.status === 'success').length
    const err = run.entries.filter(e => e.status === 'error').length
    totalSteps += run.entries.length
    successSteps += ok
    errorSteps += err
    const day = new Date(run.startedAt).toISOString().slice(0, 10)
    if (dayMap[day]) { dayMap[day].runs++; dayMap[day].steps += run.entries.length }
  }

  return {
    schedule,
    stats: {
      totalRuns,
      totalSteps,
      successSteps,
      errorSteps,
      byDay: Object.values(dayMap),
    },
  }
}

function fireDueSchedules() {
  const now = Date.now()
  for (const [flowId, entry] of Object.entries(armed)) {
    if (entry.at > now) continue
    createRun(entry.flow, { speed: 'instant', trigger: { trigger: 'schedule', firedAt: new Date().toISOString() } })
    const next = nextOccurrence(parseSchedule(entry.flow.steps[0].config.schedule), now)
    if (next) entry.at = next
    else delete armed[flowId]
  }
}

// ---------- worker ----------
let settingsReader = () => ({})
const readSettings = () => settingsReader()

export function startWorker(readSettingsFn) {
  settingsReader = readSettingsFn
  setInterval(async () => {
    fireDueSchedules()
    const now = Date.now()
    const due = db.events.filter(e => e.state === 'queued' && (!e.not_before || e.not_before <= now))
    if (!due.length) return
    for (const event of due) {
      event.state = 'running'
      try {
        await processEvent(event)
        // processEvent may park the event (approval → waiting); only a
        // still-running event is actually finished.
        if (event.state === 'running') event.state = 'done'
      } catch (err) {
        event.state = 'failed'
        event.error = String(err)
      }
    }
    db.events = db.events.filter(e => e.state === 'queued' || e.state === 'waiting' || e.state === 'running')
    persist()
  }, 250)
}
