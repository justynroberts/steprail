// MIT License - Copyright (c) fintonlabs.com
import { AlertTriangle } from 'lucide-react'

interface Props {
  flowName: string
  onSave: () => void
  onLeave: () => void
  onStay: () => void
}

export function UnsavedDialog({ flowName, onSave, onLeave, onStay }: Props) {
  return (
    <div className="overlay" onClick={onStay} style={{ zIndex: 80 }}>
      <div className="unsaved-dialog" onClick={e => e.stopPropagation()}>
        <div className="unsaved-icon">
          <AlertTriangle size={18} />
        </div>
        <div className="unsaved-body">
          <div className="unsaved-title">Unsaved changes</div>
          <div className="unsaved-sub">
            <strong>{flowName}</strong> has changes that haven't been saved yet.
          </div>
        </div>
        <div className="unsaved-actions">
          <button className="btn" onClick={onStay}>Stay</button>
          <button className="btn" onClick={onLeave}>Leave anyway</button>
          <button className="btn primary" onClick={onSave}>Save &amp; leave</button>
        </div>
      </div>
    </div>
  )
}
