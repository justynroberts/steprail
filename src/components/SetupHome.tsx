// MIT License - Copyright (c) fintonlabs.com
// Setup: how this server runs — preferences, observability, security, and
// the endpoints it exposes. Values flows consume live in Config.
import { useEffect, useState } from 'react'
import { BellRing, Paintbrush, Server } from 'lucide-react'
import type { Settings } from '../types'
import { saveSettings } from '../api'
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

        <h2 className="config-section"><BellRing size={14} style={{ verticalAlign: -2 }} /> Failure alerts</h2>
        <div className="settings-note" style={{ marginBottom: 8, maxWidth: 560 }}>
          When an unattended run fails (schedule, webhook, form — not manual runs), send the plain-language error.
          Slack uses the run's project's Slack secret; email uses its SMTP secret.
        </div>
        <div className="field" style={{ maxWidth: 320, marginBottom: 8 }}>
          <label>Alert via</label>
          <select
            value={settings.failureNotify || 'off'}
            onChange={e => {
              const failureNotify = e.target.value as Settings['failureNotify']
              onChange({ failureNotify })
              void saveSettings({ failureNotify })
            }}
          >
            <option value="off">Off</option>
            <option value="slack">Slack</option>
            <option value="email">Email</option>
            <option value="both">Slack + email</option>
          </select>
        </div>
        {(settings.failureNotify === 'slack' || settings.failureNotify === 'both') && (
          <div className="field" style={{ maxWidth: 320, marginBottom: 8 }}>
            <label>Slack connection name</label>
            <input
              placeholder="failed-workflows (blank = project's first)"
              value={settings.failureNotifySlack || ''}
              onChange={e => onChange({ failureNotifySlack: e.target.value })}
              onBlur={e => void saveSettings({ failureNotifySlack: e.target.value })}
            />
            <div className="settings-note" style={{ marginTop: 4, maxWidth: 560 }}>
              A Slack webhook always posts to the channel it was created for. To route alerts to
              #failed-workflows, create a webhook for that channel, save it in Secrets under a name,
              and put that name here. Each project needs its own copy.
            </div>
          </div>
        )}
        {(settings.failureNotify === 'email' || settings.failureNotify === 'both') && (
          <div className="field" style={{ maxWidth: 320, marginBottom: 16 }}>
            <label>Email to</label>
            <input
              type="email"
              placeholder="ops@fintonlabs.com"
              value={settings.failureNotifyEmail || ''}
              onChange={e => onChange({ failureNotifyEmail: e.target.value })}
              onBlur={e => void saveSettings({ failureNotifyEmail: e.target.value })}
            />
          </div>
        )}

        <h2 className="config-section"><Paintbrush size={14} style={{ verticalAlign: -2 }} /> Whitelabel</h2>
        <BrandingPanel settings={settings} onChange={onChange} />
      </div>
    </div>
  )
}
