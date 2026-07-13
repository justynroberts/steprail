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
import { executeStep } from './executors.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const QUEUE_FILE = path.join(__dirname, '..', 'data', 'queue.json')
const FLOWS_FILE = path.join(__dirname, '..', 'data', 'flows.json')

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

function mark(run, step, status, extra = {}) {
  run.statuses[step.id] = status
  if (extra.output !== undefined) run.outputs[step.id] = extra.output
  if (extra.error) run.errors[step.id] = extra.error
  if (status === 'success') delete run.errors[step.id]
  const existing = run.entries.find(e => e.stepId === step.id)
  if (existing) {
    Object.assign(existing, { status, ...extra })
    if (status === 'success') delete existing.error
  } else {
    run.entries.push({ stepId: step.id, name: step.name, toolId: step.toolId, status, ms: 0, ...extra })
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

// ---------- public API ----------
export function createRun(flow, { speed = 'realtime', trigger = null } = {}) {
  const run = {
    id: `run_${uid()}`,
    flowId: flow.id,
    flowName: flow.name,
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
    tokenOutputs: seedVars(flow),
    // OpenTelemetry: the run is a trace, each step becomes a span.
    traceId: randHex(32),
    rootSpanId: randHex(16),
    spans: [],
    startedAt: Date.now(),
  }
  queueAll(run, flow.steps)
  db.runs[run.id] = run
  enqueue(run, { hops: [], index: 0 })
  pruneRuns()
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
      'newflow.tool': step.toolId,
      'newflow.step_id': step.id,
      'newflow.attempts': (event.attempts || 0) + 1,
      ...(event.loop ? { 'newflow.loop_iteration': event.loop.i } : {}),
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
    attrs: { 'newflow.flow': run.flowName, 'newflow.trigger': run.trigger?.trigger || 'manual', 'newflow.run_id': run.id },
  }
  return {
    resourceSpans: [{
      resource: { attributes: [otlpAttr(['service.name', 'newflow'])] },
      scopeSpans: [{ scope: { name: 'newflow', version: '0.1.0' }, spans: [root, ...run.spans].map(toSpan) }],
    }],
  }
}

function finalizeRun(run) {
  run.running = false
  run.finishedAt = Date.now()
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
    enqueue(run, { hops: parentHops, index: idx + 1 })
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

  const started = Date.now()
  mark(run, step, 'running')
  persist()

  // Validation failure: plain-language error on the step, skip the rest of
  // this lane — same semantics the editor teaches.
  const problem = validateStep(step)
  if (problem) {
    mark(run, step, 'error', { error: problem, ms: Date.now() - started })
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
      const childFlow = readFlowsFile().find(f => f.name.toLowerCase() === (config.flow || '').trim().toLowerCase())
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
      settings: readSettings(),
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
      const entry = run.entries.find(e => e.stepId === step.id)
      if (entry) entry.error = `retrying (attempt ${event.attempts + 1} of 3): ${redact(err.message)}`
      return
    }
    mark(run, step, 'error', { error: redact(err.message), ms: Date.now() - started })
    endSpan(run, event, step, 'error', redact(err.message))
    for (const rest of list.slice(index + 1)) markSkippedDeep(run, rest)
    return finishLane(run, hops)
  }

  mark(run, step, 'success', { output, ms: Date.now() - started })
  endSpan(run, event, step, 'ok')
  run.tokenOutputs = { ...run.tokenOutputs, [step.name]: output }

  if (step.branches?.length) {
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
        enqueue(run, { hops, index: index + 1 })
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
