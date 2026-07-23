// MIT License - Copyright (c) fintonlabs.com
// The settings/credentials body, shared by the Config sidebar tab and the
// settings drawer. All runtime configuration lives here and persists server-side.
// Connections are named credentials — as many databases, workspaces, and
// API keys as you need; steps pick one by name. Secrets are write-only.
import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import type { Settings } from '../types'
import { saveSettings, TOKEN_KEY } from '../api'

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
}

export function SettingsPanel({ settings, onChange }: Omit<Props, 'onClose'>) {
  const [apiToken, setApiToken] = useState('')
  const [browserToken, setBrowserToken] = useState(localStorage.getItem(TOKEN_KEY) || '')

  const set = (patch: Partial<Settings>) => {
    onChange(patch)
    void saveSettings(patch)
  }

  const saveApiToken = async () => {
    await saveSettings({ apiToken })
    // The server now requires it — keep this browser working.
    if (apiToken) localStorage.setItem(TOKEN_KEY, apiToken)
    else localStorage.removeItem(TOKEN_KEY)
    setBrowserToken(apiToken)
    onChange({ hasApiToken: Boolean(apiToken) })
    setApiToken('')
  }

  return (
    <div className="drawer-body" style={{ padding: '12px 12px 16px' }}>
        <div className="field">
          <label>Theme</label>
          <div className="seg">
            {(['dark', 'light'] as const).map(t => (
              <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => set({ theme: t })}>
                {t === 'dark' ? 'Dark' : 'Light'}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Run pacing</label>
          <div className="seg">
            {(['realtime', 'fast', 'instant'] as const).map(s => (
              <button key={s} className={settings.runSpeed === s ? 'on' : ''} onClick={() => set({ runSpeed: s })}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Default AI model</label>
          <select value={settings.model} onChange={e => set({ model: e.target.value })}>
            <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
            <option value="claude-haiku-4-5">claude-haiku-4-5</option>
            <option value="claude-opus-4-8">claude-opus-4-8</option>
          </select>
          <div className="settings-note">Used by AI steps inside flows unless a step overrides it.</div>
        </div>

        <div className="field">
          <label>StepHan model (flow authoring)</label>
          <select value={settings.composeModel || 'claude-opus-4-8'} onChange={e => set({ composeModel: e.target.value })}>
            <option value="claude-opus-4-8">claude-opus-4-8</option>
            <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
            <option value="claude-haiku-4-5">claude-haiku-4-5</option>
          </select>
          <div className="settings-note">Drafting a whole flow is one-shot — keep this on the most capable model for the best results.</div>
        </div>

        <div className="field">
          <label>Public URL</label>
          <input
            placeholder="https://steprail.yourco.com — where this instance is reachable"
            value={settings.publicUrl || ''}
            onChange={e => set({ publicUrl: e.target.value })}
          />
          <div className="settings-note" style={{ marginTop: 6 }}>
            Used to build links in outbound messages — notably the <strong>approve/reject links</strong> emailed or posted to Slack for Approval steps. Leave blank to keep approvals in-app only.
          </div>
        </div>

        <div className="field">
          <label>OTLP traces endpoint</label>
          <input
            placeholder="http://oracle.local:4318 (Jaeger/Tempo/collector)"
            value={settings.otlpEndpoint || ''}
            onChange={e => set({ otlpEndpoint: e.target.value })}
          />
          <div className="settings-note" style={{ marginTop: 6 }}>
            Every finished run posts its OpenTelemetry spans to <span className="kbd">/v1/traces</span> here. The built-in trace viewer works either way.
          </div>
        </div>

        <div className="field">
          <label>Email from address</label>
          <input
            placeholder="onboarding@resend.dev"
            value={settings.smtpFrom || ''}
            onChange={e => set({ smtpFrom: e.target.value })}
          />
          <div className="settings-note" style={{ marginTop: 6 }}>
            Must be a sender your SMTP provider has verified. For Resend, use <span className="kbd">onboarding@resend.dev</span> to
            test, or verify your domain at resend.com/domains and send from it. An unverified address is rejected (550).
          </div>
        </div>

        <div className="field">
          <label>Access token{settings.hasApiToken ? ' · enabled' : ''}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              placeholder={settings.hasApiToken ? 'Set — paste to replace, save empty to disable' : 'Require a token for all API access'}
              value={apiToken}
              onChange={e => setApiToken(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn" onClick={saveApiToken} disabled={!apiToken.trim() && !settings.hasApiToken}>
              <KeyRound size={13} /> Save
            </button>
          </div>
          <div className="settings-note" style={{ marginTop: 6 }}>
            Off by default (open on your network, like n8n). Set a token to lock the API; this browser keeps a copy locally{browserToken ? ' (stored)' : ''}. Webhooks stay open — use unguessable paths.
          </div>
        </div>
    </div>
  )
}
