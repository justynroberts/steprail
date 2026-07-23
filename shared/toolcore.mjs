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
      { key: 'path', label: 'Form path', kind: 'generated', required: true },
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
      { key: 'model', label: 'Model', kind: 'select', placeholder: 'Setup default', options: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-8'] },
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
      { key: 'model', label: 'Model', kind: 'select', placeholder: 'Setup default', options: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-8'] },
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
      { key: 'model', label: 'Model', kind: 'select', placeholder: 'Setup default', options: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-8'] },
      { key: 'connection', label: 'API key', kind: 'connection', connType: 'anthropic' },
    ],
    sample: cfg => Object.fromEntries(parseFormFields(cfg.fields).map(f => [f.key, exampleValue(f)])),
  },
  {
    id: 'ai.classify', name: 'Classify', category: 'ai',
    description: 'Label input into categories',
    fields: [
      { key: 'labels', label: 'Labels (comma-sep)', placeholder: 'urgent, routine, spam', required: true },
      { key: 'model', label: 'Model', kind: 'select', placeholder: 'Setup default', options: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-8'] },
      { key: 'connection', label: 'API key', kind: 'connection', connType: 'anthropic' },
    ],
    sample: cfg => ({ label: (cfg.labels || 'urgent').split(',')[0].trim(), confidence: 0.93 }),
  },
  {
    id: 'ai.summarize', name: 'Summarize', category: 'ai',
    description: 'Condense input to key points',
    fields: [
      { key: 'text', label: 'What to summarize (blank = previous step’s output)', kind: 'code', placeholder: '{{Fleet df.hosts.*.stdout}}\n\n{{Fetch incidents.response}} — mix any tokens, from any steps' },
      { key: 'style', label: 'Style', kind: 'select', options: ['bullets', 'paragraph', 'headline'] },
      { key: 'model', label: 'Model', kind: 'select', placeholder: 'Setup default', options: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-8'] },
      { key: 'connection', label: 'API key', kind: 'connection', connType: 'anthropic' },
    ],
    sample: () => ({ summary: '3 deploys, 1 rollback, error budget at 98.2%.' }),
  },

  // Infra
  {
    id: 'infra.terraform', name: 'Terraform', category: 'infra',
    description: 'Plan or apply infrastructure — inline HCL or a directory on disk (runs the real CLI)',
    // Inline/Directory tabs ARE the source switch, mirroring Ansible. Inline
    // HCL is written to a temp dir and `terraform init` runs before the action.
    modeTabs: { key: 'source', values: { 'Inline HCL': 'inline', 'Directory on disk': 'dir' } },
    fields: [
      { key: 'source', label: 'Config source', kind: 'select', options: ['inline', 'dir'], hidden: true },
      { key: 'hcl', label: 'Terraform HCL', kind: 'code', placeholder: 'terraform {\n  required_providers {\n    random = { source = "hashicorp/random" }\n  }\n}\n\nresource "random_pet" "name" {\n  length = 2\n}\n\noutput "name" {\n  value = random_pet.name.id\n}', tab: 'Inline HCL' },
      { key: 'dir', label: 'Working dir', placeholder: 'infra/prod', tab: 'Directory on disk' },
      { key: 'action', label: 'Action', kind: 'select', options: ['plan', 'apply', 'destroy'], tab: 'Run' },
      { key: 'connection', label: 'AWS credentials', kind: 'connection', connType: 'aws', tab: 'Run' },
    ],
    sample: cfg => ({ action: cfg.action || 'plan', exitCode: 0, output: 'Plan: 3 to add, 1 to change, 0 to destroy.' }),
  },
  {
    id: 'infra.k8s', name: 'Kubernetes', category: 'infra',
    description: 'Apply manifests or run kubectl commands',
    modeTabs: { key: 'mode', values: { 'Apply manifest': 'apply', 'Run kubectl': 'command' } },
    fields: [
      { key: 'mode', label: 'Mode', hidden: true },
      { key: 'manifest', label: 'Manifest', placeholder: 'k8s/api.yaml', tab: 'Apply manifest' },
      { key: 'command', label: 'Command', kind: 'code', placeholder: 'kubectl get pods -n prod -o wide', tab: 'Run kubectl' },
      { key: 'context', label: 'Context', placeholder: 'prod-eu', required: true, tab: 'Cluster' },
      { key: 'connection', label: 'Kubeconfig', kind: 'connection', connType: 'k8s', tab: 'Cluster' },
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
      { key: 'group', label: 'Target group', placeholder: 'linux — a tag from Targets; runs on every host carrying it (define hosts under Targets)', tab: 'Target' },
      { key: 'host', label: 'Host(s)', kind: 'code', placeholder: 'web1.example.com, web2.example.com, deploy@web3:2222 — a comma list runs on every host in parallel. Combine with a group above, or use on its own.', tab: 'Target' },
      { key: 'user', label: 'User', placeholder: 'deploy (blank = system default)', tab: 'Target' },
      { key: 'port', label: 'Port', kind: 'number', placeholder: '22', tab: 'Target' },
      { key: 'connection', label: 'SSH key / password (fallback for unnamed hosts)', kind: 'connection', connType: 'ssh', tab: 'Target' },
      { key: 'allowExit', label: 'Allow non-zero exit', kind: 'select', options: ['no', 'yes'], placeholder: 'yes = a non-zero exit code counts as success (for health-check scripts that exit with a status count)', tab: 'Target' },
    ],
    // The sample mirrors the step's OWN host list, so token chips offer
    // hosts.<your actual host>.stdout for every configured machine.
    sample: cfg => {
      const targets = String(cfg.host || '').split(/[\n,]+/).map(t => t.trim()).filter(Boolean)
      if (targets.length <= 1) return { host: targets[0] || 'prod.example.com', exitCode: 0, stdout: 'api restarted' }
      return {
        ok: targets.length, failed: 0, failedHosts: [],
        hosts: {
          // "*" is a real token wildcard: {{Step.hosts.*.stdout}} joins every
          // host's output, one per line. Listed first so the chip shows up.
          '*': { stdout: 'every host, one line each' },
          ...Object.fromEntries(targets.map(t => {
            const host = t.includes('@') ? t.slice(t.lastIndexOf('@') + 1) : t
            return [t, { stdout: `output from ${host}`, exitCode: 0 }]
          })),
        },
      }
    },
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
      { key: 'invSource', label: 'Inventory source', kind: 'select', options: ['inline', 'git', 'group'], tab: 'Inventory' },
      { key: 'invGroup', label: 'Inventory group (Infrastructure tag)', placeholder: 'linux — every host carrying this tag becomes an inventory host', tab: 'Inventory' },
      { key: 'inventory', label: 'Inventory (inline)', kind: 'code', placeholder: 'web1.example.com, web2.example.com — or paste INI/YAML. Blank = implicit localhost.', tab: 'Inventory' },
      { key: 'invRepo', label: 'Inventory git repo', placeholder: 'https://github.com/org/inventory.git — blank reuses the playbook repo', tab: 'Inventory' },
      { key: 'invPath', label: 'Inventory path in repo', placeholder: 'inventories/prod/hosts.ini', tab: 'Inventory' },
      { key: 'invRef', label: 'Inventory branch or tag', placeholder: 'main (blank = default branch)', tab: 'Inventory' },
      { key: 'user', label: 'Remote user', placeholder: 'deploy (blank = system default)', tab: 'Run' },
      { key: 'connection', label: 'SSH key / password', kind: 'connection', connType: 'ssh', tab: 'Run' },
      { key: 'extraVars', label: 'Extra vars', kind: 'json', placeholder: '{"app_version": "{{Build.tag}}"}', tab: 'Run' },
    ],
    // When the inventory is a simple comma host list, the sample mirrors it
    // so token chips offer hosts.<your host>.* per machine.
    sample: cfg => {
      const inv = String(cfg.inventory || '').trim()
      const targets = inv && !/[\n=:[]/.test(inv)
        ? inv.split(',').map(t => t.trim()).filter(Boolean)
        : ['web1.example.com']
      return {
        ok: targets.length, changed: 1, failed: 0, unreachable: 0,
        hosts: Object.fromEntries(targets.map(t => [t, { ok: 3, changed: 1, unreachable: 0, failed: 0 }])),
        output: `PLAY RECAP — ${targets[0]} : ok=3 changed=1 unreachable=0 failed=0`,
      }
    },
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
  {
    id: 'infra.git', name: 'Git', category: 'infra',
    description: 'One step for git: clone, branch, stage/commit, push, pull, merge, tag or inspect a repo (runs the real CLI)',
    fields: [
      { key: 'op', label: 'Operation', kind: 'select', options: ['status', 'log', 'clone', 'checkout', 'commit', 'push', 'pull', 'merge', 'tag'] },
      { key: 'dir', label: 'Working directory', placeholder: 'repo checkout path — blank clones to a temp dir' },
      { key: 'repo', label: 'Repo URL', placeholder: 'https://github.com/org/repo.git (clone)' },
      { key: 'ref', label: 'Branch / tag / commit', placeholder: 'main — for checkout, pull, merge, tag, or clone' },
      { key: 'message', label: 'Message', kind: 'code', placeholder: 'commit or annotated-tag message' },
      { key: 'files', label: 'Files to stage', placeholder: 'src/ README.md — space or comma separated; blank = all changes' },
      { key: 'remote', label: 'Remote', placeholder: 'origin (blank = origin)' },
      { key: 'connection', label: 'GitHub token', kind: 'connection', connType: 'github' },
    ],
    sample: cfg => ({
      op: cfg.op || 'status',
      exitCode: 0,
      branch: cfg.ref || 'main',
      output: ({
        status: '## main...origin/main\n M src/app.ts',
        log: 'a1b2c3d Update readme\n9f8e7d6 Initial commit',
        clone: "Cloning into 'repo'...\na1b2c3d Update readme",
        commit: '[main a1b2c3d] ' + (cfg.message || 'update') + '\n 1 file changed',
        push: 'To github.com:org/repo.git\n   9f8e7d6..a1b2c3d  main -> main',
      })[cfg.op] || 'done',
    }),
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
    fields: [
      { key: 'approver', label: 'Approver', placeholder: 'justyn@fintonlabs.com — emailed a signed approve/reject link (comma-separate for several)', required: true },
      { key: 'message', label: 'Message to approver', kind: 'code', placeholder: 'What are they approving, and what to check? e.g. “Please confirm the maintenance window is open — this deploys {{var.service}} to production.”' },
    ],
    sample: () => ({ approvedBy: 'justyn', via: 'signed-link', at: '2026-07-12T09:14:00Z' }),
  },
  {
    id: 'logic.exit', name: 'Exit', category: 'logic',
    description: 'Stop the flow here — skip everything after',
    fields: [{ key: 'reason', label: 'Reason (optional)', placeholder: 'Already processed — nothing to do' }],
    sample: cfg => ({ exited: true, ...(cfg.reason ? { reason: cfg.reason } : {}) }),
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
      { key: 'from', label: 'From (optional)', placeholder: 'onboarding@resend.dev — must be a verified sender' },
      { key: 'subject', label: 'Subject', placeholder: 'Nightly report' },
      { key: 'body', label: 'Body', kind: 'code', placeholder: 'Report for {{system.date}}: {{Summarize.summary}}' },
      { key: 'transport', label: 'Send via', kind: 'select', options: ['auto', 'smtp', 'api'], placeholder: 'auto = Resend over HTTPS (works where SMTP is blocked, e.g. Railway), any other provider over SMTP' },
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
