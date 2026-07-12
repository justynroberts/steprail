// MIT License - Copyright (c) fintonlabs.com
// The tool catalog, shared by client and server. Icons live client-side in
// src/tools.ts. `sample()` is NOT what runs return — real executors live in
// server/executors.mjs. Samples exist only to suggest output shapes for the
// token chips and as example upstream data when testing a step that has
// never run.
import { parseSchedule, scheduleSummary, scheduleToCron } from './schedule.mjs'

export const CATEGORY_LABEL = {
  trigger: 'Triggers',
  ai: 'AI',
  infra: 'Infra',
  data: 'Data',
  logic: 'Logic',
  notify: 'Notify',
}

export const CATEGORY_ORDER = ['trigger', 'ai', 'infra', 'data', 'logic', 'notify']

export const TOOL_CORE = [
  // Triggers
  {
    id: 'trigger.webhook', name: 'Webhook', category: 'trigger',
    description: 'Start when an HTTP request arrives',
    fields: [{ key: 'path', label: 'Path', placeholder: '/hooks/deploy', required: true }],
    sample: cfg => ({ method: 'POST', path: cfg.path || '/hooks/deploy', body: { ref: 'main', actor: 'justyn' } }),
  },
  {
    id: 'trigger.schedule', name: 'Schedule', category: 'trigger',
    description: 'Start on a friendly schedule',
    fields: [{ key: 'schedule', label: 'When should this run?', kind: 'schedule', required: true }],
    sample: cfg => {
      const s = parseSchedule(cfg.schedule)
      return { firedAt: '2026-07-12T09:00:00Z', schedule: scheduleSummary(s), cron: scheduleToCron(s) }
    },
  },
  {
    id: 'trigger.git', name: 'Git push', category: 'trigger',
    description: 'Start when a branch is pushed (via webhook)',
    fields: [
      { key: 'repo', label: 'Repository', placeholder: 'org/api', required: true },
      { key: 'branch', label: 'Branch', placeholder: 'main' },
    ],
    sample: cfg => ({ repo: cfg.repo || 'org/api', branch: cfg.branch || 'main', sha: 'a1b2c3d', message: 'fix: retry logic' }),
  },
  {
    id: 'trigger.file', name: 'File watch', category: 'trigger',
    description: 'Start when files change in a path',
    fields: [{ key: 'glob', label: 'Glob', placeholder: 'uploads/**/*.csv', required: true }],
    sample: cfg => ({ file: 'uploads/leads-07.csv', glob: cfg.glob || 'uploads/**/*.csv', size: 48213 }),
  },

  // AI
  {
    id: 'ai.prompt', name: 'LLM prompt', category: 'ai',
    description: 'Run a prompt against a model',
    fields: [
      { key: 'prompt', label: 'Prompt', kind: 'code', placeholder: 'Summarize {{input}} in three bullets', required: true },
      { key: 'model', label: 'Model', kind: 'select', options: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-8'] },
    ],
    sample: () => ({ text: 'Deploy completed cleanly; latency improved 12%; no regressions found.', tokens: 384 }),
  },
  {
    id: 'ai.agent', name: 'AI agent', category: 'ai',
    description: 'Goal-seeking agent',
    fields: [
      { key: 'goal', label: 'Goal', kind: 'code', placeholder: 'Investigate the failing check and propose a fix', required: true },
      { key: 'maxSteps', label: 'Max steps', kind: 'number', placeholder: '10' },
    ],
    sample: () => ({ result: 'Root cause: stale lockfile. Opened PR #482 with fix.', steps: 6 }),
  },
  {
    id: 'ai.classify', name: 'Classify', category: 'ai',
    description: 'Label input into categories',
    fields: [{ key: 'labels', label: 'Labels (comma-sep)', placeholder: 'urgent, routine, spam', required: true }],
    sample: cfg => ({ label: (cfg.labels || 'urgent').split(',')[0].trim(), confidence: 0.93 }),
  },
  {
    id: 'ai.summarize', name: 'Summarize', category: 'ai',
    description: 'Condense input to key points',
    fields: [{ key: 'style', label: 'Style', kind: 'select', options: ['bullets', 'paragraph', 'headline'] }],
    sample: () => ({ summary: '3 deploys, 1 rollback, error budget at 98.2%.' }),
  },

  // Infra
  {
    id: 'infra.terraform', name: 'Terraform', category: 'infra',
    description: 'Plan or apply infrastructure (runs the real CLI)',
    fields: [
      { key: 'dir', label: 'Working dir', placeholder: 'infra/prod', required: true },
      { key: 'action', label: 'Action', kind: 'select', options: ['plan', 'apply', 'destroy'] },
    ],
    sample: cfg => ({ action: cfg.action || 'plan', exitCode: 0, output: 'Plan: 3 to add, 1 to change, 0 to destroy.' }),
  },
  {
    id: 'infra.k8s', name: 'Kubernetes', category: 'infra',
    description: 'Apply manifests with the real kubectl',
    fields: [
      { key: 'context', label: 'Context', placeholder: 'prod-eu', required: true },
      { key: 'manifest', label: 'Manifest', placeholder: 'k8s/api.yaml' },
    ],
    sample: () => ({ exitCode: 0, output: 'deployment.apps/api configured' }),
  },
  {
    id: 'infra.docker', name: 'Docker build', category: 'infra',
    description: 'Build an image with the real docker CLI',
    fields: [
      { key: 'tag', label: 'Image tag', placeholder: 'registry/app:v42', required: true },
      { key: 'context', label: 'Build context', placeholder: '.' },
    ],
    sample: cfg => ({ image: cfg.tag || 'registry/app:v42', exitCode: 0 }),
  },
  {
    id: 'infra.ssh', name: 'SSH command', category: 'infra',
    description: 'Run a command on a remote host over real SSH',
    fields: [
      { key: 'host', label: 'Host', placeholder: 'oracle.local', required: true },
      { key: 'command', label: 'Command', kind: 'code', placeholder: 'systemctl restart api', required: true },
    ],
    sample: () => ({ exitCode: 0, stdout: 'api restarted' }),
  },
  {
    id: 'infra.lambda', name: 'Cloud function', category: 'infra',
    description: 'Invoke a function with the real aws CLI',
    fields: [{ key: 'fn', label: 'Function', placeholder: 'resize-images', required: true }],
    sample: () => ({ statusCode: 200, exitCode: 0 }),
  },

  // Data
  {
    id: 'data.http', name: 'HTTP request', category: 'data',
    description: 'Call any API for real',
    fields: [
      { key: 'url', label: 'URL', placeholder: 'https://api.example.com/v1/items', required: true },
      { key: 'method', label: 'Method', kind: 'select', options: ['GET', 'POST', 'PUT', 'DELETE'] },
      { key: 'body', label: 'Body', kind: 'code', placeholder: '{"event": "{{Webhook.body}}"}' },
    ],
    sample: cfg => ({ status: 200, url: cfg.url || 'https://api.example.com', response: { ok: true } }),
  },
  {
    id: 'data.postgres', name: 'PostgreSQL', category: 'data',
    description: 'Run a real query (connection in Settings)',
    fields: [{ key: 'query', label: 'Query', kind: 'code', placeholder: "SELECT * FROM orders WHERE created_at > now() - interval '1 day'", required: true }],
    sample: () => ({ rowCount: 128, rows: [{ id: 9121, total: 84.5 }] }),
  },
  {
    id: 'data.transform', name: 'Transform', category: 'data',
    description: 'Reshape data with real JavaScript',
    fields: [{ key: 'code', label: 'Code', kind: 'code', placeholder: 'return input.items.map(i => i.id)', required: true }],
    sample: () => ({ output: [9121, 9122, 9123] }),
  },
  {
    id: 'data.filter', name: 'Filter', category: 'data',
    description: 'Keep only items matching a condition',
    fields: [{ key: 'expr', label: 'Condition', placeholder: 'item.total > 50', required: true }],
    sample: () => ({ kept: [{ id: 9121, total: 84.5 }], keptCount: 1, dropped: 2 }),
  },

  // Logic
  {
    id: 'logic.branch', name: 'Branch', category: 'logic', branching: true,
    description: 'Route to the lane whose label matches',
    fields: [{ key: 'on', label: 'Branch on', placeholder: 'label (a field of the previous output)' }],
    sample: () => ({ matched: 'Lane A', value: 'urgent' }),
  },
  {
    id: 'logic.loop', name: 'Loop', category: 'logic',
    description: 'Evaluate a list; downstream steps see {{item}}',
    fields: [{ key: 'items', label: 'Items expression', placeholder: 'input.rows', required: true }],
    sample: () => ({ count: 14, first: { id: 9121 } }),
  },
  {
    id: 'logic.wait', name: 'Wait', category: 'logic',
    description: 'Pause the run in the queue',
    fields: [{ key: 'duration', label: 'Duration', placeholder: '15m', required: true }],
    sample: cfg => ({ waited: cfg.duration || '15m' }),
  },
  {
    id: 'logic.approval', name: 'Approval', category: 'logic',
    description: 'Hold the run until a human approves',
    fields: [{ key: 'approver', label: 'Approver', placeholder: 'justyn@fintonlabs.com', required: true }],
    sample: () => ({ approvedBy: 'justyn', at: '2026-07-12T09:14:00Z' }),
  },

  // Notify
  {
    id: 'notify.slack', name: 'Slack', category: 'notify',
    description: 'Post for real via a Slack webhook (Settings)',
    fields: [
      { key: 'channel', label: 'Channel', placeholder: '#deploys', required: true },
      { key: 'message', label: 'Message', kind: 'code', placeholder: 'Deploy of {{Push to main.sha}} finished' },
    ],
    sample: cfg => ({ channel: cfg.channel || '#deploys', message: cfg.message || 'Deploy finished', delivered: true }),
  },
  {
    id: 'notify.email', name: 'Email', category: 'notify',
    description: 'Send real email via SMTP (Settings)',
    fields: [
      { key: 'to', label: 'To', placeholder: 'team@fintonlabs.com', required: true },
      { key: 'subject', label: 'Subject', placeholder: 'Nightly report' },
    ],
    sample: () => ({ messageId: '<9d2f@newflow>', accepted: true }),
  },
  {
    id: 'notify.pagerduty', name: 'PagerDuty', category: 'notify',
    description: 'Open a real incident (routing key in Settings)',
    fields: [{ key: 'service', label: 'Service', placeholder: 'api-prod', required: true }],
    sample: () => ({ dedupKey: 'pd-2231', status: 'triggered' }),
  },
]

export const toolCoreById = id => TOOL_CORE.find(t => t.id === id)
export const isTrigger = id => id.startsWith('trigger.')
