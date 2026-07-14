// MIT License - Copyright (c) fintonlabs.com
// Setup: how this server runs — preferences, observability, security, and
// the endpoints it exposes. Values flows consume live in Config.
import { useEffect, useState } from 'react'
import { Paintbrush, Server } from 'lucide-react'
import type { Settings } from '../types'
import { SettingsPanel } from './SettingsPanel'
import { BrandingPanel } from './BrandingPanel'

export function SetupHome({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const [health, setHealth] = useState<{ status?: string; uptime?: number; version?: string }>({})

  useEffect(() => {
    void fetch('/api/health').then(r => r.json()).then(setHealth).catch(() => setHealth({ status: 'unreachable' }))
  }, [])

  const origin = window.location.origin

  return (
    <div className="page">
      <div className="page-head">
        <h1>Setup</h1>
        <span className="page-sub">server, preferences, observability and security</span>
      </div>

      <h2 className="config-section"><Server size={14} style={{ verticalAlign: -2 }} /> Server</h2>
      <div className="config-body">
        <div className="field-view" style={{ marginBottom: 24 }}>
          <div className="fv-rows" style={{ padding: '8px 4px' }}>
            <div className="fv-row"><span className="fv-key">status</span><span className="fv-val" style={{ color: health.status === 'ok' ? 'var(--ok)' : 'var(--err)' }}>{health.status || 'checking…'}</span></div>
            <div className="fv-row"><span className="fv-key">version</span><span className="fv-val">{health.version || '—'}</span></div>
            <div className="fv-row"><span className="fv-key">uptime</span><span className="fv-val number">{health.uptime != null ? `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m` : '—'}</span></div>
            <div className="fv-row"><span className="fv-key">webhooks</span><span className="fv-val">{origin}/hooks/…</span></div>
            <div className="fv-row"><span className="fv-key">forms</span><span className="fv-val">{origin}/forms/…</span></div>
            <div className="fv-row"><span className="fv-key">MCP server</span><span className="fv-val">{origin}/mcp</span></div>
            <div className="fv-row"><span className="fv-key">OTLP traces</span><span className="fv-val">GET /api/runs/:id/trace?format=otlp</span></div>
          </div>
        </div>

        <h2 className="config-section">Preferences &amp; security</h2>
        <SettingsPanel settings={settings} onChange={onChange} />

        <h2 className="config-section"><Paintbrush size={14} style={{ verticalAlign: -2 }} /> Whitelabel</h2>
        <BrandingPanel settings={settings} onChange={onChange} />
      </div>
    </div>
  )
}
