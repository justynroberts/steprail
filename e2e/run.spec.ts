// MIT License - Copyright (c) fintonlabs.com
// Happy path: seed a flow, open it in the real editor, click Run, and prove the
// rail renders both steps green. Exercises the full browser → queue → browser
// loop with genuine execution — a real outbound HTTP call plus a vm transform.
import { test, expect } from '@playwright/test'
import { seedFlow, openFlow, runFlow, stepCard, uniqueName } from './helpers'

const PORT = process.env.E2E_PORT || '8455'

test('runs a two-step flow and renders both steps green', async ({ page, request }) => {
  const name = uniqueName('E2E run')
  await seedFlow(request, name, [
    // Self-referential health call — hermetic, but a real request out of the queue.
    { id: 's1', toolId: 'data.http', name: 'Check health', config: { method: 'GET', url: `http://localhost:${PORT}/api/health` } },
    { id: 's2', toolId: 'data.transform', name: 'Summarize', config: { code: 'return { ok: true, checked: true }' } },
  ])

  await openFlow(page, name)
  await runFlow(page)

  await expect(stepCard(page, 'data.http')).toHaveClass(/success/)
  await expect(stepCard(page, 'data.transform')).toHaveClass(/success/)
  // No error banners anywhere on the rail.
  await expect(page.locator('.step-error')).toHaveCount(0)
})
