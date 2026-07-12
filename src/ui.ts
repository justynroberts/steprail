// MIT License - Copyright (c) fintonlabs.com
// Cross-cutting UI state: what's being dragged, the live run, and how a
// component asks for the command palette at a specific insertion point.
import { createContext, useContext } from 'react'
import type { RunState, SlotPath } from './types'
import { emptyRun } from './engine'

export interface DragPayload {
  kind: 'tool' | 'step'
  id: string
}

export interface UIContextValue {
  run: RunState
  dragging: DragPayload | null
  setDragging: (d: DragPayload | null) => void
  openPalette: (at: SlotPath) => void
}

export const UICtx = createContext<UIContextValue>({
  run: emptyRun,
  dragging: null,
  setDragging: () => {},
  openPalette: () => {},
})

export const useUI = () => useContext(UICtx)

export const CATEGORY_VAR: Record<string, string> = {
  trigger: 'var(--cat-trigger)',
  ai: 'var(--cat-ai)',
  infra: 'var(--cat-infra)',
  data: 'var(--cat-data)',
  logic: 'var(--cat-logic)',
  notify: 'var(--cat-notify)',
}
