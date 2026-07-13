// MIT License - Copyright (c) fintonlabs.com
import type { ConnectionMeta, Flow, RunState, RunSummary, Settings } from './types'
import { llmPrompt, type PortableFlow } from './flowjson'

// When the server has an access token set, every API call must carry it.
// The token for THIS browser is kept in localStorage via Settings.
export const TOKEN_KEY = 'newflow-api-token'
const apiFetch: typeof fetch = (input, init) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (!token) return fetch(input, init)
  return fetch(input, { ...init, headers: { ...(init?.headers || {}), 'x-api-token': token } })
}

// ---------- queue-backed runs ----------
export async function startRun(flow: Flow, speed: Settings['runSpeed']): Promise<string | null> {
  try {
    const r = await apiFetch('/api/runs', {
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

export async function fetchRuns(flowId: string): Promise<RunSummary[]> {
  try {
    const r = await apiFetch(`/api/runs?flowId=${encodeURIComponent(flowId)}`)
    return r.ok ? await r.json() : []
  } catch {
    return []
  }
}

export async function addConnection(name: string, type: string, secret: string): Promise<ConnectionMeta | { error: string }> {
  try {
    const r = await apiFetch('/api/connections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, type, secret }),
    })
    return await r.json()
  } catch {
    return { error: 'Could not reach the newflow server.' }
  }
}

export async function deleteConnection(id: string): Promise<void> {
  try {
    await apiFetch(`/api/connections/${id}`, { method: 'DELETE' })
  } catch {
    // Next settings load will show the truth.
  }
}

export interface TraceSpan {
  spanId: string
  name: string
  tool: string
  stepId: string
  start: number
  end: number
  status: 'ok' | 'error'
  error?: string
  attrs: Record<string, string | number>
  events: { time: number; name: string; note?: string }[]
}

export interface Trace {
  traceId: string
  startedAt: number
  finishedAt?: number
  root: { name: string; start: number; end: number }
  spans: TraceSpan[]
}

export async function fetchTrace(runId: string): Promise<Trace | null> {
  try {
    const r = await apiFetch(`/api/runs/${runId}/trace`)
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

export async function fetchTraceOtlp(runId: string): Promise<string | null> {
  try {
    const r = await apiFetch(`/api/runs/${runId}/trace?format=otlp`)
    return r.ok ? JSON.stringify(await r.json(), null, 2) : null
  } catch {
    return null
  }
}

export async function fetchRun(runId: string): Promise<RunState | null> {
  try {
    const r = await apiFetch(`/api/runs/${runId}`)
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

export async function approveStep(runId: string, stepId: string): Promise<boolean> {
  try {
    const r = await apiFetch(`/api/runs/${runId}/approve/${stepId}`, { method: 'POST' })
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
    const r = await apiFetch('/api/test-step', {
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
    const r = await apiFetch('/api/flows')
    return r.ok ? await r.json() : []
  } catch {
    return []
  }
}

export async function saveFlows(flows: Flow[]): Promise<void> {
  try {
    await apiFetch('/api/flows', {
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
    const r = await apiFetch('/api/settings')
    return r.ok ? await r.json() : {}
  } catch {
    return {}
  }
}

export async function saveSettings(patch: Record<string, unknown>): Promise<{ hasAnthropicKey?: boolean }> {
  try {
    const r = await apiFetch('/api/settings', {
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
    const r = await apiFetch('/api/blueprints')
    return r.ok ? await r.json() : []
  } catch {
    return []
  }
}

export async function saveBlueprints(blueprints: Blueprint[]): Promise<void> {
  try {
    await apiFetch('/api/blueprints', {
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
    const r = await apiFetch('/api/compose', {
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
