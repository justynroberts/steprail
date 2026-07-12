// MIT License - Copyright (c) fintonlabs.com
// The rail: a vertical, deterministically laid-out flow. Steps stack, slots
// sit between them, branch steps fork into lanes that visually merge back.
// There is no freeform canvas and no wire-drawing — layout is never your job.
import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import type { SlotPath, Step } from '../types'
import { useDispatch } from '../state'
import { useUI } from '../ui'
import { DropSlot } from './DropSlot'
import { StepCard } from './StepCard'

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
          <div className="output-block" style={{ width: '100%', maxWidth: 420 }}>
            <div className="ob-title">Output of “{step.name}”</div>
            <pre>{JSON.stringify(output, null, 2)}</pre>
          </div>
        </div>
      )}
    </>
  )
}

function Lanes({ step, hops }: { step: Step; hops: SlotPath['hops'] }) {
  const dispatch = useDispatch()
  if (!step.branches) return null
  return (
    <>
      <div className="fork" />
      <div className="lanes">
        {step.branches.map(branch => (
          <div className="lane" key={branch.id}>
            <div className="lane-head">
              <span className="lane-label">
                <input
                  value={branch.label}
                  onChange={e => dispatch({ type: 'lane', stepId: step.id, branchId: branch.id, label: e.target.value })}
                />
                {step.branches!.length > 1 && (
                  <button className="x" title="Remove lane" onClick={() => dispatch({ type: 'lane', stepId: step.id, branchId: branch.id, remove: true })}>
                    <X size={11} />
                  </button>
                )}
              </span>
            </div>
            <Rail steps={branch.steps} hops={[...hops, { stepId: step.id, branchId: branch.id }]} />
          </div>
        ))}
        <div className="add-lane">
          <button className="btn icon" title="Add lane" onClick={() => dispatch({ type: 'add-lane', stepId: step.id })}>
            <Plus size={13} />
          </button>
        </div>
      </div>
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
