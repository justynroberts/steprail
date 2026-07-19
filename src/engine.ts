// MIT License - Copyright (c) fintonlabs.com
// Client-side engine glue. Real execution happens in the server's queue
// worker (server/queue.mjs + executors.mjs); what lives here is the shared
// token machinery, upstream *shape* suggestions for token chips, and the
// keyword fallback for AI compose.
import type { Flow, RunState, Step } from './types'
import { toolById } from './tools'
import { upstreamSteps } from './state'
import { interpolateWith, resolveConfigWith, seedVars, systemVars, validateStep } from '../shared/enginecore.mjs'

export { interpolateWith, resolveConfigWith, seedVars, systemVars, validateStep }

export const emptyRun: RunState = { running: false, entries: [], statuses: {}, outputs: {}, errors: {} }

// Example outputs for every step upstream of `stepId` — shape suggestions
// for token chips, resolved in order so nested tokens look right. These are
// NOT run results; runs and tests always come from the server.
export function sampleUpstream(flow: Flow, stepId: string): Record<string, Record<string, unknown>> {
  const outputs = seedVars(flow)
  for (const up of upstreamSteps(flow.steps, stepId) || []) {
    const tool = toolById(up.toolId)
    if (tool) outputs[up.name] = tool.sample(resolveConfigWith(outputs, up.config))
  }
  return outputs
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
  // A trigger alone isn't a flow — guarantee at least one action step so
  // StepHan's keyword fallback still hands back something runnable.
  if (!plan.some(id => !id.startsWith('trigger.'))) plan.push('notify.slack')
  return plan
}

// Depth-first: the last successful outputs a step would see, from the most
// recent run — used to feed real tests with real upstream data.
export function upstreamOutputsFromRun(flow: Flow, stepId: string, run: RunState): Record<string, Record<string, unknown>> | null {
  const ups = upstreamSteps(flow.steps, stepId)
  if (!ups) return null
  const outputs: Record<string, Record<string, unknown>> = {}
  let any = false
  for (const up of ups) {
    const out = run.outputs[up.id]
    if (out) {
      outputs[up.name] = out
      any = true
    }
  }
  return any ? outputs : null
}

export function lastUpstreamOutput(flow: Flow, stepId: string, run: RunState): Record<string, unknown> | undefined {
  const ups = upstreamSteps(flow.steps, stepId)
  const last = ups?.[ups.length - 1]
  return last ? run.outputs[last.id] : undefined
}

export type { Flow, Step }
