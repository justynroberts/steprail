// MIT License - Copyright (c) fintonlabs.com
// Simulated execution. Walks the tree in order, animating step states and
// producing sample payloads so the data pills have something real to show.
// A step with a missing required field fails with a plain-language error —
// the failure surfaces on the step itself, not in a log you have to hunt for.
import type { Flow, RunEntry, RunState, Step } from './types'
import { toolById } from './tools'
import { upstreamSteps } from './state'

export const emptyRun: RunState = { running: false, entries: [], statuses: {}, outputs: {}, errors: {} }

// {{Step name.path}} tokens resolve against a map of step outputs —
// the low-code glue between steps. Unresolvable tokens pass through as-is.
export const interpolateWith = (outputs: Record<string, Record<string, unknown>>, value: string): string =>
  value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, expr: string) => {
    const [head, ...path] = expr.split('.')
    let cur: unknown = outputs[head.trim()]
    if (cur === undefined) return match
    for (const part of path) {
      if (cur === null || typeof cur !== 'object') return match
      cur = (cur as Record<string, unknown>)[part.trim()]
    }
    if (cur === undefined || cur === null) return match
    return typeof cur === 'object' ? JSON.stringify(cur) : String(cur)
  })

export const resolveConfigWith = (
  outputs: Record<string, Record<string, unknown>>,
  cfg: Record<string, string>,
): Record<string, string> =>
  Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, interpolateWith(outputs, v)]))

// Built-in variables, resolvable anywhere as {{system.<key>}}.
export function systemVars(flow: Pick<Flow, 'name'>): Record<string, unknown> {
  const now = new Date()
  return {
    now: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    time: now.toTimeString().slice(0, 8),
    flow: flow.name,
    runId: `run_${Math.random().toString(36).slice(2, 8)}`,
  }
}

// Seed outputs with system + custom vars so {{system.*}} and {{var.*}}
// resolve through the same token machinery as step outputs.
const seedVars = (flow: Flow): Record<string, Record<string, unknown>> => ({
  system: systemVars(flow) as Record<string, unknown>,
  var: { ...(flow.vars || {}) },
})

// Sample outputs for every step upstream of `stepId`, tokens resolved in order.
export function sampleUpstream(flow: Flow, stepId: string): Record<string, Record<string, unknown>> {
  const outputs = seedVars(flow)
  for (const up of upstreamSteps(flow.steps, stepId) || []) {
    const tool = toolById(up.toolId)
    if (tool) outputs[up.name] = tool.sample(resolveConfigWith(outputs, up.config))
  }
  return outputs
}

