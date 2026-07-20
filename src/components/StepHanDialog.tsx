// MIT License - Copyright (c) fintonlabs.com
// StepHan — steprail's assistant. Describe the job in a sentence; StepHan
// drafts the whole flow (Anthropic when a key is connected, keyword planner
// otherwise) and drops you into the editor with it.
import { useEffect, useState } from 'react'
import { CornerDownLeft, Loader2, Sparkles, X } from 'lucide-react'
import type { Flow } from '../types'
import { makeStep, useDispatch } from '../state'
import { composeRemote, composeRemoteEdit } from '../api'
import { localPlan } from '../engine'
import { hydrateFlow, serializeFlow } from '../flowjson'
import { makeFlow } from '../blueprints'

const STEPHAN_PHASES = [
  'Reading your brief…',
  'Choosing the trigger…',
  'Wiring the steps…',
  'Filling in config…',
  'Writing the documentation…',
]

const STARTERS = [
  'When a webhook arrives, post its payload to Slack',
  'Every weekday at 8am, summarize new orders from the database and email me',
  'Expose an order-lookup tool that AI agents can call',
  'Host a contact form and send each submission to Slack with an email receipt',
  'Poll an API every 30 seconds until the job is done, then announce it',
  'When a PR merges, run terraform plan, wait for my approval, then apply',
]

const EDIT_STARTERS = [
  'Add a Slack alert if any step fails',
  'Add a human approval step before the last action',
  'Send an email as well as the Slack message',
  'Add a branch: page on-call if severity is high, else just log it',
]

