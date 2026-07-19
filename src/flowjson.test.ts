// MIT License - Copyright (c) fintonlabs.com
import { describe, it, expect } from 'vitest'
import { serializeFlow, hydrateFlow } from './flowjson'
import type { Flow } from './types'

describe('flowjson — portable round-trip', () => {
  const flow: Flow = {
    id: 'f1', name: 'My flow', updatedAt: 0, tags: ['x'], vars: { region: 'eu' },
    steps: [
      { id: 's1', toolId: 'trigger.webhook', name: 'Hook', config: { path: '/hooks/a' } },
      { id: 's2', toolId: 'notify.slack', name: 'Post', config: { message: 'hi {{Hook.body.x}}' } },
    ],
  }

  it('serialize drops internal ids but keeps structure', () => {
    const p = serializeFlow(flow)
    expect((p as { id?: string }).id).toBeUndefined()
    const steps = p.steps ?? []
    expect(steps[0]).not.toHaveProperty('id')
    expect(p.name).toBe('My flow')
    expect(steps.map(s => s.tool)).toEqual(['trigger.webhook', 'notify.slack'])
  })

  it('hydrate restores steps, vars, tags and fresh ids', () => {
    const { name, steps, vars, tags, warnings } = hydrateFlow(serializeFlow(flow))
    expect(name).toBe('My flow')
    expect(steps).toHaveLength(2)
    expect(steps[0].toolId).toBe('trigger.webhook')
    expect(steps[1].config.message).toContain('{{Hook.body.x}}')
    expect(steps[0].id).toBeTruthy() // fresh id assigned
    expect(vars).toEqual({ region: 'eu' })
    expect(tags).toEqual(['x'])
    expect(warnings).toEqual([])
  })

  it('is tolerant of garbage — warnings, never throws', () => {
    const r = hydrateFlow({ steps: ['not an object', { name: 'no tool' }] })
    expect(Array.isArray(r.steps)).toBe(true)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('non-object input yields an empty flow with a warning', () => {
    const r = hydrateFlow(null)
    expect(r.steps).toHaveLength(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})
