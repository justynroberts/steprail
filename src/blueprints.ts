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
