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
// `*` in a segment globs against keys at that level — including across dots,
// so {{Fleet df.hosts.*.com.stdout}} matches every ".com" host. All matches
// collect; the shortest key match at each level wins first (so non-wildcard
// tokens behave exactly as before), and once a split yields results, longer
// merges at that level are not also tried (no duplicate leaves).
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function collectPath(cur, parts, acc, label) {
  if (acc.length >= 100) return
  if (!parts.length) {
    if (cur !== undefined && cur !== null) acc.push({ label, value: cur })
    return
  }
  if (cur === null || typeof cur !== 'object') return
  for (let take = 1; take <= parts.length; take++) {
    const before = acc.length
    const key = parts.slice(0, take).join('.')
    if (key.includes('*')) {
      const re = new RegExp('^' + key.split('*').map(escapeRe).join('.*') + '$')
      for (const k of Object.keys(cur)) {
        // The wildcard-matched key becomes the label — for hosts.*.stdout
        // each block is attributed to its host.
        if (re.test(k)) collectPath(cur[k], parts.slice(take), acc, k)
      }
    } else if (key in cur) {
      collectPath(cur[key], parts.slice(take), acc, label)
    }
    if (acc.length > before) return
  }
}

export const interpolateWith = (outputs, value) =>
  String(value).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, expr) => {
    const parts = expr.split('.').map(p => p.trim())
    const acc = []
    collectPath(outputs, parts, acc)
    if (!acc.length) return match
    if (acc.length === 1) {
      const v = acc[0].value
      return typeof v === 'object' ? JSON.stringify(v) : String(v)
    }
    // Many matches: one-liners join line-per-match; multi-line blocks are
    // labelled with the key they came from (two near-identical host reports
    // are indistinguishable otherwise); objects become a JSON array.
    if (acc.every(r => typeof r.value !== 'object')) {
      const blocks = acc.some(r => String(r.value).includes('\n'))
      return blocks
        ? acc.map(r => `── ${r.label ?? ''}\n${r.value}`).join('\n\n')
        : acc.map(r => String(r.value)).join('\n')
    }
    return JSON.stringify(acc.map(r => r.value))
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
