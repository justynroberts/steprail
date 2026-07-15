// MIT License - Copyright (c) fintonlabs.com
// Config: the values flows consume — named credential connections, and
// global config values available in every flow as {{config.key}} tokens.
// Server setup (preferences, security, observability) lives in Setup.
import type { Settings } from '../types'
import { saveSettings } from '../api'
import { JsonFieldEditor } from './JsonFieldEditor'

export function ConfigHome({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const globals = settings.globals || {}

  const setGlobals = (raw: string) => {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        onChange({ globals: parsed })
        void saveSettings({ globals: parsed })
      }
    } catch { /* Raw mode mid-edit — persist once it parses. */ }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Config</h1>
        <span className="page-sub">shared non-secret values available in every flow as {'{{config.key}}'}</span>
      </div>
      <div className="config-body">
        <div className="settings-note" style={{ marginBottom: 10 }}>
          Environment names, base URLs, team handles, feature flags — anything non-secret that multiple flows share.
          Reference anywhere as <span className="kbd">{'{{config.key}}'}</span>. Credentials and API keys go in{' '}
          <strong>Secrets</strong>.
        </div>
        <JsonFieldEditor
          value={JSON.stringify(globals, null, 2)}
          placeholder={'{"environment": "prod", "apiBase": "https://api.fintonlabs.com", "team": "platform"}'}
          onChange={setGlobals}
        />
      </div>
    </div>
  )
}
