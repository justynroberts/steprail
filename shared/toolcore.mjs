// MIT License - Copyright (c) fintonlabs.com
// The tool catalog, shared by client and server. Icons live client-side in
// src/tools.ts. `sample()` is NOT what runs return — real executors live in
// server/executors.mjs. Samples exist only to suggest output shapes for the
// token chips and as example upstream data when testing a step that has
// never run.
import { parseSchedule, scheduleSummary, scheduleToCron } from './schedule.mjs'
import { exampleValue, parseFormFields } from './formcore.mjs'

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
    fields: [
      { key: 'path', label: 'Webhook path', kind: 'generated', required: true },
      { key: 'secret', label: 'Signing secret (optional)', kind: 'secret', placeholder: 'Auto-generated or paste your own — callers must send X-Hub-Signature-256' },
    ],
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
    id: 'trigger.form', name: 'Form', category: 'trigger',
    description: 'Start when someone submits a hosted form',
    fields: [
      { key: 'path', label: 'Form path', placeholder: '/forms/contact', required: true },
      { key: 'title', label: 'Form title', placeholder: 'Contact us' },
      { key: 'description', label: 'Intro text', placeholder: 'We reply within a day.' },
      { key: 'fields', label: 'Form fields', kind: 'form', required: true },
      { key: 'css', label: 'Custom CSS (branding)', kind: 'code', placeholder: ':root { --form-accent: #0f9d6e; }\n.card { border-radius: 0; }' },
    ],
    sample: cfg => {
      const answers = Object.fromEntries(parseFormFields(cfg.fields).map(f => [f.key, exampleValue(f)]))
      return { ...answers, trigger: 'form', submittedAt: '2026-07-13T09:00:00Z' }
    },
  },
  {
    id: 'trigger.mcp', name: 'MCP tool call', category: 'trigger',
    description: 'Expose this flow as a tool AI agents can call',
    fields: [
      { key: 'toolName', label: 'Tool name', placeholder: 'lookup_order', required: true },
      { key: 'description', label: 'What this tool does (for the agent)', placeholder: 'Looks up an order by id and returns its status', required: true },
      { key: 'inputs', label: 'Inputs', kind: 'form' },
    ],
    sample: cfg => {
      const args = Object.fromEntries(parseFormFields(cfg.inputs).map(f => [f.key, exampleValue(f)]))
      return { ...args, trigger: 'mcp', calledAt: '2026-07-13T09:00:00Z' }
    },
  },
  {
    id: 'trigger.git', name: 'Git push', category: 'trigger',
    description: 'Start when a branch is pushed (GitHub webhook)',
    fields: [
      { key: 'path', label: 'Webhook path', kind: 'generated', required: true },
      { key: 'repo', label: 'Repository filter', placeholder: 'org/api (blank = any repo)' },
      { key: 'branch', label: 'Branch filter', placeholder: 'main (blank = any branch)' },
      { key: 'secret', label: 'Webhook signing secret', kind: 'secret', placeholder: 'Set in GitHub → repo Settings → Webhooks → Secret' },
    ],
    sample: cfg => ({ repo: cfg.repo || 'org/api', branch: cfg.branch || 'main', sha: 'a1b2c3d', message: 'fix: retry logic', pusher: 'justyn' }),
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
      { key: 'connection', label: 'API key', kind: 'connection', connType: 'anthropic' },
    ],
    sample: () => ({ text: 'Deploy completed cleanly; latency improved 12%; no regressions found.', tokens: 384 }),
  },
  {
    id: 'ai.agent', name: 'AI agent', category: 'ai',
    description: 'Agent with real tool use via an MCP server',
    fields: [
      { key: 'goal', label: 'Goal', kind: 'code', placeholder: 'Investigate the failing check and propose a fix', required: true },
      { key: 'mcp', label: 'Tool server (MCP)', kind: 'connection', connType: 'mcp' },
      { key: 'maxSteps', label: 'Max tool calls', kind: 'number', placeholder: '8' },
      { key: 'connection', label: 'API key', kind: 'connection', connType: 'anthropic' },
    ],
    sample: () => ({ result: 'Root cause: stale lockfile. Opened PR #482 with fix.', steps: 6, toolCalls: [{ tool: 'read_file', ok: true }] }),
  },
  {
    id: 'ai.mcptool', name: 'MCP tool', category: 'ai',
    description: 'Call one tool on a connected MCP server',
    fields: [
      { key: 'connection', label: 'MCP server', kind: 'connection', connType: 'mcp' },
      { key: 'tool', label: 'Tool name', placeholder: 'read_file', required: true },
      { key: 'args', label: 'Arguments', kind: 'json', placeholder: '{"path": "{{Incoming event.body.file}}"}' },
    ],
    sample: () => ({ text: 'Tool result appears here', isError: false }),
  },
  {
    id: 'ai.extract', name: 'Extract', category: 'ai',
    description: 'Pull structured fields out of messy input',
    fields: [
      { key: 'fields', label: 'Fields to extract', kind: 'form', required: true },
      { key: 'hint', label: 'Guidance (optional)', placeholder: 'Amounts are in EUR' },
      { key: 'connection', label: 'API key', kind: 'connection', connType: 'anthropic' },
    ],
    sample: cfg => Object.fromEntries(parseFormFields(cfg.fields).map(f => [f.key, exampleValue(f)])),
  },
  {
    id: 'ai.classify', name: 'Classify', category: 'ai',
    description: 'Label input into categories',
    fields: [
      { key: 'labels', label: 'Labels (comma-sep)', placeholder: 'urgent, routine, spam', required: true },
      { key: 'connection', label: 'API key', kind: 'connection', connType: 'anthropic' },
    ],
    sample: cfg => ({ label: (cfg.labels || 'urgent').split(',')[0].trim(), confidence: 0.93 }),
  },
  {
    id: 'ai.summarize', name: 'Summarize', category: 'ai',
    description: 'Condense input to key points',
    fields: [
      { key: 'style', label: 'Style', kind: 'select', options: ['bullets', 'paragraph', 'headline'] },
      { key: 'connection', label: 'API key', kind: 'connection', connType: 'anthropic' },
    ],
    sample: () => ({ summary: '3 deploys, 1 rollback, error budget at 98.2%.' }),
  },

  // Infra
  {
    id: 'infra.terraform', name: 'Terraform', category: 'infra',
    description: 'Plan or apply infrastructure (runs the real CLI)',
    fields: [
      { key: 'dir', label: 'Working dir', placeholder: 'infra/prod', required: true },
      { key: 'action', label: 'Action', kind: 'select', options: ['plan', 'apply', 'destroy'] },
      { key: 'connection', label: 'AWS credentials', kind: 'connection', connType: 'aws' },
    ],
    sample: cfg => ({ action: cfg.action || 'plan', exitCode: 0, output: 'Plan: 3 to add, 1 to change, 0 to destroy.' }),
  },
  {
    id: 'infra.k8s', name: 'Kubernetes', category: 'infra',
    description: 'Apply manifests with the real kubectl',
    fields: [
      { key: 'context', label: 'Context', placeholder: 'prod-eu', required: true },
      { key: 'manifest', label: 'Manifest', placeholder: 'k8s/api.yaml' },
      { key: 'connection', label: 'Kubeconfig', kind: 'connection', connType: 'k8s' },
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
    description: 'Run a command or script on a remote host over real SSH',
    // The Command/Script tabs ARE the mode switch — picking one sets "mode".
    modeTabs: { key: 'mode', values: { Command: 'command', Script: 'script' } },
    fields: [
      { key: 'mode', label: 'Run mode', kind: 'select', options: ['command', 'script'], hidden: true },
      { key: 'command', label: 'Command', kind: 'code', placeholder: 'systemctl restart api', tab: 'Command' },
      { key: 'script', label: 'Script (piped to bash -s on the host)', kind: 'code', placeholder: '#!/bin/bash\nset -euo pipefail\ndf -h /\nuptime', tab: 'Script' },
      { key: 'host', label: 'Host', placeholder: 'prod.example.com', required: true, tab: 'Target' },
      { key: 'user', label: 'User', placeholder: 'deploy (blank = system default)', tab: 'Target' },
      { key: 'port', label: 'Port', kind: 'number', placeholder: '22', tab: 'Target' },
      { key: 'connection', label: 'SSH key / password', kind: 'connection', connType: 'ssh', tab: 'Target' },
    ],
    sample: () => ({ exitCode: 0, stdout: 'api restarted' }),
  },
  {
    id: 'infra.ansible', name: 'Ansible', category: 'infra',
    description: 'Run a playbook — inline or pulled from git',
    // The Inline/Pull tabs ARE the source switch — picking one sets "source".
    modeTabs: { key: 'source', values: { 'Inline playbook': 'inline', 'Pull from git': 'git' } },
    fields: [
      { key: 'source', label: 'Playbook source', kind: 'select', options: ['inline', 'git'], hidden: true },
      { key: 'playbook', label: 'Playbook YAML', kind: 'code', placeholder: '- hosts: all\n  tasks:\n    - name: Ping every host\n      ansible.builtin.ping:', tab: 'Inline playbook' },
      { key: 'repo', label: 'Git repo', placeholder: 'https://github.com/org/playbooks.git', tab: 'Pull from git' },
      { key: 'path', label: 'Playbook path in repo', placeholder: 'site.yml', tab: 'Pull from git' },
      { key: 'ref', label: 'Branch or tag', placeholder: 'main (blank = default branch)', tab: 'Pull from git' },
      { key: 'inventory', label: 'Inventory', kind: 'code', placeholder: 'web1.example.com,web2.example.com — or paste INI/YAML inventory — or a path in the repo. Blank = implicit localhost.', tab: 'Run' },
      { key: 'user', label: 'Remote user', placeholder: 'deploy (blank = system default)', tab: 'Run' },
      { key: 'connection', label: 'SSH key / password', kind: 'connection', connType: 'ssh', tab: 'Run' },
      { key: 'extraVars', label: 'Extra vars', kind: 'json', placeholder: '{"app_version": "{{Build.tag}}"}', tab: 'Run' },
    ],
    sample: () => ({
      ok: 3, changed: 1, failed: 0, unreachable: 0,
      hosts: { 'web1.example.com': { ok: 3, changed: 1, unreachable: 0, failed: 0 } },
      output: 'PLAY RECAP — web1.example.com : ok=3 changed=1 unreachable=0 failed=0',
    }),
  },
  {
    id: 'infra.lambda', name: 'Cloud function', category: 'infra',
    description: 'Invoke a function with the real aws CLI',
    fields: [
      { key: 'fn', label: 'Function', placeholder: 'resize-images', required: true },
      { key: 'connection', label: 'AWS credentials', kind: 'connection', connType: 'aws' },
    ],
    sample: () => ({ statusCode: 200, exitCode: 0 }),
  },

  // Data
  {
    id: 'data.http', name: 'HTTP request', category: 'data',
    description: 'Call any API for real',
    fields: [
      { key: 'url', label: 'URL', placeholder: 'https://api.example.com/v1/items', required: true },
      { key: 'method', label: 'Method', kind: 'select', options: ['GET', 'POST', 'PUT', 'DELETE'] },
      { key: 'body', label: 'Body', kind: 'json', placeholder: '{"event": "{{Webhook.body}}"}' },
      { key: 'headers', label: 'Headers', kind: 'json', placeholder: '{"x-api-version": "2"}' },
      { key: 'connection', label: 'Auth (Bearer)', kind: 'connection', connType: 'apikey' },
    ],
    sample: cfg => ({ status: 200, url: cfg.url || 'https://api.example.com', response: { ok: true } }),
  },
  {
    id: 'data.postgres', name: 'PostgreSQL', category: 'data',
    description: 'Run a real query against a connected database',
    fields: [
      { key: 'connection', label: 'Database', kind: 'connection', connType: 'postgres' },
      { key: 'query', label: 'Query', kind: 'code', placeholder: "SELECT * FROM orders WHERE created_at > now() - interval '1 day'", required: true },
    ],
    sample: () => ({ rowCount: 128, rows: [{ id: 9121, total: 84.5 }] }),
  },
  {
    id: 'data.transform', name: 'Transform', category: 'data',
    description: 'Reshape data with real JavaScript',
    fields: [{ key: 'code', label: 'Code', kind: 'code', placeholder: 'return input.items.map(i => i.id)', required: true }],
    sample: () => ({ output: [9121, 9122, 9123] }),
  },
  {
    id: 'data.memory', name: 'Memory', category: 'data',
    description: 'Save or recall values across runs',
    fields: [
      { key: 'mode', label: 'Action', kind: 'select', options: ['save', 'load', 'append', 'forget'] },
      { key: 'key', label: 'Key', placeholder: 'last-seen-id', required: true },
      { key: 'value', label: 'Value (blank = previous step output)', kind: 'code', placeholder: '{{Check health.response.uptime}}' },
    ],
    sample: cfg => ({ key: cfg.key || 'last-seen-id', value: 'stored value', mode: cfg.mode || 'save' }),
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
    id: 'logic.until', name: 'Until', category: 'logic',
    description: 'Repeat the following steps until a condition passes',
    fields: [
      { key: 'condition', label: 'Stop when', kind: 'code', placeholder: "input.status === 'done'", required: true },
      { key: 'max', label: 'Max repeats', kind: 'number', placeholder: '5' },
    ],
    sample: () => ({ iterations: 3, satisfied: true }),
  },
  {
    id: 'logic.subflow', name: 'Run flow', category: 'logic',
    description: 'Run another flow and use its result',
    fields: [
      { key: 'flow', label: 'Flow name', placeholder: 'Nightly AI report', required: true },
      { key: 'vars', label: 'Variables to pass', kind: 'json', placeholder: '{"region": "{{var.region}}", "mode": "fast"}' },
    ],
    sample: () => ({ status: 'finished', result: { note: 'output of the last step of that flow' } }),
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
      { key: 'connection', label: 'Workspace webhook', kind: 'connection', connType: 'slack' },
      { key: 'channel', label: 'Channel', placeholder: '#deploys', required: true },
      { key: 'message', label: 'Message', kind: 'code', placeholder: 'Deploy of {{Push to main.sha}} finished' },
    ],
    sample: cfg => ({ channel: cfg.channel || '#deploys', message: cfg.message || 'Deploy finished', delivered: true }),
  },
  {
    id: 'notify.email', name: 'Email', category: 'notify',
    description: 'Send real email via SMTP (Settings)',
    fields: [
      { key: 'connection', label: 'Mail server', kind: 'connection', connType: 'smtp' },
      { key: 'to', label: 'To', placeholder: 'team@fintonlabs.com', required: true },
      { key: 'subject', label: 'Subject', placeholder: 'Nightly report' },
      { key: 'body', label: 'Body', kind: 'code', placeholder: 'Report for {{system.date}}: {{Summarize.summary}}' },
    ],
    sample: () => ({ messageId: '<9d2f@steprail>', accepted: true }),
  },
  {
    id: 'notify.pagerduty', name: 'PagerDuty', category: 'notify',
    description: 'Open a real incident (routing key in Settings)',
    fields: [
      { key: 'connection', label: 'Routing key', kind: 'connection', connType: 'pagerduty' },
      { key: 'service', label: 'Service', placeholder: 'api-prod', required: true },
    ],
    sample: () => ({ dedupKey: 'pd-2231', status: 'triggered' }),
  },
]

export const toolCoreById = id => TOOL_CORE.find(t => t.id === id)
export const isTrigger = id => id.startsWith('trigger.')
