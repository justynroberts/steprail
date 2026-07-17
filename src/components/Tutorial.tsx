// MIT License - Copyright (c) fintonlabs.com
// Interactive onboarding, two tracks. Basics: eight short steps ending in a
// real, working flow (the server checks its own health). Advanced: complex
// transforms, loop iteration, and branch routing — a batch processor that
// fans out per item and routes each one by priority. Both panels watch
// editor and run state to tick steps off as the user actually does them;
// every action step has a "Do it for me" so nobody gets stuck. Re-runnable
// any time from Learn in the nav rail.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowLeft, ArrowRight, Check, ChevronLeft, GraduationCap, Play, RotateCcw, Wand2, X,
} from 'lucide-react'
import type { RunState, Step } from '../types'
import { active, makeStep, uid, useDispatch, useEditor } from '../state'
import { makeFlow } from '../blueprints'
import type { AppView } from './NavRail'

const TUT_KEY = 'sr-tutorial'

type Track = 'basics' | 'advanced'

interface TutState {
  track?: Track | null
  step?: number
  steps?: Partial<Record<Track, number>>
  completed?: boolean | Partial<Record<Track, boolean>>
}

export function tutorialState(): TutState {
  try {
    const raw = JSON.parse(localStorage.getItem(TUT_KEY) || '{}') as TutState
    // Pre-tracks shape: {step, completed: boolean} was the basics track.
    if (typeof raw.completed === 'boolean') {
      return { track: null, steps: { basics: raw.step || 0 }, completed: { basics: raw.completed } }
    }
    return raw
  } catch {
    return {}
  }
}
const saveTutorial = (patch: Partial<TutState>) =>
  localStorage.setItem(TUT_KEY, JSON.stringify({ ...tutorialState(), ...patch }))

export const tutorialCompleted = (track: Track): boolean => {
  const c = tutorialState().completed
  return typeof c === 'object' && !!c?.[track]
}

// ---- Basics: the server checks its own health -----------------------------
const BASICS_FLOW = 'Tutorial: Health check'
const HEALTH_URL = 'http://localhost:8452/api/health'
const HEALTH_TRANSFORM = `const health = input.response
return {
  message: 'Server ' + health.status + ' for ' + Math.round(health.uptime / 60) + ' minutes',
  version: health.version,
}`

// ---- Advanced: batch processor (form → transform → loop → routed branch) --
const ADV_FLOW = 'Tutorial: Advanced patterns'
const ADV_FORM_FIELDS = JSON.stringify([
  { key: 'count', label: 'How many jobs', type: 'number', required: true },
  { key: 'prefix', label: 'Job name prefix', type: 'text' },
])
const ITEMS_CODE = `// input is the trigger payload: form answers when the hosted
// form fired this run, or a manual-run note when you press Run —
// so default everything. Transforms run real JavaScript.
const count = Math.min(Number(input.count) || 3, 6)
const prefix = input.prefix || 'job'
return {
  items: Array.from({ length: count }, (_, i) => ({
    name: prefix + '-' + (i + 1),
    priority: i % 3 === 0 ? 'critical' : 'routine',
  })),
}`
const ESCALATE_CODE = `return { message: 'ESCALATED {{item.name}} — item {{loop.index}} of {{loop.count}}' }`
const ROUTINE_CODE = `return { message: 'logged {{item.name}} as routine' }`

interface TutStep {
  id: string
  title: string
  body: ReactNode
  done: boolean
  action?: { label: string; run: () => void }
  highlight?: string
}

interface Props {
  view: AppView
  run: RunState
  startRun: () => void
  onOpenFlow: (id: string) => void
  onClose: () => void
}

