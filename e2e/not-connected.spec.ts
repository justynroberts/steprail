// MIT License - Copyright (c) fintonlabs.com
// The honesty guarantee: an unconnected step fails with a plain-language error
// on the step that caused it — never a fake success. Fresh store has no
// connections, so PagerDuty must refuse and say so, while the prior step stays green.
import { test, expect } from '@playwright/test'
import { seedFlow, openFlow, runFlow, stepCard, uniqueName } from './helpers'

test('an unconnected step fails in plain language on the right step', async ({ page, request }) => {
  const name = uniqueName('E2E not-connected')
  await seedFlow(request, name, [
    { id: 's1', toolId: 'data.transform', name: 'Prepare', config: { code: 'return { severity: "critical" }' } },
    { id: 's2', toolId: 'notify.pagerduty', name: 'Page on-call', config: { service: 'ops', summary: 'disk full', severity: 'critical' } },
  ])

  await openFlow(page, name)
  await runFlow(page)

  // First step succeeded; the failure lands on the PagerDuty step, in plain words.
  await expect(stepCard(page, 'data.transform')).toHaveClass(/success/)
  const pd = stepCard(page, 'notify.pagerduty')
  await expect(pd).toHaveClass(/error/)
  await expect(pd.locator('.step-error')).toContainText('PagerDuty is not connected')
})
