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
  // Config-heavy tools group fields into tabs; fields without a tab render
  // in the first group. Code fields inside tabs get extra height.
  tab?: string
  // Real config the engine reads but the form doesn't render (a mode the
  // tabs set, a value another control manages). Still valid on import and
  // documented in the LLM prompt.
  hidden?: boolean
  // For kind 'connection': which connection type this field accepts.
  connType?: 'postgres' | 'slack' | 'smtp' | 'pagerduty' | 'anthropic' | 'apikey' | 'mcp' | 'ssh' | 'aws' | 'k8s' | 'github'
}

export interface ConnectionMeta {
  id: string
  name: string
  type: NonNullable<Field['connType']>
  // Owning project — secrets are strictly project-scoped ("default" when absent).
  projectId?: string
}

// The tenant boundary: flows, runs, and secrets segment by project.
export interface Project {
  id: string
  name: string
  color: string
  createdAt: number
}

// An Infrastructure host: a machine grouped by tags (linux, east, prod…) and
// used as an SSH / Ansible target. Per-project.
export interface Host {
  id: string
  address: string
  tags: string[]
  user?: string
  port?: string
  projectId?: string
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
  // Tabs that double as a mode switch: clicking the named tab writes the
  // mapped value into config[key] (e.g. Ansible's Inline/Pull tabs set
  // "source"). Tabs not named here (Run, Target) leave the mode alone.
  modeTabs?: { key: string; values: Record<string, string> }
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
  // Absent = critical: a failure skips the rest of the lane. Explicitly
  // false = the flow carries on past this step's failure.
  critical?: boolean
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
  // Human documentation for this flow, as Markdown. Authored by hand or by
  // StepHan at compose time; rendered in the Docs panel alongside the
  // auto-generated Mermaid diagram, and travels with the portable flow.
  docs?: string
  // Owning project; the server backfills "default" for pre-projects flows.
  projectId?: string
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
  // Set on repeat executions (loop passes) and per-host fan-out rows.
  iter?: string
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
  // Model StepHan uses to author whole flows (defaults to the most capable —
  // flow drafting is one-shot and quality-sensitive, unlike per-step calls).
  composeModel?: string
  runSpeed: 'realtime' | 'fast' | 'instant'
  smtpFrom?: string
  publicUrl?: string
  otlpEndpoint?: string
  // Failure alerts for unattended (non-manual) runs.
  failureNotify?: 'off' | 'slack' | 'email' | 'both'
  failureNotifyEmail?: string
  // Name of the Slack connection alerts post through (webhooks are
  // channel-bound, so this IS the channel choice). Blank = first in project.
  failureNotifySlack?: string
  // Legacy pre-projects {{config.*}} values; the server folds them into
  // projectGlobals.default at boot.
  globals?: Record<string, unknown>
  // Per-project {{config.*}} values, keyed by projectId — strictly scoped.
  projectGlobals?: Record<string, Record<string, unknown>>
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
