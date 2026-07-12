// MIT License - Copyright (c) fintonlabs.com
import type { Flow, Settings } from './types'
import { llmPrompt, type PortableFlow } from './flowjson'

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

import type { Blueprint } from './blueprints'

export async function fetchBlueprints(): Promise<Blueprint[]> {
  try {
    const r = await fetch('/api/blueprints')
    return r.ok ? await r.json() : []
  } catch {
    return []
  }
}

export async function saveBlueprints(blueprints: Blueprint[]): Promise<void> {
  try {
    await fetch('/api/blueprints', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(blueprints),
    })
  } catch {
    // Offline is fine.
  }
}

export async function composeRemote(brief: string): Promise<PortableFlow | null> {
  try {
    const r = await fetch('/api/compose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: llmPrompt(brief) }),
    })
    const data = await r.json()
    if (data.fallback || !data.flow || typeof data.flow !== 'object') return null
    return data.flow as PortableFlow
  } catch {
    return null
  }
}
