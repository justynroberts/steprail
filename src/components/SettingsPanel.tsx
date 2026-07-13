// MIT License - Copyright (c) fintonlabs.com
// The settings/credentials body, shared by the Config sidebar tab and the
// settings drawer. All runtime configuration lives here and persists server-side.
// Connections are named credentials — as many databases, workspaces, and
// API keys as you need; steps pick one by name. Secrets are write-only.
import { useState } from 'react'
import { KeyRound, Plug, Plus, Trash2 } from 'lucide-react'
import type { ConnectionMeta, Settings } from '../types'
import { addConnection, deleteConnection, saveSettings, TOKEN_KEY } from '../api'

const CONN_TYPES: { value: NonNullable<ConnectionMeta['type']>; label: string; hint: string }[] = [
  { value: 'postgres', label: 'PostgreSQL', hint: 'postgres://user:pass@host:5432/db' },
  { value: 'anthropic', label: 'Anthropic', hint: 'sk-ant-…' },
  { value: 'slack', label: 'Slack webhook', hint: 'https://hooks.slack.com/services/…' },
  { value: 'smtp', label: 'SMTP', hint: 'smtp://user:pass@host:587' },
  { value: 'pagerduty', label: 'PagerDuty', hint: 'Events v2 routing key' },
  { value: 'apikey', label: 'API bearer token', hint: 'Token sent as Authorization: Bearer' },
  { value: 'mcp', label: 'MCP server', hint: 'npx -y @modelcontextprotocol/server-… or https://host/mcp' },
]

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
}

export function SettingsPanel({ settings, onChange }: Omit<Props, 'onClose'>) {
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<ConnectionMeta['type']>('postgres')
  const [newSecret, setNewSecret] = useState('')
  const [connError, setConnError] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [browserToken, setBrowserToken] = useState(localStorage.getItem(TOKEN_KEY) || '')

  const set = (patch: Partial<Settings>) => {
    onChange(patch)
    void saveSettings(patch)
  }

  const connections = settings.connections || []

  const add = async () => {
    setConnError('')
    const result = await addConnection(newName, newType, newSecret)
    if ('error' in result) {
      setConnError(result.error)
      return
    }
    onChange({ connections: [...connections, result] })
    setNewName('')
    setNewSecret('')
  }

  const remove = (id: string) => {
    void deleteConnection(id)
    onChange({ connections: connections.filter(c => c.id !== id) })
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
        </div>

        <div className="field">
          <label><Plug size={11} style={{ verticalAlign: -1 }} /> Connections</label>
          <div className="settings-note">
            Named credentials — add as many databases, workspaces, and keys as you need. Steps pick one by name; the first of each type is the default. Secrets never return to the browser.
          </div>
        </div>

        {connections.map(c => (
          <div className="var-row editable" key={c.id}>
            <span className="token-chip">{CONN_TYPES.find(t => t.value === c.type)?.label || c.type}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 510, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
            <button className="btn icon danger" title="Remove connection" onClick={() => remove(c.id)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        <div className="conn-add">
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={newType} onChange={e => setNewType(e.target.value as ConnectionMeta['type'])} style={{ width: 150 }}>
              {CONN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input
              className="var-input"
              placeholder="Name (e.g. orders-db)"
              value={newName}
              onChange={e => setNewName(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="var-input"
              type="password"
              placeholder={CONN_TYPES.find(t => t.value === newType)?.hint}
              value={newSecret}
              onChange={e => setNewSecret(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn" onClick={add} disabled={!newName.trim() || !newSecret.trim()}>
              <Plus size={13} /> Add
            </button>
          </div>
          {connError && <div className="settings-note" style={{ color: 'var(--err)' }}>{connError}</div>}
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
            placeholder="newflow@fintonlabs.com"
            value={settings.smtpFrom || ''}
            onChange={e => set({ smtpFrom: e.target.value })}
          />
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
