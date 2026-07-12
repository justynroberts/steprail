// MIT License - Copyright (c) fintonlabs.com
// The run timeline. Every entry links back to its step on the rail — errors
// are one click from the field that caused them, and approval holds are
// resolved right here.
import { Activity, Check, X } from 'lucide-react'
import { approveStep } from '../api'
import { useDispatch } from '../state'
import { useUI } from '../ui'

export function RunDrawer({ onClose }: { onClose: () => void }) {
  const { run, runId } = useUI()
  const dispatch = useDispatch()

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
        {run.running ? 'Running…' : 'Last run'}
        <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-4)' }}>
          {done} ok{failed > 0 ? ` · ${failed} failed` : ''}
        </span>
        <span className="spacer" />
        <button className="btn icon" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="drawer-body">
        {run.entries.length === 0 && <div className="settings-note">Nothing has run yet.</div>}
        {run.entries.map(entry => (
          <button className="run-row" key={entry.stepId} onClick={() => jump(entry.stepId)}>
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
