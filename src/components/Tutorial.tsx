// MIT License - Copyright (c) fintonlabs.com
// Interactive onboarding: eight short steps that end with a real, working
// flow (the server checks its own health and summarizes it). The panel
// watches editor and run state to tick steps off as the user actually does
// them; every action step also has a "Do it for me" so nobody gets stuck.
// Re-runnable any time from Learn in the nav rail.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowLeft, ArrowRight, Check, GraduationCap, Play, RotateCcw, Wand2, X,
} from 'lucide-react'
import type { RunState } from '../types'
import { active, makeStep, useDispatch, useEditor } from '../state'
import { makeFlow } from '../blueprints'
import type { AppView } from './NavRail'

const TUT_KEY = 'sr-tutorial'

export function tutorialState(): { step?: number; completed?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(TUT_KEY) || '{}')
  } catch {
    return {}
  }
}
const saveTutorial = (patch: { step?: number; completed?: boolean }) =>
  localStorage.setItem(TUT_KEY, JSON.stringify({ ...tutorialState(), ...patch }))

// The flow the tutorial builds. The server calls itself, so this works on
// every install with zero credentials.
const FLOW_NAME = 'Tutorial: Health check'
const HEALTH_URL = 'http://localhost:8452/api/health'
const TRANSFORM_CODE = `const health = input.response
return {
  message: 'Server ' + health.status + ' for ' + Math.round(health.uptime / 60) + ' minutes',
  version: health.version,
}`

interface TutStep {
  id: string
  title: string
  body: ReactNode
  // Auto-detected completion; steps without it are read-and-continue.
  done: boolean
  action?: { label: string; run: () => void }
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
  const [idx, setIdx] = useState(() => Math.min(tutorialState().step || 0, 7))

  useEffect(() => {
    saveTutorial({ step: idx })
  }, [idx])

  const flow = active(state)
  const inEditor = view === 'editor' && !!flow
  const httpStep = flow?.steps.find(s => s.toolId === 'data.http')
  const transformStep = flow?.steps.find(s => s.toolId === 'data.transform')
  const urlSet = Boolean(httpStep?.config.url?.includes('/api/health'))
  const runOk = !run.running && run.entries.length > 0 && run.entries.every(e => e.status === 'success')

  const steps: TutStep[] = useMemo(() => [
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
      action: {
        label: 'Create it for me',
        run: () => {
          const f = makeFlow(FLOW_NAME)
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
      action: {
        label: 'Add it for me',
        run: () => {
          if (!flow || transformStep) return
          const s = makeStep('data.transform')
          s.name = 'Summarize'
          s.config.code = TRANSFORM_CODE
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
      done: runOk,
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
            <li><strong>Secrets</strong> — per-project credentials, encrypted at rest</li>
            <li><strong>Config</strong> — per-project <code>{'{{config.*}}'}</code> values</li>
            <li><strong>Blueprints</strong> — ready-made flows to start from</li>
            <li><strong>StepHan</strong> — describe a job in a sentence, get a flow</li>
          </ul>
          <p>Restart this tutorial any time from <strong>Learn</strong> in the nav rail.</p>
        </>
      ),
    },
  ], [inEditor, httpStep, transformStep, urlSet, runOk, flow, dispatch, onOpenFlow, startRun])

  const step = steps[idx]
  const last = idx === steps.length - 1

  const restart = () => {
    saveTutorial({ step: 0, completed: false })
    setIdx(0)
  }

  const finish = () => {
    saveTutorial({ step: 0, completed: true })
    onClose()
  }

  return (
    <div className="tut-panel">
      <div className="tut-head">
        <GraduationCap size={14} />
        <span className="tut-head-title">Tutorial</span>
        <span className="tut-count">{idx + 1} / {steps.length}</span>
        <button className="btn icon" title="Restart tutorial" onClick={restart}><RotateCcw size={12} /></button>
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
            {step.id === 'run' ? <Play size={12} /> : <Wand2 size={12} />} {step.action.label}
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
