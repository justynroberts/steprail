// MIT License - Copyright (c) fintonlabs.com
import { useEffect, useRef, useState } from 'react'
import {
  Activity, Braces, ChevronDown, LayoutTemplate, Moon, Play, Plus, Settings2, Sun, Trash2, Undo2, Variable, Workflow,
} from 'lucide-react'
import type { Settings } from '../types'
import { active, useDispatch, useEditor } from '../state'
import { makeFlow } from '../blueprints'
import { useUI } from '../ui'

interface Props {
  settings: Settings
  onToggleTheme: () => void
  onRun: () => void
  onOpenRuns: () => void
  onOpenSettings: () => void
  onOpenJson: () => void
  onOpenVars: () => void
  onOpenBlueprints: () => void
}

export function TopBar({ settings, onToggleTheme, onRun, onOpenRuns, onOpenSettings, onOpenJson, onOpenVars, onOpenBlueprints }: Props) {
  const state = useEditor()
  const dispatch = useDispatch()
  const { run } = useUI()
  const flow = active(state)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  return (
    <header className="topbar">
      <div className="switcher" ref={menuRef}>
        <button className="btn icon" title="Flows" onClick={() => setMenuOpen(o => !o)}>
          <Workflow size={16} />
          <ChevronDown size={13} />
        </button>
        {menuOpen && (
          <div className="menu">
            {state.flows.map(f => (
              <button key={f.id} className="menu-item" onClick={() => { dispatch({ type: 'select', id: f.id }); setMenuOpen(false) }}>
                <span style={{ fontWeight: f.id === state.activeId ? 590 : 400 }}>{f.name}</span>
                <span
                  className="del"
                  title="Delete flow"
                  onClick={e => { e.stopPropagation(); dispatch({ type: 'delete-flow', id: f.id }) }}
                >
                  <Trash2 size={12} />
                </span>
              </button>
            ))}
            {state.flows.length > 0 && <div className="menu-sep" />}
            <button
              className="menu-item"
              onClick={() => { dispatch({ type: 'create', flow: makeFlow('Untitled flow') }); setMenuOpen(false) }}
            >
              <Plus size={13} /> New flow
            </button>
          </div>
        )}
      </div>

      {flow && (
        <input
          className="flow-name"
          value={flow.name}
          onChange={e => dispatch({ type: 'rename', name: e.target.value })}
          size={Math.max(flow.name.length, 6)}
        />
      )}

      <span className="spacer" />
      <span className="saved-hint">{state.dirty ? 'saving…' : 'saved'}</span>
      <button className="btn icon" title="Undo (Cmd+Z)" onClick={() => dispatch({ type: 'undo' })}>
        <Undo2 size={16} />
      </button>
      <button className="btn icon" title="Blueprints" onClick={onOpenBlueprints}>
        <LayoutTemplate size={16} />
      </button>
      <button className="btn icon" title="Variables (system and custom)" onClick={onOpenVars}>
        <Variable size={16} />
      </button>
      <button className="btn icon" title="Flow as JSON (export, import, LLM prompt)" onClick={onOpenJson}>
        <Braces size={16} />
      </button>
      <button className="btn icon" title="Toggle theme" onClick={onToggleTheme}>
        {settings.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <button className="btn icon" title="Run history" onClick={onOpenRuns}>
        <Activity size={16} />
      </button>
      <button className="btn icon" title="Settings" onClick={onOpenSettings}>
        <Settings2 size={16} />
      </button>
      <button className="btn primary" onClick={onRun} disabled={run.running || !flow || flow.steps.length === 0} title="Run (Cmd+Enter)">
        <Play size={15} />
        {run.running ? 'Running…' : 'Run'}
      </button>
    </header>
  )
}
