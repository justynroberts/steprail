// MIT License - Copyright (c) fintonlabs.com
// The blueprints section: tagged, searchable starting points. Click one to
// spin up a new flow; save the current flow to add your own.
import { useEffect, useMemo, useState } from 'react'
import { BookmarkPlus, LayoutTemplate, Search, Trash2 } from 'lucide-react'
import { active, useDispatch, useEditor } from '../state'
import { BUILTIN_BLUEPRINTS, flowFromBlueprint, type Blueprint } from '../blueprints'
import { serializeFlow } from '../flowjson'
import { fetchBlueprints, saveBlueprints } from '../api'
import { uid } from '../state'

export function BlueprintsPanel() {
  const state = useEditor()
  const dispatch = useDispatch()
  const flow = active(state)
  const [custom, setCustom] = useState<Blueprint[]>([])
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('')

  useEffect(() => {
    void fetchBlueprints().then(setCustom)
  }, [])

  const all = useMemo(() => [...custom, ...BUILTIN_BLUEPRINTS], [custom])
  const allTags = useMemo(() => [...new Set(all.flatMap(b => b.tags || []))].sort(), [all])

  const visible = all.filter(bp => {
    if (tagFilter && !(bp.tags || []).includes(tagFilter)) return false
    const q = query.trim().toLowerCase()
    return !q || bp.name.toLowerCase().includes(q) || bp.description.toLowerCase().includes(q) || (bp.tags || []).some(t => t.includes(q))
  })

  const remove = (id: string) => {
    const next = custom.filter(b => b.id !== id)
    setCustom(next)
    void saveBlueprints(next)
  }

  const saveCurrent = () => {
    if (!flow || !flow.steps.length || !saveName.trim()) return
    const bp: Blueprint = {
      id: uid(),
      name: saveName.trim(),
      description: `${flow.steps.length} steps`,
      flow: serializeFlow({ ...flow, name: saveName.trim() }),
      tags: flow.tags,
      custom: true,
    }
    const next = [bp, ...custom]
    setCustom(next)
    void saveBlueprints(next)
    setSaveName('')
  }

  return (
    <div className="side-panel">
      <div className="search">
        <Search size={13} />
        <input placeholder="Search blueprints" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      {allTags.length > 0 && (
        <div className="tag-filter">
          {allTags.map(t => (
            <button key={t} className={`tag-chip${tagFilter === t ? ' on' : ''}`} onClick={() => setTagFilter(cur => (cur === t ? null : t))}>
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="side-list">
        {visible.map(bp => (
          <div key={bp.id} className="flow-row bp" onClick={() => dispatch({ type: 'create', flow: flowFromBlueprint(bp) })} title={bp.description}>
            <LayoutTemplate size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span className="flow-row-main">
              <span className="flow-row-name">
                {bp.name}
                {bp.custom && <span className="bp-badge">saved</span>}
              </span>
              {(bp.tags?.length ?? 0) > 0 && (
                <span className="flow-row-tags">
                  {bp.tags!.map(t => <span key={t} className="tag-chip small">{t}</span>)}
                </span>
              )}
            </span>
            {bp.custom && (
              <button className="btn icon danger flow-row-del" title="Delete blueprint" onClick={e => { e.stopPropagation(); remove(bp.id) }}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
        {visible.length === 0 && <div className="settings-note" style={{ padding: '4px 8px' }}>No blueprints match.</div>}
      </div>
      <div className="side-actions">
        <input
          className="var-input"
          placeholder="Save current flow as…"
          value={saveName}
          onChange={e => setSaveName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && saveCurrent()}
        />
        <button className="btn" onClick={saveCurrent} disabled={!saveName.trim() || !flow?.steps.length}>
          <BookmarkPlus size={13} />
        </button>
      </div>
    </div>
  )
}
