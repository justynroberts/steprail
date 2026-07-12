// MIT License - Copyright (c) fintonlabs.com
// The tool library. Drag a tool onto the rail, or click to append it.
import { useMemo, useState, type DragEvent } from 'react'
import { Search, Workflow } from 'lucide-react'
import { CATEGORY_LABEL, CATEGORY_ORDER, TOOLS } from '../tools'
import { active, useDispatch, useEditor } from '../state'
import { CATEGORY_VAR, useUI } from '../ui'

export function Palette() {
  const dispatch = useDispatch()
  const state = useEditor()
  const { setDragging } = useUI()
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const visible = q
      ? TOOLS.filter(t => (t.name + t.description + t.category).toLowerCase().includes(q))
      : TOOLS
    return CATEGORY_ORDER.map(cat => ({ cat, tools: visible.filter(t => t.category === cat) })).filter(g => g.tools.length)
  }, [query])

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
        {groups.map(({ cat, tools }) => (
          <div key={cat}>
            <div className="group-title" style={{ color: CATEGORY_VAR[cat] }}>{CATEGORY_LABEL[cat]}</div>
            {tools.map(tool => (
              <button
                key={tool.id}
                className="tool-item"
                draggable
                onDragStart={onDragStart(tool.id)}
                onDragEnd={() => setDragging(null)}
                onClick={() => append(tool.id)}
                title="Drag onto the rail, or click to append"
              >
                <tool.icon size={16} style={{ color: CATEGORY_VAR[tool.category] }} />
                <span>
                  {tool.name}
                  <span className="desc">{tool.description}</span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="hint">
        Drag onto the rail — every legal spot lights up. Or press <span className="kbd">/</span> anywhere to insert by keyboard.
      </div>
    </aside>
  )
}
