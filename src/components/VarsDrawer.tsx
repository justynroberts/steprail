// MIT License - Copyright (c) fintonlabs.com
// Variables popout. System variables are computed per run; custom variables
// belong to the flow (and travel with its portable JSON). Clicking a token
// inserts it into the last-focused config field, or copies it if none.
import { useState } from 'react'
import { Plus, Trash2, Variable, X } from 'lucide-react'
import { active, findStep, useDispatch, useEditor } from '../state'
import { systemVars } from '../engine'
import { useUI } from '../ui'

const SYSTEM_HINTS: Record<string, string> = {
  now: 'ISO timestamp at run time',
  date: 'Run date (YYYY-MM-DD)',
  time: 'Run time (HH:MM:SS)',
  flow: 'Name of this flow',
  runId: 'Unique id per run',
}

export function VarsDrawer({ onClose }: { onClose: () => void }) {
  const state = useEditor()
  const dispatch = useDispatch()
  const { insertTarget } = useUI()
  const flow = active(state)
  const [copied, setCopied] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')

  if (!flow) return null
  const vars = flow.vars || {}

  const useToken = async (token: string) => {
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
          <button className="var-row" key={key} onClick={() => useToken(`{{system.${key}}}`)}>
            <span className="token-chip">{copied === `{{system.${key}}}` ? 'copied' : `system.${key}`}</span>
            <span className="var-hint">{SYSTEM_HINTS[key] || String(preview)}</span>
            <span className="var-preview">{String(preview)}</span>
          </button>
        ))}

        <div className="field"><label>Custom (this flow)</label></div>
        {Object.entries(vars).map(([key, value]) => (
          <div className="var-row editable" key={key}>
            <button className="token-chip" onClick={() => useToken(`{{var.${key}}}`)}>
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
      </div>
    </div>
  )
}
