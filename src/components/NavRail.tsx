// MIT License - Copyright (c) fintonlabs.com
// The slim always-visible navigation rail: three destinations, full words,
// one job each. Theme lives at the bottom.
import { BarChart2, GraduationCap, KeySquare, LayoutTemplate, Moon, Server, Settings2, Sliders, Sun, Workflow } from 'lucide-react'
import type { Project, Settings } from '../types'
import { Logo } from './Logo'
import { ProjectSwitcher } from './ProjectSwitcher'

export type AppView = 'flows' | 'blueprints' | 'infrastructure' | 'config' | 'secrets' | 'reports' | 'setup' | 'editor'

const DESTINATIONS: { id: Exclude<AppView, 'editor'>; label: string; icon: typeof Workflow }[] = [
  { id: 'flows',          label: 'Flows',          icon: Workflow },
  { id: 'blueprints',     label: 'Blueprints',     icon: LayoutTemplate },
  { id: 'infrastructure', label: 'Targets',        icon: Server },
  { id: 'secrets',        label: 'Secrets',        icon: KeySquare },
  { id: 'reports',        label: 'Reports',        icon: BarChart2 },
  { id: 'config',         label: 'Config',         icon: Sliders },
  { id: 'setup',          label: 'Setup',          icon: Settings2 },
]

interface Props {
  view: AppView
  onNavigate: (view: AppView) => void
  settings: Settings
  onToggleTheme: () => void
  projects: Project[]
  activeProjectId: string
  onSwitchProject: (id: string) => void
  onProjectsChanged: () => void
  onOpenTutorial: () => void
}

export function NavRail({ view, onNavigate, settings, onToggleTheme, projects, activeProjectId, onSwitchProject, onProjectsChanged, onOpenTutorial }: Props) {
  const brand = settings.branding || {}
  return (
    <nav className="nav-rail">
      <div className="nav-mark" title={brand.name?.trim() || 'steprail'}>
        {brand.logoUrl
          ? <img src={brand.logoUrl} alt={brand.name || 'logo'} style={{ maxWidth: 26, maxHeight: 26, objectFit: 'contain' }} />
          : <Logo size={22} />}
      </div>
      <ProjectSwitcher
        projects={projects}
        activeId={activeProjectId}
        onSwitch={onSwitchProject}
        onChanged={onProjectsChanged}
      />
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
      <button className="nav-item" title="Interactive tutorial — build a working flow" onClick={onOpenTutorial}>
        <GraduationCap size={18} />
        <span>Learn</span>
      </button>
      <button className="nav-item" title="Toggle theme" onClick={onToggleTheme}>
        {settings.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        <span>Theme</span>
      </button>
    </nav>
  )
}
