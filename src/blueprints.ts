// MIT License - Copyright (c) fintonlabs.com
// Blueprints: reusable flows stored in the portable JSON format — the same
// format LLMs author and the JSON dialog imports. Built-ins ship here;
// custom ones are saved from the editor and persist server-side.
import type { Flow, Step } from './types'
import type { PortableFlow } from './flowjson'
import { hydrateFlow } from './flowjson'
import { getActiveProjectId } from './projects'
import { uid } from './state'

export interface Pack {
  id: string
  name: string
  description: string
  accent: string  // CSS color string — used as the pack's tint
}

export interface Blueprint {
  id: string
  name: string
  description: string
  flow: PortableFlow
  tags?: string[]
  custom?: boolean
  pack?: string
}

export const PACKS: Pack[] = [
  { id: 'core', name: 'Core', description: 'General-purpose automations for any team', accent: 'var(--accent)' },
  { id: 'k8s', name: 'K8s Remediation', description: 'Self-healing workflows for Kubernetes clusters', accent: '#f59e0b' },
  { id: 'ai-agents', name: 'AI Agents', description: 'Agentic patterns: MCP tools, loops, research', accent: 'var(--cat-ai)' },
  { id: 'infra', name: 'Infra & DevOps', description: 'Deploy, provision, backup, and audit flows', accent: 'var(--cat-infra)' },
  { id: 'forms', name: 'Forms & CRM', description: 'Hosted forms, lead capture, and CRM flows', accent: 'var(--cat-notify)' },
]

const BUILTIN_TAGS: Record<string, string[]> = {
  'contact-form': ['forms', 'notify'],
  'webhook-post': ['integration', 'webhook'],
  deploy: ['infra', 'git'],
  triage: ['ai', 'incident'],
  report: ['ai', 'data', 'schedule'],
  provision: ['infra', 'approval'],
  uptime: ['monitoring', 'schedule'],
  'morning-digest': ['ai', 'schedule'],
  'form-to-crm': ['forms', 'integration'],
  'lead-qualify': ['ai', 'forms'],
  'backup-check': ['infra', 'schedule'],
  'weekly-report': ['ai', 'data', 'schedule'],
  content: ['ai', 'forms'],
  'order-tool': ['ai', 'mcp', 'agent'],
  'research-agent': ['ai', 'agent'],
  'poll-until': ['logic', 'monitoring'],
  'feedback-triage': ['forms', 'ai'],
  'data-sync': ['data', 'schedule'],
  'k8s-crashloop': ['k8s', 'incident', 'ai'],
  'k8s-rollback': ['k8s', 'infra', 'approval'],
  'k8s-node-drain': ['k8s', 'infra'],
  'k8s-oom': ['k8s', 'incident', 'ai'],
  'k8s-scale': ['k8s', 'monitoring'],
  'k8s-audit': ['k8s', 'schedule'],
}

