// MIT License - Copyright (c) fintonlabs.com
// The editor's top bar: back to Flows, the flow's identity (name, live
// state), and run-adjacent actions only. Navigation lives in the nav rail.
import { ArrowLeft, Activity, BookmarkPlus, BookText, Braces, History, Play, Power, Undo2, Variable } from 'lucide-react'
import { active, useDispatch, useEditor } from '../state'
import { saveFlowAsBlueprint } from '../api'
import { showToast } from '../toast'
import { useUI } from '../ui'

interface Props {
  onBack: () => void
  onRun: () => void
  onOpenRuns: () => void
  onOpenVars: () => void
  onOpenJson: () => void
  onOpenDocs: () => void
  onOpenHistory: () => void
}

export function TopBar({ onBack, onRun, onOpenRuns, onOpenVars, onOpenJson, onOpenDocs, onOpenHistory }: Props) {
  const state = useEditor()
  const dispatch = useDispatch()
  const { run } = useUI()
  const flow = active(state)

  const saveAsBlueprint = async () => {
    if (!flow || !flow.steps.length) return
    await saveFlowAsBlueprint(flow)
    showToast(`Saved “${flow.name}” to Blueprints`)
  }

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
      <button className="btn icon" title="Documentation — diagram + Markdown write-up" onClick={onOpenDocs} data-tut="docs">
        <BookText size={18} />
      </button>
      <button className="btn icon" title="Save as a reusable blueprint" onClick={() => void saveAsBlueprint()} disabled={!flow || flow.steps.length === 0}>
        <BookmarkPlus size={18} />
      </button>
      <button className="btn icon" title="History — restore an earlier version of this flow" onClick={onOpenHistory}>
        <History size={18} />
      </button>
      <button className="btn" title="Runs and traces" onClick={onOpenRuns} data-tut="runs">
        <Activity size={16} /> Runs
      </button>
      <button className="btn primary" onClick={onRun} disabled={run.running || !flow || flow.steps.length === 0} title="Run (Cmd+Enter)" data-tut="run">
        <Play size={17} />
        {run.running ? 'Running…' : 'Run'}
      </button>
    </header>
  )
}
