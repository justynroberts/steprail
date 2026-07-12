// MIT License - Copyright (c) fintonlabs.com
import type { LucideIcon } from 'lucide-react'

export type Category = 'trigger' | 'ai' | 'infra' | 'data' | 'logic' | 'notify'

export interface Field {
  key: string
  label: string
  placeholder?: string
  required?: boolean
  kind?: 'text' | 'select' | 'code' | 'number'
  options?: string[]
}

export interface ToolDef {
  id: string
  name: string
  category: Category
  icon: LucideIcon
  description: string
  fields: Field[]
  // Tools that fork the rail into parallel lanes.
  branching?: boolean
  sample: (cfg: Record<string, string>) => Record<string, unknown>
}

export interface Branch {
  id: string
  label: string
  steps: Step[]
}

export interface Step {
  id: string
  toolId: string
  name: string
  config: Record<string, string>
  branches?: Branch[]
}

export interface Flow {
  id: string
  name: string
  steps: Step[]
  updatedAt: number
}

export type StepStatus = 'idle' | 'queued' | 'running' | 'success' | 'error' | 'skipped'

export interface RunEntry {
  stepId: string
  name: string
  toolId: string
  status: StepStatus
  ms: number
  error?: string
  output?: Record<string, unknown>
}

export interface RunState {
  running: boolean
  entries: RunEntry[]
  statuses: Record<string, StepStatus>
  outputs: Record<string, Record<string, unknown>>
  errors: Record<string, string>
}

export interface Settings {
  theme: 'dark' | 'light'
  model: string
  runSpeed: 'realtime' | 'fast' | 'instant'
  hasAnthropicKey?: boolean
}

// A location in the flow tree where a step can be inserted:
// path of branch hops from the root, plus an index in that step list.
export interface SlotPath {
  hops: { stepId: string; branchId: string }[]
  index: number
}
