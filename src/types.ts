// MIT License - Copyright (c) fintonlabs.com
import type { LucideIcon } from 'lucide-react'

export type Category = 'trigger' | 'ai' | 'infra' | 'data' | 'logic' | 'notify'

export interface Field {
  key: string
  label: string
  placeholder?: string
  required?: boolean
  kind?: 'text' | 'select' | 'code' | 'number' | 'schedule' | 'connection' | 'form' | 'json' | 'secret' | 'generated'
  options?: string[]
  // For kind 'connection': which connection type this field accepts.
  connType?: 'postgres' | 'slack' | 'smtp' | 'pagerduty' | 'anthropic' | 'apikey' | 'mcp' | 'ssh' | 'aws' | 'k8s' | 'github'
}

export interface ConnectionMeta {
  id: string
  name: string
  type: NonNullable<Field['connType']>
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
  // Custom variables, referenced as {{var.<key>}} in any config field.
  vars?: Record<string, string>
  // Live triggers (schedule/webhook) only fire when active. Default true.
  active?: boolean
  tags?: string[]
  updatedAt: number
}

export type StepStatus = 'idle' | 'queued' | 'running' | 'success' | 'error' | 'skipped' | 'waiting'

export interface RunEntry {
  stepId: string
  name: string
  toolId: string
  status: StepStatus
  ms: number
  error?: string
  output?: Record<string, unknown>
  approver?: string
}

export interface RunState {
  running: boolean
  entries: RunEntry[]
  statuses: Record<string, StepStatus>
  outputs: Record<string, Record<string, unknown>>
  errors: Record<string, string>
}

// Whitelabel: rebrand the app shell and every hosted form page.
export interface Branding {
  name?: string
  logoUrl?: string
  accent?: string
  formCss?: string
  hideBadge?: boolean
}

export interface Settings {
  theme: 'dark' | 'light'
  branding?: Branding
  model: string
  runSpeed: 'realtime' | 'fast' | 'instant'
  smtpFrom?: string
  otlpEndpoint?: string
  globals?: Record<string, unknown>
  connections?: ConnectionMeta[]
  hasAnthropicKey?: boolean
  hasSlackWebhookUrl?: boolean
  hasPagerdutyRoutingKey?: boolean
  hasSmtpUrl?: boolean
  hasPostgresUrl?: boolean
  hasApiToken?: boolean
}

export interface RunSummary {
  id: string
  startedAt: number
  finishedAt?: number
  running: boolean
  ok: number
  failed: number
  waiting: number
  trigger: string
}

// A location in the flow tree where a step can be inserted:
// path of branch hops from the root, plus an index in that step list.
export interface SlotPath {
  hops: { stepId: string; branchId: string }[]
  index: number
}
