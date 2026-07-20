// MIT License - Copyright (c) fintonlabs.com
// Shared helpers for the browser E2E suite: seed a flow straight into the store
// via the API (deterministic, no drag-drop), then drive the real editor UI.
import type { APIRequestContext, Page } from '@playwright/test'
import { expect } from '@playwright/test'

let seq = 0
// Unique per test so the shared store never collides between specs/retries.
export const uniqueName = (base: string) => `${base} ${Date.now().toString(36)}-${seq++}`

type Step = { id: string; toolId: string; name: string; config?: Record<string, unknown>; branches?: unknown[] }
type Flow = { id: string; name: string; projectId: string; steps: Step[]; updatedAt: number; docs?: string }

// Read-modify-write the flows array (PUT replaces the whole list), so seeding
// one flow never clobbers the others.
export async function seedFlow(
  request: APIRequestContext,
  name: string,
  steps: Step[],
  extra: Partial<Flow> = {},
): Promise<Flow> {
  const flow: Flow = { id: `e2e${Date.now().toString(36)}${seq}`, name, projectId: 'default', steps, updatedAt: Date.now(), ...extra }
  const current = await (await request.get('/api/flows')).json()
  const res = await request.put('/api/flows', { data: [flow, ...current] })
  expect(res.ok(), `seedFlow PUT failed: ${res.status()}`).toBeTruthy()
  return flow
}

// Navigate to the app with the tutorial suppressed (a fresh store would pop it),
// then open the named flow's editor and wait for the Run button.
export async function openFlow(page: Page, name: string): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('sr-tutorial', JSON.stringify({ completed: { basics: true, ops: true } }))
  })
  await page.goto('/')
  const row = page.locator('.flow-row', { hasText: name })
  await expect(row).toBeVisible()
  await row.click()
  await expect(runButton(page)).toBeVisible()
}

export const runButton = (page: Page) => page.getByRole('button', { name: /^Run/ }).and(page.locator('.primary'))

// A step card in the rail, addressed by its tool id (data-tool attribute).
export const stepCard = (page: Page, toolId: string) => page.locator(`.step-card[data-tool="${toolId}"]`)

// Click Run and wait until it settles (button re-enables / leaves the Running… state).
export async function runFlow(page: Page): Promise<void> {
  await runButton(page).click()
  await expect(page.getByRole('button', { name: 'Running…' })).toHaveCount(0, { timeout: 20_000 })
}
