// MIT License - Copyright (c) fintonlabs.com
// All runtime configuration lives here and persists server-side — nothing to
// hand-edit in files. Connection secrets are write-only: the server stores
// them and reports only whether each is set.
import { useState } from 'react'
import { KeyRound, Settings2, X } from 'lucide-react'
import type { Settings } from '../types'
import { saveSettings } from '../api'

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
}

function SecretField({ label, note, isSet, settingKey, flagKey, onSaved }: {
  label: string
  note: string
  isSet: boolean
  settingKey: string
  flagKey: keyof Settings
  onSaved: (patch: Partial<Settings>) => void
}) {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)
  const save = async () => {
    const r = await saveSettings({ [settingKey]: value })
    onSaved({ [flagKey]: (r as Record<string, unknown>)[flagKey] } as Partial<Settings>)
    setValue('')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  return (
    <div className="field">
      <label>{label}{isSet ? ' · connected' : ''}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="password"
          placeholder={isSet ? 'Set — paste to replace, save empty to remove' : note}
          value={value}
          onChange={e => setValue(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn" onClick={save} disabled={!value.trim() && !isSet}>
          <KeyRound size={13} /> {saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}

export function SettingsDrawer({ settings, onChange, onClose }: Props) {
  const set = (patch: Partial<Settings>) => {
    onChange(patch)
    void saveSettings(patch)
  }

  return (
    <div className="drawer">
      <div className="drawer-head">
        <Settings2 size={15} style={{ color: 'var(--accent)' }} />
        Settings
        <span className="spacer" />
        <button className="btn icon" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="drawer-body">
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
          <div className="settings-note" style={{ marginTop: 6 }}>Spacing between queued steps, so runs are easy to follow.</div>
        </div>

        <div className="field">
          <label>Default AI model</label>
          <select value={settings.model} onChange={e => set({ model: e.target.value })}>
            <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
            <option value="claude-haiku-4-5">claude-haiku-4-5</option>
            <option value="claude-opus-4-8">claude-opus-4-8</option>
          </select>
        </div>

        <div className="field"><label>Connections</label>
          <div className="settings-note">
            Steps use these for real. A step whose connection is missing fails with a clear message — nothing is faked.
          </div>
        </div>

        <SecretField
          label="Anthropic API key" note="sk-ant-… (AI steps and compose)"
          isSet={Boolean(settings.hasAnthropicKey)} settingKey="anthropicKey" flagKey="hasAnthropicKey" onSaved={onChange}
        />
        <SecretField
          label="Slack webhook URL" note="https://hooks.slack.com/services/…"
          isSet={Boolean(settings.hasSlackWebhookUrl)} settingKey="slackWebhookUrl" flagKey="hasSlackWebhookUrl" onSaved={onChange}
        />
        <SecretField
          label="PagerDuty routing key" note="Events API v2 routing key"
          isSet={Boolean(settings.hasPagerdutyRoutingKey)} settingKey="pagerdutyRoutingKey" flagKey="hasPagerdutyRoutingKey" onSaved={onChange}
        />
        <SecretField
          label="SMTP URL" note="smtp://user:pass@host:587"
          isSet={Boolean(settings.hasSmtpUrl)} settingKey="smtpUrl" flagKey="hasSmtpUrl" onSaved={onChange}
        />
        <div className="field">
          <label>Email from address</label>
          <input
            placeholder="newflow@fintonlabs.com"
            value={settings.smtpFrom || ''}
            onChange={e => set({ smtpFrom: e.target.value })}
          />
        </div>
        <SecretField
          label="PostgreSQL URL" note="postgres://user:pass@host:5432/db"
          isSet={Boolean(settings.hasPostgresUrl)} settingKey="postgresUrl" flagKey="hasPostgresUrl" onSaved={onChange}
        />
      </div>
    </div>
  )
}
