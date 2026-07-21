// MIT License - Copyright (c) fintonlabs.com
// Flow state lives in a single reducer. The flow is a tree (branches hold
// nested step lists), and every mutation clones it — flows are small, so
// structural sharing isn't worth the complexity, and cloning makes undo free.
import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react'
import type { Branch, Flow, SlotPath, Step } from './types'
import { toolById } from './tools'

export const uid = () => Math.random().toString(36).slice(2, 9)

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

// Recursively assign fresh IDs to a step and all nested branches/steps.
export function reIdStep(step: Step): Step {
  return {
    ...step,
    id: uid(),
    branches: step.branches?.map(b => ({ ...b, id: uid(), steps: b.steps.map(reIdStep) })),
  }
}

function insertAfter(steps: Step[], id: string, next: Step): boolean {
  const i = steps.findIndex(s => s.id === id)
  if (i >= 0) { steps.splice(i + 1, 0, next); return true }
  for (const s of steps) {
    for (const b of s.branches || []) {
      if (insertAfter(b.steps, id, next)) return true
    }
  }
  return false
}

// Resolve the step list a SlotPath points into, inside a cloned tree.
function listAt(steps: Step[], hops: SlotPath['hops']): Step[] | null {
  let list = steps
  for (const hop of hops) {
    const step = list.find(s => s.id === hop.stepId)
    const branch = step?.branches?.find(b => b.id === hop.branchId)
    if (!branch) return null
    list = branch.steps
  }
  return list
}

