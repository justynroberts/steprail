// MIT License - Copyright (c) fintonlabs.com
// Many-branch layout: lanes stay readable (min-width + horizontal scroll, never
// squished) and fold individually or all at once so a wide fork stays editable.
import { test, expect } from '@playwright/test'
import { seedFlow, openFlow, uniqueName } from './helpers'

const lane = (label: string, stepId: string, toolId: string, name: string) => ({
  id: `l-${stepId}`, label, steps: [{ id: stepId, toolId, name, config: {} }],
})

test('many branch lanes stay readable and fold', async ({ page, request }) => {
  const name = uniqueName('E2E branches')
  await seedFlow(request, name, [
    { id: 't1', toolId: 'trigger.webhook', name: 'Incoming', config: { path: '/hooks/mb' } },
    {
      id: 'b1', toolId: 'logic.branch', name: 'Route', config: { on: 'type' },
      branches: [
        lane('orders', 's1', 'data.postgres', 'Load order'),
        lane('refunds', 's2', 'notify.slack', 'Post refund'),
        lane('signups', 's3', 'notify.email', 'Welcome'),
        lane('else', 's4', 'data.transform', 'Log'),
      ],
    },
  ])

  await openFlow(page, name)

  const lanes = page.locator('.lanes')
  await expect(page.locator('.lane')).toHaveCount(4)

  // No squish: each expanded lane is at least the readable min-width, and the
  // row overflows into a horizontal scroll rather than shrinking cards.
  const minWidth = await page.locator('.lane').first().evaluate(el => el.getBoundingClientRect().width)
  expect(minWidth).toBeGreaterThanOrEqual(240)
  const scrolls = await lanes.evaluate(el => el.scrollWidth > el.clientWidth + 1)
  expect(scrolls).toBeTruthy()

  // Collapse all → every lane folds to a chip showing its step count.
  await page.getByRole('button', { name: 'Collapse all' }).click()
  await expect(page.locator('.lane.folded')).toHaveCount(4)
  await expect(page.locator('.lane-steps').first()).toBeVisible()

  // Expand one lane again via its chevron.
  await page.locator('.lane .lane-fold').first().click()
  await expect(page.locator('.lane.folded')).toHaveCount(3)
})
