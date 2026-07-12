// MIT License - Copyright (c) fintonlabs.com
// The insertion slot — the core of the no-wires model. Invisible until you
// hover or drag; while dragging, every legal slot inflates into a target.
import { useState, type DragEvent } from 'react'
import { Plus } from 'lucide-react'
import type { SlotPath } from '../types'
import { useDispatch } from '../state'
import { useUI } from '../ui'

export function DropSlot({ at }: { at: SlotPath }) {
  const dispatch = useDispatch()
  const { dragging, setDragging, openPalette } = useUI()
  const [over, setOver] = useState(false)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    if (!dragging) return
    if (dragging.kind === 'tool') dispatch({ type: 'insert', toolId: dragging.id, at })
    else dispatch({ type: 'move', stepId: dragging.id, at })
    setDragging(null)
  }

  return (
    <div
      className={`slot${dragging ? ' armed' : ''}${over ? ' over' : ''}`}
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <button className="plus" title="Add a step here" onClick={() => openPalette(at)}>
        <Plus size={12} strokeWidth={2.2} />
      </button>
    </div>
  )
}
