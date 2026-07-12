// MIT License - Copyright (c) fintonlabs.com
// The tool catalog. Categories are deliberately broad: an orchestrator in 2026
// speaks infra, AI, and data with equal fluency.
import {
  Webhook, CalendarClock, GitBranch, FolderSearch,
  Sparkles, Bot, Tags, FileText,
  Boxes, Container, TerminalSquare, CloudCog, Layers,
  Globe, Database, Braces, Filter,
  Split, Repeat, Timer, UserCheck,
  MessageSquare, Mail, Siren,
} from 'lucide-react'
import type { Category, ToolDef } from './types'
import { parseSchedule, scheduleSummary, scheduleToCron } from './schedule'

export const CATEGORY_LABEL: Record<Category, string> = {
  trigger: 'Triggers',
  ai: 'AI',
  infra: 'Infra',
  data: 'Data',
  logic: 'Logic',
  notify: 'Notify',
}

export const CATEGORY_ORDER: Category[] = ['trigger', 'ai', 'infra', 'data', 'logic', 'notify']

export const TOOLS: ToolDef[] = [
  // Triggers
  {
    id: 'trigger.webhook', name: 'Webhook', category: 'trigger', icon: Webhook,
    description: 'Start when an HTTP request arrives',
    fields: [{ key: 'path', label: 'Path', placeholder: '/hooks/deploy', required: true }],
    sample: cfg => ({ method: 'POST', path: cfg.path || '/hooks/deploy', body: { ref: 'main', actor: 'justyn' } }),
  },
  {
    id: 'trigger.schedule', name: 'Schedule', category: 'trigger', icon: CalendarClock,
    description: 'Start on a friendly schedule',
    fields: [{ key: 'schedule', label: 'When should this run?', kind: 'schedule', required: true }],
    sample: cfg => {
      const s = parseSchedule(cfg.schedule)
      return { firedAt: '2026-07-12T09:00:00Z', schedule: scheduleSummary(s), cron: scheduleToCron(s) }
    },
  },
  {
    id: 'trigger.git', name: 'Git push', category: 'trigger', icon: GitBranch,
    description: 'Start when a branch is pushed',
    fields: [
      { key: 'repo', label: 'Repository', placeholder: 'org/api', required: true },
      { key: 'branch', label: 'Branch', placeholder: 'main' },
    ],
    sample: cfg => ({ repo: cfg.repo || 'org/api', branch: cfg.branch || 'main', sha: 'a1b2c3d', message: 'fix: retry logic' }),
  },
  {
    id: 'trigger.file', name: 'File watch', category: 'trigger', icon: FolderSearch,
    description: 'Start when files change in a path',
    fields: [{ key: 'glob', label: 'Glob', placeholder: 'uploads/**/*.csv', required: true }],
    sample: cfg => ({ file: 'uploads/leads-07.csv', glob: cfg.glob || 'uploads/**/*.csv', size: 48213 }),
  },

  // AI
  {
    id: 'ai.prompt', name: 'LLM prompt', category: 'ai', icon: Sparkles,
    description: 'Run a prompt against a model',
    fields: [
      { key: 'prompt', label: 'Prompt', kind: 'code', placeholder: 'Summarize {{input}} in three bullets', required: true },
      { key: 'model', label: 'Model', kind: 'select', options: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-8'] },
    ],
    sample: () => ({ text: 'Deploy completed cleanly; latency improved 12%; no regressions found.', tokens: 384 }),
  },
  {
    id: 'ai.agent', name: 'AI agent', category: 'ai', icon: Bot,
    description: 'Goal-seeking agent with tool access',
    fields: [
      { key: 'goal', label: 'Goal', kind: 'code', placeholder: 'Investigate the failing check and propose a fix', required: true },
      { key: 'maxSteps', label: 'Max steps', kind: 'number', placeholder: '10' },
    ],
    sample: () => ({ result: 'Root cause: stale lockfile. Opened PR #482 with fix.', steps: 6 }),
  },
  {
    id: 'ai.classify', name: 'Classify', category: 'ai', icon: Tags,
    description: 'Label input into categories',
    fields: [{ key: 'labels', label: 'Labels (comma-sep)', placeholder: 'urgent, routine, spam', required: true }],
    sample: cfg => ({ label: (cfg.labels || 'urgent').split(',')[0].trim(), confidence: 0.93 }),
  },
  {
    id: 'ai.summarize', name: 'Summarize', category: 'ai', icon: FileText,
    description: 'Condense input to key points',
    fields: [{ key: 'style', label: 'Style', kind: 'select', options: ['bullets', 'paragraph', 'headline'] }],
    sample: () => ({ summary: '3 deploys, 1 rollback, error budget at 98.2%.' }),
  },

  // Infra
  {
    id: 'infra.terraform', name: 'Terraform', category: 'infra', icon: Layers,
    description: 'Plan or apply infrastructure',
    fields: [
      { key: 'dir', label: 'Working dir', placeholder: 'infra/prod', required: true },
      { key: 'action', label: 'Action', kind: 'select', options: ['plan', 'apply', 'destroy'] },
    ],
    sample: cfg => ({ action: cfg.action || 'plan', changes: { add: 3, change: 1, destroy: 0 } }),
  },
  {
    id: 'infra.k8s', name: 'Kubernetes', category: 'infra', icon: Boxes,
    description: 'Apply manifests or roll a deployment',
    fields: [
      { key: 'context', label: 'Context', placeholder: 'prod-eu', required: true },
      { key: 'manifest', label: 'Manifest', placeholder: 'k8s/api.yaml' },
    ],
    sample: () => ({ deployment: 'api', replicas: 6, status: 'rolled' }),
  },
  {
    id: 'infra.docker', name: 'Docker build', category: 'infra', icon: Container,
    description: 'Build and push an image',
    fields: [{ key: 'tag', label: 'Image tag', placeholder: 'registry/app:v42', required: true }],
    sample: cfg => ({ image: cfg.tag || 'registry/app:v42', digest: 'sha256:9f2c', pushed: true }),
  },
  {
    id: 'infra.ssh', name: 'SSH command', category: 'infra', icon: TerminalSquare,
    description: 'Run a command on a remote host',
    fields: [
      { key: 'host', label: 'Host', placeholder: 'oracle.local', required: true },
      { key: 'command', label: 'Command', kind: 'code', placeholder: 'systemctl restart api', required: true },
    ],
    sample: () => ({ exitCode: 0, stdout: 'api restarted' }),
  },
  {
    id: 'infra.lambda', name: 'Cloud function', category: 'infra', icon: CloudCog,
    description: 'Invoke a serverless function',
    fields: [{ key: 'fn', label: 'Function', placeholder: 'resize-images', required: true }],
    sample: () => ({ statusCode: 200, durationMs: 412 }),
  },

  // Data
  {
    id: 'data.http', name: 'HTTP request', category: 'data', icon: Globe,
    description: 'Call any API',
    fields: [
      { key: 'url', label: 'URL', placeholder: 'https://api.example.com/v1/items', required: true },
      { key: 'method', label: 'Method', kind: 'select', options: ['GET', 'POST', 'PUT', 'DELETE'] },
      { key: 'body', label: 'Body', kind: 'code', placeholder: '{"event": "{{Webhook.body}}"}' },
    ],
    sample: cfg => ({
      status: cfg.method === 'POST' || cfg.method === 'PUT' ? 201 : 200,
      url: cfg.url || 'https://api.example.com/v1/items',
      sentBody: cfg.body || null,
      response: { ok: true, id: 'evt_58231' },
    }),
  },
  {
    id: 'data.postgres', name: 'PostgreSQL', category: 'data', icon: Database,
    description: 'Run a query',
    fields: [{ key: 'query', label: 'Query', kind: 'code', placeholder: 'SELECT * FROM orders WHERE created_at > now() - interval \'1 day\'', required: true }],
    sample: () => ({ rows: 128, sample: { id: 9121, total: 84.5 } }),
  },
  {
    id: 'data.transform', name: 'Transform', category: 'data', icon: Braces,
    description: 'Reshape data with JavaScript',
    fields: [{ key: 'code', label: 'Code', kind: 'code', placeholder: 'return input.items.map(i => i.id)', required: true }],
    sample: () => ({ output: [9121, 9122, 9123] }),
  },
  {
    id: 'data.filter', name: 'Filter', category: 'data', icon: Filter,
    description: 'Keep only matching items',
    fields: [{ key: 'expr', label: 'Condition', placeholder: 'item.total > 50', required: true }],
    sample: () => ({ kept: 42, dropped: 86 }),
  },

  // Logic
  {
    id: 'logic.branch', name: 'Branch', category: 'logic', icon: Split, branching: true,
    description: 'Fork into parallel lanes by condition',
    fields: [{ key: 'on', label: 'Branch on', placeholder: 'result.label' }],
    sample: () => ({ matched: 'lane A' }),
  },
  {
    id: 'logic.loop', name: 'Loop', category: 'logic', icon: Repeat,
    description: 'Repeat downstream steps per item',
    fields: [{ key: 'items', label: 'Items expression', placeholder: 'input.rows', required: true }],
    sample: () => ({ iterations: 14 }),
  },
  {
    id: 'logic.wait', name: 'Wait', category: 'logic', icon: Timer,
    description: 'Pause before continuing',
    fields: [{ key: 'duration', label: 'Duration', placeholder: '15m', required: true }],
    sample: cfg => ({ waited: cfg.duration || '15m' }),
  },
  {
    id: 'logic.approval', name: 'Approval', category: 'logic', icon: UserCheck,
    description: 'Hold for a human sign-off',
    fields: [{ key: 'approver', label: 'Approver', placeholder: 'justyn@fintonlabs.com', required: true }],
    sample: () => ({ approvedBy: 'justyn', at: '2026-07-12T09:14:00Z' }),
  },

  // Notify
  {
    id: 'notify.slack', name: 'Slack', category: 'notify', icon: MessageSquare,
    description: 'Post a message to a channel',
    fields: [
      { key: 'channel', label: 'Channel', placeholder: '#deploys', required: true },
      { key: 'message', label: 'Message', kind: 'code', placeholder: 'Deploy of {{sha}} finished' },
    ],
    sample: cfg => ({ channel: cfg.channel || '#deploys', message: cfg.message || 'Deploy finished', ts: '1783934061.000200' }),
  },
  {
    id: 'notify.email', name: 'Email', category: 'notify', icon: Mail,
    description: 'Send an email',
    fields: [
      { key: 'to', label: 'To', placeholder: 'team@fintonlabs.com', required: true },
      { key: 'subject', label: 'Subject', placeholder: 'Nightly report' },
    ],
    sample: () => ({ messageId: '<9d2f@newflow>', accepted: true }),
  },
  {
    id: 'notify.pagerduty', name: 'PagerDuty', category: 'notify', icon: Siren,
    description: 'Open or resolve an incident',
    fields: [{ key: 'service', label: 'Service', placeholder: 'api-prod', required: true }],
    sample: () => ({ incident: 'PD-2231', status: 'triggered' }),
  },
]

export const toolById = (id: string): ToolDef | undefined => TOOLS.find(t => t.id === id)
export const isTrigger = (id: string) => id.startsWith('trigger.')
