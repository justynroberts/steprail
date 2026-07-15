// MIT License - Copyright (c) fintonlabs.com
// The blueprint gallery as a page: pack sidebar + tagged cards, search, your saved ones
// alongside the built-ins. Clicking one creates a flow and opens the editor.
import { useEffect, useMemo, useState } from 'react'
import { BookmarkPlus, Search } from 'lucide-react'
import { BlueprintCard } from './BlueprintCard'
import { active, uid, useDispatch, useEditor } from '../state'
import { BUILTIN_BLUEPRINTS, PACKS, flowFromBlueprint, type Blueprint } from '../blueprints'
import { serializeFlow } from '../flowjson'
import { fetchBlueprints, saveBlueprints } from '../api'
import { showToast } from '../toast'

export function BlueprintsHome({ onOpen }: { onOpen: (id: string) => void }) {
  const state = useEditor()
  const dispatch = useDispatch()
  const flow = active(state)
  const [custom, setCustom] = useState<Blueprint[]>([])
  const [query, setQuery] = useState('')
  const [activePack, setActivePack] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('')

  useEffect(() => { void fetchBlueprints().then(setCustom) }, [])

  const all = useMemo(() => [...custom.map(b => ({ ...b, pack: 'custom' })), ...BUILTIN_BLUEPRINTS], [custom])

  const visible = useMemo(() => {
    let list = all
    if (activePack === 'custom') list = list.filter(b => b.custom)
    else if (activePack) list = list.filter(b => b.pack === activePack)
    const q = query.trim().toLowerCase()
    if (q) list = list.filter(b => b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q) || (b.tags || []).some(t => t.includes(q)))
    return list
  }, [all, activePack, query])

  const packCounts = useMemo(() => {
    const counts: Record<string, number> = { all: all.length }
    if (custom.length) counts['custom'] = custom.length
    for (const p of PACKS) counts[p.id] = all.filter(b => b.pack === p.id).length
    return counts
  }, [all, custom])

  const use = (bp: Blueprint) => {
    const created = flowFromBlueprint(bp)
    dispatch({ type: 'create', flow: created })
    onOpen(created.id)
  }

  const remove = (id: string) => {
    const bp = custom.find(b => b.id === id)
    if (!bp) return
    const next = custom.filter(b => b.id !== id)
    setCustom(next)
    void saveBlueprints(next)
    showToast(`"${bp.name}" deleted`, {
      kind: 'danger',
      action: {
        label: 'Undo',
        fn: () => {
          const restored = [bp, ...next]
          setCustom(restored)
          void saveBlueprints(restored)
        },
      },
    })
  }

  const saveCurrent = () => {
    if (!flow || !flow.steps.length || !saveName.trim()) return
    const bp: Blueprint = {
      id: uid(), name: saveName.trim(), description: `${flow.steps.length} steps`,
      flow: serializeFlow({ ...flow, name: saveName.trim() }),
      tags: flow.tags, custom: true,
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
            <input className="var-input" style={{ width: 220 }} placeholder={`Save "${flow.name}" as…`}
              value={saveName} onChange={e => setSaveName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveCurrent()} />
            <button className="btn" onClick={saveCurrent} disabled={!saveName.trim()}>
              <BookmarkPlus size={14} /> Save
            </button>
          </>
        )}
      </div>

      <div className="bp-layout">
        {/* Pack sidebar */}
        <div className="bp-pack-sidebar">
          <button className={`bp-pack-item${!activePack ? ' on' : ''}`} onClick={() => setActivePack(null)}>
            <span className="bp-pack-dot" style={{ background: 'var(--accent)' }} />
            <span className="bp-pack-name">All</span>
            <span className="bp-pack-count">{packCounts.all}</span>
          </button>
          {custom.length > 0 && (
            <button className={`bp-pack-item${activePack === 'custom' ? ' on' : ''}`} onClick={() => setActivePack('custom')}>
              <span className="bp-pack-dot" style={{ background: 'var(--text-4)' }} />
              <span className="bp-pack-name">My blueprints</span>
              <span className="bp-pack-count">{packCounts.custom}</span>
            </button>
          )}
          <div className="bp-pack-divider" />
          {PACKS.map(pack => (
            <button key={pack.id} className={`bp-pack-item${activePack === pack.id ? ' on' : ''}`} onClick={() => setActivePack(pack.id)}>
              <span className="bp-pack-dot" style={{ background: pack.accent.startsWith('var(') ? `var(--accent)` : pack.accent }} />
              <span className="bp-pack-name">{pack.name}</span>
              <span className="bp-pack-count">{packCounts[pack.id] || 0}</span>
            </button>
          ))}
        </div>

        {/* Content area */}
        <div className="bp-pack-content">
          <div className="bp-pack-header">
            {activePack ? (
              <div>
                <div className="bp-pack-title">{PACKS.find(p => p.id === activePack)?.name ?? 'My blueprints'}</div>
                <div className="bp-pack-subtitle">{PACKS.find(p => p.id === activePack)?.description ?? 'Your saved blueprints'}</div>
              </div>
            ) : (
              <div>
                <div className="bp-pack-title">All packs</div>
                <div className="bp-pack-subtitle">Every starting-point flow across all packs</div>
              </div>
            )}
            <div className="search" style={{ margin: 0, maxWidth: 260 }}>
              <Search size={13} />
              <input placeholder="Search blueprints" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
          </div>

          <div className="bp-grid">
            {visible.map(bp => (
              <BlueprintCard key={bp.id} bp={bp} onUse={() => use(bp)} onDelete={bp.custom ? () => remove(bp.id) : undefined} />
            ))}
            {visible.length === 0 && <div className="settings-note" style={{ padding: 20 }}>No blueprints match.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