export function StepHanDialog({ editingFlow, onOpen, onClose }: { editingFlow?: Flow | null; onOpen: (id: string) => void; onClose: () => void }) {
  const dispatch = useDispatch()
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [phase, setPhase] = useState(0)
  // 'edit' modifies the open flow in place; only offered when one is open.
  const canEdit = !!(editingFlow && editingFlow.steps.length)
  const [mode, setMode] = useState<'new' | 'edit'>('new')
  const editing = canEdit && mode === 'edit'

  // While drafting, cycle a status line so it's clear StepHan is actively
  // working (a one-shot LLM call gives no real progress — this is a heartbeat).
  useEffect(() => {
    if (!busy) { setPhase(0); return }
    const t = window.setInterval(() => setPhase(p => (p + 1) % STEPHAN_PHASES.length), 1500)
    return () => window.clearInterval(t)
  }, [busy])

  const go = async (text?: string) => {
    const ask = (text ?? brief).trim()
    if (!ask || busy) return
    setBusy(true)
    setWarnings([])

    // ---- Edit the open flow in place ----
    if (editing && editingFlow) {
      const portable = await composeRemoteEdit(ask, serializeFlow(editingFlow))
      setBusy(false)
      if (!portable) {
        setWarnings(['StepHan needs an Anthropic connection to modify a flow — add one in Config.'])
        return
      }
      const { name, steps, vars, tags, docs, warnings: warns } = hydrateFlow(portable)
      if (!steps.length) {
        setWarnings(warns.length ? warns : ['StepHan could not apply that change — try describing it differently.'])
        return
      }
      if (!steps[0].toolId.startsWith('trigger.')) steps.unshift(makeStep('trigger.webhook'))
      // Apply onto the open flow — undo history is preserved, so a bad edit is one Cmd+Z away.
      dispatch({ type: 'load-steps', steps })
      dispatch({ type: 'rename', name })
      dispatch({ type: 'set-vars', vars })
      dispatch({ type: 'set-tags', tags })
      if (docs) dispatch({ type: 'set-docs', docs })
      onClose()
      return
    }

    // ---- Draft a brand-new flow ----
    const portable = (await composeRemote(ask)) ?? { name: ask.slice(0, 48), steps: localPlan(ask).map(tool => ({ tool })) }
    const { name, steps, vars, tags, docs, warnings: warns } = hydrateFlow(portable)
    setBusy(false)
    if (!steps.length) {
      setWarnings(warns.length ? warns : ['StepHan could not sketch that one — try describing the trigger and the outcome.'])
      return
    }
    // Guarantee a trigger: every StepHan flow starts on a trigger step, even if
    // the model returned an action-only draft. A missing trigger becomes a
    // webhook the user can re-point.
    if (!steps[0].toolId.startsWith('trigger.')) steps.unshift(makeStep('trigger.webhook'))
    const flow = makeFlow(name, steps, vars, tags.length ? tags : ['stephan'], docs)
    dispatch({ type: 'create', flow })
    onClose()
    onOpen(flow.id)
  }

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`cmdk stephan${busy ? ' working' : ''}`}>
        <div className="cmdk-input">
          <span className={`stephan-face${busy ? ' pulse' : ''}`}><Sparkles size={15} /></span>
          <span style={{ flex: 1, fontWeight: 590, fontSize: 14 }}>StepHan</span>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{busy ? (editing ? 'updating…' : 'drafting…') : editing ? 'describe a change' : 'describe the job, get a flow'}</span>
          <button className="btn icon" onClick={onClose}><X size={14} /></button>
        </div>
        {busy && <div className="stephan-progress" aria-hidden />}
        <div className="json-body">
          {canEdit && !busy && (
            <div className="stephan-mode">
              <button className={`stephan-mode-tab${mode === 'new' ? ' on' : ''}`} onClick={() => setMode('new')}>New flow</button>
              <button className={`stephan-mode-tab${mode === 'edit' ? ' on' : ''}`} onClick={() => setMode('edit')}>
                Modify “{editingFlow!.name}”
              </button>
            </div>
          )}
          <div className="compose-bar" style={{ margin: 0 }}>
            <Sparkles size={16} />
            <input
              autoFocus
              placeholder={editing ? 'What should I change?' : 'What should we automate?'}
              value={brief}
              onChange={e => setBrief(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void go()}
            />
            <button className="btn icon primary" onClick={() => void go()} disabled={busy || !brief.trim()} title={editing ? 'Apply the change (Enter)' : 'Draft the flow (Enter)'}>
              {busy ? <Loader2 size={16} className="spin" /> : <CornerDownLeft size={16} />}
            </button>
          </div>
          {warnings.length > 0 && (
            <div className="compose-warnings" style={{ margin: 0 }}>
              {warnings.map(w => <div key={w}>{w}</div>)}
            </div>
          )}
          {busy ? (
            <div className="stephan-working">
              <Loader2 size={16} className="spin" />
              <div>
                <div className="stephan-working-title">{editing ? 'StepHan is updating your flow' : 'StepHan is drafting your flow'}</div>
                <div className="stephan-working-phase">{STEPHAN_PHASES[phase]}</div>
              </div>
            </div>
          ) : editing ? (
            <>
              <div className="settings-note">Or try one of these changes:</div>
              <div className="stephan-starters">
                {EDIT_STARTERS.map(s => (
                  <button key={s} className="stephan-starter" onClick={() => { setBrief(s); void go(s) }}>
                    {s}
                  </button>
                ))}
              </div>
              <div className="settings-note">
                StepHan rewrites the open flow to match — keeping everything you didn't ask to change. The result replaces the current steps, and <strong>Undo (⌘Z)</strong> reverts it. Needs an Anthropic connection.
              </div>
            </>
          ) : (
            <>
              <div className="settings-note">Or start from one of these:</div>
              <div className="stephan-starters">
                {STARTERS.map(s => (
                  <button key={s} className="stephan-starter" onClick={() => { setBrief(s); void go(s) }}>
                    {s}
                  </button>
                ))}
              </div>
              <div className="settings-note">
                StepHan drafts a complete flow — a trigger, the actions between, and sensible config on every step — then drops you into the editor to review and Run. Add an Anthropic connection in Config to author with the full model.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
