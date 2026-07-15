// MIT License - Copyright (c) fintonlabs.com
// Config: non-secret values the active project's flows consume as
// {{config.key}} tokens. Strictly project-scoped — each project has its own
// set. Server setup (preferences, security, observability) lives in Setup.
import type { Project, Settings } from '../types'
import { saveSettings } from '../api'
import { JsonFieldEditor } from './JsonFieldEditor'

export function ConfigHome({ settings, onChange, projectId, projects }: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  projectId: string
  projects: Project[]
}) {
  const projectName = projects.find(p => p.id === projectId)?.name || 'Default'
  const projectGlobals = settings.projectGlobals || {}
  const own = projectGlobals[projectId] || {}

  const setProjectConfig = (raw: string) => {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const next = { ...projectGlobals, [projectId]: parsed }
        onChange({ projectGlobals: next })
        void saveSettings({ projectGlobals: next })
      }
    } catch { /* Raw mode mid-edit — persist once it parses. */ }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Config</h1>
        <span className="page-sub">{projectName} project — values available in its flows as {'{{config.key}}'}</span>
      </div>
      <div className="config-body">
        <div className="settings-note" style={{ marginBottom: 10 }}>
          Environment names, base URLs, team handles, feature flags — anything non-secret this project's flows share.
          Reference anywhere as <span className="kbd">{'{{config.key}}'}</span>. Credentials and API keys go in{' '}
          <strong>Secrets</strong>. Other projects have their own config.
        </div>
        <JsonFieldEditor
          key={projectId}
          value={JSON.stringify(own, null, 2)}
          placeholder={'{"environment": "prod", "apiBase": "https://api.fintonlabs.com", "team": "platform"}'}
          onChange={setProjectConfig}
        />
      </div>
    </div>
  )
}
