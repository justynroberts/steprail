// MIT License - Copyright (c) fintonlabs.com
import type { Flow, RunState, Settings } from './types'
import { llmPrompt, type PortableFlow } from './flowjson'

// ---------- queue-backed runs ----------
export async function startRun(flow: Flow, speed: Settings['runSpeed']): Promise<string | null> {
  try {
    const r = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flow, speed }),
    })
    const data = await r.json()
    return r.ok ? data.runId : null
  } catch {
    return null
  }
}

export async function fetchRun(runId: string): Promise<RunState | null> {
  try {
    const r = await fetch(`/api/runs/${runId}`)
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

export async function approveStep(runId: string, stepId: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/runs/${runId}/approve/${stepId}`, { method: 'POST' })
    return r.ok
  } catch {
    return false
  }
}

export async function testStepRemote(
  flow: Flow,
  stepId: string,
  upstream: Record<string, unknown>,
): Promise<{ output?: Record<string, unknown>; error?: string }> {
  try {
    const r = await fetch('/api/test-step', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flow, stepId, upstream }),
    })
    return r.ok ? await r.json() : { error: 'The newflow server rejected the test.' }
  } catch {
    return { error: 'Could not reach the newflow server — is it running?' }
  }
}

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
