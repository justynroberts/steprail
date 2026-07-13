// MIT License - Copyright (c) fintonlabs.com
// Credentials, secrets and settings on a real page — the SettingsPanel body
// given the room it deserves.
import type { Settings } from '../types'
import { SettingsPanel } from './SettingsPanel'

export function ConfigHome({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  return (
    <div className="page">
      <div className="page-head">
        <h1>Config</h1>
        <span className="page-sub">connections, credentials and preferences</span>
      </div>
      <div className="config-body">
        <SettingsPanel settings={settings} onChange={onChange} />
      </div>
    </div>
  )
}
