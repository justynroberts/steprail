// MIT License - Copyright (c) fintonlabs.com
export interface Toast {
  id: string
  message: string
  kind: 'info' | 'success' | 'danger'
  action?: { label: string; fn: () => void }
}

type Listener = (toast: Toast) => void
let listeners: Listener[] = []

let counter = 0

export function showToast(message: string, opts?: { kind?: Toast['kind']; action?: Toast['action'] }) {
  const toast: Toast = {
    id: String(++counter),
    message,
    kind: opts?.kind ?? 'info',
    action: opts?.action,
  }
  for (const l of listeners) l(toast)
}

export function subscribeToast(fn: Listener): () => void {
  listeners.push(fn)
  return () => { listeners = listeners.filter(l => l !== fn) }
}
