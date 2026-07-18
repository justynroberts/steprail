// MIT License - Copyright (c) fintonlabs.com
// The run drawer: history of every run of this flow (manual, webhook, or
// schedule — externally triggered ones appear live), plus the timeline of
// the selected run. Approval holds are resolved right here.
import { useEffect, useState } from 'react'
import { Activity, Check, Play, RotateCcw, Route, X } from 'lucide-react'
import type { RunSummary } from '../types'
import { approveStep, fetchRuns, rerunRunApi, resumeRunApi } from '../api'
import { showToast } from '../toast'
import { useDispatch } from '../state'
import { useUI } from '../ui'
import { TraceDialog } from './TraceDialog'

const ago = (ts: number) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

interface Props {
  flowId: string
  loadRun: (id: string) => void
  onClose: () => void
}

export function RunDrawer({ flowId, loadRun, onClose }: Props) {
  const { run, runId } = useUI()
  const dispatch = useDispatch()
  const [history, setHistory] = useState<RunSummary[]>([])
  const [traceOpen, setTraceOpen] = useState(false)

  // Poll the history while open so webhook/schedule runs show up live;
  // follow a newer running run automatically.
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      const runs = await fetchRuns(flowId)
      if (cancelled) return
      setHistory(runs)
      const newest = runs[0]
      if (newest?.running && newest.id !== runId && !run.running) loadRun(newest.id)
    }
    void tick()
    const interval = window.setInterval(tick, 2500)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [flowId, runId, run.running, loadRun])

  const done = run.entries.filter(e => e.status === 'success').length
  const failed = run.entries.filter(e => e.status === 'error').length

  const jump = (stepId: string) => {
    dispatch({ type: 'expand', id: stepId })
    document.getElementById(`step-${stepId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="drawer">
      <div className="drawer-head">
        <Activity size={15} style={{ color: 'var(--accent)' }} />
        Runs
        <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-4)' }}>
          {run.running ? 'running…' : `${done} ok${failed > 0 ? ` · ${failed} failed` : ''}`}
        </span>
        <span className="spacer" />
        <button className="btn icon" onClick={onClose}><X size={14} /></button>
      </div>
      {runId && (
        <div className="drawer-actions">
          {!run.running && failed > 0 && (
            <button
              className="btn"
              title="Resume — keep everything that succeeded, re-execute from the failure"
              onClick={async () => {
                const r = await resumeRunApi(runId)
                if (r.runId) loadRun(r.runId)
                else showToast(r.error || 'Could not resume', { kind: 'danger' })
              }}
            >
              <Play size={13} /> Resume
            </button>
          )}
          {!run.running && (
            <button
              className="btn"
              title="Re-run — same flow, same trigger payload"
              onClick={async () => {
                const id = await rerunRunApi(runId)
                if (id) loadRun(id)
                else showToast('Could not re-run', { kind: 'danger' })
              }}
            >
              <RotateCcw size={13} /> Re-run
            </button>
          )}
          <button className="btn" title="Waterfall view of this run (OpenTelemetry)" onClick={() => setTraceOpen(true)}>
            <Route size={13} /> Trace
          </button>
        </div>
      )}
      {traceOpen && runId && <TraceDialog runId={runId} onClose={() => setTraceOpen(false)} />}
      <div className="drawer-body">
        {history.length > 0 && (
          <div className="run-history">
            {history.slice(0, 8).map(h => (
              <button
                key={h.id}
                className={`run-hist-row${h.id === runId ? ' sel' : ''}`}
                onClick={() => loadRun(h.id)}
              >
                <span className={`status-dot ${h.running ? 'running' : h.waiting ? 'waiting' : h.failed ? 'error' : 'success'}`} />
                <span className="rh-trigger">{h.trigger}</span>
                <span className="rh-time">{ago(h.startedAt)}</span>
                <span className="rh-counts">
                  {h.running ? 'running' : h.waiting ? 'waiting' : `${h.ok} ok${h.failed ? ` · ${h.failed} failed` : ''}`}
                </span>
              </button>
            ))}
          </div>
        )}

        {run.entries.length === 0 && <div className="settings-note">Nothing has run yet. Press Run, or send a request to a webhook trigger.</div>}
        {run.entries.map((entry, i) => (
          <button className="run-row" key={`${entry.stepId}-${entry.iter ?? ''}-${i}`} onClick={() => jump(entry.stepId)}>
            <span className={`status-dot ${entry.status}`} />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="rr-name" style={{ display: 'block' }}>{entry.name}</span>
              {entry.error && <span className="rr-err" style={{ display: 'block' }}>{entry.error}</span>}
              {entry.status === 'waiting' && (
                <span className="rr-err" style={{ display: 'block', color: 'var(--warn)' }}>
                  Waiting for {entry.approver || 'approval'}
                </span>
              )}
            </span>
            {entry.status === 'waiting' && runId && (
              <span
                className="btn"
                style={{ fontSize: 12 }}
                onClick={e => { e.stopPropagation(); void approveStep(runId, entry.stepId) }}
              >
                <Check size={12} /> Approve
              </span>
            )}
            {entry.ms > 0 && <span className="rr-ms">{entry.ms} ms</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
