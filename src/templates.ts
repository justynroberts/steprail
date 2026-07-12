// MIT License - Copyright (c) fintonlabs.com
// Built-in starting points, available right where you create a flow —
// no separate gallery to hunt through.
import type { Flow, Step } from './types'
import { uid } from './state'

const step = (toolId: string, name: string, config: Record<string, string> = {}, branches?: Step['branches']): Step => ({
  id: uid(), toolId, name, config, ...(branches ? { branches } : {}),
})

export interface Template {
  id: string
  name: string
  description: string
  build: () => Step[]
}

export const TEMPLATES: Template[] = [
  {
    id: 'deploy',
    name: 'Deploy on merge',
    description: 'Git push to main, plan infra, roll the deployment, tell the channel.',
    build: () => [
      step('trigger.git', 'Push to main', { repo: 'fintonlabs/api', branch: 'main' }),
      step('infra.terraform', 'Plan infra', { dir: 'infra/prod', action: 'plan' }),
      step('infra.k8s', 'Roll deployment', { context: 'prod-eu', manifest: 'k8s/api.yaml' }),
      step('notify.slack', 'Announce deploy', { channel: '#deploys', message: 'api {{sha}} is live on prod-eu' }),
    ],
  },
  {
    id: 'triage',
    name: 'AI incident triage',
    description: 'Webhook in, classify severity, page on urgent or post routine to Slack.',
    build: () => [
      step('trigger.webhook', 'Alert webhook', { path: '/hooks/alerts' }),
      step('ai.classify', 'Classify severity', { labels: 'urgent, routine' }),
      step('logic.branch', 'Route by severity', { on: 'result.label' }, [
        { id: uid(), label: 'Urgent', steps: [step('notify.pagerduty', 'Page on-call', { service: 'api-prod' })] },
        { id: uid(), label: 'Routine', steps: [step('notify.slack', 'Log to channel', { channel: '#alerts', message: '{{summary}}' })] },
      ]),
    ],
  },
  {
    id: 'report',
    name: 'Nightly AI report',
    description: 'Every night, query the database, summarize with a model, email the team.',
    build: () => [
      step('trigger.schedule', 'Every night at 7', { cron: '0 19 * * *' }),
      step('data.postgres', 'Fetch daily orders', { query: "SELECT * FROM orders WHERE created_at > now() - interval '1 day'" }),
      step('ai.summarize', 'Summarize activity', { style: 'bullets' }),
      step('notify.email', 'Email the team', { to: 'team@fintonlabs.com', subject: 'Nightly report' }),
    ],
  },
]

export const makeFlow = (name: string, steps: Step[] = []): Flow => ({
  id: uid(), name, steps, updatedAt: Date.now(),
})
