// MIT License - Copyright (c) fintonlabs.com
// Variables popout. Three sections: system variables, custom flow variables,
// and the data every step produces (real outputs from the last run when
// available, example shapes otherwise). Clicking any token inserts it into
// the last-focused config field, or copies it if none.
import { useState } from 'react'
import { Plus, Trash2, Variable, X } from 'lucide-react'
import type { Step } from '../types'
import { active, findStep, useDispatch, useEditor } from '../state'
import { systemVars } from '../engine'
import { toolById } from '../tools'
import { flattenData } from './FieldView'
import { useUI } from '../ui'

const SYSTEM_HINTS: Record<string, string> = {
  now: 'ISO timestamp at run time',
  date: 'Run date (YYYY-MM-DD)',
  time: 'Run time (HH:MM:SS)',
  flow: 'Name of this flow',
  runId: 'Unique id per run',
}

const allSteps = (steps: Step[]): Step[] =>
  steps.flatMap(s => [s, ...(s.branches || []).flatMap(b => allSteps(b.steps))])

export function VarsDrawer({ onClose }: { onClose: () => void }) {
  const state = useEditor()
  const dispatch = useDispatch()
  const { insertTarget, run } = useUI()
  const flow = active(state)
  const [copied, setCopied] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')

  if (!flow) return null
  const vars = flow.vars || {}

  const insertToken = async (token: string) => {
    const step = insertTarget && findStep(flow.steps, insertTarget.stepId)
    if (insertTarget && step && state.expandedId === step.id) {
      const current = step.config[insertTarget.fieldKey] || ''
      dispatch({
        type: 'configure',
        stepId: step.id,
        patch: { config: { [insertTarget.fieldKey]: current ? `${current} ${token}` : token } },
      })
      return
    }
    await navigator.clipboard.writeText(token)
    setCopied(token)
    setTimeout(() => setCopied(null), 1500)
  }

  const setVar = (key: string, value: string) => dispatch({ type: 'set-vars', vars: { ...vars, [key]: value } })
  const removeVar = (key: string) => {
    const next = { ...vars }
    delete next[key]
    dispatch({ type: 'set-vars', vars: next })
  }
  const addVar = () => {
    const key = newKey.trim().replace(/[^\w.-]/g, '_')
    if (!key || key in vars) return
    setVar(key, '')
    setNewKey('')
  }

  return (
    <div className="drawer">
      <div className="drawer-head">
        <Variable size={15} style={{ color: 'var(--accent)' }} />
        Variables
        <span className="spacer" />
        <button className="btn icon" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="drawer-body">
        <div className="settings-note">
          {insertTarget && state.expandedId === insertTarget.stepId
            ? 'Click a token to insert it into the focused field.'
            : 'Click a token to copy it — or focus a step field first to insert directly.'}
        </div>

        <div className="field"><label>System</label></div>
        {Object.entries(systemVars(flow)).map(([key, preview]) => (
          <button className="var-row" key={key} onClick={() => insertToken(`{{system.${key}}}`)}>
            <span className="token-chip">{copied === `{{system.${key}}}` ? 'copied' : `system.${key}`}</span>
            <span className="var-hint">{SYSTEM_HINTS[key] || String(preview)}</span>
            <span className="var-preview">{String(preview)}</span>
          </button>
        ))}

        <div className="field"><label>Custom (this flow)</label></div>
        {Object.entries(vars).map(([key, value]) => (
          <div className="var-row editable" key={key}>
            <button className="token-chip" onClick={() => insertToken(`{{var.${key}}}`)}>
              {copied === `{{var.${key}}}` ? 'copied' : `var.${key}`}
            </button>
            <input
              className="var-input"
              placeholder="value"
              value={value}
              onChange={e => setVar(key, e.target.value)}
            />
            <button className="btn icon danger" title="Remove variable" onClick={() => removeVar(key)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <div className="var-row editable">
          <input
            className="var-input"
            placeholder="new variable name"
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addVar()}
          />
          <button className="btn icon" title="Add variable" onClick={addVar} disabled={!newKey.trim()}>
            <Plus size={13} />
          </button>
        </div>
        <div className="settings-note">
          Custom variables travel with the flow's JSON, so an LLM can set them too. Reference anywhere as{' '}
          <span className="kbd">{'{{var.name}}'}</span>.
        </div>

        <div className="field"><label>Step data (every step)</label></div>
        <div className="settings-note" style={{ marginTop: -8 }}>
          Real values from the last run where available; example shapes otherwise.
        </div>
        {allSteps(flow.steps).map(step => {
          const tool = toolById(step.toolId)
          if (!tool) return null
          const data = run.outputs[step.id] || tool.sample(step.config)
          const rows = flattenData(data).slice(0, 6)
          const live = Boolean(run.outputs[step.id])
          return (
            <div className="chip-group" key={step.id}>
              <span className="chip-owner" title={live ? 'From the last run' : 'Example shape'}>
                {step.name}{live ? '' : ' *'}
              </span>
              {rows.map(row => (
                <button
                  key={row.path}
                  className="token-chip"
                  title={`{{${step.name}.${row.path}}} → ${row.value}`}
                  onClick={() => insertToken(`{{${step.name}.${row.path}}}`)}
                >
                  {copied === `{{${step.name}.${row.path}}}` ? 'copied' : row.path}
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
