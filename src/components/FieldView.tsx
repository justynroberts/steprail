// MIT License - Copyright (c) fintonlabs.com
// Structured data view: payloads render as labeled fields, not JSON.
// A raw toggle keeps the escape hatch for people who want the braces.
import { useState } from 'react'
import { Braces } from 'lucide-react'

export interface FieldRow {
  path: string
  value: string
  kind: 'string' | 'number' | 'boolean' | 'null' | 'list'
}

export function flattenData(obj: Record<string, unknown>, prefix = '', depth = 0): FieldRow[] {
  const rows: FieldRow[] = []
  for (const [key, raw] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (raw === null || raw === undefined) {
      rows.push({ path, value: 'empty', kind: 'null' })
    } else if (Array.isArray(raw)) {
      const prims = raw.filter(v => typeof v !== 'object')
      if (prims.length === raw.length) {
        const shown = raw.slice(0, 4).join(', ')
        rows.push({ path, value: raw.length > 4 ? `${shown} +${raw.length - 4} more` : shown || 'empty list', kind: 'list' })
      } else {
        rows.push({ path, value: `${raw.length} ${raw.length === 1 ? 'item' : 'items'}`, kind: 'list' })
        if (raw[0] && typeof raw[0] === 'object' && depth < 2) {
          rows.push(...flattenData(raw[0] as Record<string, unknown>, `${path}[0]`, depth + 1))
        }
      }
    } else if (typeof raw === 'object') {
      if (depth < 2) rows.push(...flattenData(raw as Record<string, unknown>, path, depth + 1))
      else rows.push({ path, value: JSON.stringify(raw), kind: 'string' })
    } else {
      rows.push({
        path,
        value: String(raw),
        kind: typeof raw === 'number' ? 'number' : typeof raw === 'boolean' ? 'boolean' : 'string',
      })
    }
  }
  return rows
}

export function FieldView({ data, title }: { data: Record<string, unknown>; title?: string }) {
  const [raw, setRaw] = useState(false)
  const rows = flattenData(data)
  return (
    <div className="field-view">
      <div className="fv-head">
        <span className="fv-title">{title || 'Data'}</span>
        <button className={`fv-raw${raw ? ' on' : ''}`} title="Toggle raw JSON" onClick={() => setRaw(r => !r)}>
          <Braces size={11} />
        </button>
      </div>
      {raw ? (
        <pre className="fv-pre">{JSON.stringify(data, null, 2)}</pre>
      ) : (
        <div className="fv-rows">
          {rows.map(row => (
            <div className="fv-row" key={row.path}>
              <span className="fv-key">{row.path}</span>
              <span className={`fv-val ${row.kind}`}>{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
