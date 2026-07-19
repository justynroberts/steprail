// MIT License - Copyright (c) fintonlabs.com
import { describe, it, expect } from 'vitest'
import { localPlan } from './engine'

describe('localPlan — keyword fallback planner', () => {
  it('always starts with a trigger', () => {
    expect(localPlan('summarize the orders and email me')[0]).toMatch(/^trigger\./)
  })

  it('guarantees at least one action after a trigger-only brief', () => {
    const plan = localPlan('when a webhook arrives')
    expect(plan[0]).toMatch(/^trigger\./)
    expect(plan.some(id => !id.startsWith('trigger.'))).toBe(true)
  })

  it('puts the matched trigger first even if mentioned last', () => {
    const plan = localPlan('post to slack when a webhook arrives')
    expect(plan[0]).toBe('trigger.webhook')
    expect(plan).toContain('notify.slack')
  })

  it('defaults to a webhook trigger when none is named', () => {
    expect(localPlan('call an api then post to slack')[0]).toBe('trigger.webhook')
  })
})
