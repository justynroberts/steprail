// MIT License - Copyright (c) fintonlabs.com
// The workflows section: every flow, searchable and taggable — built for
// dozens of flows, not five. Files move flows between people and instances,
// variables and tags included.
import { useMemo, useRef, useState } from 'react'
import { Download, Plus, Tag, Trash2, Upload } from 'lucide-react'
import { active, useDispatch, useEditor } from '../state'
import { makeFlow } from '../blueprints'
import { hydrateFlow, serializeFlow } from '../flowjson'

export function FlowsPanel() {
  const state = useEditor()
  const dispatch = useDispatch()
  const flow = active(state)
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [newTag, setNewTag] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const allTags = useMemo(
    () => [...new Set(state.flows.flatMap(f => f.tags || []))].sort(),
    [state.flows],
  )

  const visible = state.flows.filter(f => {
    if (tagFilter && !(f.tags || []).includes(tagFilter)) return false
    const q = query.trim().toLowerCase()
    return !q || f.name.toLowerCase().includes(q) || (f.tags || []).some(t => t.includes(q))
  })

  const exportFile = () => {
    if (!flow) return
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
    dispatch({ type: 'create', flow: makeFlow(name, steps, vars, tags) })
    setNotes(warnings)
  }

  const addTag = () => {
    if (!flow || !newTag.trim()) return
    dispatch({ type: 'set-tags', tags: [...(flow.tags || []), newTag] })
    setNewTag('')
  }

  return (
    <div className="side-panel">
      <div className="search">
        <Tag size={13} />
        <input placeholder="Search flows and tags" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      {allTags.length > 0 && (
        <div className="tag-filter">
          {allTags.map(t => (
            <button
              key={t}
              className={`tag-chip${tagFilter === t ? ' on' : ''}`}
              onClick={() => setTagFilter(cur => (cur === t ? null : t))}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="side-list">
        {visible.map(f => (
          <div
            key={f.id}
            className={`flow-row${f.id === state.activeId ? ' sel' : ''}`}
            onClick={() => dispatch({ type: 'select', id: f.id })}
          >
            <span className={`status-dot ${f.active === false ? 'idle' : 'success'}`} title={f.active === false ? 'Triggers off' : 'Live'} />
            <span className="flow-row-main">
              <span className="flow-row-name">{f.name}</span>
              {(f.tags?.length || f.id === state.activeId) && (
                <span className="flow-row-tags">
                  {(f.tags || []).map(t => (
                    <button
                      key={t}
                      className="tag-chip small"
                      title={f.id === state.activeId ? 'Remove tag' : t}
                      onClick={e => {
                        e.stopPropagation()
                        if (f.id === state.activeId) dispatch({ type: 'set-tags', tags: (f.tags || []).filter(x => x !== t) })
                      }}
                    >
                      {t}
                    </button>
                  ))}
                  {f.id === state.activeId && (
                    <input
                      className="tag-add"
                      placeholder="+ tag"
                      value={newTag}
                      onClick={e => e.stopPropagation()}
                      onChange={e => setNewTag(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addTag()}
                    />
                  )}
                </span>
              )}
            </span>
            <button
              className="btn icon danger flow-row-del"
              title="Delete flow"
              onClick={e => { e.stopPropagation(); dispatch({ type: 'delete-flow', id: f.id }) }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {visible.length === 0 && <div className="settings-note" style={{ padding: '4px 8px' }}>No flows match.</div>}
      </div>
      {notes.length > 0 && (
        <div className="compose-warnings" style={{ margin: '0 8px 8px' }}>
          {notes.map(n => <div key={n}>{n}</div>)}
        </div>
      )}
      <div className="side-actions">
        <button className="btn" onClick={() => dispatch({ type: 'create', flow: makeFlow('Untitled flow') })}>
          <Plus size={13} /> New
        </button>
        <button className="btn" title="Import a .flow.json file (variables and tags included)" onClick={() => fileRef.current?.click()}>
          <Upload size={13} /> Import
        </button>
        <button className="btn" title="Download this flow as a file to share" onClick={exportFile} disabled={!flow}>
          <Download size={13} /> Export
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = '' }}
        />
      </div>
    </div>
  )
}
