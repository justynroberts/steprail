// MIT License - Copyright (c) fintonlabs.com
// The authenticated approval modal a magic-link opens when "require sign-in to
// approve" is on. The app is already behind the login gate, so reaching here
// proves a valid session; the token (from ?approval=) scopes which gate. Shows
// the message + decision context and Approve / Reject-with-reason.
import { useCallback, useEffect, useState } from 'react'
import { Check, ShieldCheck, X } from 'lucide-react'
import { fetchApprovalByToken, decideApprovalByToken, type ApprovalByToken } from '../api'
import { showToast } from '../toast'
import { FieldView } from './FieldView'

export function ApprovalModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ApprovalByToken | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => setDetail(await fetchApprovalByToken(token)), [token])
  useEffect(() => { void load() }, [load])

  const decide = async (decision: 'approve' | 'reject') => {
    if (busy) return
    if (decision === 'reject' && !reason.trim()) { showToast('A reason is required to reject', { kind: 'danger' }); return }
    setBusy(true)
    const ok = await decideApprovalByToken(token, decision, reason)
    setBusy(false)
    showToast(ok ? (decision === 'approve' ? 'Approved — run released' : 'Rejected — run stopped') : 'Could not record the decision', ok ? {} : { kind: 'danger' })
    if (ok) onClose()
  }

  const gone = detail && (detail.error || detail.decided)

  return (
    <div className="overlay" style={{ zIndex: 90, alignItems: 'center', paddingTop: 0 }} onClick={onClose}>
      <div className="approval-dialog" onClick={e => e.stopPropagation()}>
        <div className="approval-modal-head">
          <ShieldCheck size={16} />
          <span>Approval</span>
          <button className="btn" style={{ marginLeft: 'auto', padding: '4px 8px' }} onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>

        {!detail && <div className="approval-modal-body"><p className="page-sub">Loading…</p></div>}

        {gone && (
          <div className="approval-modal-body">
            <p>{detail?.error || 'This approval has already been decided, or the link expired.'}</p>
            <div className="approval-actions" style={{ marginTop: 14 }}>
              <button className="btn" onClick={onClose}>Close</button>
            </div>
          </div>
        )}

        {detail && !gone && (
          <div className="approval-modal-body">
            <div className="approval-step">{detail.stepName}</div>
            <div className="approval-meta">Flow “{detail.flowName}” · for {detail.approver || 'anyone'}</div>
            {detail.message && <div className="approval-message">{detail.message}</div>}
            {detail.context != null && (
              <div className="approval-context">
                <div className="approval-context-label">What you're approving — {detail.context.label}</div>
                <FieldView data={(detail.context.data && typeof detail.context.data === 'object' ? detail.context.data : { value: detail.context.data }) as Record<string, unknown>} />
              </div>
            )}
            <label className="approval-reason-label">Reason (required to reject)</label>
            <textarea className="approval-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why you're approving or rejecting…" />
            <div className="approval-actions">
              <button className="btn primary" disabled={busy} onClick={() => decide('approve')}><Check size={14} /> Approve</button>
              <button className="btn danger" disabled={busy} onClick={() => decide('reject')}><X size={14} /> Reject</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