// Run a single step in isolation against sample upstream data — the
// "test this step" path. No flow state is touched.
export function testStep(flow: Flow, step: Step): { output?: Record<string, unknown>; error?: string } {
  const problem = validateStep(step)
  if (problem) return { error: problem }
  const tool = toolById(step.toolId)!
  return { output: tool.sample(resolveConfigWith(sampleUpstream(flow, step.id), step.config)) }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export function validateStep(step: Step): string | null {
  const tool = toolById(step.toolId)
  if (!tool) return `Unknown tool "${step.toolId}"`
  const missing = tool.fields.filter(f => f.required && !(step.config[f.key] || '').trim())
  if (missing.length) {
    const names = missing.map(f => f.label).join(' and ')
    return `${names} ${missing.length > 1 ? 'are' : 'is'} empty — open this step and fill ${missing.length > 1 ? 'them' : 'it'} in.`
  }
  return null
}

export interface RunCallbacks {
  onUpdate: (run: RunState) => void
}

export async function runFlow(flow: Flow, speed: 'realtime' | 'fast' | 'instant', cb: RunCallbacks): Promise<RunState> {
  const delay = speed === 'realtime' ? 650 : speed === 'fast' ? 220 : 0
  const run: RunState = { running: true, entries: [], statuses: {}, outputs: {}, errors: {} }

  // Outputs accumulate as the run progresses; tokens resolve against them.
  // Pre-seeded with {{system.*}} and {{var.*}}.
  const outputsByName = seedVars(flow)

  const mark = (step: Step, status: RunEntry['status'], extra?: Partial<RunEntry>) => {
    run.statuses = { ...run.statuses, [step.id]: status }
    if (extra?.output) run.outputs = { ...run.outputs, [step.id]: extra.output }
    if (extra?.error) run.errors = { ...run.errors, [step.id]: extra.error }
    const existing = run.entries.find(e => e.stepId === step.id)
    if (existing) Object.assign(existing, { status, ...extra })
    else run.entries = [...run.entries, { stepId: step.id, name: step.name, toolId: step.toolId, status, ms: 0, ...extra }]
    cb.onUpdate({ ...run })
  }

  const queueAll = (steps: Step[]) => {
    for (const s of steps) {
      run.statuses[s.id] = 'queued'
      for (const b of s.branches || []) queueAll(b.steps)
    }
  }
  queueAll(flow.steps)
  cb.onUpdate({ ...run })

  // Returns false when the lane failed and downstream steps should be skipped.
  const walk = async (steps: Step[]): Promise<boolean> => {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      mark(step, 'running')
      const started = performance.now()
      await sleep(delay + Math.random() * delay * 0.6)
      const problem = validateStep(step)
      const ms = Math.round(performance.now() - started)
      if (problem) {
        mark(step, 'error', { error: problem, ms })
        // Skip the remainder of this lane, plain and visible.
        for (const rest of steps.slice(i + 1)) markSkipped(rest)
        return false
      }
      const tool = toolById(step.toolId)!
      const output = tool.sample(resolveConfigWith(outputsByName, step.config))
      outputsByName[step.name] = output
      mark(step, 'success', { output, ms })
      if (step.branches) {
        // Lanes run concurrently, like they would in production.
        await Promise.all(step.branches.map(b => walk(b.steps)))
      }
    }
    return true
  }

  const markSkipped = (step: Step) => {
    mark(step, 'skipped')
    for (const b of step.branches || []) b.steps.forEach(markSkipped)
  }

  await walk(flow.steps)
  run.running = false
  cb.onUpdate({ ...run })
  return run
}

// Local fallback planner for AI compose: maps keywords in the brief to tools.
// Used when no Anthropic key is configured in Settings.
const KEYWORDS: [RegExp, string][] = [
  [/webhook|http request comes|incoming request/i, 'trigger.webhook'],
  [/every (morning|day|hour|week)|daily|nightly|schedule|cron|at \d/i, 'trigger.schedule'],
  [/push|merge|commit|pr |pull request|git/i, 'trigger.git'],
  [/file|upload|csv|folder/i, 'trigger.file'],
  [/terraform|provision/i, 'infra.terraform'],
  [/kubernetes|k8s|deploy/i, 'infra.k8s'],
  [/docker|image|build/i, 'infra.docker'],
  [/ssh|restart|server command/i, 'infra.ssh'],
  [/lambda|function/i, 'infra.lambda'],
  [/summari[sz]e/i, 'ai.summarize'],
  [/classif|triage|label|categor/i, 'ai.classify'],
  [/agent|investigate|figure out/i, 'ai.agent'],
  [/llm|prompt|claude|generate|write/i, 'ai.prompt'],
  [/postgres|sql|database|query/i, 'data.postgres'],
  [/api|fetch|request/i, 'data.http'],
  [/transform|reshape|map/i, 'data.transform'],
  [/filter|only|keep/i, 'data.filter'],
  [/approv|sign.?off|confirm/i, 'logic.approval'],
  [/wait|pause|delay/i, 'logic.wait'],
  [/loop|each|every item/i, 'logic.loop'],
  [/branch|if |depending|route/i, 'logic.branch'],
  [/slack|channel|message/i, 'notify.slack'],
  [/email|mail/i, 'notify.email'],
  [/pager|incident|alert|page /i, 'notify.pagerduty'],
]

export function localPlan(brief: string): string[] {
  const clauses = brief.split(/\bthen\b|,|;|\band\b|\./i).map(c => c.trim()).filter(Boolean)
  const plan: string[] = []
  for (const clause of clauses) {
    for (const [re, toolId] of KEYWORDS) {
      if (re.test(clause) && !plan.includes(toolId)) plan.push(toolId)
    }
  }
  // A flow always starts with a trigger; default to webhook if none matched.
  const triggerIdx = plan.findIndex(id => id.startsWith('trigger.'))
  if (triggerIdx > 0) plan.unshift(...plan.splice(triggerIdx, 1))
  if (triggerIdx === -1) plan.unshift('trigger.webhook')
  return plan
}
