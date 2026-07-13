// MIT License - Copyright (c) fintonlabs.com
// The blueprint gallery as a page: tagged cards, search, your saved ones
// alongside the built-ins. Clicking one creates a flow and opens the editor.
import { useEffect, useMemo, useState } from 'react'
import { BookmarkPlus, Search } from 'lucide-react'
import { BlueprintCard } from './BlueprintCard'
import { active, uid, useDispatch, useEditor } from '../state'
import { BUILTIN_BLUEPRINTS, flowFromBlueprint, type Blueprint } from '../blueprints'
import { serializeFlow } from '../flowjson'
import { fetchBlueprints, saveBlueprints } from '../api'

export function BlueprintsHome({ onOpen }: { onOpen: (id: string) => void }) {
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

  const use = (bp: Blueprint) => {
    const created = flowFromBlueprint(bp)
    dispatch({ type: 'create', flow: created })
    onOpen(created.id)
  }

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
    <div className="page">
      <div className="page-head">
        <h1>Blueprints</h1>
        <span className="page-sub">{all.length} starting points</span>
        <span className="spacer" />
        {flow && flow.steps.length > 0 && (
          <>
            <input
              className="var-input"
              style={{ width: 220 }}
              placeholder={`Save "${flow.name}" as…`}
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveCurrent()}
            />
            <button className="btn" onClick={saveCurrent} disabled={!saveName.trim()}>
              <BookmarkPlus size={14} /> Save
            </button>
          </>
        )}
      </div>

      <div className="page-filters">
        <div className="search" style={{ margin: 0, maxWidth: 320, flex: 1 }}>
          <Search size={13} />
          <input placeholder="Search blueprints" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        {allTags.map(t => (
          <button key={t} className={`tag-chip${tagFilter === t ? ' on' : ''}`} onClick={() => setTagFilter(cur => (cur === t ? null : t))}>
            {t}
          </button>
        ))}
      </div>

      <div className="bp-grid">
        {visible.map(bp => (
          <BlueprintCard key={bp.id} bp={bp} onUse={() => use(bp)} onDelete={bp.custom ? () => remove(bp.id) : undefined} />
        ))}
        {visible.length === 0 && <div className="settings-note" style={{ padding: 20 }}>No blueprints match.</div>}
      </div>
    </div>
  )
}
