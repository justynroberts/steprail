// MIT License - Copyright (c) fintonlabs.com
// The app shell: a slim nav rail with three destinations (Flows, Blueprints,
// Config), and the editor as a mode you enter by opening a flow.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StepHanLogo } from './components/StepHanLogo'
import type { Flow, Project, RunState, Settings, SlotPath, Step } from './types'
import { active, useDispatch, useEditor } from './state'
import { emptyRun } from './engine'
import { fetchFlows, fetchLastTrigger, fetchProjects, fetchRun, fetchSettings, saveFlows, saveSettings, startRun as startRunApi } from './api'
import { getActiveProjectId, setActiveProjectId } from './projects'
import { UICtx, type DragPayload, type InsertTarget } from './ui'
import { NavRail, type AppView } from './components/NavRail'
import { FlowsHome } from './components/FlowsHome'
import { BlueprintsHome } from './components/BlueprintsHome'
import { ConfigHome } from './components/ConfigHome'
import { SecretsHome } from './components/SecretsHome'
import { ReportsHome } from './components/ReportsHome'
import { SetupHome } from './components/SetupHome'
import { TopBar } from './components/TopBar'
import { Palette } from './components/Palette'
import { Rail } from './components/Rail'
import { EmptyState } from './components/EmptyState'
import { CommandPalette } from './components/CommandPalette'
import { RunDrawer } from './components/RunDrawer'
import { VarsDrawer } from './components/VarsDrawer'
import { FlowJsonDialog } from './components/FlowJsonDialog'
import { RunFormDialog } from './components/RunFormDialog'
import { VersionsDialog } from './components/VersionsDialog'
import { ToastContainer } from './components/Toast'
import { UnsavedDialog } from './components/UnsavedDialog'
import { StepHanDialog } from './components/StepHanDialog'
import { Tutorial, tutorialState } from './components/Tutorial'

const DEFAULT_SETTINGS: Settings = { theme: 'light', model: 'claude-sonnet-4-6', runSpeed: 'realtime' }

// One-time shape migrations for persisted flows (e.g. the schedule trigger's
// old raw-cron config key). parseSchedule accepts bare cron, so moving the
// value is all it takes.
function migrateFlows(flows: Flow[]): Flow[] {
  const walk = (steps: Step[]) => {
    for (const s of steps) {
      if (s.toolId === 'trigger.schedule' && s.config.cron && !s.config.schedule) {
        s.config.schedule = s.config.cron
        delete s.config.cron
      }
      for (const b of s.branches || []) walk(b.steps)
    }
  }
  for (const f of flows) walk(f.steps)
  return flows
}

