// MIT License - Copyright (c) fintonlabs.com
// Documentation panel: every flow renders an auto-generated Mermaid diagram plus
// its Markdown write-up, and the write-up is editable and persists.
import { test, expect } from '@playwright/test'
import { seedFlow, openFlow, uniqueName } from './helpers'

test('renders the flow diagram and its markdown docs', async ({ page, request }) => {
  const name = uniqueName('E2E docs')
  await seedFlow(
    request,
    name,
    [
      { id: 's1', toolId: 'trigger.webhook', name: 'Incoming', config: { path: '/hooks/x' } },
      { id: 's2', toolId: 'notify.slack', name: 'Announce', config: { message: 'hi' } },
    ],
    { docs: '## What this does\nDocumented by the test.\n\n- point one\n- point two' },
  )

  await openFlow(page, name)
  await page.locator('[data-tut="docs"]').click()

  const dialog = page.locator('.docs-dialog')
  await expect(dialog).toBeVisible()

  // Mermaid renders an inline SVG from the flow tree.
  await expect(dialog.locator('.docs-diagram svg')).toBeVisible()

  // The authored Markdown is rendered (heading + bullet), not shown raw.
  await expect(dialog.locator('.docs-prose h2')).toContainText('What this does')
  await expect(dialog.locator('.docs-prose li').first()).toContainText('point one')

  // Copy Markdown runs the export path and flips the label.
  await dialog.getByRole('button', { name: /Copy Markdown/ }).click()
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible()
})

test('editing the docs persists across reopen', async ({ page, request }) => {
  const name = uniqueName('E2E docs edit')
  await seedFlow(request, name, [
    { id: 's1', toolId: 'trigger.webhook', name: 'Incoming', config: { path: '/hooks/y' } },
    { id: 's2', toolId: 'data.transform', name: 'Shape', config: { code: 'return {}' } },
  ])

  await openFlow(page, name)
  await page.locator('[data-tut="docs"]').click()
  const dialog = page.locator('.docs-dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'Edit' }).click()
  const marker = `Runbook ${Date.now().toString(36)}`
  await dialog.locator('textarea.docs-edit').fill(`## Runbook\n${marker}`)
  await dialog.getByRole('button', { name: 'Save' }).click()

  // Rendered immediately…
  await expect(dialog.locator('.docs-prose')).toContainText(marker)

  // …and still there after closing and reopening the panel (persisted via the reducer).
  await dialog.locator('.cmdk-input .btn.icon').click()
  await expect(dialog).toBeHidden()
  await page.locator('[data-tut="docs"]').click()
  await expect(page.locator('.docs-dialog .docs-prose')).toContainText(marker)
})
