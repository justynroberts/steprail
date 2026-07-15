// MIT License - Copyright (c) fintonlabs.com
// A step on the rail. Clicking expands configuration in place — the rail
// shifts to make room, so you never lose sight of the flow around it.
// Upstream outputs surface as clickable chips that drop {{tokens}} into
// config fields; the engine resolves them at run time.
import { useState, type DragEvent } from 'react'
import {
  AlertCircle, Check, ChevronDown, ChevronRight, ClipboardCopy, FlaskConical, GripVertical, Loader2, Trash2,
} from 'lucide-react'
import type { Step, StepStatus } from '../types'
import { toolById } from '../tools'
import { active, findStep, upstreamSteps, useDispatch, useEditor } from '../state'
import { lastUpstreamOutput, sampleUpstream, upstreamOutputsFromRun } from '../engine'
import { testStepRemote } from '../api'
import { parseSchedule, scheduleSummary } from '../schedule'
import { CATEGORY_VAR, useUI } from '../ui'
import { showToast } from '../toast'
import { FieldView, flattenData } from './FieldView'
import { ScheduleField } from './ScheduleField'
import { FormFieldsBuilder } from './FormFieldsBuilder'
import { JsonFieldEditor } from './JsonFieldEditor'

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === 'running') return <Loader2 size={15} className="spin" style={{ color: 'var(--accent)' }} />
  if (status === 'success') return <Check size={15} style={{ color: 'var(--ok)' }} />
  if (status === 'error') return <AlertCircle size={15} style={{ color: 'var(--err)' }} />
  if (status === 'waiting') return <Loader2 size={15} className="spin" style={{ color: 'var(--warn)' }} />
  return null
}

