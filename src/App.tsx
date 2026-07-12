// MIT License - Copyright (c) fintonlabs.com
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RunState, Settings, SlotPath } from './types'
import { active, useDispatch, useEditor } from './state'
import { emptyRun, runFlow } from './engine'
import { fetchFlows, fetchSettings, saveFlows, saveSettings } from './api'
import { makeFlow, TEMPLATES } from './templates'
import { UICtx, type DragPayload } from './ui'
import { TopBar } from './components/TopBar'
import { Palette } from './components/Palette'
import { Rail } from './components/Rail'
import { EmptyState } from './components/EmptyState'
import { CommandPalette } from './components/CommandPalette'
import { RunDrawer } from './components/RunDrawer'
import { SettingsDrawer } from './components/SettingsDrawer'
import { FlowJsonDialog } from './components/FlowJsonDialog'

const DEFAULT_SETTINGS: Settings = { theme: 'light', model: 'claude-sonnet-4-6', runSpeed: 'realtime' }

export default function App() {
  const state = useEditor()
  const dispatch = useDispatch()
  const flow = active(state)

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [run, setRun] = useState<RunState>(emptyRun)
  const [dragging, setDragging] = useState<DragPayload | null>(null)
  const [paletteAt, setPaletteAt] = useState<SlotPath | null>(null)
  const [drawer, setDrawer] = useState<'none' | 'runs' | 'settings'>('none')
  const [jsonOpen, setJsonOpen] = useState(false)

  // Boot: settings + flows; seed a demo flow on first ever launch.
  useEffect(() => {
    void (async () => {
      const [s, flows] = await Promise.all([fetchSettings(), fetchFlows()])
      setSettings(prev => ({ ...prev, ...s }))
      if (flows.length) dispatch({ type: 'load', flows })
      else dispatch({ type: 'load', flows: [makeFlow('Deploy on merge', TEMPLATES[0].build())] })
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

  const startRun = useCallback(() => {
    const current = active(state)
    if (!current || run.running) return
    setDrawer('runs')
    void runFlow(current, settings.runSpeed, { onUpdate: setRun })
  }, [state, run.running, settings.runSpeed])

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
    () => ({ run, dragging, setDragging, openPalette: setPaletteAt }),
    [run, dragging],
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
      {drawer === 'runs' && <RunDrawer onClose={() => setDrawer('none')} />}
      {drawer === 'settings' && <SettingsDrawer settings={settings} onChange={changeSettings} onClose={() => setDrawer('none')} />}
    </UICtx.Provider>
  )
}
