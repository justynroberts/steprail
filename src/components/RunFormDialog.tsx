// MIT License - Copyright (c) fintonlabs.com
// Pressing Run on a flow whose trigger is a hosted form pops this modal:
// the same fields the hosted page shows, filled in before the run starts.
// The run gets the answers as its trigger payload — identical shape to a
// real form submission, so downstream tokens resolve the same way.
import { useState } from 'react'
import { ClipboardList, Play, X } from 'lucide-react'
import { parseFormFields, type FormFieldDef } from '../../shared/formcore.mjs'

interface Props {
  flowName: string
  config: Record<string, string>
  onSubmit: (answers: Record<string, unknown>) => void
  onClose: () => void
}

export function RunFormDialog({ flowName, config, onSubmit, onClose }: Props) {
  const fields = parseFormFields(config.fields)
  const [values, setValues] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState('')

  const set = (key: string, v: string) => {
    setValues(cur => ({ ...cur, [key]: v }))
    setProblem('')
  }

  const submit = () => {
    for (const f of fields) {
      if (f.required && !(values[f.key] || '').trim()) {
        setProblem(`"${f.label}" is required.`)
        return
      }
    }
    const answers: Record<string, unknown> = {}
    for (const f of fields) {
      const raw = values[f.key] ?? ''
      answers[f.key] = f.type === 'number' ? Number(raw) || 0 : raw
    }
    onSubmit({ ...answers, trigger: 'form', submittedAt: new Date().toISOString() })
  }

  const input = (f: FormFieldDef) => {
    if (f.type === 'long') {
      return <textarea value={values[f.key] || ''} onChange={e => set(f.key, e.target.value)} rows={4} />
    }
    if (f.type === 'choice') {
      const options = (f.options || '').split(',').map(o => o.trim()).filter(Boolean)
      return (
        <select value={values[f.key] || ''} onChange={e => set(f.key, e.target.value)}>
          <option value="">Choose…</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    if (f.type === 'yesno') {
      return (
        <select value={values[f.key] || ''} onChange={e => set(f.key, e.target.value)}>
          <option value="">Choose…</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      )
    }
    return (
      <input
        type={f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : 'text'}
        value={values[f.key] || ''}
        onChange={e => set(f.key, e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
      />
    )
  }

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmdk run-form-dialog">
        <div className="cmdk-input">
          <ClipboardList size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ flex: 1, fontWeight: 590, fontSize: 14 }}>
            {config.title?.trim() || flowName}
          </span>
          <button className="btn icon" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="run-form-body">
          <div className="settings-note" style={{ marginBottom: 4 }}>
            This flow starts from a form — fill it in to run. External submissions use the hosted page at its Live URL.
          </div>
          {fields.map(f => (
            <div className="field" key={f.key}>
              <label>
                {f.label}
                {f.required && <span className="req">*</span>}
              </label>
              {input(f)}
            </div>
          ))}
          {fields.length === 0 && (
            <div className="settings-note">The form has no fields yet — the run will start with an empty submission.</div>
          )}
          {problem && <div className="compose-warnings" style={{ margin: 0 }}>{problem}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={submit}>
              <Play size={13} /> Run flow
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