export function StepCard({ step }: { step: Step }) {
  const dispatch = useDispatch()
  const state = useEditor()
  const { expandedId } = state
  const { run, dragging, setDragging, connections, insertTarget } = useUI()
  const [copiedHook, setCopiedHook] = useState(false)
  const [focusedField, setFocusedFieldRaw] = useState<string | null>(null)
  const [test, setTest] = useState<{ output?: Record<string, unknown>; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [chipsOpen, setChipsOpen] = useState(false)
  const { setInsertTarget } = useUI()
  const setFocusedField = (key: string) => {
    setFocusedFieldRaw(key)
    setInsertTarget({ stepId: step.id, fieldKey: key })
  }
  const tool = toolById(step.toolId)
  if (!tool) return null

  const status = run.statuses[step.id] || 'idle'
  const output = run.outputs[step.id]
  const error = run.errors[step.id]
  const expanded = expandedId === step.id
  const isDragged = dragging?.kind === 'step' && dragging.id === step.id

  // The one-line summary under the name: the first configured value, or a nudge.
  // Schedules summarize in plain language, never as raw JSON or cron.
  const firstValue = tool.fields
    .map(f => {
      const v = step.config[f.key]
      if (!v || !v.trim()) return undefined
      return f.kind === 'schedule' ? scheduleSummary(parseSchedule(v)) : v
    })
    .find(Boolean)
  const needsConfig = tool.fields.some(f => f.required && !(step.config[f.key] || '').trim())
  const sub = firstValue || (needsConfig ? 'needs configuration' : tool.description)

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', step.id)
    setDragging({ kind: 'step', id: step.id })
  }

  // Upstream steps whose sample outputs become insertable {{tokens}}.
  const flow = active(state)
  const textFields = tool.fields.filter(f => !f.kind || f.kind === 'text' || f.kind === 'code')
  const upstream = expanded && flow && textFields.length ? upstreamSteps(flow.steps, step.id) || [] : []

  // Insert a {{token}} into the globally last-focused field (insertTarget), falling
  // back to the locally-focused field in this card, then to the first text field.
  const insertToken = (token: string) => {
    if (insertTarget && flow) {
      const targetStep = findStep(flow.steps, insertTarget.stepId)
      if (targetStep) {
        const current = targetStep.config[insertTarget.fieldKey] || ''
        dispatch({ type: 'configure', stepId: insertTarget.stepId, patch: { config: { [insertTarget.fieldKey]: current ? `${current} ${token}` : token } } })
        return
      }
    }
    const key = focusedField && textFields.some(f => f.key === focusedField) ? focusedField : textFields[0]?.key
    if (!key) return
    const current = step.config[key] || ''
    dispatch({ type: 'configure', stepId: step.id, patch: { config: { [key]: current ? `${current} ${token}` : token } } })
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
              {f.kind === 'connection' ? (
                (() => {
                  const pool = connections.filter(c => c.type === f.connType)
                  if (!pool.length) {
                    return (
                      <div className="settings-note">
                        No {f.connType} connections yet — add one in Settings → Connections.
                      </div>
                    )
                  }
                  return (
                    <select
                      value={step.config[f.key] || ''}
                      onChange={e => dispatch({ type: 'configure', stepId: step.id, patch: { config: { [f.key]: e.target.value } } })}
                    >
                      <option value="">{pool[0].name} (default)</option>
                      {pool.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  )
                })()
              ) : f.kind === 'json' ? (
                <JsonFieldEditor
                  value={step.config[f.key]}
                  placeholder={f.placeholder}
                  onChange={v => dispatch({ type: 'configure', stepId: step.id, patch: { config: { [f.key]: v } } })}
                />
              ) : f.kind === 'form' ? (
                <FormFieldsBuilder
                  value={step.config[f.key]}
                  onChange={v => dispatch({ type: 'configure', stepId: step.id, patch: { config: { [f.key]: v } } })}
                />
              ) : f.kind === 'schedule' ? (
                <ScheduleField
                  value={step.config[f.key]}
                  onChange={v => dispatch({ type: 'configure', stepId: step.id, patch: { config: { [f.key]: v } } })}
                />
              ) : f.kind === 'code' ? (
                <textarea
                  placeholder={f.placeholder}
                  value={step.config[f.key] || ''}
                  onFocus={() => setFocusedField(f.key)}
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
                  onFocus={() => f.kind !== 'number' && setFocusedField(f.key)}
                  onChange={e => dispatch({ type: 'configure', stepId: step.id, patch: { config: { [f.key]: e.target.value } } })}
                />
              )}
            </div>
          ))}
          {(step.toolId === 'trigger.webhook' || step.toolId === 'trigger.form') && (step.config.path || '').trim() && (
            <div className="hook-url">
              <span className="hook-label">Live URL</span>
              <span className="hook-value">{`${window.location.origin}${step.config.path.startsWith('/') ? '' : '/'}${step.config.path.trim()}`}</span>
              <button
                className="btn icon"
                title="Copy webhook URL"
                onClick={async () => {
                  await navigator.clipboard.writeText(`${window.location.origin}${step.config.path.startsWith('/') ? '' : '/'}${step.config.path.trim()}`)
                  setCopiedHook(true)
                  setTimeout(() => setCopiedHook(false), 1500)
                }}
              >
                {copiedHook ? <Check size={12} /> : <ClipboardCopy size={12} />}
              </button>
            </div>
          )}
          {upstream.length > 0 && (
            <div className="chip-section">
              <button className="chip-toggle" onClick={() => setChipsOpen(o => !o)}>
                {chipsOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                Data tokens
                <span className="chip-toggle-count">{upstream.length} step{upstream.length === 1 ? '' : 's'}</span>
              </button>
              {chipsOpen && upstream.map(up => {
                const upTool = toolById(up.toolId)
                if (!upTool) return null
                const rows = flattenData(upTool.sample(up.config)).slice(0, 5)
                return (
                  <div className="chip-group" key={up.id}>
                    <span className="chip-owner">{up.name}</span>
                    {rows.map(row => (
                      <button
                        key={row.path}
                        className="token-chip"
                        title={`Insert {{${up.name}.${row.path}}} — resolves to "${row.value}" on the last sample`}
                        onClick={() => insertToken(`{{${up.name}.${row.path}}}`)}
                      >
                        {row.path}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
          {test?.error && (
            <div className="step-error" style={{ margin: 0 }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{test.error}</span>
            </div>
          )}
          {test?.output && <FieldView data={test.output} title="Test output" />}
          {output && <FieldView data={output} title="Last run output" />}
          <div className="row-actions">
            <button
              className="btn"
              title="Run just this step for real — upstream data comes from the last run when available"
              disabled={testing}
              onClick={() => {
                if (!flow || testing) return
                setTesting(true)
                // Real upstream outputs from the last run win; sample shapes
                // only fill gaps for steps that have never run.
                const upstream = { ...sampleUpstream(flow, step.id), ...(upstreamOutputsFromRun(flow, step.id, run) || {}) }
                const ups = upstreamSteps(flow.steps, step.id) || []
                const last = ups[ups.length - 1]
                const input = lastUpstreamOutput(flow, step.id, run) ?? (last ? upstream[last.name] : undefined)
                void testStepRemote(flow, step.id, { ...upstream, __input: input }).then(result => {
                  setTest(result)
                  setTesting(false)
                })
              }}
            >
              {testing ? <Loader2 size={13} className="spin" /> : <FlaskConical size={13} />} Test step
            </button>
            <button
              className="btn icon danger"
              title="Delete step"
              onClick={() => {
                dispatch({ type: 'remove', stepId: step.id })
                showToast(`"${step.name}" removed`, { action: { label: 'Undo', fn: () => dispatch({ type: 'undo' }) } })
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
