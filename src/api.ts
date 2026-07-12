// MIT License - Copyright (c) fintonlabs.com
import type { Flow, Settings } from './types'
import { TOOLS } from './tools'

export async function fetchFlows(): Promise<Flow[]> {
  try {
    const r = await fetch('/api/flows')
    return r.ok ? await r.json() : []
  } catch {
    return []
  }
}

export async function saveFlows(flows: Flow[]): Promise<void> {
  try {
    await fetch('/api/flows', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(flows),
    })
  } catch {
    // Offline is fine; the editor keeps working and retries on next change.
  }
}

export async function fetchSettings(): Promise<Partial<Settings>> {
  try {
    const r = await fetch('/api/settings')
    return r.ok ? await r.json() : {}
  } catch {
    return {}
  }
}

export async function saveSettings(patch: Record<string, unknown>): Promise<{ hasAnthropicKey?: boolean }> {
  try {
    const r = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    return r.ok ? await r.json() : {}
  } catch {
    return {}
  }
}

export async function composeRemote(prompt: string): Promise<string[] | null> {
  try {
    const catalog = TOOLS.map(t => `${t.id}: ${t.description}`).join('\n')
    const r = await fetch('/api/compose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, catalog }),
    })
    const data = await r.json()
    if (data.fallback || !Array.isArray(data.toolIds)) return null
    return data.toolIds
  } catch {
    return null
  }
}
