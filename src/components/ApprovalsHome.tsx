// MIT License - Copyright (c) fintonlabs.com
// Approvals inbox: every run currently parked at an Approval step, across this
// project. Shows what's being approved (the upstream decision context) and lets
// an operator approve or reject-with-reason in place — the same actions the
// emailed/Slack magic-link and the Run drawer expose, hitting the same endpoint.
import { useCallback, useEffect, useState } from 'react'
import { Check, ShieldCheck, X } from 'lucide-react'
import { approveStep, fetchApprovals, fetchApprovalLog, rejectStep, type ApprovalDecision, type PendingApproval } from '../api'
import { showToast } from '../toast'
import { FieldView } from './FieldView'

const ago = (ts: number) => {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function ApprovalsHome({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<PendingApproval[]>([])
  const [log, setLog] = useState<ApprovalDecision[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const [pending, history] = await Promise.all([fetchApprovals(projectId), fetchApprovalLog(projectId)])
    setItems(pending)
    setLog(history)
    setLoaded(true)
  }, [projectId])

  useEffect(() => {
    void load()
    // Approvals arrive while you watch — poll gently.
    const t = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(t)
  }, [load])

  const decide = async (a: PendingApproval, approve: boolean) => {
    if (approve) {
      const ok = await approveStep(a.runId, a.stepId)
      showToast(ok ? `Approved “${a.stepName}”` : 'Could not approve', ok ? {} : { kind: 'danger' })
    } else {
      const reason = window.prompt(`Reject “${a.stepName}” — reason?`)
      if (reason === null) return
      if (!reason.trim()) { showToast('A reason is required to reject', { kind: 'danger' }); return }
      const ok = await rejectStep(a.runId, a.stepId, reason)
      showToast(ok ? `Rejected — run stopped` : 'Could not reject', ok ? {} : { kind: 'danger' })
    }
    void load()
  }

  return (
    <div className="approvals-page">
      <div className="page-head">
        <h1>Approvals</h1>
        <span className="page-sub">{items.length ? `${items.length} waiting` : 'nothing waiting'}{log.length ? ` · ${log.length} decided` : ''}</span>
      </div>

      {loaded && items.length === 0 && (
        <div className="approvals-empty">
          <ShieldCheck size={22} />
          <p>No approvals waiting. When a flow hits an Approval step it appears here — and the approver gets a signed link by email/Slack if a Public URL is set in Setup.</p>
        </div>
      )}

      <div className="approvals-list">
        {items.map(a => (
          <div className="approval-card" key={`${a.runId}-${a.stepId}`}>
            <div className="approval-top">
              <div>
                <div className="approval-step">{a.stepName}</div>
                <div className="approval-meta">
                  {a.flowName} · {a.approver || 'anyone'} · {ago(a.startedAt)}
                </div>
              </div>
              <div className="approval-actions">
                <button className="btn primary" onClick={() => decide(a, true)}><Check size={14} /> Approve</button>
                <button className="btn danger" onClick={() => decide(a, false)}><X size={14} /> Reject</button>
              </div>
            </div>
            {a.context != null && (
              <div className="approval-context">
                <div className="approval-context-label">What you're approving — {a.context.label}</div>
                <FieldView data={(a.context.data && typeof a.context.data === 'object' ? a.context.data : { value: a.context.data }) as Record<string, unknown>} />
              </div>
            )}
          </div>
        ))}
      </div>

      {log.length > 0 && (
        <div className="approval-history">
          <h2>Decision history</h2>
          {log.map((d, i) => (
            <div className="approval-history-row" key={`${d.runId}-${d.stepId}-${d.at}-${i}`}>
              <span className={`approval-history-dot ${d.decision}`} />
              <span className="approval-history-main">
                <span className="ah-step">{d.decision === 'approved' ? 'Approved' : 'Rejected'} “{d.stepName}”</span>
                <span className="ah-sub">
                  {' '}· {d.flowName} · {d.approver} ({d.via})
                  {d.reason ? ` — ${d.reason}` : ''}
                </span>
              </span>
              <span className="approval-history-when">{ago(d.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
