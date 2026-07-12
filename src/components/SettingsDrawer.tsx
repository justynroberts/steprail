// MIT License - Copyright (c) fintonlabs.com
// All runtime configuration lives here and persists server-side —
// nothing to hand-edit in files.
import { useState } from 'react'
import { KeyRound, Settings2, X } from 'lucide-react'
import type { Settings } from '../types'
import { saveSettings } from '../api'

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
}

export function SettingsDrawer({ settings, onChange, onClose }: Props) {
  const [key, setKey] = useState('')
  const [keySaved, setKeySaved] = useState(false)

  const set = (patch: Partial<Settings>) => {
    onChange(patch)
    void saveSettings(patch)
  }

  const saveKey = async () => {
    const r = await saveSettings({ anthropicKey: key })
    onChange({ hasAnthropicKey: r.hasAnthropicKey })
    setKey('')
    setKeySaved(true)
    setTimeout(() => setKeySaved(false), 2000)
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
          <label>Run speed</label>
          <div className="seg">
            {(['realtime', 'fast', 'instant'] as const).map(s => (
              <button key={s} className={settings.runSpeed === s ? 'on' : ''} onClick={() => set({ runSpeed: s })}>
                {s}
              </button>
            ))}
          </div>
          <div className="settings-note" style={{ marginTop: 6 }}>How quickly simulated runs step through the rail.</div>
        </div>

        <div className="field">
          <label>Compose model</label>
          <select value={settings.model} onChange={e => set({ model: e.target.value })}>
            <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
            <option value="claude-haiku-4-5">claude-haiku-4-5</option>
            <option value="claude-opus-4-8">claude-opus-4-8</option>
          </select>
        </div>

        <div className="field">
          <label>Anthropic API key</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              placeholder={settings.hasAnthropicKey ? 'Key is set — paste to replace' : 'sk-ant-…'}
              value={key}
              onChange={e => setKey(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn" onClick={saveKey} disabled={!key.trim()}>
              <KeyRound size={13} /> {keySaved ? 'Saved' : 'Save'}
            </button>
          </div>
          <div className="settings-note" style={{ marginTop: 6 }}>
            Powers AI compose on empty flows. Stored server-side; never sent back to the browser.
            Without a key, compose falls back to a local keyword planner.
          </div>
        </div>
      </div>
    </div>
  )
}
