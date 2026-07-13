// MIT License - Copyright (c) fintonlabs.com
// A flow with no steps: describe it in a sentence, pick a template, or start
// dragging — three on-ramps, zero blank-canvas paralysis.
import { useState } from 'react'
import { ArrowRight, LayoutTemplate, Loader2, Sparkles } from 'lucide-react'
import { useDispatch } from '../state'
import { composeRemote } from '../api'
import { localPlan } from '../engine'
import { hydrateFlow } from '../flowjson'
import { BUILTIN_BLUEPRINTS } from '../blueprints'

export function EmptyState() {
  const dispatch = useDispatch()
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])

  const compose = async () => {
    if (!brief.trim() || busy) return
    setBusy(true)
    // Remote: the LLM authors a whole portable flow (names, configs, branches).
    // Fallback: the local keyword planner produces a bare tool list.
    const portable = (await composeRemote(brief)) ?? { name: brief.slice(0, 48), steps: localPlan(brief).map(tool => ({ tool })) }
    setBusy(false)
    const { name, steps, vars, tags, warnings: warns } = hydrateFlow(portable)
    setWarnings(warns)
    if (!steps.length) return
    dispatch({ type: 'load-steps', steps })
    dispatch({ type: 'rename', name })
    dispatch({ type: 'set-vars', vars })
    dispatch({ type: 'set-tags', tags })
  }

  return (
    <div className="compose-hero">
      <h1>What should this flow do?</h1>
      <p>Describe it, start from a template, or drag a trigger in from the left.</p>
      <div className="compose-bar">
        <Sparkles size={16} />
        <input
          placeholder="e.g. when a PR merges, run terraform, summarize the changes and post to Slack"
          value={brief}
          onChange={e => setBrief(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && compose()}
        />
        <button className="btn icon primary" onClick={compose} disabled={busy || !brief.trim()} title="Compose flow">
          {busy ? <Loader2 size={14} className="spin" /> : <ArrowRight size={14} />}
        </button>
      </div>
      {warnings.length > 0 && (
        <div className="compose-warnings">
          {warnings.map(w => <div key={w}>{w}</div>)}
        </div>
      )}
      <div className="compose-or">or start from a blueprint</div>
      <div className="template-grid">
        {BUILTIN_BLUEPRINTS.map(bp => (
          <button
            key={bp.id}
            className="template-card"
            onClick={() => {
              const { name, steps, vars, tags } = hydrateFlow(bp.flow)
              dispatch({ type: 'load-steps', steps })
              dispatch({ type: 'rename', name })
              dispatch({ type: 'set-vars', vars })
              dispatch({ type: 'set-tags', tags: tags.length ? tags : bp.tags || [] })
            }}
          >
            <span className="t-name"><LayoutTemplate size={14} style={{ color: 'var(--accent)' }} />{bp.name}</span>
            <span className="t-desc">{bp.description}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
