// MIT License - Copyright (c) fintonlabs.com
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Flow, RunState, Settings, SlotPath, Step } from './types'
import { active, useDispatch, useEditor } from './state'
import { emptyRun } from './engine'
import { fetchFlows, fetchRun, fetchSettings, saveFlows, saveSettings, startRun as startRunApi } from './api'
import { BUILTIN_BLUEPRINTS, flowFromBlueprint } from './blueprints'
import { UICtx, type DragPayload, type InsertTarget } from './ui'
import { TopBar } from './components/TopBar'
import { Palette } from './components/Palette'
import { Rail } from './components/Rail'
import { EmptyState } from './components/EmptyState'
import { CommandPalette } from './components/CommandPalette'
import { RunDrawer } from './components/RunDrawer'
import { SettingsDrawer } from './components/SettingsDrawer'
import { FlowJsonDialog } from './components/FlowJsonDialog'
import { VarsDrawer } from './components/VarsDrawer'
import { BlueprintsDialog } from './components/BlueprintsDialog'

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

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [run, setRun] = useState<RunState>(emptyRun)
  const [dragging, setDragging] = useState<DragPayload | null>(null)
  const [paletteAt, setPaletteAt] = useState<SlotPath | null>(null)
  const [drawer, setDrawer] = useState<'none' | 'runs' | 'settings' | 'vars'>('none')
  const [jsonOpen, setJsonOpen] = useState(false)
  const [blueprintsOpen, setBlueprintsOpen] = useState(false)
  const [insertTarget, setInsertTarget] = useState<InsertTarget | null>(null)

  // Boot: settings + flows; seed a demo flow on first ever launch.
  useEffect(() => {
    void (async () => {
      const [s, flows] = await Promise.all([fetchSettings(), fetchFlows()])
      setSettings(prev => ({ ...prev, ...s }))
      if (flows.length) dispatch({ type: 'load', flows: migrateFlows(flows) })
      else dispatch({ type: 'load', flows: [flowFromBlueprint(BUILTIN_BLUEPRINTS[0])] })
    })()
  }, [dispatch])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

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

  // Runs execute in the server's event queue; the client just watches.
  const [runId, setRunId] = useState<string | null>(null)
  const pollRef = useRef<number>()
  const startRun = useCallback(() => {
    const current = active(state)
    if (!current || run.running) return
    setDrawer('runs')
    void (async () => {
      const id = await startRunApi(current, settings.runSpeed)
      if (!id) {
        setRun({
          ...emptyRun,
          entries: [{ stepId: '_server', name: 'Queue server', toolId: '', status: 'error', ms: 0, error: 'Could not reach the newflow server — is it running?' }],
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
  }, [state, run.running, settings.runSpeed])
  useEffect(() => () => window.clearInterval(pollRef.current), [])

  // Global keys: '/' inserts at the end, Cmd+Z undoes, Cmd+Enter runs.
  useEffect(() => {
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
  }, [state, paletteAt, dispatch, startRun])

  const changeSettings = (patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch }))

  const toggleTheme = () => {
    const theme = settings.theme === 'dark' ? 'light' : 'dark'
    changeSettings({ theme })
    void saveSettings({ theme })
  }

  const ui = useMemo(
    () => ({ run, runId, dragging, setDragging, openPalette: setPaletteAt, insertTarget, setInsertTarget }),
    [run, runId, dragging, insertTarget],
  )

  return (
    <UICtx.Provider value={ui}>
      <div className="app">
        <Palette />
        <div className="main">
          <TopBar
            settings={settings}
            onToggleTheme={toggleTheme}
            onRun={startRun}
            onOpenRuns={() => setDrawer(d => (d === 'runs' ? 'none' : 'runs'))}
            onOpenSettings={() => setDrawer(d => (d === 'settings' ? 'none' : 'settings'))}
            onOpenJson={() => setJsonOpen(true)}
            onOpenVars={() => setDrawer(d => (d === 'vars' ? 'none' : 'vars'))}
            onOpenBlueprints={() => setBlueprintsOpen(true)}
          />
          <div className="rail-scroll">
            <div className="rail-wrap" style={drawer !== 'none' ? { marginRight: 348 } : undefined}>
              {flow && flow.steps.length === 0 ? <EmptyState /> : flow ? <Rail steps={flow.steps} hops={[]} /> : null}
            </div>
          </div>
        </div>
      </div>
      {paletteAt && <CommandPalette at={paletteAt} onClose={() => setPaletteAt(null)} />}
      {jsonOpen && flow && <FlowJsonDialog flow={flow} onClose={() => setJsonOpen(false)} />}
      {blueprintsOpen && <BlueprintsDialog flow={flow} onClose={() => setBlueprintsOpen(false)} />}
      {drawer === 'runs' && <RunDrawer onClose={() => setDrawer('none')} />}
      {drawer === 'settings' && <SettingsDrawer settings={settings} onChange={changeSettings} onClose={() => setDrawer('none')} />}
      {drawer === 'vars' && <VarsDrawer onClose={() => setDrawer('none')} />}
    </UICtx.Provider>
  )
}
