// MIT License - Copyright (c) fintonlabs.com
import type { ConnectionMeta, Flow, Project, RunState, RunSummary, Settings } from './types'
import { llmPrompt, type PortableFlow } from './flowjson'

// When the server has an access token set, every API call must carry it.
// The token for THIS browser is kept in localStorage via Settings.
export const TOKEN_KEY = 'steprail-api-token'
const apiFetch: typeof fetch = (input, init) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (!token) return fetch(input, init)
  return fetch(input, { ...init, headers: { ...(init?.headers || {}), 'x-api-token': token } })
}

// ---------- queue-backed runs ----------
export async function startRun(flow: Flow, speed: Settings['runSpeed'], trigger?: Record<string, unknown>): Promise<string | null> {
  try {
    const r = await apiFetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flow, speed, trigger }),
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

export async function addConnection(name: string, type: string, secret: string, projectId?: string): Promise<ConnectionMeta | { error: string }> {
  try {
    const r = await apiFetch('/api/connections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, type, secret, projectId }),
    })
    return await r.json()
  } catch {
    return { error: 'Could not reach the steprail server.' }
  }
}

// ---------- projects (tenancy) ----------
export async function fetchProjects(): Promise<Project[]> {
  try {
    const r = await apiFetch('/api/projects')
    return r.ok ? await r.json() : []
  } catch {
    return []
  }
}

export async function addProject(name: string, color?: string): Promise<Project | { error: string }> {
  try {
    const r = await apiFetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, color }),
    })
    return await r.json()
  } catch {
    return { error: 'Could not reach the steprail server.' }
  }
}

export async function renameProject(id: string, name: string): Promise<Project | { error: string }> {
  try {
    const r = await apiFetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    return await r.json()
  } catch {
    return { error: 'Could not reach the steprail server.' }
  }
}

export async function deleteProject(id: string): Promise<{ ok?: boolean; movedFlows?: number; movedSecrets?: number; error?: string }> {
  try {
    const r = await apiFetch(`/api/projects/${id}`, { method: 'DELETE' })
    return await r.json()
  } catch {
    return { error: 'Could not reach the steprail server.' }
  }
}

export async function testConnection(id: string): Promise<{ ok: boolean; note?: string; error?: string }> {
  try {
    const r = await apiFetch(`/api/connections/${id}/test`, { method: 'POST' })
    return await r.json()
  } catch {
    return { ok: false, error: 'Could not reach the steprail server.' }
  }
}

export async function replaceConnectionSecret(id: string, secret: string): Promise<boolean> {
  try {
    const r = await apiFetch(`/api/connections/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret }),
    })
    return r.ok
  } catch {
    return false
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
    return r.ok ? await r.json() : { error: 'The steprail server rejected the test.' }
  } catch {
    return { error: 'Could not reach the steprail server — is it running?' }
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

export interface ReportData {
  schedule: { flowId: string; flowName: string; stepCount: number; schedule: string; nextAt: number }[]
  stats: {
    totalRuns: number
    totalSteps: number
    successSteps: number
    errorSteps: number
    byDay: { date: string; runs: number; steps: number }[]
  }
}

export async function fetchReports(projectId?: string): Promise<ReportData | null> {
  try {
    const r = await apiFetch(`/api/reports${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`)
    return r.ok ? await r.json() : null
  } catch {
    return null
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

// ---------- trust features: rerun/resume, pinned payloads, versions ----------
export async function rerunRunApi(runId: string): Promise<string | null> {
  try {
    const r = await apiFetch(`/api/runs/${runId}/rerun`, { method: 'POST' })
    return r.ok ? (await r.json()).runId : null
  } catch { return null }
}

export async function resumeRunApi(runId: string): Promise<{ runId?: string; error?: string }> {
  try {
    const r = await apiFetch(`/api/runs/${runId}/resume`, { method: 'POST' })
    return await r.json()
  } catch { return { error: 'Could not reach the steprail server.' } }
}

export async function fetchLastTrigger(flowId: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await apiFetch(`/api/flows/${flowId}/last-trigger`)
    return r.ok ? (await r.json()).trigger : null
  } catch { return null }
}

export interface FlowVersion { at: number; name: string; stepCount: number }

export async function fetchVersions(flowId: string): Promise<FlowVersion[]> {
  try {
    const r = await apiFetch(`/api/flows/${flowId}/versions`)
    return r.ok ? await r.json() : []
  } catch { return [] }
}

export async function restoreVersion(flowId: string, at: number): Promise<Flow | null> {
  try {
    const r = await apiFetch(`/api/flows/${flowId}/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ at }),
    })
    return r.ok ? (await r.json()).flow : null
  } catch { return null }
}
