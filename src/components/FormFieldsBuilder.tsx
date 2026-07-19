// MIT License - Copyright (c) fintonlabs.com
// The form builder: rows of label + type + required, no code anywhere.
// The result is stored as the fields JSON the server renders and validates.
import { useState } from 'react'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { FORM_FIELD_TYPES, parseFormFields, slugKey, type FormFieldDef } from '../../shared/formcore.mjs'

export function FormFieldsBuilder({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  const fields = parseFormFields(value)
  const [newLabel, setNewLabel] = useState('')

  const commit = (next: FormFieldDef[]) => onChange(JSON.stringify(next))

  const update = (i: number, patch: Partial<FormFieldDef>) => {
    const next = fields.map((f, idx) => (idx === i ? { ...f, ...patch, ...(patch.label ? { key: slugKey(patch.label) } : {}) } : f))
    commit(next)
  }

  const add = () => {
    const label = newLabel.trim()
    if (!label) return
    commit([...fields, { key: slugKey(label), label, type: 'text', required: false, options: '' }])
    setNewLabel('')
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= fields.length) return
    const next = [...fields]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }

  return (
    <div className="form-builder">
      {fields.length === 0 && (
        <div className="settings-note">No fields yet — name one below and press add. Answers reach later steps as tokens.</div>
      )}
      {fields.map((f, i) => (
        <div className="fb-field" key={`${f.key}-${i}`}>
          <div className="fb-row">
            <button className="fb-move" title="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
              <GripVertical size={13} />
            </button>
            <input
              className="var-input"
              value={f.label}
              onChange={e => update(i, { label: e.target.value })}
              style={{ flex: 2 }}
            />
            <select value={f.type} onChange={e => update(i, { type: e.target.value as FormFieldDef['type'] })}>
              {FORM_FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <label className="fb-req" title="Required">
              <input type="checkbox" checked={f.required} onChange={e => update(i, { required: e.target.checked })} />
              req
            </label>
            <button className="btn icon danger" title="Remove field" onClick={() => commit(fields.filter((_, idx) => idx !== i))}>
              <Trash2 size={12} />
            </button>
          </div>
          {f.type === 'choice' && (
            <div className="fb-choice">
              <input
                className="var-input"
                placeholder="Fixed options, comma separated"
                value={f.options}
                onChange={e => update(i, { options: e.target.value })}
              />
              <input
                className="var-input"
                placeholder="…or a JSON API URL for a live dropdown (https://…)"
                value={f.optionsUrl || ''}
                onChange={e => update(i, { optionsUrl: e.target.value })}
              />
              {(f.optionsUrl || '').trim() && (
                <div className="fb-choice-map">
                  <input className="var-input" placeholder="array path (e.g. data.items)" value={f.optionsPath || ''} onChange={e => update(i, { optionsPath: e.target.value })} />
                  <input className="var-input" placeholder="label key (e.g. name)" value={f.optionsLabel || ''} onChange={e => update(i, { optionsLabel: e.target.value })} />
                  <input className="var-input" placeholder="value key (e.g. id)" value={f.optionsValue || ''} onChange={e => update(i, { optionsValue: e.target.value })} />
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      <div className="fb-row">
        <input
          className="var-input"
          placeholder="New field label (e.g. Your name)"
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          style={{ flex: 1 }}
        />
        <button className="btn" onClick={add} disabled={!newLabel.trim()}>
          <Plus size={13} /> Add field
        </button>
      </div>
    </div>
  )
}
