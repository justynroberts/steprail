// MIT License - Copyright (c) fintonlabs.com
// StepHan — steprail's assistant. Describe the job in a sentence; StepHan
// drafts the whole flow (Anthropic when a key is connected, keyword planner
// otherwise) and drops you into the editor with it.
import { useEffect, useState } from 'react'
import { ArrowRight, Loader2, Sparkles, X } from 'lucide-react'
import { makeStep, useDispatch } from '../state'
import { composeRemote } from '../api'
import { localPlan } from '../engine'
import { hydrateFlow } from '../flowjson'
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

export function StepHanDialog({ onOpen, onClose }: { onOpen: (id: string) => void; onClose: () => void }) {
  const dispatch = useDispatch()
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [phase, setPhase] = useState(0)

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
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{busy ? 'drafting…' : 'describe the job, get a flow'}</span>
          <button className="btn icon" onClick={onClose}><X size={14} /></button>
        </div>
        {busy && <div className="stephan-progress" aria-hidden />}
        <div className="json-body">
          <div className="compose-bar" style={{ margin: 0 }}>
            <Sparkles size={16} />
            <input
              autoFocus
              placeholder="What should we automate?"
              value={brief}
              onChange={e => setBrief(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void go()}
            />
            <button className="btn icon primary" onClick={() => void go()} disabled={busy || !brief.trim()} title="Draft the flow">
              {busy ? <Loader2 size={14} className="spin" /> : <ArrowRight size={14} />}
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
                <div className="stephan-working-title">StepHan is drafting your flow</div>
                <div className="stephan-working-phase">{STEPHAN_PHASES[phase]}</div>
              </div>
            </div>
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
