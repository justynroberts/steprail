// MIT License - Copyright (c) fintonlabs.com
// Flow history: every meaningful save keeps the previous state (capped,
// coalesced server-side). Restoring is itself versioned, so it's always
// undoable — one bad edit to a live flow is one click back.
import { useEffect, useState } from 'react'
import { History, RotateCcw, X } from 'lucide-react'
import type { Flow } from '../types'
import { fetchVersions, restoreVersion, type FlowVersion } from '../api'
import { useDispatch } from '../state'
import { showToast } from '../toast'

export function VersionsDialog({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const dispatch = useDispatch()
  const [versions, setVersions] = useState<FlowVersion[] | null>(null)

  useEffect(() => {
    void fetchVersions(flow.id).then(setVersions)
  }, [flow.id])

  const restore = async (at: number) => {
    const restored = await restoreVersion(flow.id, at)
    if (!restored) {
      showToast('Could not restore that version', { kind: 'danger' })
      return
    }
    dispatch({ type: 'load-steps', steps: restored.steps })
    dispatch({ type: 'rename', name: restored.name })
    dispatch({ type: 'set-vars', vars: restored.vars || {} })
    dispatch({ type: 'set-tags', tags: restored.tags || [] })
    showToast(`Restored "${restored.name}" — the replaced state was kept in history too`)
    onClose()
  }

  const fmt = (at: number) =>
    new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmdk run-form-dialog">
        <div className="cmdk-input">
          <History size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ flex: 1, fontWeight: 590, fontSize: 14 }}>History — {flow.name}</span>
          <button className="btn icon" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="run-form-body">
          {versions === null && <div className="settings-note">Loading…</div>}
          {versions?.length === 0 && (
            <div className="settings-note">No versions yet — one is kept automatically each time this flow meaningfully changes.</div>
          )}
          {versions?.map(v => (
            <div key={v.at} className="version-row">
              <span className="version-when">{fmt(v.at)}</span>
              <span className="version-name">{v.name}</span>
              <span className="version-steps">{v.stepCount} step{v.stepCount === 1 ? '' : 's'}</span>
              <button className="btn" onClick={() => void restore(v.at)}>
                <RotateCcw size={12} /> Restore
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
