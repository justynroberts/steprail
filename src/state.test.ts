// MIT License - Copyright (c) fintonlabs.com
import { describe, it, expect } from 'vitest'
import { reducer, initialState, active } from './state'
import type { Flow } from './types'

const flow = (over: Partial<Flow> = {}): Flow => ({ id: 'f1', name: 'Test', steps: [], updatedAt: 0, ...over })
const create = (s = initialState, f: Flow = flow()) => reducer(s, { type: 'create', flow: f })

describe('reducer — tree operations', () => {
  it('create adds a flow and makes it active', () => {
    const s = create()
    expect(s.flows).toHaveLength(1)
    expect(s.activeId).toBe('f1')
    expect(active(s)?.name).toBe('Test')
    expect(s.dirty).toBe(true)
  })

  it('insert adds a step at the given index', () => {
    let s = create()
    s = reducer(s, { type: 'insert', toolId: 'data.http', at: { hops: [], index: 0 } })
    expect(active(s)?.steps).toHaveLength(1)
    expect(active(s)?.steps[0].toolId).toBe('data.http')
  })

  it('move reorders steps within a lane', () => {
    let s = create()
    s = reducer(s, { type: 'insert', toolId: 'data.http', at: { hops: [], index: 0 } })
    s = reducer(s, { type: 'insert', toolId: 'notify.slack', at: { hops: [], index: 1 } })
    const first = active(s)!.steps[0]
    s = reducer(s, { type: 'move', stepId: first.id, at: { hops: [], index: 2 } })
    expect(active(s)!.steps.map(x => x.toolId)).toEqual(['notify.slack', 'data.http'])
  })

  it('remove deletes a step', () => {
    let s = create()
    s = reducer(s, { type: 'insert', toolId: 'data.http', at: { hops: [], index: 0 } })
    s = reducer(s, { type: 'remove', stepId: active(s)!.steps[0].id })
    expect(active(s)!.steps).toHaveLength(0)
  })

  it('toggle-active with an id flips only the target flow', () => {
    let s = create(initialState, flow({ id: 'a' }))
    s = create(s, flow({ id: 'b', name: 'B' })) // active becomes 'b'
    s = reducer(s, { type: 'toggle-active', id: 'a' })
    expect(s.flows.find(f => f.id === 'a')!.active).toBe(false)
    expect(s.flows.find(f => f.id === 'b')!.active).toBeUndefined() // untouched
  })

  it('toggle-active with no id targets the active flow', () => {
    let s = create(initialState, flow({ id: 'a' }))
    s = reducer(s, { type: 'toggle-active' })
    expect(active(s)!.active).toBe(false)
  })

  it('undo reverts the last mutation', () => {
    let s = create()
    s = reducer(s, { type: 'insert', toolId: 'data.http', at: { hops: [], index: 0 } })
    expect(active(s)!.steps).toHaveLength(1)
    s = reducer(s, { type: 'undo' })
    expect(active(s)!.steps).toHaveLength(0)
  })

  it('delete-flow removes it and reassigns active', () => {
    let s = create(initialState, flow({ id: 'a' }))
    s = create(s, flow({ id: 'b' }))
    s = reducer(s, { type: 'delete-flow', id: 'b' })
    expect(s.flows.map(f => f.id)).toEqual(['a'])
    expect(s.activeId).toBe('a')
  })

  it('history snapshots are deep-cloned (a later edit cannot mutate them)', () => {
    let s = create()
    s = reducer(s, { type: 'insert', toolId: 'data.http', at: { hops: [], index: 0 } })
    s = reducer(s, { type: 'insert', toolId: 'notify.slack', at: { hops: [], index: 1 } })
    const snap = s.history[s.history.length - 1] // state captured before the 2nd insert: 1 step
    expect(snap.steps).toHaveLength(1)
    s = reducer(s, { type: 'remove', stepId: active(s)!.steps[0].id })
    expect(snap.steps).toHaveLength(1) // unchanged by the later mutation
  })
})
