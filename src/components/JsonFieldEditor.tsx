// MIT License - Copyright (c) fintonlabs.com
// Low-code editing for JSON-object config values: key/value rows with
// add/change/delete, and a raw-JSON mode for hand editing. Values that look
// like JSON literals (42, true, nested objects) keep their types; everything
// else — including {{tokens}} — stays a string.
import { useState } from 'react'
import { Braces, Plus, Rows3, Trash2 } from 'lucide-react'

const parseObject = (value: string | undefined): Record<string, unknown> | null => {
  if (!value || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

const display = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v))

const coerce = (raw: string): unknown => {
  const t = raw.trim()
  if (t === '') return ''
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (/^[{[]/.test(t)) {
    try { return JSON.parse(t) } catch { return raw }
  }
  return raw
}

export function JsonFieldEditor({ value, onChange, placeholder }: { value: string | undefined; onChange: (v: string) => void; placeholder?: string }) {
  const obj = parseObject(value)
  const [mode, setMode] = useState<'fields' | 'raw'>(obj ? 'fields' : 'raw')
  const [newKey, setNewKey] = useState('')

  const commit = (next: Record<string, unknown>) => onChange(JSON.stringify(next, null, 2))

  const setEntry = (key: string, raw: string) => {
    if (!obj) return
    commit({ ...obj, [key]: coerce(raw) })
  }

  const renameKey = (oldKey: string, newName: string) => {
    if (!obj || !newName.trim() || newName === oldKey) return
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) next[k === oldKey ? newName.trim() : k] = v
    commit(next)
  }

  const removeKey = (key: string) => {
    if (!obj) return
    const next = { ...obj }
    delete next[key]
    commit(next)
  }

  const addField = () => {
    const key = newKey.trim()
    if (!obj || !key || key in obj) return
    commit({ ...obj, [key]: '' })
    setNewKey('')
  }

  const fieldsDisabled = obj === null

  return (
    <div className="jfe">
      <div className="jfe-head">
        <div className="seg jfe-seg">
          <button
            className={mode === 'fields' ? 'on' : ''}
            title={fieldsDisabled ? 'Not a JSON object — fix the raw JSON first' : 'Edit as fields'}
            onClick={() => !fieldsDisabled && setMode('fields')}
          >
            <Rows3 size={11} /> Fields
          </button>
          <button className={mode === 'raw' ? 'on' : ''} title="Edit raw JSON" onClick={() => setMode('raw')}>
            <Braces size={11} /> JSON
          </button>
        </div>
        {fieldsDisabled && <span className="jfe-warn">not a JSON object — raw only</span>}
      </div>

      {mode === 'fields' && obj !== null ? (
        <div className="jfe-rows">
          {Object.entries(obj).map(([key, v]) => (
            <div className="jfe-row" key={key}>
              <input
                className="jfe-key"
                defaultValue={key}
                onBlur={e => renameKey(key, e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <input
                className="jfe-val"
                value={display(v)}
                placeholder="value or {{token}}"
                onChange={e => setEntry(key, e.target.value)}
              />
              <button className="btn icon danger" title="Delete field" onClick={() => removeKey(key)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <div className="jfe-row">
            <input
              className="jfe-key"
              placeholder="new field"
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addField()}
            />
            <button className="btn" onClick={addField} disabled={!newKey.trim()}>
              <Plus size={12} /> Add
            </button>
          </div>
        </div>
      ) : (
        <textarea
          className="jfe-raw"
          spellCheck={false}
          placeholder={placeholder || '{"key": "value"}'}
          value={value || ''}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  )
}