export default function App() {
  const state = useEditor()
  const dispatch = useDispatch()
  const flow = active(state)

  const [view, setView] = useState<AppView>('flows')
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [run, setRun] = useState<RunState>(emptyRun)
  const [dragging, setDragging] = useState<DragPayload | null>(null)
  const [paletteAt, setPaletteAt] = useState<SlotPath | null>(null)
  const [drawer, setDrawer] = useState<'none' | 'runs' | 'vars'>('none')
  const [jsonOpen, setJsonOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  // Pinned payload: the last real trigger this flow received.
  const [lastTrigger, setLastTrigger] = useState<Record<string, unknown> | null>(null)
  useEffect(() => {
    setLastTrigger(null)
    if (flow?.id && view === 'editor') void fetchLastTrigger(flow.id).then(setLastTrigger)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow?.id, view])
  const [insertTarget, setInsertTarget] = useState<InsertTarget | null>(null)
  const [clipboard, setClipboardState] = useState<Step | null>(() => {
    try { return JSON.parse(localStorage.getItem('sr-step-clipboard') || 'null') } catch { return null }
  })
  const setClipboard = (s: Step | null) => {
    setClipboardState(s)
    if (s) localStorage.setItem('sr-step-clipboard', JSON.stringify(s))
    else localStorage.removeItem('sr-step-clipboard')
  }
  // Pending navigation destination when leaving a dirty editor
  const [pendingDest, setPendingDest] = useState<{ view: AppView; flowId?: string } | null>(null)
  const [stephanOpen, setStephanOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)

  // Projects: the tenant boundary. The active one persists per browser.
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string>(getActiveProjectId)
  const reloadProjects = useCallback(async () => {
    const list = await fetchProjects()
    if (list.length) setProjects(list)
    return list
  }, [])

  // Boot: settings + flows + projects.
  useEffect(() => {
    void (async () => {
      const [s, flows, projs] = await Promise.all([fetchSettings(), fetchFlows(), fetchProjects()])
      setSettings(prev => ({ ...prev, ...s }))
      if (flows.length) dispatch({ type: 'load', flows: migrateFlows(flows) })
      // Fresh install with nothing built yet: offer the tutorial unprompted.
      if (!flows.length && !tutorialState().completed) setTutorialOpen(true)
      if (projs.length) {
        setProjects(projs)
        // A stale localStorage id (project deleted elsewhere) falls back to Default.
        if (!projs.some(p => p.id === getActiveProjectId())) {
          setActiveProjectId('default')
          setProjectId('default')
        }
      }
    })()
  }, [dispatch])


  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  // Whitelabel: retint the accent tokens and retitle the tab live.
  useEffect(() => {
    const brand = settings.branding || {}
    const root = document.documentElement.style
    if (/^#[0-9a-fA-F]{6}$/.test(brand.accent || '')) {
      const hex = brand.accent as string
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
      root.setProperty('--accent', hex)
      root.setProperty('--accent-bg', hex)
      root.setProperty('--accent-hover', hex)
      root.setProperty('--accent-dim', `rgba(${r}, ${g}, ${b}, 0.14)`)
    } else {
      for (const p of ['--accent', '--accent-bg', '--accent-hover', '--accent-dim']) root.removeProperty(p)
    }
    document.title = brand.name?.trim() || 'steprail'
  }, [settings.branding])

  // Debounced autosave.
  const saveTimer = useRef<number>()
  useEffect(() => {
    if (!state.dirty) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      await saveFlows(state.flows)
      dispatch({ type: 'saved' })
    }, 600)
    return () => window.clearTimeout(saveTimer.current)
  }, [state.flows, state.dirty, dispatch])

  // Guard navigation — if the editor is dirty, intercept and show the unsaved dialog.
  const guardedNavigate = useCallback((dest: AppView, flowId?: string) => {
    if (view === 'editor' && state.dirty) {
      setPendingDest({ view: dest, flowId })
      return
    }
    if (flowId) {
      dispatch({ type: 'select', id: flowId })
      setRun(emptyRun)
      setDrawer('none')
    }
    setView(dest)
  }, [view, state.dirty, dispatch])

  const openFlow = useCallback((id: string) => {
    guardedNavigate('editor', id)
  }, [guardedNavigate])

  const switchProject = useCallback((id: string) => {
    setActiveProjectId(id)
    setProjectId(id)
    // The editor shows a flow of the previous project — leave it for Flows.
    if (view === 'editor') guardedNavigate('flows')
  }, [view, guardedNavigate])

  const confirmLeave = useCallback(async (save: boolean) => {
    if (!pendingDest) return
    if (save) {
      await saveFlows(state.flows)
      dispatch({ type: 'saved' })
    } else {
      // Mark clean so the autosave timer won't persist the discarded changes
      dispatch({ type: 'saved' })
    }
    if (pendingDest.flowId) {
      dispatch({ type: 'select', id: pendingDest.flowId })
      setRun(emptyRun)
      setDrawer('none')
    }
    setView(pendingDest.view)
    setPendingDest(null)
  }, [pendingDest, state.flows, dispatch])

  // Runs execute in the server's event queue; the client just watches.
  const [runId, setRunId] = useState<string | null>(null)
  const [formRun, setFormRun] = useState<Flow | null>(null)
  const pollRef = useRef<number>()
  const launchRun = useCallback((current: Flow, trigger?: Record<string, unknown>) => {
    setDrawer('runs')
    void (async () => {
      const id = await startRunApi(current, settings.runSpeed, trigger)
      if (!id) {
        setRun({
          ...emptyRun,
          entries: [{ stepId: '_server', name: 'Queue server', toolId: '', status: 'error', ms: 0, error: 'Could not reach the steprail server — is it running?' }],
        })
        return
      }
      setRunId(id)
      setRun({ ...emptyRun, running: true })
      window.clearInterval(pollRef.current)
      pollRef.current = window.setInterval(async () => {
        const snapshot = await fetchRun(id)
        if (!snapshot) return
        setRun(snapshot)
        if (!snapshot.running) window.clearInterval(pollRef.current)
      }, 350)
    })()
  }, [settings.runSpeed])

  const startRun = useCallback(() => {
    const current = active(state)
    if (!current || run.running) return
    // Form-trigger flows collect their answers first — the modal launches
    // the run on submit with the answers as the trigger payload.
    if (current.steps[0]?.toolId === 'trigger.form') {
      setFormRun(current)
      return
    }
    launchRun(current)
  }, [state, run.running, launchRun])
  useEffect(() => () => window.clearInterval(pollRef.current), [])

  // Load a specific run (past or externally triggered) onto the rail.
  const loadRun = useCallback(async (id: string) => {
    setRunId(id)
    const snapshot = await fetchRun(id)
    if (!snapshot) return
    setRun(snapshot)
    window.clearInterval(pollRef.current)
    if (snapshot.running) {
      pollRef.current = window.setInterval(async () => {
        const s = await fetchRun(id)
        if (!s) return
        setRun(s)
        if (!s.running) window.clearInterval(pollRef.current)
      }, 350)
    }
  }, [])

  // Global keys, editor only: '/' inserts, Cmd+Z undoes, Cmd+Enter runs.
  useEffect(() => {
    if (view !== 'editor') return
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)
      if (e.key === '/' && !typing && !paletteAt) {
        e.preventDefault()
        setPaletteAt({ hops: [], index: active(state)?.steps.length ?? 0 })
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !typing) {
        e.preventDefault()
        dispatch({ type: 'undo' })
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        startRun()
      }
      if (e.key === 'Escape' && !paletteAt) dispatch({ type: 'expand', id: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, state, paletteAt, dispatch, startRun])

  const changeSettings = (patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch }))

  const toggleTheme = () => {
    const theme = settings.theme === 'dark' ? 'light' : 'dark'
    changeSettings({ theme })
    void saveSettings({ theme })
  }

  const ui = useMemo(
    () => ({
      run,
      runId,
      // Step config pickers only offer the active project's connections.
      connections: (settings.connections || []).filter(c => (c.projectId || 'default') === projectId),
      dragging, setDragging, openPalette: setPaletteAt, insertTarget, setInsertTarget, clipboard, setClipboard, lastTrigger,
    }),
    [run, runId, settings.connections, projectId, dragging, insertTarget, clipboard, lastTrigger],
  )

  return (
    <UICtx.Provider value={ui}>
      <div className="app">
        <NavRail
          view={view}
          onNavigate={v => guardedNavigate(v)}
          settings={settings}
          onToggleTheme={toggleTheme}
          projects={projects.length ? projects : [{ id: 'default', name: 'Default', color: '#5e6ad2', createdAt: 0 }]}
          activeProjectId={projectId}
          onSwitchProject={switchProject}
          onProjectsChanged={() => void reloadProjects()}
          onOpenTutorial={() => setTutorialOpen(o => !o)}
        />
        <div className="main">
          {view === 'flows' && <FlowsHome onOpen={openFlow} projectId={projectId} />}
          {view === 'blueprints' && <BlueprintsHome onOpen={openFlow} />}
          {view === 'secrets' && <SecretsHome settings={settings} onChange={changeSettings} projectId={projectId} projects={projects} />}
          {view === 'reports' && <ReportsHome projectId={projectId} />}
          {view === 'config' && <ConfigHome settings={settings} onChange={changeSettings} projectId={projectId} projects={projects} />}
          {view === 'setup' && <SetupHome settings={settings} onChange={changeSettings} />}
          {view === 'editor' && (
            <div className="editor">
              <Palette />
              <div className="editor-main">
                <TopBar
                  onBack={() => guardedNavigate('flows')}
                  onRun={startRun}
                  onOpenRuns={() => setDrawer(d => (d === 'runs' ? 'none' : 'runs'))}
                  onOpenVars={() => setDrawer(d => (d === 'vars' ? 'none' : 'vars'))}
                  onOpenJson={() => setJsonOpen(true)}
                  onOpenHistory={() => setHistoryOpen(true)}
                />
                <div className="rail-scroll">
                  <div className="rail-wrap" style={drawer !== 'none' ? { marginRight: 348 } : undefined}>
                    {flow && flow.steps.length === 0 ? <EmptyState /> : flow ? <Rail steps={flow.steps} hops={[]} /> : null}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {formRun && (
        <RunFormDialog
          flowName={formRun.name}
          config={formRun.steps[0]?.config || {}}
          onSubmit={answers => {
            setFormRun(null)
            launchRun(formRun, answers)
          }}
          onClose={() => setFormRun(null)}
        />
      )}
      {view === 'editor' && paletteAt && <CommandPalette at={paletteAt} onClose={() => setPaletteAt(null)} />}
      {view === 'editor' && jsonOpen && flow && <FlowJsonDialog flow={flow} onClose={() => setJsonOpen(false)} />}
      {view === 'editor' && historyOpen && flow && <VersionsDialog flow={flow} onClose={() => setHistoryOpen(false)} />}
      {view === 'editor' && drawer === 'runs' && flow && <RunDrawer flowId={flow.id} loadRun={loadRun} onClose={() => setDrawer('none')} />}
      {view === 'editor' && drawer === 'vars' && <VarsDrawer onClose={() => setDrawer('none')} />}
      {/* StepHan floating action button — visible on every page */}
      <button className="stephan-fab" onClick={() => setStephanOpen(true)} title="StepHan — describe a job, get a flow">
        <StepHanLogo size={20} />
        <span>StepHan</span>
        {view === 'editor' && flow && <span className="stephan-fab-ctx">{flow.name}</span>}
      </button>
      {stephanOpen && <StepHanDialog onOpen={openFlow} onClose={() => setStephanOpen(false)} />}
      {tutorialOpen && (
        <Tutorial
          view={view}
          run={run}
          startRun={startRun}
          onOpenFlow={openFlow}
          onClose={() => setTutorialOpen(false)}
        />
      )}

      <ToastContainer />
      {pendingDest && flow && (
        <UnsavedDialog
          flowName={flow.name}
          onSave={() => void confirmLeave(true)}
          onLeave={() => void confirmLeave(false)}
          onStay={() => setPendingDest(null)}
        />
      )}
    </UICtx.Provider>
  )
}
