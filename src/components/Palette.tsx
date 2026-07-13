// MIT License - Copyright (c) fintonlabs.com
// The left nav: four sections — Tools (the drag palette), Workflows,
// Blueprints, and Config (connections/secrets/settings).
import { useMemo, useState, type DragEvent } from 'react'
import { ChevronDown, ChevronRight, LayoutTemplate, Plug, Search, Wrench, Workflow } from 'lucide-react'
import type { Category, Settings } from '../types'
import { CATEGORY_LABEL, CATEGORY_ORDER, TOOLS } from '../tools'
import { active, useDispatch, useEditor } from '../state'
import { CATEGORY_VAR, useUI } from '../ui'
import { FlowsPanel } from './FlowsPanel'
import { BlueprintsPanel } from './BlueprintsPanel'
import { SettingsPanel } from './SettingsPanel'

type SideTab = 'tools' | 'flows' | 'blueprints' | 'config'

const TABS: { id: SideTab; label: string; icon: typeof Wrench }[] = [
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'flows', label: 'Flows', icon: Workflow },
  { id: 'blueprints', label: 'Prints', icon: LayoutTemplate },
  { id: 'config', label: 'Config', icon: Plug },
]

export function Palette({ settings, onSettingsChange }: { settings: Settings; onSettingsChange: (patch: Partial<Settings>) => void }) {
  const [tab, setTab] = useState<SideTab>('tools')
  return (
    <aside className="palette">
      <div className="brand">
        <Workflow size={18} />
        newflow
        <span className="ver">v0.1</span>
      </div>
      <div className="side-tabs">
        {TABS.map(t => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} title={t.id === 'blueprints' ? 'Blueprints' : t.label} onClick={() => setTab(t.id)}>
            <t.icon size={14} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {tab === 'tools' && <ToolsPanel />}
      {tab === 'flows' && <FlowsPanel />}
      {tab === 'blueprints' && <BlueprintsPanel />}
      {tab === 'config' && <SettingsPanel settings={settings} onChange={onSettingsChange} />}
    </aside>
  )
}

function ToolsPanel() {
  const dispatch = useDispatch()
  const state = useEditor()
  const { setDragging } = useUI()
  const [query, setQuery] = useState('')
  // Categories start minimized — search always reveals matches regardless.
  const [collapsed, setCollapsed] = useState<Set<Category>>(new Set(CATEGORY_ORDER))

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const visible = q
      ? TOOLS.filter(t => (t.name + t.description + t.category).toLowerCase().includes(q))
      : TOOLS
    return CATEGORY_ORDER.map(cat => ({ cat, tools: visible.filter(t => t.category === cat) })).filter(g => g.tools.length)
  }, [query])

  const toggle = (cat: Category) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })

  const onDragStart = (toolId: string) => (e: DragEvent) => {
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('text/plain', toolId)
    setDragging({ kind: 'tool', id: toolId })
  }

  const append = (toolId: string) => {
    const flow = active(state)
    if (!flow) return
    dispatch({ type: 'insert', toolId, at: { hops: [], index: flow.steps.length } })
  }

  return (
    <>
      <div className="search">
        <Search size={13} />
        <input placeholder="Search tools" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      <div className="groups">
        {groups.map(({ cat, tools }) => {
          // While searching, always show matches regardless of collapse state.
          const open = query.trim() ? true : !collapsed.has(cat)
          return (
            <div key={cat}>
              <button className="group-title" style={{ color: CATEGORY_VAR[cat] }} onClick={() => toggle(cat)}>
                {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                {CATEGORY_LABEL[cat]}
                <span className="group-count">{tools.length}</span>
              </button>
              {open && tools.map(tool => (
                <button
                  key={tool.id}
                  className="tool-item"
                  draggable
                  onDragStart={onDragStart(tool.id)}
                  onDragEnd={() => setDragging(null)}
                  onClick={() => append(tool.id)}
                  title={`${tool.description} — drag onto the rail, or click to append`}
                >
                  <tool.icon size={15} style={{ color: CATEGORY_VAR[tool.category] }} />
                  <span className="tool-name">{tool.name}</span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
      <div className="hint">
        Drag onto the rail — every legal spot lights up. Or press <span className="kbd">/</span> anywhere to insert by keyboard.
      </div>
    </>
  )
}
