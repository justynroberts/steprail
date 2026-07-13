// MIT License - Copyright (c) fintonlabs.com
// Blueprints: reusable flows stored in the portable JSON format — the same
// format LLMs author and the JSON dialog imports. Built-ins ship here;
// custom ones are saved from the editor and persist server-side.
import type { Flow, Step } from './types'
import type { PortableFlow } from './flowjson'
import { hydrateFlow } from './flowjson'
import { uid } from './state'

export interface Blueprint {
  id: string
  name: string
  description: string
  flow: PortableFlow
  custom?: boolean
}

export const BUILTIN_BLUEPRINTS: Blueprint[] = [
  {
    id: 'webhook-post',
    name: 'Webhook to HTTP POST',
    description: 'Receive a webhook, forward its payload to another API as a POST.',
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
    id: 'content',
    name: 'AI content pipeline',
    description: 'New CSV of leads, loop each, draft outreach with a model, hold for review.',
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
]

export const makeFlow = (name: string, steps: Step[] = [], vars?: Record<string, string>): Flow => ({
  id: uid(), name, steps, ...(vars && Object.keys(vars).length ? { vars } : {}), updatedAt: Date.now(),
})

// Blueprint → a fresh Flow (new ids throughout, tolerant of bad JSON in
// custom blueprints).
export function flowFromBlueprint(bp: Blueprint): Flow {
  const { name, steps, vars } = hydrateFlow(bp.flow)
  return makeFlow(name, steps, vars)
}