export function makeStep(toolId: string): Step {
  const tool = toolById(toolId)
  const step: Step = { id: uid(), toolId, name: tool?.name || toolId, config: {} }
  // Auto-generate a UUID path so trigger URLs are unguessable by default —
  // webhooks/git under /hooks, hosted forms under /forms.
  const pathPrefix = toolId === 'trigger.form' ? '/forms'
    : (toolId === 'trigger.webhook' || toolId === 'trigger.git') ? '/hooks'
    : null
  if (pathPrefix) {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${uid()}${uid()}${uid()}${uid()}`
    step.config.path = `${pathPrefix}/${id}`
  }
  if (tool?.branching) {
    step.branches = [
      { id: uid(), label: 'Lane A', steps: [] },
      { id: uid(), label: 'Lane B', steps: [] },
    ]
  }
  return step
}

// Collect all step names in a tree (for duplicate detection).
function allNames(steps: Step[]): string[] {
  return steps.flatMap(s => [s.name, ...s.branches?.flatMap(b => allNames(b.steps)) || []])
}

// Return a unique name by appending " 2", " 3", … when a conflict exists.
function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name
  // Strip any existing trailing number suffix before re-numbering.
  const base = name.replace(/ \d+$/, '')
  let n = 2
  while (taken.includes(`${base} ${n}`)) n++
  return `${base} ${n}`
}

// Depth-first search over the whole tree.
export function findStep(steps: Step[], id: string): Step | null {
  for (const s of steps) {
    if (s.id === id) return s
    for (const b of s.branches || []) {
      const hit = findStep(b.steps, id)
      if (hit) return hit
    }
  }
  return null
}

// Steps whose output is visible to `id`: same-lane predecessors plus every
// predecessor along the ancestor chain. Sibling lanes are excluded.
export function upstreamSteps(steps: Step[], id: string): Step[] | null {
  const acc: Step[] = []
  for (const s of steps) {
    if (s.id === id) return acc
    for (const b of s.branches || []) {
      const sub = upstreamSteps(b.steps, id)
      if (sub) return [...acc, s, ...sub]
    }
    acc.push(s)
  }
  return null
}

function removeStep(steps: Step[], id: string): Step | null {
  const i = steps.findIndex(s => s.id === id)
  if (i >= 0) return steps.splice(i, 1)[0]
  for (const s of steps) {
    for (const b of s.branches || []) {
      const hit = removeStep(b.steps, id)
      if (hit) return hit
    }
  }
  return null
}

// Guard for moves: a step cannot be dropped inside its own subtree.
function contains(step: Step, id: string): boolean {
  if (step.id === id) return true
  return (step.branches || []).some(b => b.steps.some(s => contains(s, id)))
}

export interface EditorState {
  flows: Flow[]
  activeId: string | null
  expandedId: string | null
  history: { flowId: string; steps: Step[] }[]
  dirty: boolean
}

export type Action =
  | { type: 'load'; flows: Flow[] }
  | { type: 'select'; id: string }
  | { type: 'create'; flow: Flow }
  | { type: 'rename'; name: string }
  | { type: 'delete-flow'; id: string }
  | { type: 'insert'; toolId: string; at: SlotPath }
  | { type: 'load-steps'; steps: Step[] }
  | { type: 'move'; stepId: string; at: SlotPath }
  | { type: 'remove'; stepId: string }
  | { type: 'configure'; stepId: string; patch: Partial<Pick<Step, 'name' | 'critical'>> & { config?: Record<string, string> } }
  | { type: 'set-vars'; vars: Record<string, string> }
  | { type: 'set-docs'; docs: string }
  | { type: 'toggle-active'; id?: string }
  | { type: 'set-tags'; tags: string[] }
  | { type: 'add-lane'; stepId: string }
  | { type: 'lane'; stepId: string; branchId: string; label?: string; remove?: boolean }
  | { type: 'expand'; id: string | null }
  | { type: 'duplicate'; stepId: string }
  | { type: 'insert-step'; step: Step; at: SlotPath }
  | { type: 'undo' }
  | { type: 'saved' }

export const active = (s: EditorState): Flow | null => s.flows.find(f => f.id === s.activeId) || null

function withFlow(state: EditorState, fn: (steps: Step[]) => void): EditorState {
  const flow = active(state)
  if (!flow) return state
  const history = [...state.history.slice(-49), { flowId: flow.id, steps: clone(flow.steps) }]
  const steps = clone(flow.steps)
  fn(steps)
  const flows = state.flows.map(f => (f.id === flow.id ? { ...f, steps, updatedAt: Date.now() } : f))
  return { ...state, flows, history, dirty: true }
}

export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'load': {
      return { ...state, flows: action.flows, activeId: action.flows[0]?.id || null, dirty: false }
    }
    case 'select':
      return { ...state, activeId: action.id, expandedId: null, history: [] }
    case 'create':
      return { ...state, flows: [action.flow, ...state.flows], activeId: action.flow.id, expandedId: null, history: [], dirty: true }
    case 'rename': {
      const flows = state.flows.map(f => (f.id === state.activeId ? { ...f, name: action.name, updatedAt: Date.now() } : f))
      return { ...state, flows, dirty: true }
    }
    case 'delete-flow': {
      const flows = state.flows.filter(f => f.id !== action.id)
      return { ...state, flows, activeId: state.activeId === action.id ? flows[0]?.id || null : state.activeId, dirty: true }
    }
    case 'load-steps':
      return withFlow(state, steps => {
        steps.splice(0, steps.length, ...clone(action.steps))
      })
    case 'insert':
      return withFlow(state, steps => {
        const list = listAt(steps, action.at.hops)
        if (!list) return
        const s = makeStep(action.toolId)
        s.name = uniqueName(s.name, allNames(steps))
        list.splice(Math.min(action.at.index, list.length), 0, s)
      })
    case 'move':
      return withFlow(state, steps => {
        const moving = findStep(steps, action.stepId)
        if (!moving) return
        // Reject drops into the step's own subtree.
        const targetList = listAt(steps, action.at.hops)
        if (!targetList || action.at.hops.some(h => contains(moving, h.stepId))) return
        // Index shifts if removal happens earlier in the same list.
        const beforeIdx = targetList.findIndex(s => s.id === action.stepId)
        removeStep(steps, action.stepId)
        const list = listAt(steps, action.at.hops)
        if (!list) return
        let index = action.at.index
        if (beforeIdx >= 0 && beforeIdx < index) index -= 1
        list.splice(Math.min(index, list.length), 0, moving)
      })
    case 'remove':
      return withFlow(state, steps => {
        removeStep(steps, action.stepId)
      })
    case 'configure':
      return withFlow(state, steps => {
        const step = findStep(steps, action.stepId)
        if (!step) return
        if (action.patch.name !== undefined) step.name = action.patch.name
        if (action.patch.critical !== undefined) {
          if (action.patch.critical) delete step.critical
          else step.critical = false
        }
        if (action.patch.config) step.config = { ...step.config, ...action.patch.config }
      })
    case 'set-vars': {
      const flows = state.flows.map(f => (f.id === state.activeId ? { ...f, vars: action.vars, updatedAt: Date.now() } : f))
      return { ...state, flows, dirty: true }
    }
    case 'set-docs': {
      const docs = action.docs
      const flows = state.flows.map(f => (f.id === state.activeId ? { ...f, docs, updatedAt: Date.now() } : f))
      return { ...state, flows, dirty: true }
    }
    case 'toggle-active': {
      // No id → the open flow (TopBar pill); with id → any row in the list.
      const targetId = action.id ?? state.activeId
      const flows = state.flows.map(f => (f.id === targetId ? { ...f, active: f.active === false, updatedAt: Date.now() } : f))
      return { ...state, flows, dirty: true }
    }
    case 'set-tags': {
      const tags = [...new Set(action.tags.map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12)
      const flows = state.flows.map(f => (f.id === state.activeId ? { ...f, tags, updatedAt: Date.now() } : f))
      return { ...state, flows, dirty: true }
    }
    case 'add-lane':
      return withFlow(state, steps => {
        const step = findStep(steps, action.stepId)
        if (!step?.branches) return
        const label = `Lane ${String.fromCharCode(65 + step.branches.length)}`
        step.branches.push({ id: uid(), label, steps: [] } as Branch)
      })
    case 'lane':
      return withFlow(state, steps => {
        const step = findStep(steps, action.stepId)
        if (!step?.branches) return
        if (action.remove) {
          if (step.branches.length > 1) step.branches = step.branches.filter(b => b.id !== action.branchId)
          return
        }
        const branch = step.branches.find(b => b.id === action.branchId)
        if (branch && action.label !== undefined) branch.label = action.label
      })
    case 'expand':
      return { ...state, expandedId: action.id }
    case 'duplicate':
      return withFlow(state, steps => {
        const original = findStep(steps, action.stepId)
        if (!original) return
        const clone = reIdStep(original)
        clone.name = uniqueName(original.name, allNames(steps))
        insertAfter(steps, action.stepId, clone)
      })
    case 'insert-step':
      return withFlow(state, steps => {
        const list = listAt(steps, action.at.hops)
        if (!list) return
        const s = reIdStep(action.step)
        s.name = uniqueName(s.name, allNames(steps))
        list.splice(Math.min(action.at.index, list.length), 0, s)
      })
    case 'undo': {
      const last = state.history[state.history.length - 1]
      if (!last || last.flowId !== state.activeId) return state
      const flows = state.flows.map(f => (f.id === last.flowId ? { ...f, steps: last.steps, updatedAt: Date.now() } : f))
      return { ...state, flows, history: state.history.slice(0, -1), dirty: true }
    }
    case 'saved':
      return { ...state, dirty: false }
  }
}

export const initialState: EditorState = { flows: [], activeId: null, expandedId: null, history: [], dirty: false }

const StateCtx = createContext<EditorState>(initialState)
const DispatchCtx = createContext<Dispatch<Action>>(() => {})

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  )
}

export const useEditor = () => useContext(StateCtx)
export const useDispatch = () => useContext(DispatchCtx)
