// MIT License - Copyright (c) fintonlabs.com
// The slim always-visible navigation rail: three destinations, full words,
// one job each. Theme lives at the bottom.
import { LayoutTemplate, Moon, Plug, Settings2, Sun, Workflow } from 'lucide-react'
import type { Settings } from '../types'
import { Logo } from './Logo'

export type AppView = 'flows' | 'blueprints' | 'config' | 'setup' | 'editor'

const DESTINATIONS: { id: Exclude<AppView, 'editor'>; label: string; icon: typeof Workflow }[] = [
  { id: 'flows', label: 'Flows', icon: Workflow },
  { id: 'blueprints', label: 'Blueprints', icon: LayoutTemplate },
  { id: 'config', label: 'Config', icon: Plug },
  { id: 'setup', label: 'Setup', icon: Settings2 },
]

interface Props {
  view: AppView
  onNavigate: (view: AppView) => void
  settings: Settings
  onToggleTheme: () => void
}

export function NavRail({ view, onNavigate, settings, onToggleTheme }: Props) {
  const brand = settings.branding || {}
  return (
    <nav className="nav-rail">
      <div className="nav-mark" title={brand.name?.trim() || 'steprail'}>
        {brand.logoUrl
          ? <img src={brand.logoUrl} alt={brand.name || 'logo'} style={{ maxWidth: 26, maxHeight: 26, objectFit: 'contain' }} />
          : <Logo size={22} />}
      </div>
      {DESTINATIONS.map(d => (
        <button
          key={d.id}
          className={`nav-item${view === d.id || (d.id === 'flows' && view === 'editor') ? ' on' : ''}`}
          onClick={() => onNavigate(d.id)}
        >
          <d.icon size={18} />
          <span>{d.label}</span>
        </button>
      ))}
      <span className="nav-spacer" />
      <button className="nav-item" title="Toggle theme" onClick={onToggleTheme}>
        {settings.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        <span>Theme</span>
      </button>
    </nav>
  )
}
