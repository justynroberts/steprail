// MIT License - Copyright (c) fintonlabs.com
// Save the open flow as a reusable blueprint from the editor — one click, and it
// lands in the persisted blueprint list.
import { test, expect } from '@playwright/test'
import { seedFlow, openFlow, uniqueName } from './helpers'

test('saves the open flow as a blueprint', async ({ page, request }) => {
  const name = uniqueName('E2E blueprint')
  await seedFlow(request, name, [
    { id: 's1', toolId: 'trigger.webhook', name: 'Incoming', config: { path: '/hooks/z' } },
    { id: 's2', toolId: 'notify.slack', name: 'Announce', config: { message: 'hi' } },
  ])

  await openFlow(page, name)
  await page.getByRole('button', { name: 'Save as a reusable blueprint' }).click()

  // Persisted: the blueprint list now includes a custom blueprint for this flow.
  await expect(async () => {
    const list = await (await request.get('/api/blueprints')).json()
    expect(list.some((b: { name: string; custom?: boolean }) => b.name === name && b.custom)).toBeTruthy()
  }).toPass({ timeout: 5000 })
})
