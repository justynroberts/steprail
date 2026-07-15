// MIT License - Copyright (c) fintonlabs.com
// The project switcher lives at the top of the nav rail: a compact button
// showing the active project, and a popover for switching, creating,
// renaming, and deleting projects. Projects are the tenant boundary —
// flows, runs, and secrets segment by the active one.
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, FolderKanban, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Project } from '../types'
import { addProject, deleteProject, renameProject } from '../api'
import { showToast } from '../toast'

const PALETTE = ['#5e6ad2', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6', '#ec4899', '#14b8a6']

interface Props {
  projects: Project[]
  activeId: string
  onSwitch: (id: string) => void
  onChanged: () => void // reload the projects list after create/rename/delete
}

export function ProjectSwitcher({ projects, activeId, onSwitch, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [error, setError] = useState('')
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const current = projects.find(p => p.id === activeId) || projects[0]

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setError('')
    const color = PALETTE[projects.length % PALETTE.length]
    const result = await addProject(name, color)
    if ('error' in result) { setError(result.error); return }
    setNewName('')
    onChanged()
    onSwitch(result.id)
    setOpen(false)
  }

  const saveRename = async (id: string) => {
    const name = renameValue.trim()
    setRenamingId(null)
    if (!name) return
    const result = await renameProject(id, name)
    if ('error' in result) { setError(result.error); return }
    setError('')
    onChanged()
  }

  const remove = async (p: Project) => {
    if (!window.confirm(`Delete project "${p.name}"? Its flows and secrets move to Default.`)) return
    const result = await deleteProject(p.id)
    if (result.error) { setError(result.error); return }
    const moved = (result.movedFlows || 0) + (result.movedSecrets || 0)
    showToast(`"${p.name}" deleted${moved ? ` — ${moved} item${moved === 1 ? '' : 's'} moved to Default` : ''}`)
    if (activeId === p.id) onSwitch('default')
    onChanged()
  }

  return (
    <>
      <button
        ref={btnRef}
        className="proj-switch"
        title={`Project: ${current?.name || 'Default'}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="proj-dot" style={{ background: current?.color || 'var(--accent)' }} />
        <span className="proj-switch-name">{current?.name || 'Default'}</span>
        <ChevronsUpDown size={11} />
      </button>

      {open && (
        <div className="proj-pop" ref={popRef}>
          <div className="proj-pop-head">
            <FolderKanban size={13} />
            <span>Projects</span>
          </div>
          {projects.map(p => (
            <div key={p.id} className={`proj-row${p.id === activeId ? ' on' : ''}`}>
              {renamingId === p.id ? (
                <input
                  className="var-input proj-rename"
                  value={renameValue}
                  autoFocus
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void saveRename(p.id)
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={() => void saveRename(p.id)}
                />
              ) : (
                <>
                  <button className="proj-row-main" onClick={() => { onSwitch(p.id); setOpen(false) }}>
                    <span className="proj-dot" style={{ background: p.color }} />
                    <span className="proj-row-name">{p.name}</span>
                    {p.id === activeId && <Check size={12} />}
                  </button>
                  {p.id !== 'default' && (
                    <span className="proj-row-actions">
                      <button className="btn icon" title="Rename" onClick={() => { setRenamingId(p.id); setRenameValue(p.name) }}>
                        <Pencil size={11} />
                      </button>
                      <button className="btn icon danger" title="Delete — contents move to Default" onClick={() => void remove(p)}>
                        <Trash2 size={11} />
                      </button>
                    </span>
                  )}
                </>
              )}
            </div>
          ))}
          <div className="proj-new">
            <input
              className="var-input"
              placeholder="New project…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void create()}
            />
            <button className="btn icon" title="Create project" onClick={() => void create()} disabled={!newName.trim()}>
              <Plus size={13} />
            </button>
          </div>
          {error && <div className="proj-error">{error}</div>}
          <div className="proj-pop-note">Flows, runs, and secrets segment by project.</div>
        </div>
      )}
    </>
  )
}
