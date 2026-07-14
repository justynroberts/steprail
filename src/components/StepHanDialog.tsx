// MIT License - Copyright (c) fintonlabs.com
// StepHan — steprail's assistant. Describe the job in a sentence; StepHan
// drafts the whole flow (Anthropic when a key is connected, keyword planner
// otherwise) and drops you into the editor with it.
import { useState } from 'react'
import { ArrowRight, Loader2, Sparkles, X } from 'lucide-react'
import { useDispatch } from '../state'
import { composeRemote } from '../api'
import { localPlan } from '../engine'
import { hydrateFlow } from '../flowjson'
import { makeFlow } from '../blueprints'

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

  const go = async (text?: string) => {
    const ask = (text ?? brief).trim()
    if (!ask || busy) return
    setBusy(true)
    setWarnings([])
    const portable = (await composeRemote(ask)) ?? { name: ask.slice(0, 48), steps: localPlan(ask).map(tool => ({ tool })) }
    const { name, steps, vars, tags, warnings: warns } = hydrateFlow(portable)
    setBusy(false)
    if (!steps.length) {
      setWarnings(warns.length ? warns : ['StepHan could not sketch that one — try describing the trigger and the outcome.'])
      return
    }
    const flow = makeFlow(name, steps, vars, tags.length ? tags : ['stephan'])
    dispatch({ type: 'create', flow })
    onClose()
    onOpen(flow.id)
  }

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmdk stephan">
        <div className="cmdk-input">
          <span className="stephan-face"><Sparkles size={15} /></span>
          <span style={{ flex: 1, fontWeight: 590, fontSize: 14 }}>StepHan</span>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>describe the job, get a flow</span>
          <button className="btn icon" onClick={onClose}><X size={14} /></button>
        </div>
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
          <div className="settings-note">Or start from one of these:</div>
          <div className="stephan-starters">
            {STARTERS.map(s => (
              <button key={s} className="stephan-starter" disabled={busy} onClick={() => { setBrief(s); void go(s) }}>
                {s}
              </button>
            ))}
          </div>
          <div className="settings-note">
            StepHan drafts every step with sensible config — you review and press Run. With an Anthropic connection in Config he gets much smarter.
          </div>
        </div>
      </div>
    </div>
  )
}
