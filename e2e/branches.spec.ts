// MIT License - Copyright (c) fintonlabs.com
// Branch lanes are tabs: a wrapping chip strip plus one lane edited full-width.
// Scales to many lanes, one at a time — cards never squish or scroll sideways.
import { test, expect } from '@playwright/test'
import { seedFlow, openFlow, uniqueName } from './helpers'

const lane = (label: string, stepId: string, toolId: string, name: string) => ({
  id: `l-${stepId}`, label, steps: [{ id: stepId, toolId, name, config: {} }],
})

test('branch lanes are tabs — edit one lane at a time, full width', async ({ page, request }) => {
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

  // One tab per lane (plus the add button), all visible without horizontal scroll.
  await expect(page.locator('.lane-tab:not(.lane-tab-add)')).toHaveCount(4)

  // The active lane is rendered full width — its card is a normal trunk-size card.
  const activeCard = page.locator('.lane-active .step-card').first()
  await expect(activeCard).toContainText('Load order')
  const width = await activeCard.evaluate(el => el.getBoundingClientRect().width)
  expect(width).toBeGreaterThan(400) // not a squished ~190px lane

  // Switching tabs swaps which lane is being edited.
  await page.locator('.lane-tab', { hasText: 'refunds' }).click()
  await expect(page.locator('.lane-active .step-card').first()).toContainText('Post refund')
})

test('lanes delete down to the last, which removes the whole branch', async ({ page, request }) => {
  const name = uniqueName('E2E branch delete')
  await seedFlow(request, name, [
    { id: 't1', toolId: 'trigger.webhook', name: 'Incoming', config: { path: '/hooks/mb' } },
    {
      id: 'b1', toolId: 'logic.branch', name: 'Route', config: { on: 'type' },
      branches: [lane('a', 's1', 'notify.slack', 'A'), lane('b', 's2', 'notify.slack', 'B')],
    },
  ])
  await openFlow(page, name)

  // Two lanes → "Remove lane" removes one, leaving one.
  await expect(page.getByRole('button', { name: 'Remove lane' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove lane' }).click()
  await expect(page.locator('.lane-tab:not(.lane-tab-add)')).toHaveCount(1)

  // The last lane's control removes the whole branch step.
  await page.getByRole('button', { name: 'Remove branch' }).click()
  await expect(page.locator('.lane-tabs')).toHaveCount(0)
  await expect(page.locator('.rail > .step')).toHaveCount(1) // just the trigger
})
