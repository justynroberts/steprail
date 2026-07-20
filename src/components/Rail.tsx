// MIT License - Copyright (c) fintonlabs.com
// The rail: a vertical, deterministically laid-out flow. Steps stack, slots
// sit between them, branch steps fork into lanes that visually merge back.
// There is no freeform canvas and no wire-drawing — layout is never your job.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import type { SlotPath, Step } from '../types'
import { useDispatch } from '../state'
import { useUI } from '../ui'
import { DropSlot } from './DropSlot'
import { StepCard } from './StepCard'
import { FieldView } from './FieldView'

function DataPill({ step }: { step: Step }) {
  const { run } = useUI()
  const [open, setOpen] = useState(false)
  const output = run.outputs[step.id]
  if (!output) return null
  const keys = Object.keys(output).length
  const bytes = JSON.stringify(output).length
  return (
    <>
      <div className="pill-row">
        <button className="data-pill" onClick={() => setOpen(o => !o)} title="Inspect the data flowing here">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {keys} {keys === 1 ? 'key' : 'keys'} · {bytes < 1024 ? `${bytes} b` : `${(bytes / 1024).toFixed(1)} kb`}
        </button>
      </div>
      {open && (
        <div className="pill-row">
          <div style={{ width: '100%', maxWidth: 440 }}>
            <FieldView data={output} title={`Output of “${step.name}”`} />
          </div>
        </div>
      )}
    </>
  )
}

// Total steps in a lane, counting nested branches — shown when a lane is folded.
function deepCount(steps: Step[]): number {
  let n = steps.length
  for (const s of steps) for (const b of s.branches || []) n += deepCount(b.steps)
  return n
}

// Branch lanes as TABS: a wrapping strip of lane chips, and the selected lane's
// steps rendered full-width below — one at a time. This scales to many lanes
// (20+) without squishing cards or scrolling sideways; you edit one lane, then
// switch. The fork/merge brackets still frame it as a branch that rejoins.
function Lanes({ step, hops }: { step: Step; hops: SlotPath['hops'] }) {
  const dispatch = useDispatch()
  const branches = step.branches
  const [activeId, setActiveId] = useState(branches?.[0]?.id)
  // Auto-select a freshly added lane so you drop straight into editing it.
  const prevLen = useRef(branches?.length ?? 0)
  useEffect(() => {
    const len = branches?.length ?? 0
    if (len > prevLen.current && branches) setActiveId(branches[len - 1].id)
    prevLen.current = len
  }, [branches])
  if (!branches) return null

  const active = branches.find(b => b.id === activeId) || branches[0]
  const removeLane = (branchId: string) => {
    const idx = branches.findIndex(b => b.id === branchId)
    dispatch({ type: 'lane', stepId: step.id, branchId, remove: true })
    if (branchId === active.id) setActiveId((branches[idx + 1] || branches[idx - 1])?.id)
  }

  return (
    <>
      <div className="fork" />
      <div className="lane-tabs">
        {branches.map(b => (
          <button
            key={b.id}
            className={`lane-tab${b.id === active.id ? ' on' : ''}`}
            onClick={() => setActiveId(b.id)}
            title={`Edit lane “${b.label}” (${deepCount(b.steps)} steps)`}
          >
            <span className="lane-tab-label">{b.label || 'lane'}</span>
            <span className="lane-tab-count">{deepCount(b.steps)}</span>
          </button>
        ))}
        <button className="lane-tab lane-tab-add" title="Add a lane" onClick={() => dispatch({ type: 'add-lane', stepId: step.id })}>
          <Plus size={13} />
        </button>
      </div>

      {active && (
        <div className="lane-active" key={active.id}>
          <div className="lane-active-head">
            <span className="lane-label">
              <input
                value={active.label}
                onChange={e => dispatch({ type: 'lane', stepId: step.id, branchId: active.id, label: e.target.value })}
                aria-label="Lane label"
              />
            </span>
            {branches.length > 1 && (
              <button className="lane-remove" title="Remove this lane" onClick={() => removeLane(active.id)}>
                <X size={13} /> Remove lane
              </button>
            )}
            <span className="lane-active-hint">{branches.length} lane{branches.length === 1 ? '' : 's'} · editing one at a time</span>
          </div>
          <Rail steps={active.steps} hops={[...hops, { stepId: step.id, branchId: active.id }]} />
        </div>
      )}
      <div className="merge" />
    </>
  )
}

export function Rail({ steps, hops }: { steps: Step[]; hops: SlotPath['hops'] }) {
  return (
    <div className="rail">
      <DropSlot at={{ hops, index: 0 }} />
      {steps.map((step, i) => (
        <div className="step" key={step.id} id={`step-${step.id}`}>
          <StepCard step={step} />
          {step.branches ? <Lanes step={step} hops={hops} /> : <DataPill step={step} />}
          <DropSlot at={{ hops, index: i + 1 }} />
        </div>
      ))}
    </div>
  )
}
