// MIT License - Copyright (c) fintonlabs.com
// Whitelabel: rename the product, swap the logo, pick the accent, and restyle
// every hosted form page — globally here, per-form via the Form trigger's
// Custom CSS field. All of it persists server-side and applies live.
import { Paintbrush, RotateCcw } from 'lucide-react'
import type { Branding, Settings } from '../types'
import { saveSettings } from '../api'

const ACCENT_DEFAULT = '#5e6ad2'
const HEX = /^#[0-9a-fA-F]{6}$/

export function BrandingPanel({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const branding = settings.branding || {}

  const set = (patch: Partial<Branding>) => {
    const next = { ...branding, ...patch }
    onChange({ branding: next })
    void saveSettings({ branding: next })
  }

  const isDefault = !branding.name && !branding.logoUrl && !branding.accent && !branding.formCss && !branding.hideBadge

  return (
    <div className="drawer-body" style={{ padding: '12px 12px 16px' }}>
      <div className="field">
        <label>Product name</label>
        <input
          placeholder="steprail — shown in the nav, browser tab, and on forms"
          value={branding.name || ''}
          onChange={e => set({ name: e.target.value })}
        />
      </div>

      <div className="field">
        <label>Logo URL</label>
        <input
          placeholder="https://yourco.com/logo.svg — replaces the mark in the nav and on forms"
          value={branding.logoUrl || ''}
          onChange={e => set({ logoUrl: e.target.value })}
        />
      </div>

      <div className="field">
        <label>Accent color</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="color"
            value={HEX.test(branding.accent || '') ? branding.accent : ACCENT_DEFAULT}
            onChange={e => set({ accent: e.target.value })}
            style={{ width: 40, height: 32, padding: 2, cursor: 'pointer', flexShrink: 0 }}
          />
          <input
            placeholder={ACCENT_DEFAULT}
            value={branding.accent || ''}
            onChange={e => set({ accent: e.target.value })}
            style={{ flex: 1 }}
          />
          {branding.accent && (
            <button className="btn icon" title="Back to the default accent" onClick={() => set({ accent: '' })}>
              <RotateCcw size={13} />
            </button>
          )}
        </div>
        <div className="settings-note" style={{ marginTop: 6 }}>
          Buttons, links, and highlights across the app and on hosted forms.
        </div>
      </div>

      <div className="field">
        <label>Form CSS (all forms)</label>
        <textarea
          className="code"
          rows={5}
          placeholder={':root { --form-accent: #0f9d6e; --form-radius: 0; }\n.card { box-shadow: none; }\nbutton { text-transform: uppercase; }'}
          value={branding.formCss || ''}
          onChange={e => set({ formCss: e.target.value })}
          spellCheck={false}
        />
        <div className="settings-note" style={{ marginTop: 6 }}>
          Injected into every hosted form page after the base styles. Variables: <span className="kbd">--form-accent</span> <span className="kbd">--form-bg</span> <span className="kbd">--form-card</span> <span className="kbd">--form-text</span> <span className="kbd">--form-muted</span> <span className="kbd">--form-border</span> <span className="kbd">--form-field</span> <span className="kbd">--form-radius</span>. Each Form trigger also has its own Custom CSS field that layers on top of this.
        </div>
      </div>

      <div className="field">
        <label>“Powered by” badge</label>
        <div className="seg">
          <button className={!branding.hideBadge ? 'on' : ''} onClick={() => set({ hideBadge: false })}>Show</button>
          <button className={branding.hideBadge ? 'on' : ''} onClick={() => set({ hideBadge: true })}>Hide</button>
        </div>
        <div className="settings-note" style={{ marginTop: 6 }}>
          The footer line on hosted form pages. When shown it reads “powered by {branding.name?.trim() || 'steprail'}”.
        </div>
      </div>

      {!isDefault && (
        <div className="settings-note" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Paintbrush size={12} /> Whitelabel active — clear the fields above to return to stock steprail.
        </div>
      )}
    </div>
  )
}
