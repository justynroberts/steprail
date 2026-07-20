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

function Lanes({ step, hops }: { step: Step; hops: SlotPath['hops'] }) {
  const dispatch = useDispatch()
  // Fold state is view-only (not flow data), keyed by branch id, kept on this
  // branching step's own Lanes instance.
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  if (!step.branches) return null
  const branches = step.branches
  const many = branches.length >= 3
  const toggle = (id: string) => setFolded(f => ({ ...f, [id]: !f[id] }))
  const setAll = (v: boolean) => setFolded(Object.fromEntries(branches.map(b => [b.id, v])))
  return (
    <>
      <div className="fork" />
      {many && (
        <div className="lanes-toolbar">
          <span className="lanes-count">{branches.length} lanes</span>
          <button className="lanes-tool" onClick={() => setAll(true)}>Collapse all</button>
          <button className="lanes-tool" onClick={() => setAll(false)}>Expand all</button>
        </div>
      )}
      <div className="lanes">
        {branches.map(branch => {
          const isFolded = !!folded[branch.id]
          return (
            <div className={`lane${isFolded ? ' folded' : ''}`} key={branch.id}>
              <div className="lane-head">
                <button
                  className="lane-fold"
                  title={isFolded ? 'Expand this lane' : 'Collapse this lane'}
                  onClick={() => toggle(branch.id)}
                >
                  {isFolded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
                <span className="lane-label">
                  <input
                    value={branch.label}
                    onChange={e => dispatch({ type: 'lane', stepId: step.id, branchId: branch.id, label: e.target.value })}
                  />
                </span>
                {isFolded && <span className="lane-steps">{deepCount(branch.steps)} step{deepCount(branch.steps) === 1 ? '' : 's'}</span>}
                {branches.length > 1 && (
                  <button className="x" title="Remove lane" onClick={() => dispatch({ type: 'lane', stepId: step.id, branchId: branch.id, remove: true })}>
                    <X size={11} />
                  </button>
                )}
              </div>
              {!isFolded && <Rail steps={branch.steps} hops={[...hops, { stepId: step.id, branchId: branch.id }]} />}
            </div>
          )
        })}
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
