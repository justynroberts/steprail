// MIT License - Copyright (c) fintonlabs.com
// A flow with no steps: describe it in a sentence, pick a template, or start
// dragging — three on-ramps, zero blank-canvas paralysis.
import { useState } from 'react'
import { ArrowRight, LayoutTemplate, Loader2, Sparkles } from 'lucide-react'
import { useDispatch } from '../state'
import { composeRemote } from '../api'
import { localPlan } from '../engine'
import { toolById } from '../tools'
import { TEMPLATES } from '../templates'

export function EmptyState() {
  const dispatch = useDispatch()
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)

  const compose = async () => {
    if (!brief.trim() || busy) return
    setBusy(true)
    // Remote plan (Anthropic key configured in Settings) with local fallback.
    const toolIds = (await composeRemote(brief)) ?? localPlan(brief)
    setBusy(false)
    toolIds.filter(id => toolById(id)).forEach((id, i) => {
      dispatch({ type: 'insert', toolId: id, at: { hops: [], index: i } })
    })
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
      <div className="compose-or">or start from a template</div>
      <div className="template-grid">
        {TEMPLATES.map(t => (
          <button
            key={t.id}
            className="template-card"
            onClick={() => dispatch({ type: 'load-steps', steps: t.build() })}
          >
            <span className="t-name"><LayoutTemplate size={14} style={{ color: 'var(--accent)' }} />{t.name}</span>
            <span className="t-desc">{t.description}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
