// MIT License - Copyright (c) fintonlabs.com
// The tool library. Drag a tool onto the rail, or click to append it.
// Dense by design: one line per tool (description in the tooltip) and
// collapsible categories, so a large catalog fits without scrolling.
import { useMemo, useState, type DragEvent } from 'react'
import { ChevronDown, ChevronRight, Search, Workflow } from 'lucide-react'
import type { Category } from '../types'
import { CATEGORY_LABEL, CATEGORY_ORDER, TOOLS } from '../tools'
import { active, useDispatch, useEditor } from '../state'
import { CATEGORY_VAR, useUI } from '../ui'

export function Palette() {
  const dispatch = useDispatch()
  const state = useEditor()
  const { setDragging } = useUI()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<Category>>(new Set())

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
    <aside className="palette">
      <div className="brand">
        <Workflow size={18} />
        newflow
        <span className="ver">v0.1</span>
      </div>
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
    </aside>
  )
}
