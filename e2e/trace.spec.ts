// MIT License - Copyright (c) fintonlabs.com
// Observability: after a run, the Runs drawer opens the OpenTelemetry trace
// viewer — a waterfall with a W3C trace id and a working Copy OTLP button.
import { test, expect } from '@playwright/test'
import { seedFlow, openFlow, runFlow, uniqueName } from './helpers'

test('shows an OTel waterfall with a trace id and copies OTLP', async ({ page, request }) => {
  const name = uniqueName('E2E trace')
  const flow = await seedFlow(request, name, [
    { id: 's1', toolId: 'data.transform', name: 'Seed', config: { code: 'return { n: 21 }' } },
    { id: 's2', toolId: 'data.transform', name: 'Double', config: { code: 'return { doubled: 42 }' } },
  ])

  await openFlow(page, name)
  await runFlow(page)

  // Running a flow auto-opens the Runs drawer. Wait for the just-finished run to
  // land in history — the Trace dialog only mounts once a runId is resolved.
  await expect(page.locator('.drawer')).toBeVisible()
  await expect(page.locator('.run-hist-row').first()).toBeVisible()
  await page.locator('.drawer').getByRole('button', { name: 'Trace' }).click()

  // Waterfall populated: a W3C trace id and at least one span bar per real step.
  await expect(page.locator('.trace-dialog')).toBeVisible()
  await expect(page.locator('.trace-id')).toBeVisible()
  await expect(page.locator('.trace-row .tr-bar')).not.toHaveCount(0)

  // Copy OTLP runs the export path and flips the button label.
  const copy = page.getByRole('button', { name: /Copy OTLP/ })
  await copy.click()
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
})
