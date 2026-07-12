// MIT License - Copyright (c) fintonlabs.com
// A step on the rail. Clicking expands configuration in place — the rail
// shifts to make room, so you never lose sight of the flow around it.
import { type DragEvent } from 'react'
import {
  AlertCircle, Check, ChevronRight, GripVertical, Loader2, Trash2,
} from 'lucide-react'
import type { Step, StepStatus } from '../types'
import { toolById } from '../tools'
import { useDispatch, useEditor } from '../state'
import { CATEGORY_VAR, useUI } from '../ui'

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === 'running') return <Loader2 size={15} className="spin" style={{ color: 'var(--accent)' }} />
  if (status === 'success') return <Check size={15} style={{ color: 'var(--ok)' }} />
  if (status === 'error') return <AlertCircle size={15} style={{ color: 'var(--err)' }} />
  return null
}

export function StepCard({ step }: { step: Step }) {
  const dispatch = useDispatch()
  const { expandedId } = useEditor()
  const { run, dragging, setDragging } = useUI()
  const tool = toolById(step.toolId)
  if (!tool) return null

  const status = run.statuses[step.id] || 'idle'
  const output = run.outputs[step.id]
  const error = run.errors[step.id]
  const expanded = expandedId === step.id
  const isDragged = dragging?.kind === 'step' && dragging.id === step.id

  // The one-line summary under the name: the first configured value, or a nudge.
  const firstValue = tool.fields.map(f => step.config[f.key]).find(v => v && v.trim())
  const needsConfig = tool.fields.some(f => f.required && !(step.config[f.key] || '').trim())
  const sub = firstValue || (needsConfig ? 'needs configuration' : tool.description)

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', step.id)
    setDragging({ kind: 'step', id: step.id })
  }

  const classes = ['step-card']
  if (expanded) classes.push('expanded')
  if (isDragged) classes.push('dragging')
  if (status !== 'idle' && status !== 'queued') classes.push(status)

  return (
    <div className={classes.join(' ')}>
      <div className="step-head" onClick={() => dispatch({ type: 'expand', id: expanded ? null : step.id })}>
        <span
          className="grip"
          draggable
          onDragStart={onDragStart}
          onDragEnd={() => setDragging(null)}
          onClick={e => e.stopPropagation()}
          title="Drag to move"
        >
          <GripVertical size={14} />
        </span>
        <span className="tool-chip">
          <tool.icon size={15} style={{ color: CATEGORY_VAR[tool.category] }} />
        </span>
        <span className="titles">
          <span className="name">{step.name}</span>
          <span className="sub" style={needsConfig && !firstValue ? { color: 'var(--warn)' } : undefined}>{sub}</span>
        </span>
        <span className="status-ico"><StatusIcon status={status} /></span>
        <span className="chev"><ChevronRight size={15} /></span>
      </div>

      {error && (
        <div className="step-error">
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {expanded && (
        <div className="step-body" onClick={e => e.stopPropagation()}>
          <div className="field">
            <label>Step name</label>
            <input
              value={step.name}
              onChange={e => dispatch({ type: 'configure', stepId: step.id, patch: { name: e.target.value } })}
            />
          </div>
          {tool.fields.map(f => (
            <div className="field" key={f.key}>
              <label>
                {f.label}
                {f.required && <span className="req">*</span>}
              </label>
              {f.kind === 'code' ? (
                <textarea
                  placeholder={f.placeholder}
                  value={step.config[f.key] || ''}
                  onChange={e => dispatch({ type: 'configure', stepId: step.id, patch: { config: { [f.key]: e.target.value } } })}
                />
              ) : f.kind === 'select' ? (
                <select
                  value={step.config[f.key] || f.options?.[0] || ''}
                  onChange={e => dispatch({ type: 'configure', stepId: step.id, patch: { config: { [f.key]: e.target.value } } })}
                >
                  {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={f.kind === 'number' ? 'number' : 'text'}
                  placeholder={f.placeholder}
                  value={step.config[f.key] || ''}
                  onChange={e => dispatch({ type: 'configure', stepId: step.id, patch: { config: { [f.key]: e.target.value } } })}
                />
              )}
            </div>
          ))}
          {output && (
            <div className="output-block">
              <div className="ob-title">Last output</div>
              <pre>{JSON.stringify(output, null, 2)}</pre>
            </div>
          )}
          <div className="row-actions">
            <span style={{ fontSize: 11.5, color: 'var(--text-4)' }}>{tool.description}</span>
            <button className="btn icon danger" title="Delete step" onClick={() => dispatch({ type: 'remove', stepId: step.id })}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