const RAW_BLUEPRINTS: Blueprint[] = [
  {
    id: 'webhook-post',
    name: 'Webhook to HTTP POST',
    description: 'Receive a webhook, forward its payload to another API as a POST.',
    pack: 'core',
    flow: {
      name: 'Webhook to HTTP POST',
      steps: [
        { tool: 'trigger.webhook', name: 'Incoming event', config: { path: '/hooks/events' } },
        {
          tool: 'data.http', name: 'Forward as POST',
          config: { url: 'https://api.example.com/v1/events', method: 'POST', body: '{"ref": "{{Incoming event.body.ref}}", "actor": "{{Incoming event.body.actor}}", "at": "{{system.now}}"}' },
        },
        { tool: 'notify.slack', name: 'Confirm delivery', config: { channel: '#events', message: 'Forwarded {{Incoming event.path}} → {{Forward as POST.response.id}}' } },
      ],
    },
  },
  {
    id: 'contact-form',
    name: 'Contact form to Slack',
    description: 'A hosted form; every submission lands in Slack and gets an email receipt.',
    pack: 'core',
    flow: {
      name: 'Contact form',
      steps: [
        {
          tool: 'trigger.form', name: 'Contact form',
          config: {
            path: '/forms/contact',
            title: 'Contact us',
            description: 'We usually reply within a day.',
            fields: '[{"key":"name","label":"Your name","type":"text","required":true},{"key":"email","label":"Email","type":"email","required":true},{"key":"topic","label":"Topic","type":"choice","options":"Support, Sales, Feedback"},{"key":"message","label":"Message","type":"long","required":true}]',
          },
        },
        { tool: 'notify.slack', name: 'Post to Slack', config: { channel: '#inbound', message: '{{Contact form.topic}} from {{Contact form.name}} ({{Contact form.email}}): {{Contact form.message}}' } },
        { tool: 'notify.email', name: 'Email receipt', config: { to: '{{Contact form.email}}', subject: 'We got your message', body: 'Thanks {{Contact form.name}} — we received your {{Contact form.topic}} message and will reply soon.' } },
      ],
    },
  },
  {
    id: 'deploy',
    name: 'Deploy on merge',
    description: 'Git push to main, plan infra, roll the deployment, tell the channel.',
    pack: 'infra',
    flow: {
      name: 'Deploy on merge',
      steps: [
        { tool: 'trigger.git', name: 'Push to main', config: { repo: 'fintonlabs/api', branch: 'main' } },
        { tool: 'infra.terraform', name: 'Plan infra', config: { dir: 'infra/prod', action: 'plan' } },
        { tool: 'infra.k8s', name: 'Roll deployment', config: { context: 'prod-eu', manifest: 'k8s/api.yaml' } },
        { tool: 'notify.slack', name: 'Announce deploy', config: { channel: '#deploys', message: 'api {{Push to main.sha}} is live on prod-eu' } },
      ],
    },
  },
  {
    id: 'triage',
    name: 'AI incident triage',
    description: 'Webhook in, classify severity, page on urgent or post routine to Slack.',
    pack: 'core',
    flow: {
      name: 'AI incident triage',
      steps: [
        { tool: 'trigger.webhook', name: 'Alert webhook', config: { path: '/hooks/alerts' } },
        { tool: 'ai.classify', name: 'Classify severity', config: { labels: 'urgent, routine' } },
        {
          tool: 'logic.branch', name: 'Route by severity', config: { on: 'result.label' },
          branches: [
            { label: 'Urgent', steps: [{ tool: 'notify.pagerduty', name: 'Page on-call', config: { service: 'api-prod' } }] },
            { label: 'Routine', steps: [{ tool: 'notify.slack', name: 'Log to channel', config: { channel: '#alerts', message: 'Routine alert at {{system.time}}' } }] },
          ],
        },
      ],
    },
  },
  {
    id: 'report',
    name: 'Nightly AI report',
    description: 'Every night, query the database, summarize with a model, email the team.',
    pack: 'core',
    flow: {
      name: 'Nightly AI report',
      steps: [
        { tool: 'trigger.schedule', name: 'Every night at 7', config: { schedule: '{"freq":"daily","time":"19:00"}' } },
        { tool: 'data.postgres', name: 'Fetch daily orders', config: { query: "SELECT * FROM orders WHERE created_at > now() - interval '1 day'" } },
        { tool: 'ai.summarize', name: 'Summarize activity', config: { style: 'bullets' } },
        { tool: 'notify.email', name: 'Email the team', config: { to: 'team@fintonlabs.com', subject: 'Report {{system.date}}' } },
      ],
    },
  },
  {
    id: 'provision',
    name: 'Provision with approval',
    description: 'Terraform plan, human sign-off, then apply and confirm.',
    pack: 'infra',
    flow: {
      name: 'Provision with approval',
      vars: { environment: 'prod' },
      steps: [
        { tool: 'trigger.git', name: 'Infra change', config: { repo: 'fintonlabs/infra', branch: 'main' } },
        { tool: 'infra.terraform', name: 'Plan changes', config: { dir: 'envs/{{var.environment}}', action: 'plan' } },
        { tool: 'logic.approval', name: 'Approve plan', config: { approver: 'justyn@fintonlabs.com' } },
        { tool: 'infra.terraform', name: 'Apply changes', config: { dir: 'envs/{{var.environment}}', action: 'apply' } },
        { tool: 'notify.slack', name: 'Confirm apply', config: { channel: '#infra', message: '{{var.environment}} updated: +{{Apply changes.changes.add}} ~{{Apply changes.changes.change}}' } },
      ],
    },
  },
  {
    id: 'uptime',
    name: 'Uptime monitor',
    description: 'Ping your site every 5 minutes; page on-call and post when it looks down.',
    pack: 'core',
    flow: {
      name: 'Uptime monitor',
      vars: { site: 'https://fintonlabs.com' },
      steps: [
        { tool: 'trigger.schedule', name: 'Every 5 minutes', config: { schedule: '{"freq":"minutes","every":5}' } },
        { tool: 'data.http', name: 'Ping site', config: { url: '{{var.site}}', method: 'GET' } },
        { tool: 'ai.classify', name: 'Healthy or down?', config: { labels: 'healthy, down' } },
        {
          tool: 'logic.branch', name: 'Route by status', config: { on: 'result.label' },
          branches: [
            { label: 'Down', steps: [
              { tool: 'notify.pagerduty', name: 'Page on-call', config: { service: 'website' } },
              { tool: 'notify.slack', name: 'Post outage', config: { channel: '#status', message: '{{var.site}} looks down as of {{system.time}}' } },
            ] },
            { label: 'Healthy', steps: [] },
          ],
        },
      ],
    },
  },
  {
    id: 'morning-digest',
    name: 'Morning digest',
    description: 'Weekday mornings: fetch the news feed, summarize it, email it to yourself.',
    pack: 'core',
    flow: {
      name: 'Morning digest',
      steps: [
        { tool: 'trigger.schedule', name: 'Weekdays at 8', config: { schedule: '{"freq":"weekdays","time":"08:00"}' } },
        { tool: 'data.http', name: 'Fetch headlines', config: { url: 'https://api.example.com/news/top', method: 'GET' } },
        { tool: 'ai.summarize', name: 'Boil it down', config: { style: 'bullets' } },
        { tool: 'notify.email', name: 'Send digest', config: { to: 'justyn@fintonlabs.com', subject: 'Digest {{system.date}}' } },
      ],
    },
  },
  {
    id: 'form-to-crm',
    name: 'Form to CRM',
    description: 'A form submission arrives, reshape it, push it to your CRM, tell sales.',
    pack: 'forms',
    flow: {
      name: 'Form to CRM',
      steps: [
        { tool: 'trigger.webhook', name: 'Form submitted', config: { path: '/hooks/signup' } },
        { tool: 'data.transform', name: 'Shape the lead', config: { code: 'return { name: input.body.actor, source: "website" }' } },
        { tool: 'data.http', name: 'Push to CRM', config: { url: 'https://crm.example.com/api/leads', method: 'POST', body: '{"name": "{{Form submitted.body.actor}}", "at": "{{system.now}}"}' } },
        { tool: 'notify.slack', name: 'Tell sales', config: { channel: '#sales', message: 'New lead in the CRM: {{Form submitted.body.actor}}' } },
      ],
    },
  },
  {
    id: 'lead-qualify',
    name: 'AI lead qualifier',
    description: 'New signup, enrich it, let AI score it, route hot leads to sales.',
    pack: 'forms',
    flow: {
      name: 'AI lead qualifier',
      steps: [
        { tool: 'trigger.webhook', name: 'New signup', config: { path: '/hooks/leads' } },
        { tool: 'data.http', name: 'Enrich lead', config: { url: 'https://enrich.example.com/v1/person', method: 'GET' } },
        { tool: 'ai.classify', name: 'Score lead', config: { labels: 'hot, nurture' } },
        {
          tool: 'logic.branch', name: 'Route by score', config: { on: 'result.label' },
          branches: [
            { label: 'Hot', steps: [{ tool: 'notify.slack', name: 'Ping sales', config: { channel: '#sales', message: 'Hot lead: {{New signup.body.actor}}' } }] },
            { label: 'Nurture', steps: [{ tool: 'notify.email', name: 'Drip email', config: { to: 'nurture@fintonlabs.com', subject: 'Welcome aboard' } }] },
          ],
        },
      ],
    },
  },
  {
    id: 'backup-check',
    name: 'Nightly backup',
    description: 'Run the backup script over SSH every night and confirm in Slack.',
    pack: 'infra',
    flow: {
      name: 'Nightly backup',
      steps: [
        { tool: 'trigger.schedule', name: 'Every night at 2', config: { schedule: '{"freq":"daily","time":"02:00"}' } },
        { tool: 'infra.ssh', name: 'Run backup', config: { host: 'oracle.local', command: './backup.sh --all' } },
        { tool: 'notify.slack', name: 'Confirm backup', config: { channel: '#ops', message: 'Backup finished {{system.date}} — exit {{Run backup.exitCode}}' } },
      ],
    },
  },
  {
    id: 'weekly-report',
    name: 'Weekly team report',
    description: 'Every Friday: pull the numbers, have AI write the summary, send it out.',
    pack: 'core',
    flow: {
      name: 'Weekly team report',
      steps: [
        { tool: 'trigger.schedule', name: 'Fridays at 4', config: { schedule: '{"freq":"weekly","day":5,"time":"16:00"}' } },
        { tool: 'data.postgres', name: 'Pull the numbers', config: { query: "SELECT count(*) AS orders, sum(total) AS revenue FROM orders WHERE created_at > now() - interval '7 days'" } },
        { tool: 'ai.prompt', name: 'Write the summary', config: { prompt: 'Write a short upbeat weekly report from {{Pull the numbers.sample}}', model: 'claude-sonnet-4-6' } },
        { tool: 'notify.email', name: 'Send report', config: { to: 'team@fintonlabs.com', subject: 'Week of {{system.date}}' } },
        { tool: 'notify.slack', name: 'Post to channel', config: { channel: '#general', message: 'Weekly report is out — check your inbox.' } },
      ],
    },
  },
  {
    id: 'order-tool',
    name: 'Order status MCP tool',
    description: 'Expose an order-lookup flow as a tool AI agents can call over MCP.',
    pack: 'ai-agents',
    flow: {
      name: 'Order status tool',
      steps: [
        { tool: 'trigger.mcp', name: 'Tool call', config: { toolName: 'lookup_order', description: 'Looks up an order and returns its status', inputs: '[{"key":"order_id","label":"Order id","type":"text","required":true}]' } },
        { tool: 'data.http', name: 'Fetch order', config: { url: 'https://api.example.com/orders/{{Tool call.order_id}}', method: 'GET' } },
        { tool: 'data.transform', name: 'Shape reply', config: { code: "return { order: '{{Tool call.order_id}}', status: input.response.status || 'unknown' }" } },
      ],
    },
  },
  {
    id: 'research-agent',
    name: 'Research agent',
    description: 'A question arrives, an agent works it with MCP tools, the answer lands in Slack.',
    pack: 'ai-agents',
    flow: {
      name: 'Research agent',
      steps: [
        { tool: 'trigger.webhook', name: 'Question in', config: { path: '/hooks/research' } },
        { tool: 'ai.agent', name: 'Work the question', config: { goal: 'Answer this question thoroughly: {{Question in.body.question}}', maxSteps: '8' } },
        { tool: 'notify.slack', name: 'Share answer', config: { channel: '#research', message: '{{Work the question.result}}' } },
      ],
    },
  },
  {
    id: 'poll-until',
    name: 'Poll until ready',
    description: 'Keep checking an endpoint until it reports done, then announce it.',
    pack: 'core',
    flow: {
      name: 'Poll until ready',
      steps: [
        { tool: 'trigger.webhook', name: 'Start polling', config: { path: '/hooks/poll' } },
        { tool: 'logic.until', name: 'Until done', config: { condition: "input.response && input.response.status === 'ok'", max: '10' } },
        { tool: 'logic.wait', name: 'Breathe', config: { duration: '30s' } },
        { tool: 'data.http', name: 'Check status', config: { url: 'https://api.example.com/jobs/{{Start polling.body.jobId}}', method: 'GET' } },
        { tool: 'notify.slack', name: 'Announce ready', config: { channel: '#jobs', message: 'Job {{Start polling.body.jobId}} is ready after {{Until done.iterations}} checks' } },
      ],
    },
  },
  {
    id: 'feedback-triage',
    name: 'Feedback triage',
    description: 'A feedback form, AI-sorted: bugs page on-call, praise goes to the team channel.',
    pack: 'core',
    flow: {
      name: 'Feedback triage',
      steps: [
        { tool: 'trigger.form', name: 'Feedback form', config: { path: '/forms/feedback', title: 'Send us feedback', fields: '[{"key":"name","label":"Your name","type":"text"},{"key":"feedback","label":"What happened?","type":"long","required":true}]' } },
        { tool: 'ai.classify', name: 'Sort it', config: { labels: 'bug, idea, praise' } },
        {
          tool: 'logic.branch', name: 'Route', config: { on: 'label' },
          branches: [
            { label: 'bug', steps: [{ tool: 'notify.pagerduty', name: 'Page on-call', config: { service: 'product' } }] },
            { label: 'idea', steps: [{ tool: 'notify.slack', name: 'Ideas channel', config: { channel: '#ideas', message: '{{Feedback form.feedback}}' } }] },
            { label: 'praise', steps: [{ tool: 'notify.slack', name: 'Wins channel', config: { channel: '#wins', message: '{{Feedback form.name}}: {{Feedback form.feedback}}' } }] },
          ],
        },
      ],
    },
  },
  {
    id: 'data-sync',
    name: 'Nightly data sync',
    description: 'Every night, pull rows from the database, reshape them, push to an API.',
    pack: 'core',
    flow: {
      name: 'Nightly data sync',
      steps: [
        { tool: 'trigger.schedule', name: 'Every night at 3', config: { schedule: '{"freq":"daily","time":"03:00"}' } },
        { tool: 'data.postgres', name: 'Pull new rows', config: { query: "SELECT * FROM events WHERE created_at > now() - interval '1 day'" } },
        { tool: 'data.transform', name: 'Reshape', config: { code: 'return { records: (input.rows || []).map(r => ({ id: r.id, at: r.created_at })) }' } },
        { tool: 'data.http', name: 'Push upstream', config: { url: 'https://warehouse.example.com/ingest', method: 'POST', body: '{"records": {{Reshape.output.records}}}' } },
      ],
    },
  },
  {
    id: 'content',
    name: 'AI content pipeline',
    description: 'New CSV of leads, loop each, draft outreach with a model, hold for review.',
    pack: 'forms',
    flow: {
      name: 'AI content pipeline',
      steps: [
        { tool: 'trigger.file', name: 'New leads file', config: { glob: 'uploads/**/*.csv' } },
        { tool: 'logic.loop', name: 'Each lead', config: { items: 'input.rows' } },
        { tool: 'ai.prompt', name: 'Draft outreach', config: { prompt: 'Write a short intro email for {{New leads file.file}}', model: 'claude-sonnet-4-6' } },
        { tool: 'logic.approval', name: 'Review drafts', config: { approver: 'justyn@fintonlabs.com' } },
        { tool: 'notify.email', name: 'Send batch', config: { to: 'leads@fintonlabs.com', subject: 'Outreach {{system.date}}' } },
      ],
    },
  },
  // K8s Remediation pack
  {
    id: 'k8s-crashloop',
    name: 'CrashLoopBackOff response',
    description: 'Alertmanager fires, AI analyses the crash logs, pages on-call and posts a diagnosis.',
    pack: 'k8s',
    flow: {
      name: 'CrashLoopBackOff response',
      steps: [
        { tool: 'trigger.webhook', name: 'Alertmanager', config: { path: '/hooks/k8s-alerts' } },
        { tool: 'infra.k8s', name: 'Describe pod', config: { context: '{{var.cluster}}', action: 'kubectl describe pod {{Alertmanager.body.pod}} -n {{Alertmanager.body.namespace}}' } },
        { tool: 'ai.prompt', name: 'Diagnose crash', config: { prompt: 'You are a Kubernetes expert. Analyse this pod description and crash log, identify the root cause, and suggest a fix in 3 bullet points.\n\nPod description:\n{{Describe pod.output}}\n\nAlert labels:\n{{Alertmanager.body.labels}}', model: 'claude-sonnet-4-6' } },
        { tool: 'notify.pagerduty', name: 'Page on-call', config: { service: 'k8s-prod' } },
        { tool: 'notify.slack', name: 'Post diagnosis', config: { channel: '#k8s-alerts', message: 'CrashLoop on {{Alertmanager.body.pod}} ({{Alertmanager.body.namespace}})\n{{Diagnose crash.result}}' } },
      ],
    },
  },
  {
    id: 'k8s-rollback',
    name: 'Deployment rollback',
    description: 'Failed deployment detected, automatic rollback, approval gate, then redeploy.',
    pack: 'k8s',
    flow: {
      name: 'Deployment rollback',
      vars: { cluster: 'prod-eu', namespace: 'default' },
      steps: [
        { tool: 'trigger.webhook', name: 'Deploy failed', config: { path: '/hooks/deploy-failed' } },
        { tool: 'infra.k8s', name: 'Rollback', config: { context: '{{var.cluster}}', manifest: 'kubectl rollout undo deployment/{{Deploy failed.body.deployment}} -n {{var.namespace}}' } },
        { tool: 'notify.slack', name: 'Announce rollback', config: { channel: '#deploys', message: ':warning: Rolled back {{Deploy failed.body.deployment}} on {{var.cluster}} — waiting for approval to redeploy' } },
        { tool: 'logic.approval', name: 'Approve redeploy', config: { approver: 'infra@example.com' } },
        { tool: 'infra.k8s', name: 'Redeploy', config: { context: '{{var.cluster}}', manifest: 'k8s/{{Deploy failed.body.deployment}}.yaml' } },
        { tool: 'notify.slack', name: 'Confirm live', config: { channel: '#deploys', message: '{{Deploy failed.body.deployment}} redeployed on {{var.cluster}}' } },
      ],
    },
  },
  {
    id: 'k8s-node-drain',
    name: 'Node pressure drain',
    description: 'Node memory/disk pressure alert, cordon and drain, notify, wait for manual fix.',
    pack: 'k8s',
    flow: {
      name: 'Node pressure drain',
      vars: { cluster: 'prod-eu' },
      steps: [
        { tool: 'trigger.webhook', name: 'Node alert', config: { path: '/hooks/node-pressure' } },
        { tool: 'infra.k8s', name: 'Cordon node', config: { context: '{{var.cluster}}', manifest: 'kubectl cordon {{Node alert.body.node}}' } },
        { tool: 'infra.k8s', name: 'Drain node', config: { context: '{{var.cluster}}', manifest: 'kubectl drain {{Node alert.body.node}} --ignore-daemonsets --delete-emptydir-data' } },
        { tool: 'notify.slack', name: 'Notify ops', config: { channel: '#k8s-ops', message: 'Node {{Node alert.body.node}} cordoned and drained due to {{Node alert.body.condition}}. Review and uncordon when resolved.' } },
        { tool: 'logic.approval', name: 'Uncordon approval', config: { approver: 'infra@example.com' } },
        { tool: 'infra.k8s', name: 'Uncordon', config: { context: '{{var.cluster}}', manifest: 'kubectl uncordon {{Node alert.body.node}}' } },
      ],
    },
  },
  {
    id: 'k8s-oom',
    name: 'OOMKilled response',
    description: 'Container OOM-killed, AI recommends a memory limit bump, creates a PR, pages on-call.',
    pack: 'k8s',
    flow: {
      name: 'OOMKilled response',
      steps: [
        { tool: 'trigger.webhook', name: 'OOM alert', config: { path: '/hooks/oom' } },
        { tool: 'infra.k8s', name: 'Get resource usage', config: { context: '{{var.cluster}}', action: 'kubectl top pod {{OOM alert.body.pod}} -n {{OOM alert.body.namespace}}' } },
        { tool: 'ai.prompt', name: 'Recommend limits', config: { prompt: 'A container was OOMKilled. Current usage: {{Get resource usage.output}}\nCurrent limits from alert: {{OOM alert.body.limits}}\nRecommend new memory limits and requests as a kubectl patch command. Be conservative — add 30% headroom.', model: 'claude-sonnet-4-6' } },
        { tool: 'notify.pagerduty', name: 'Page on-call', config: { service: 'k8s-prod' } },
        { tool: 'notify.slack', name: 'Post recommendation', config: { channel: '#k8s-alerts', message: 'OOMKill on {{OOM alert.body.pod}}\nRecommended fix:\n{{Recommend limits.result}}' } },
      ],
    },
  },
  {
    id: 'k8s-scale',
    name: 'Scale on CPU pressure',
    description: 'Prometheus fires a high-CPU alert, check HPA, scale up if needed, confirm.',
    pack: 'k8s',
    flow: {
      name: 'Scale on CPU pressure',
      vars: { cluster: 'prod-eu', namespace: 'default' },
      steps: [
        { tool: 'trigger.webhook', name: 'CPU alert', config: { path: '/hooks/cpu-pressure' } },
        { tool: 'infra.k8s', name: 'Check HPA', config: { context: '{{var.cluster}}', manifest: 'kubectl get hpa {{CPU alert.body.deployment}} -n {{var.namespace}}' } },
        { tool: 'ai.classify', name: 'Scale needed?', config: { labels: 'scale-up, within-limits' } },
        {
          tool: 'logic.branch', name: 'Route', config: { on: 'result.label' },
          branches: [
            { label: 'scale-up', steps: [
              { tool: 'infra.k8s', name: 'Scale up', config: { context: '{{var.cluster}}', manifest: 'kubectl scale deployment/{{CPU alert.body.deployment}} --replicas=$(( $(kubectl get deploy {{CPU alert.body.deployment}} -n {{var.namespace}} -o jsonpath=\'{.spec.replicas}\') + 2 ))' } },
              { tool: 'notify.slack', name: 'Confirm scale', config: { channel: '#k8s-ops', message: 'Scaled {{CPU alert.body.deployment}} up by 2 replicas due to CPU pressure' } },
            ]},
            { label: 'within-limits', steps: [
              { tool: 'notify.slack', name: 'Log only', config: { channel: '#k8s-ops', message: 'CPU alert for {{CPU alert.body.deployment}} — HPA within limits, no action taken' } },
            ]},
          ],
        },
      ],
    },
  },
  {
    id: 'k8s-audit',
    name: 'Namespace resource audit',
    description: 'Nightly: audit a namespace for idle deployments and over-provisioned pods, report to Slack.',
    pack: 'k8s',
    flow: {
      name: 'Namespace resource audit',
      vars: { cluster: 'prod-eu', namespace: 'default' },
      steps: [
        { tool: 'trigger.schedule', name: 'Nightly at 1am', config: { schedule: '{"freq":"daily","time":"01:00"}' } },
        { tool: 'infra.k8s', name: 'Get pod resources', config: { context: '{{var.cluster}}', manifest: 'kubectl top pods -n {{var.namespace}}' } },
        { tool: 'infra.k8s', name: 'Get deployments', config: { context: '{{var.cluster}}', manifest: 'kubectl get deployments -n {{var.namespace}} -o json' } },
        { tool: 'ai.prompt', name: 'Audit resources', config: { prompt: 'Analyse these Kubernetes resource metrics and identify:\n1. Idle deployments (0 or minimal traffic, could scale to 0)\n2. Over-provisioned pods (using <30% of requested CPU/memory)\n3. Quick wins to reduce cost\n\nPod resources:\n{{Get pod resources.output}}\n\nDeployments:\n{{Get deployments.output}}', model: 'claude-sonnet-4-6' } },
        { tool: 'notify.slack', name: 'Post audit', config: { channel: '#k8s-ops', message: 'Nightly {{var.namespace}} audit ({{var.cluster}}):\n{{Audit resources.result}}' } },
      ],
    },
  },
]

export const BUILTIN_BLUEPRINTS: Blueprint[] = RAW_BLUEPRINTS.map(bp => ({ ...bp, tags: BUILTIN_TAGS[bp.id] || [] }))

export const makeFlow = (name: string, steps: Step[] = [], vars?: Record<string, string>, tags?: string[]): Flow => ({
  id: uid(), name, steps,
  ...(vars && Object.keys(vars).length ? { vars } : {}),
  ...(tags?.length ? { tags } : {}),
  // Every creation path (new, import, blueprint, compose) lands in the
  // browser's active project.
  projectId: getActiveProjectId(),
  updatedAt: Date.now(),
})

// Blueprint → a fresh Flow (new ids throughout, tolerant of bad JSON in
// custom blueprints).
export function flowFromBlueprint(bp: Blueprint): Flow {
  const { name, steps, vars, tags } = hydrateFlow(bp.flow)
  return makeFlow(name, steps, vars, tags.length ? tags : bp.tags)
}