export function Tutorial({ view, run, startRun, onOpenFlow, onClose }: Props) {
  const state = useEditor()
  const dispatch = useDispatch()
  const [track, setTrackState] = useState<Track | null>(() => tutorialState().track ?? null)
  const [idx, setIdx] = useState(() => (track ? tutorialState().steps?.[track] || 0 : 0))

  const setTrack = (t: Track | null) => {
    setTrackState(t)
    setIdx(t ? tutorialState().steps?.[t] || 0 : 0)
    saveTutorial({ track: t })
  }

  useEffect(() => {
    if (track) saveTutorial({ steps: { ...tutorialState().steps, [track]: idx } })
  }, [idx, track])

  const flow = active(state)
  const inEditor = view === 'editor' && !!flow

  // Basics detection
  const httpStep = flow?.steps.find(s => s.toolId === 'data.http')
  const transformStep = flow?.steps.find(s => s.toolId === 'data.transform')
  const urlSet = Boolean(httpStep?.config.url?.includes('/api/health'))
  const basicsRunOk = !run.running && run.entries.length > 0 && run.entries.every(e => e.status === 'success')

  // Advanced detection — skipped entries are EXPECTED (the unmatched lane
  // skips every iteration), so success means "no errors, something ran".
  const formStep = flow?.steps.find(s => s.toolId === 'trigger.form')
  const itemsStep = flow?.steps.find(s => s.toolId === 'data.transform' && (s.config.code || '').includes('items'))
  const loopStep = flow?.steps.find(s => s.toolId === 'logic.loop')
  const branchStep = flow?.steps.find(s => s.toolId === 'logic.branch' && s.branches?.some(b => /critical/i.test(b.label)))
  const advRunOk = !run.running && run.entries.length > 0
    && Object.keys(run.errors || {}).length === 0
    && run.entries.some(e => e.status === 'success')
    && run.entries.every(e => e.status === 'success' || e.status === 'skipped')

  const basicsSteps: TutStep[] = useMemo(() => [
    {
      id: 'welcome',
      title: 'A rail, not a canvas',
      done: true,
      body: (
        <>
          <p>Steps run <strong>top to bottom</strong> — the order on the rail IS the wiring, so there are no arrows to draw and no way to wire things wrong. Branches fork into parallel lanes.</p>
          <p>In the next few minutes you'll build a real flow: it calls this server's health endpoint and summarizes the result. It stays in your Flows list when we're done.</p>
        </>
      ),
    },
    {
      id: 'create',
      title: 'Create a flow',
      done: inEditor,
      highlight: '[data-tut="new-flow"]',
      action: {
        label: 'Create it for me',
        run: () => {
          const f = makeFlow(BASICS_FLOW)
          f.tags = ['tutorial']
          dispatch({ type: 'create', flow: f })
          onOpenFlow(f.id)
        },
      },
      body: (
        <>
          <p>Flows live in the current <strong>project</strong> — the switcher at the top of the nav rail segments flows, runs, and secrets per project.</p>
          <p>Go to <strong>Flows</strong> and click <strong>New flow</strong>, or use the button below.</p>
        </>
      ),
    },
    {
      id: 'add-http',
      title: 'Add your first step',
      done: !!httpStep,
      highlight: '[data-tut="palette"]',
      action: {
        label: 'Add it for me',
        run: () => {
          if (!flow || httpStep) return
          const s = makeStep('data.http')
          s.name = 'Check health'
          dispatch({ type: 'insert-step', step: s, at: { hops: [], index: flow.steps.length } })
        },
      },
      body: (
        <>
          <p>Three ways to add a step: press <span className="kbd">/</span>, drag from the left palette, or click a <strong>+</strong> slot on the rail. While dragging, every legal insertion point lights up.</p>
          <p>Add <strong>HTTP request</strong> (in Data).</p>
        </>
      ),
    },
    {
      id: 'configure',
      title: 'Configure in place',
      done: urlSet,
      highlight: '[data-tool="data.http"]',
      action: {
        label: 'Fill it in for me',
        run: () => {
          if (!httpStep) return
          dispatch({ type: 'configure', stepId: httpStep.id, patch: { config: { url: HEALTH_URL, method: 'GET' } } })
          dispatch({ type: 'expand', id: httpStep.id })
        },
      },
      body: (
        <>
          <p>Click the card — it expands right there, no modal. Set the URL to:</p>
          <code className="tut-code">{HEALTH_URL}</code>
          <p>The server will call itself, so this works with no credentials. Missing required fields show plain-language errors on the card, and <strong>Test step</strong> runs just this one step for real.</p>
        </>
      ),
    },
    {
      id: 'add-transform',
      title: 'Use the data downstream',
      done: !!transformStep,
      highlight: transformStep ? '[data-tool="data.transform"]' : '[data-tut="palette"]',
      action: {
        label: 'Add it for me',
        run: () => {
          if (!flow || transformStep) return
          const s = makeStep('data.transform')
          s.name = 'Summarize'
          s.config.code = HEALTH_TRANSFORM
          dispatch({ type: 'insert-step', step: s, at: { hops: [], index: flow.steps.length } })
        },
      },
      body: (
        <>
          <p>Every step's output flows to the next. In a <strong>Transform</strong>, <code>input</code> is the previous step's output. Anywhere else, reference any earlier step with tokens like <code>{'{{Check health.response.uptime}}'}</code> — click into a field and pick from the chips.</p>
          <p>Add a <strong>Transform</strong> (in Data) below the HTTP step — the button fills in working code.</p>
        </>
      ),
    },
    {
      id: 'run',
      title: 'Run it',
      done: basicsRunOk,
      highlight: '[data-tut="run"]',
      action: { label: 'Run the flow', run: startRun },
      body: (
        <>
          <p>Press <span className="kbd">⌘ Enter</span> or click <strong>Run</strong>. Runs execute <strong>server-side</strong> through a persistent queue — statuses land on each card as they happen, and schedules, webhooks, and forms trigger flows the same way even with the browser closed.</p>
        </>
      ),
    },
    {
      id: 'inspect',
      title: 'Read the results',
      done: true,
      highlight: '[data-tut="runs"]',
      body: (
        <>
          <p>Green cards succeeded. Click the <strong>data pill</strong> on the connector between steps to inspect exactly what flowed through. Expand Summarize to see its output — your message built from live data.</p>
          <p>The <strong>Runs</strong> drawer keeps history, and every run is an OpenTelemetry trace. When something fails, the error appears in plain language on the failing card and the rest of the lane skips.</p>
        </>
      ),
    },
    {
      id: 'finish',
      title: 'You have a working flow',
      done: true,
      body: (
        <>
          <p>It's saved in your Flows list — run it again any time. Where to go next:</p>
          <ul className="tut-list">
            <li><strong>Advanced track</strong> — loops, routed branches, complex transforms</li>
            <li><strong>Secrets</strong> — per-project credentials, encrypted at rest</li>
            <li><strong>Config</strong> — per-project <code>{'{{config.*}}'}</code> values</li>
            <li><strong>StepHan</strong> — describe a job in a sentence, get a flow</li>
          </ul>
        </>
      ),
    },
  ], [inEditor, httpStep, transformStep, urlSet, basicsRunOk, flow, dispatch, onOpenFlow, startRun])

  const advancedSteps: TutStep[] = useMemo(() => [
    {
      id: 'adv-welcome',
      title: 'Batch work: fan out, route each item',
      done: true,
      body: (
        <>
          <p>You'll build a <strong>batch processor</strong>: a Transform produces a list of work items, a <strong>Loop</strong> runs the rest of the rail once per item, and a <strong>Branch</strong> routes each one by priority — critical items escalate, the rest just get logged.</p>
          <p>Everything runs with zero credentials, and the shape is the backbone of real flows: <em>fetch many → iterate → decide per item</em>.</p>
        </>
      ),
    },
    {
      id: 'adv-create',
      title: 'Create the flow',
      done: inEditor && !!flow && flow.name === ADV_FLOW,
      highlight: '[data-tut="new-flow"]',
      action: {
        label: 'Create it for me',
        run: () => {
          const f = makeFlow(ADV_FLOW)
          f.tags = ['tutorial']
          dispatch({ type: 'create', flow: f })
          onOpenFlow(f.id)
        },
      },
      body: <p>A fresh flow keeps the concepts isolated — your basics flow stays as it is.</p>,
    },
    {
      id: 'adv-form',
      title: 'Start from a hosted form',
      done: !!formStep,
      highlight: formStep ? '[data-tool="trigger.form"]' : '[data-tut="palette"]',
      action: {
        label: 'Add it for me',
        run: () => {
          if (!flow || formStep) return
          const s = makeStep('trigger.form')
          s.name = 'Batch request'
          s.config.title = 'Start a batch'
          s.config.path = `/forms/batch-${uid()}`
          s.config.fields = ADV_FORM_FIELDS
          dispatch({ type: 'insert-step', step: s, at: { hops: [], index: 0 } })
        },
      },
      body: (
        <>
          <p>A <strong>Form</strong> trigger serves a real hosted page at its Live URL — every submission starts this flow with the answers as the trigger payload (<code>{'{{Batch request.count}}'}</code>).</p>
          <p>Pressing <strong>Run</strong> instead fires it manually with <em>no answers</em> — the next step will handle both cases. That's the habit: flows should run sensibly from every entry point.</p>
        </>
      ),
    },
    {
      id: 'adv-items',
      title: 'A Transform that builds data',
      done: !!itemsStep,
      highlight: itemsStep ? '[data-tool="data.transform"]' : '[data-tut="palette"]',
      action: {
        label: 'Add it for me',
        run: () => {
          if (!flow || itemsStep) return
          const s = makeStep('data.transform')
          s.name = 'Make work items'
          s.config.code = ITEMS_CODE
          dispatch({ type: 'insert-step', step: s, at: { hops: [], index: flow.steps.length } })
        },
      },
      body: (
        <>
          <p>Transforms run <strong>real JavaScript</strong> in a sandbox (<code>input</code>, <code>JSON</code>, <code>Math</code>) and whatever you <code>return</code> becomes the step's output.</p>
          <p>This one reads the form answers from <code>input</code>, <strong>defaults them</strong> for manual runs, and computes a list of work items with <code>Array.from</code> — each with a <code>name</code> and <code>priority</code>. In real flows this is where an HTTP or SQL result gets shaped into a clean list.</p>
        </>
      ),
    },
    {
      id: 'adv-loop',
      title: 'Loop: the rail runs once per item',
      done: !!loopStep,
      highlight: loopStep ? '[data-tool="logic.loop"]' : '[data-tut="palette"]',
      action: {
        label: 'Add it for me',
        run: () => {
          if (!flow || loopStep) return
          const s = makeStep('logic.loop')
          s.name = 'For each item'
          // A Transform's return value lands under "output" in its result.
          s.config.items = 'input.output.items'
          dispatch({ type: 'insert-step', step: s, at: { hops: [], index: flow.steps.length } })
        },
      },
      body: (
        <>
          <p>A <strong>Loop</strong> evaluates an expression over its input and then runs <strong>every step after it</strong> once per item, sequentially (capped at 20). A Transform's return value lands under <code>output</code> in its result — check the data pill — so the expression here is <code>input.output.items</code>.</p>
          <p>Inside each pass, two token families exist: <code>{'{{item.<field>}}'}</code> for the current item and <code>{'{{loop.index}}'}</code> / <code>{'{{loop.count}}'}</code> for the position.</p>
        </>
      ),
    },
    {
      id: 'adv-branch',
      title: 'Branch: route each item by value',
      done: !!branchStep,
      highlight: branchStep ? '[data-tool="logic.branch"]' : '[data-tut="palette"]',
      action: {
        label: 'Add it for me',
        run: () => {
          if (!flow || branchStep) return
          const s = makeStep('logic.branch')
          s.name = 'Route by priority'
          s.config.on = '{{item.priority}}'
          const lane = (name: string, code: string): Step => {
            const t = makeStep('data.transform')
            t.name = name
            t.config.code = code
            return t
          }
          s.branches = [
            { id: uid(), label: 'critical', steps: [lane('Escalate', ESCALATE_CODE)] },
            { id: uid(), label: 'else', steps: [lane('Log routine', ROUTINE_CODE)] },
          ]
          dispatch({ type: 'insert-step', step: s, at: { hops: [], index: flow.steps.length } })
        },
      },
      body: (
        <>
          <p>A <strong>Branch</strong> routes on its <strong>Branch on</strong> value — a field of the previous output, or any token. Here it's <code>{'{{item.priority}}'}</code>, so each loop pass routes on the CURRENT item.</p>
          <p>The lane whose <strong>label matches</strong> the value runs (case-insensitive); a lane labeled <code>else</code> catches everything unmatched — its steps show as <em>skipped</em> on matching passes, which is routing working, not a failure. Leave "Branch on" blank and all lanes run in parallel instead.</p>
        </>
      ),
    },
    {
      id: 'adv-run',
      title: 'Run it — watch the iterations',
      done: advRunOk,
      highlight: '[data-tut="run"]',
      action: { label: 'Run the flow', run: startRun },
      body: (
        <>
          <p>A manual run uses the defaults: three items, three passes over the branch — <code>job-1</code> routes to <strong>critical</strong> (Escalate runs), <code>job-2</code> and <code>job-3</code> fall to <strong>else</strong>.</p>
          <p>Expand <strong>Escalate</strong> after the run — its message was built from <code>{'{{item.name}}'}</code> and <code>{'{{loop.index}}'}</code>, resolved fresh on every pass. Then try the real thing: open the trigger's <strong>Live URL</strong> and submit the form with a count of 5.</p>
        </>
      ),
    },
    {
      id: 'adv-finish',
      title: 'The advanced toolbox',
      done: true,
      body: (
        <>
          <p>Fan-out, per-item routing, and computed data — the pattern behind most real automations. More to reach for:</p>
          <ul className="tut-list">
            <li><strong>Until</strong> — repeat the steps after it until a JS condition on <code>input</code> passes (polling)</li>
            <li><strong>Memory</strong> — save and load values across runs by key</li>
            <li><strong>Run flow</strong> — call another flow by name, pass vars, use its result</li>
            <li><strong>Approval</strong> — park the run until a human signs off</li>
            <li><strong>LLM authoring</strong> — the <code>{'{}'}</code> dialog copies a prompt so any LLM writes flows as JSON (see docs/LLM-AUTHORING.md)</li>
          </ul>
        </>
      ),
    },
  ], [inEditor, flow, itemsStep, loopStep, branchStep, advRunOk, dispatch, onOpenFlow, startRun])

  const steps = track === 'advanced' ? advancedSteps : basicsSteps
  const step = steps[Math.min(idx, steps.length - 1)]
  const last = idx >= steps.length - 1

  // Spotlight: pulse a ring on the element the current step talks about.
  // Polled because targets appear after user actions.
  useEffect(() => {
    const selector = track ? step.highlight : undefined
    let current: Element | null = null
    const clear = () => current?.classList.remove('tut-glow')
    if (!selector) return
    const tick = () => {
      const found = document.querySelector(selector)
      if (found === current) return
      clear()
      current = found
      current?.classList.add('tut-glow')
    }
    tick()
    const timer = window.setInterval(tick, 400)
    return () => {
      window.clearInterval(timer)
      clear()
    }
  }, [track, step.highlight])

  const restart = () => {
    if (!track) return
    saveTutorial({ steps: { ...tutorialState().steps, [track]: 0 } })
    setIdx(0)
  }

  const finish = () => {
    if (track) {
      const done = tutorialState().completed
      saveTutorial({
        completed: { ...(typeof done === 'object' ? done : {}), [track]: true },
        steps: { ...tutorialState().steps, [track]: 0 },
        track: null,
      })
    }
    onClose()
  }

  // Track chooser — shown until a track is picked.
  if (!track) {
    return (
      <div className="tut-panel">
        <div className="tut-head">
          <span className="tut-head-icon"><GraduationCap size={15} /></span>
          <span className="tut-head-title">Tutorial</span>
          <span className="tut-count" />
          <button className="btn icon" title="Close" onClick={onClose}><X size={13} /></button>
        </div>
        <div className="tut-title">Pick a track</div>
        <button className="tut-track" onClick={() => setTrack('basics')}>
          <span className="tut-track-name">
            Basics
            {tutorialCompleted('basics') && <span className="tut-done"><Check size={11} /> done</span>}
          </span>
          <span className="tut-track-desc">The rail, adding and configuring steps, tokens, running — ends with a working health-check flow.</span>
        </button>
        <button className="tut-track" onClick={() => setTrack('advanced')}>
          <span className="tut-track-name">
            Advanced
            {tutorialCompleted('advanced') && <span className="tut-done"><Check size={11} /> done</span>}
          </span>
          <span className="tut-track-desc">Complex transforms, loops, and routed branches — a batch processor that decides per item.</span>
        </button>
      </div>
    )
  }

  return (
    <div className="tut-panel">
      <div className="tut-head">
        <span className="tut-head-icon"><GraduationCap size={15} /></span>
        <span className="tut-head-title">{track === 'advanced' ? 'Tutorial — Advanced' : 'Tutorial — Basics'}</span>
        <span className="tut-count">{idx + 1} / {steps.length}</span>
        <button className="btn icon" title="All tracks" onClick={() => setTrack(null)}><ChevronLeft size={13} /></button>
        <button className="btn icon" title="Restart this track" onClick={restart}><RotateCcw size={12} /></button>
        <button className="btn icon" title="Close — progress is saved" onClick={onClose}><X size={13} /></button>
      </div>
      <div className="tut-dots">
        {steps.map((s, i) => (
          <span key={s.id} className={`tut-dot${i === idx ? ' on' : ''}${i < idx ? ' past' : ''}`} />
        ))}
      </div>
      <div className="tut-title">
        {step.title}
        {step.done && step.action && <span className="tut-done"><Check size={11} /> done</span>}
      </div>
      <div className="tut-body">{step.body}</div>
      <div className="tut-actions">
        {idx > 0 && (
          <button className="btn icon" title="Back" onClick={() => setIdx(i => i - 1)}><ArrowLeft size={13} /></button>
        )}
        <span className="spacer" />
        {step.action && !step.done && (
          <button className="btn" onClick={step.action.run}>
            {step.id.endsWith('run') ? <Play size={12} /> : <Wand2 size={12} />} {step.action.label}
          </button>
        )}
        {last ? (
          <button className="btn primary" onClick={finish}><Check size={13} /> Finish</button>
        ) : (
          <button className="btn primary" disabled={!step.done} onClick={() => setIdx(i => i + 1)}>
            Next <ArrowRight size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
