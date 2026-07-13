// MIT License - Copyright (c) fintonlabs.com
// Thin drawer wrapper; the body lives in SettingsPanel (shared with the
// Config tab in the left nav).
import { Settings2, X } from 'lucide-react'
import type { Settings } from '../types'
import { SettingsPanel } from './SettingsPanel'

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
}

export function SettingsDrawer({ settings, onChange, onClose }: Props) {
  return (
    <div className="drawer">
      <div className="drawer-head">
        <Settings2 size={15} style={{ color: 'var(--accent)' }} />
        Settings
        <span className="spacer" />
        <button className="btn icon" onClick={onClose}><X size={14} /></button>
      </div>
      <SettingsPanel settings={settings} onChange={onChange} />
    </div>
  )
}
