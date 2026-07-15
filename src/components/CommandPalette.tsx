// MIT License - Copyright (c) fintonlabs.com
// Keyboard-first insertion: fuzzy-search the catalog, Enter drops the tool
// into the slot that asked for it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardPaste, Search } from 'lucide-react'
import type { SlotPath } from '../types'
import { TOOLS } from '../tools'
import { useDispatch } from '../state'
import { CATEGORY_VAR, useUI } from '../ui'

export function CommandPalette({ at, onClose }: { at: SlotPath; onClose: () => void }) {
  const dispatch = useDispatch()
  const { clipboard } = useUI()
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return TOOLS
    // Light fuzzy scoring: name-prefix beats name-contains beats description.
    return TOOLS
      .map(t => {
        const name = t.name.toLowerCase()
        let score = -1
        if (name.startsWith(q)) score = 3
        else if (name.includes(q)) score = 2
        else if (t.description.toLowerCase().includes(q) || t.category.includes(q)) score = 1
        return { t, score }
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(r => r.t)
  }, [query])

  const pick = (toolId: string) => {
    dispatch({ type: 'insert', toolId, at })
    onClose()
  }

  const paste = () => {
    if (!clipboard) return
    dispatch({ type: 'insert-step', step: clipboard, at })
    onClose()
  }

  // Total list length for keyboard nav: clipboard item (if present) + tool results.
  const showClipboard = !!clipboard && !query
  const total = (showClipboard ? 1 : 0) + results.length

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, total - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter') {
      if (showClipboard && sel === 0) { paste(); return }
      const toolIdx = showClipboard ? sel - 1 : sel
      if (results[toolIdx]) pick(results[toolIdx].id)
    }
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmdk" onKeyDown={onKey}>
        <div className="cmdk-input">
          <Search size={15} style={{ color: 'var(--text-4)' }} />
          <input
            ref={inputRef}
            placeholder="Add a step..."
            value={query}
            onChange={e => { setQuery(e.target.value); setSel(0) }}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="cmdk-list">
          {showClipboard && (
            <button
              className={`cmdk-item${sel === 0 ? ' sel' : ''}`}
              onMouseEnter={() => setSel(0)}
              onClick={paste}
            >
              <ClipboardPaste size={15} style={{ color: 'var(--accent)' }} />
              <span>
                Paste: {clipboard!.name}
                <span className="desc">from clipboard</span>
              </span>
              <span className="cat-tag">clipboard</span>
            </button>
          )}
          {results.length === 0 && !!query && <div className="cmdk-empty">Nothing matches &ldquo;{query}&rdquo;</div>}
          {results.map((tool, i) => {
            const idx = showClipboard ? i + 1 : i
            return (
              <button
                key={tool.id}
                className={`cmdk-item${idx === sel ? ' sel' : ''}`}
                onMouseEnter={() => setSel(idx)}
                onClick={() => pick(tool.id)}
              >
                <tool.icon size={15} style={{ color: CATEGORY_VAR[tool.category] }} />
                <span>
                  {tool.name}
                  <span className="desc">{tool.description}</span>
                </span>
                <span className="cat-tag">{tool.category}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
