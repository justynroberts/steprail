// MIT License - Copyright (c) fintonlabs.com
// Token resolution and validation, shared by the editor and the queue worker.
import { toolCoreById } from './toolcore.mjs'

// {{Step name.path}} tokens resolve against a map of step outputs.
// Unresolvable tokens pass through as-is.
//
// Keys may contain dots (multi-host SSH outputs key by hostname:
// {{Fleet df.hosts.web1.example.com.stdout}}). A plain split('.') walk can
// never reach those, so segments greedily merge: at each level the shortest
// matching key wins first, extending across dots only when needed —
// backtracking keeps an exact shorter key from shadowing a longer one.
function walkPath(cur, parts) {
  if (!parts.length) return cur
  if (cur === null || typeof cur !== 'object') return undefined
  for (let take = 1; take <= parts.length; take++) {
    const key = parts.slice(0, take).join('.')
    if (key in cur) {
      const found = walkPath(cur[key], parts.slice(take))
      if (found !== undefined) return found
    }
  }
  return undefined
}

export const interpolateWith = (outputs, value) =>
  String(value).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, expr) => {
    const parts = expr.split('.').map(p => p.trim())
    const cur = walkPath(outputs, parts)
    if (cur === undefined || cur === null) return match
    return typeof cur === 'object' ? JSON.stringify(cur) : String(cur)
  })

export const resolveConfigWith = (outputs, cfg) =>
  Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, interpolateWith(outputs, v)]))

// Built-in variables, resolvable anywhere as {{system.<key>}}.
export function systemVars(flow) {
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
// resolve through the same machinery as step outputs.
export const seedVars = flow => ({
  system: systemVars(flow),
  var: { ...(flow.vars || {}) },
})

export function validateStep(step) {
  const tool = toolCoreById(step.toolId)
  if (!tool) return `Unknown tool "${step.toolId}"`
  const missing = tool.fields.filter(f => f.required && !(step.config[f.key] || '').trim())
  if (missing.length) {
    const names = missing.map(f => f.label).join(' and ')
    return `${names} ${missing.length > 1 ? 'are' : 'is'} empty — open this step and fill ${missing.length > 1 ? 'them' : 'it'} in.`
  }
  return null
}
