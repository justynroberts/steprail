// MIT License - Copyright (c) fintonlabs.com
// The portable flow format: a whole flow as one JSON object, designed to be
// written by an LLM (or a human) — no internal ids, tolerant hydration,
// warnings instead of hard failures wherever recovery is sane.
//
//   {
//     "name": "Deploy on merge",
//     "steps": [
//       { "tool": "trigger.git", "name": "Push to main", "config": { "repo": "org/api" } },
//       { "tool": "logic.branch", "name": "Route", "branches": [
//         { "label": "Urgent", "steps": [ { "tool": "notify.pagerduty", "config": { "service": "api" } } ] }
//       ]}
//     ]
//   }
import type { Flow, Step } from './types'
import { toolById } from './tools'
import { makeStep, uid } from './state'

export interface PortableStep {
  tool: string
  name?: string
  config?: Record<string, unknown>
  branches?: { label?: string; steps?: PortableStep[] }[]
  critical?: boolean
}

export interface PortableFlow {
  name?: string
  vars?: Record<string, unknown>
  tags?: string[]
  steps?: PortableStep[]
}

export interface HydrateResult {
  name: string
  steps: Step[]
  vars: Record<string, string>
  tags: string[]
  warnings: string[]
}

function hydrateSteps(portable: PortableStep[], warnings: string[], depth = 0): Step[] {
  const steps: Step[] = []
  for (const p of portable) {
    if (!p || typeof p !== 'object' || typeof p.tool !== 'string') {
      warnings.push('Skipped a step with no "tool" field.')
      continue
    }
    const tool = toolById(p.tool)
    if (!tool) {
      warnings.push(`Skipped unknown tool "${p.tool}".`)
      continue
    }
    const step = makeStep(tool.id)
    if (typeof p.name === 'string' && p.name.trim()) step.name = p.name.trim()
    if (p.critical === false) step.critical = false
    for (const [key, value] of Object.entries(p.config || {})) {
      if (!tool.fields.some(f => f.key === key)) {
        warnings.push(`"${step.name}": dropped unknown config key "${key}".`)
        continue
      }
      step.config[key] = typeof value === 'object' ? JSON.stringify(value) : String(value)
    }
    if (Array.isArray(p.branches) && p.branches.length) {
      if (!tool.branching) {
        warnings.push(`"${step.name}": ${tool.name} does not branch — lanes ignored.`)
      } else if (depth >= 3) {
        warnings.push(`"${step.name}": branch nesting deeper than 3 — lanes ignored.`)
      } else {
        step.branches = p.branches.map((b, i) => ({
          id: uid(),
          label: typeof b?.label === 'string' && b.label.trim() ? b.label.trim() : `Lane ${String.fromCharCode(65 + i)}`,
          steps: hydrateSteps(Array.isArray(b?.steps) ? b.steps : [], warnings, depth + 1),
        }))
      }
    }
    steps.push(step)
  }
  return steps
}

export function hydrateFlow(input: unknown): HydrateResult {
  const warnings: string[] = []
  if (!input || typeof input !== 'object') return { name: 'Imported flow', steps: [], vars: {}, tags: [], warnings: ['Not a JSON object.'] }
  const portable = input as PortableFlow
  const steps = hydrateSteps(Array.isArray(portable.steps) ? portable.steps : [], warnings)
  if (!steps.length) warnings.push('No usable steps found.')
  else if (!steps[0].toolId.startsWith('trigger.')) warnings.push('Flow does not start with a trigger — it can still be edited, but add one.')
  const vars: Record<string, string> = {}
  if (portable.vars && typeof portable.vars === 'object' && !Array.isArray(portable.vars)) {
    for (const [k, v] of Object.entries(portable.vars)) {
      vars[k] = typeof v === 'object' ? JSON.stringify(v) : String(v)
    }
  }
  const tags = Array.isArray(portable.tags) ? portable.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 12) : []
  return { name: typeof portable.name === 'string' && portable.name.trim() ? portable.name.trim() : 'Imported flow', steps, vars, tags, warnings }
}

function serializeSteps(steps: Step[]): PortableStep[] {
  return steps.map(s => {
    const out: PortableStep = { tool: s.toolId, name: s.name }
    if (s.critical === false) out.critical = false
    const config = Object.fromEntries(Object.entries(s.config).filter(([, v]) => v !== ''))
    if (Object.keys(config).length) out.config = config
    if (s.branches) out.branches = s.branches.map(b => ({ label: b.label, steps: serializeSteps(b.steps) }))
    return out
  })
}

export function serializeFlow(flow: Flow): PortableFlow {
  const out: PortableFlow = { name: flow.name }
  if (flow.tags?.length) out.tags = flow.tags
  if (flow.vars && Object.keys(flow.vars).length) out.vars = flow.vars
  out.steps = serializeSteps(flow.steps)
  return out
}

// The complete LLM authoring prompt lives in shared/promptcore.mjs (its tool
// catalog is generated from toolcore, so it documents itself); re-exported
// here so client callers keep one import site.
export { llmPrompt } from '../shared/promptcore.mjs'
