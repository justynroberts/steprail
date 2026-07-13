// MIT License - Copyright (c) fintonlabs.com
// Config: connections first (the star), preferences after.
import type { Settings } from '../types'
import { ConnectionsManager } from './ConnectionsManager'
import { SettingsPanel } from './SettingsPanel'

export function ConfigHome({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  return (
    <div className="page">
      <div className="page-head">
        <h1>Config</h1>
        <span className="page-sub">connections, credentials and preferences</span>
      </div>
      <h2 className="config-section">Connections</h2>
      <ConnectionsManager settings={settings} onChange={onChange} />
      <h2 className="config-section" style={{ marginTop: 34 }}>Preferences</h2>
      <div className="config-body">
        <SettingsPanel settings={settings} onChange={onChange} />
      </div>
    </div>
  )
}
