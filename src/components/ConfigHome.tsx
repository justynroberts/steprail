// MIT License - Copyright (c) fintonlabs.com
// Config: non-secret values flows consume as {{config.key}} tokens, tenanted
// by project. Each run sees shared values with the flow's own project's
// values layered on top. Server setup lives in Setup.
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
  const shared = settings.globals || {}
  const projectGlobals = settings.projectGlobals || {}
  const own = projectGlobals[projectId] || {}

  const parseObject = (raw: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null // Raw mode mid-edit — persist once it parses.
    }
  }

  const setProjectConfig = (raw: string) => {
    const parsed = parseObject(raw)
    if (!parsed) return
    const next = { ...projectGlobals, [projectId]: parsed }
    onChange({ projectGlobals: next })
    void saveSettings({ projectGlobals: next })
  }

  const setShared = (raw: string) => {
    const parsed = parseObject(raw)
    if (!parsed) return
    onChange({ globals: parsed })
    void saveSettings({ globals: parsed })
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Config</h1>
        <span className="page-sub">non-secret values available in flows as {'{{config.key}}'}</span>
      </div>
      <div className="config-body">
        <h2 className="report-h2" style={{ marginBottom: 6 }}>{projectName} project</h2>
        <div className="settings-note" style={{ marginBottom: 10 }}>
          Values for this project's flows only — they override shared keys with the same name.
          Credentials and API keys go in <strong>Secrets</strong>.
        </div>
        <JsonFieldEditor
          key={projectId}
          value={JSON.stringify(own, null, 2)}
          placeholder={'{"environment": "prod", "apiBase": "https://api.fintonlabs.com", "team": "platform"}'}
          onChange={setProjectConfig}
        />

        <h2 className="report-h2" style={{ margin: '22px 0 6px' }}>Shared — all projects</h2>
        <div className="settings-note" style={{ marginBottom: 10 }}>
          Base values every project's flows can read. A project key with the same name wins.
        </div>
        <JsonFieldEditor
          value={JSON.stringify(shared, null, 2)}
          placeholder={'{"company": "fintonlabs", "region": "eu-west-1"}'}
          onChange={setShared}
        />
      </div>
    </div>
  )
}
