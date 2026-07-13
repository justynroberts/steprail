// MIT License - Copyright (c) fintonlabs.com
// The editor's top bar: back to Flows, the flow's identity (name, live
// state), and run-adjacent actions only. Navigation lives in the nav rail.
import { ArrowLeft, Activity, Braces, Play, Power, Undo2, Variable } from 'lucide-react'
import { active, useDispatch, useEditor } from '../state'
import { useUI } from '../ui'

interface Props {
  onBack: () => void
  onRun: () => void
  onOpenRuns: () => void
  onOpenVars: () => void
  onOpenJson: () => void
}

export function TopBar({ onBack, onRun, onOpenRuns, onOpenVars, onOpenJson }: Props) {
  const state = useEditor()
  const dispatch = useDispatch()
  const { run } = useUI()
  const flow = active(state)

  return (
    <header className="topbar">
      <button className="btn icon" title="All flows" onClick={onBack}>
        <ArrowLeft size={18} />
      </button>

      {flow && (
        <input
          className="flow-name"
          value={flow.name}
          onChange={e => dispatch({ type: 'rename', name: e.target.value })}
          size={Math.max(flow.name.length, 6)}
        />
      )}

      {flow && (
        <button
          className={`btn icon live-toggle${flow.active === false ? '' : ' on'}`}
          title={flow.active === false ? 'Triggers off — schedules, webhooks and forms will not fire' : 'Live — triggers fire for this flow'}
          onClick={() => dispatch({ type: 'toggle-active' })}
        >
          <Power size={15} />
          <span>{flow.active === false ? 'Off' : 'Live'}</span>
        </button>
      )}

      <span className="spacer" />
      <span className="saved-hint">{state.dirty ? 'saving…' : 'saved'}</span>
      <button className="btn icon" title="Undo (Cmd+Z)" onClick={() => dispatch({ type: 'undo' })}>
        <Undo2 size={18} />
      </button>
      <button className="btn icon" title="Variables (system, custom, step data)" onClick={onOpenVars}>
        <Variable size={18} />
      </button>
      <button className="btn icon" title="Flow as JSON (export, import, LLM prompt)" onClick={onOpenJson}>
        <Braces size={18} />
      </button>
      <button className="btn" title="Runs and traces" onClick={onOpenRuns}>
        <Activity size={16} /> Runs
      </button>
      <button className="btn primary" onClick={onRun} disabled={run.running || !flow || flow.steps.length === 0} title="Run (Cmd+Enter)">
        <Play size={17} />
        {run.running ? 'Running…' : 'Run'}
      </button>
    </header>
  )
}
