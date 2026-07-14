// MIT License - Copyright (c) fintonlabs.com
// The flows home: built for dozens of workflows. Search, tag filters, live
// status, and file import/export (variables and tags travel in the file).
import { useMemo, useRef, useState } from 'react'
import { Download, Plus, Search, Sparkles, Trash2, Upload, Workflow } from 'lucide-react'
import { StepHanDialog } from './StepHanDialog'
import type { Flow } from '../types'
import { useDispatch, useEditor } from '../state'
import { makeFlow } from '../blueprints'
import { hydrateFlow, serializeFlow } from '../flowjson'

const ago = (ts: number) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function FlowsHome({ onOpen }: { onOpen: (id: string) => void }) {
  const state = useEditor()
  const dispatch = useDispatch()
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const [stephanOpen, setStephanOpen] = useState(false)

  const allTags = useMemo(() => [...new Set(state.flows.flatMap(f => f.tags || []))].sort(), [state.flows])

  const visible = state.flows.filter(f => {
    if (tagFilter && !(f.tags || []).includes(tagFilter)) return false
    const q = query.trim().toLowerCase()
    return !q || f.name.toLowerCase().includes(q) || (f.tags || []).some(t => t.includes(q))
  })

  const exportFile = (flow: Flow) => {
    const blob = new Blob([JSON.stringify(serializeFlow(flow), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${flow.name.replace(/[^\w-]+/g, '-').toLowerCase()}.flow.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importFile = async (file: File) => {
    setNotes([])
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      setNotes([`${file.name} is not valid JSON.`])
      return
    }
    const { name, steps, vars, tags, warnings } = hydrateFlow(parsed)
    if (!steps.length) {
      setNotes(warnings.length ? warnings : ['No usable steps in that file.'])
      return
    }
    const flow = makeFlow(name, steps, vars, tags)
    dispatch({ type: 'create', flow })
    setNotes(warnings)
    onOpen(flow.id)
  }

  const newFlow = () => {
    const flow = makeFlow('Untitled flow')
    dispatch({ type: 'create', flow })
    onOpen(flow.id)
  }

  return (
    <div className="page">
      {stephanOpen && <StepHanDialog onOpen={onOpen} onClose={() => setStephanOpen(false)} />}
      <div className="page-head">
        <h1>Flows</h1>
        <span className="page-sub">{state.flows.length} workflow{state.flows.length === 1 ? '' : 's'}</span>
        <span className="spacer" />
        <button className="btn stephan-btn" onClick={() => setStephanOpen(true)} title="StepHan — describe a job, get a flow">
          <Sparkles size={14} /> StepHan
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()} title="Import a .flow.json file — variables and tags included">
          <Upload size={14} /> Import
        </button>
        <button className="btn primary" onClick={newFlow}>
          <Plus size={14} /> New flow
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = '' }}
        />
      </div>

      <div className="page-filters">
        <div className="search" style={{ margin: 0, maxWidth: 320, flex: 1 }}>
          <Search size={13} />
          <input placeholder="Search flows and tags" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        {allTags.map(t => (
          <button key={t} className={`tag-chip${tagFilter === t ? ' on' : ''}`} onClick={() => setTagFilter(cur => (cur === t ? null : t))}>
            {t}
          </button>
        ))}
      </div>

      {notes.length > 0 && <div className="compose-warnings" style={{ margin: '0 0 12px' }}>{notes.map(n => <div key={n}>{n}</div>)}</div>}

      <div className="flow-table">
        {visible.map(f => (
          <div key={f.id} className="flow-line" onClick={() => onOpen(f.id)}>
            <Workflow size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span className="fl-name">{f.name}</span>
            <span className="flow-row-tags">
              {(f.tags || []).map(t => <span key={t} className="tag-chip small">{t}</span>)}
            </span>
            <span className="spacer" />
            <span className={`live-badge${f.active === false ? ' off' : ''}`}>{f.active === false ? 'Off' : 'Live'}</span>
            <span className="fl-updated">{ago(f.updatedAt)}</span>
            <button className="btn icon fl-action" title="Export as file" onClick={e => { e.stopPropagation(); exportFile(f) }}>
              <Download size={13} />
            </button>
            <button className="btn icon danger fl-action" title="Delete flow" onClick={e => { e.stopPropagation(); dispatch({ type: 'delete-flow', id: f.id }) }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {visible.length === 0 && <div className="settings-note" style={{ padding: 20 }}>No flows match — create one or import a file.</div>}
      </div>
    </div>
  )
}
