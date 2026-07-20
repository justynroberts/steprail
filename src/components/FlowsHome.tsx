// MIT License - Copyright (c) fintonlabs.com
// The flows home: compact row list with a hover-preview popover for detail.
// Clicking a row opens the editor; hovering shows the step chain and metadata.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, BookText, Clock, Copy, Download, GitBranch, GitMerge, Globe,
  LayoutGrid, Plus, Search, Terminal, Trash2, Upload, Webhook, Workflow, Zap,
} from 'lucide-react'
import type { Flow } from '../types'
import { useDispatch, useEditor } from '../state'
import { makeFlow } from '../blueprints'
import { uniqueFlowName } from '../projects'
import { hydrateFlow, serializeFlow } from '../flowjson'
import { toolById } from '../tools'
import { CATEGORY_VAR } from '../ui'
import { showToast } from '../toast'

const TRIGGER_ICONS: Record<string, typeof Workflow> = {
  'trigger.webhook': Webhook,
  'trigger.schedule': Clock,
  'trigger.form': LayoutGrid,
  'trigger.mcp': Zap,
  'trigger.git': GitBranch,
  'trigger.file': Globe,
}

const TRIGGER_LABELS: Record<string, string> = {
  'trigger.webhook': 'Webhook',
  'trigger.schedule': 'Schedule',
  'trigger.form': 'Form',
  'trigger.mcp': 'MCP',
  'trigger.git': 'Git push',
  'trigger.file': 'File watch',
}

const TRIGGER_ACCENT: Record<string, string> = {
  'trigger.webhook': '#8b5cf6',
  'trigger.schedule': '#f59e0b',
  'trigger.form': '#10b981',
  'trigger.mcp': '#3b82f6',
  'trigger.git': '#ef4444',
  'trigger.file': '#6366f1',
}

function countSteps(flow: Flow): number {
  const walk = (steps: Flow['steps']): number =>
    steps.reduce((n, s) => n + 1 + (s.branches?.flatMap(b => walk(b.steps)).reduce((a, b) => a + b, 0) ?? 0), 0)
  return walk(flow.steps)
}

function FlowChain({ steps }: { steps: Flow['steps'] }) {
  const MAX = 6
  const shown = steps.slice(0, MAX)
  const extra = steps.length - MAX
  if (!steps.length) return <span className="flow-chain-empty">No steps yet</span>
  return (
    <div className="flow-chain">
      {shown.map((s, i) => {
        const tool = toolById(s.toolId)
        if (!tool) return null
        const Icon = tool.icon
        const hasBranch = (s.branches?.length ?? 0) > 0
        return (
          <div key={s.id} className="flow-chain-node">
            {i > 0 && <div className="flow-chain-wire" />}
            <div className="flow-chain-chip" title={s.name}>
              <Icon size={12} style={{ color: CATEGORY_VAR[tool.category] ?? 'var(--text-4)' }} />
            </div>
            {hasBranch && <GitMerge size={9} style={{ color: 'var(--cat-logic)', marginLeft: 1 }} />}
          </div>
        )
      })}
      {extra > 0 && <span className="flow-chain-more">+{extra}</span>}
    </div>
  )
}

const ago = (ts: number) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

interface PopoverState {
  flow: Flow
  top: number
  left: number
  openLeft: boolean
}

const POPOVER_W = 300

function FlowPopover({
  state: pop,
  onOpen,
  onExport,
  onDelete,
  onDuplicate,
  onToggle,
  onMouseEnter,
  onMouseLeave,
}: {
  state: PopoverState
  onOpen: () => void
  onExport: () => void
  onDelete: () => void
  onDuplicate: () => void
  onToggle: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const { flow, top, left, openLeft } = pop
  const accent = TRIGGER_ACCENT[flow.steps[0]?.toolId || ''] ?? 'var(--accent)'
  const triggerLabel = TRIGGER_LABELS[flow.steps[0]?.toolId || ''] ?? 'Manual'
  const steps = countSteps(flow)

  return (
    <div
      className="flow-pop"
      style={{ top, left: openLeft ? left - POPOVER_W - 12 : left + 12, '--flow-accent': accent } as React.CSSProperties}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flow-pop-bar" style={{ background: `linear-gradient(90deg, ${accent}, transparent 70%)` }} />
      <div className="flow-pop-name">{flow.name}</div>
      <FlowChain steps={flow.steps} />
      <div className="flow-pop-meta">
        <span style={{ color: accent }}>{triggerLabel}</span>
        <span className="flow-card-dot">·</span>
        <span>{steps} step{steps === 1 ? '' : 's'}</span>
        <span className="spacer" />
        <span>{ago(flow.updatedAt)}</span>
      </div>
      {(flow.tags || []).length > 0 && (
        <div className="flow-card-tags" style={{ marginTop: 6 }}>
          {(flow.tags || []).map(t => <span key={t} className="tag-chip small">{t}</span>)}
        </div>
      )}
      <div className="flow-pop-actions">
        <button
          className={`live-badge toggle${flow.active === false ? ' off' : ''}`}
          title={flow.active === false ? 'Disabled — click to enable' : 'Live — click to disable'}
          onClick={e => { e.stopPropagation(); onToggle() }}
        >
          {flow.active === false ? 'Off' : 'Live'}
        </button>
        <button className="btn icon" title="Duplicate" onClick={e => { e.stopPropagation(); onDuplicate() }}><Copy size={12} /></button>
        <button className="btn icon" title="Export" onClick={e => { e.stopPropagation(); onExport() }}><Download size={12} /></button>
        <button className="btn icon danger" title="Delete" onClick={e => { e.stopPropagation(); onDelete() }}><Trash2 size={12} /></button>
        <span className="spacer" />
        <button className="btn primary" style={{ fontSize: 12 }} onClick={onOpen}>
          Open <ArrowRight size={12} />
        </button>
      </div>
    </div>
  )
}

export function FlowsHome({ onOpen, onOpenDocs, projectId }: { onOpen: (id: string) => void; onOpenDocs: (id: string) => void; projectId: string }) {
  const state = useEditor()
  const dispatch = useDispatch()
  // Only this project's flows exist on this page — the tenant boundary.
  const projectFlows = useMemo(
    () => state.flows.filter(f => (f.projectId || 'default') === projectId),
    [state.flows, projectId],
  )
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const leaveTimer = useRef<number>()

  // Close popover on scroll so it doesn't float away from its row
  useEffect(() => {
    const onScroll = () => setPopover(null)
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [])

  const allTags = useMemo(() => [...new Set(projectFlows.flatMap(f => f.tags || []))].sort(), [projectFlows])

  const visible = projectFlows.filter(f => {
    if (tagFilter && !(f.tags || []).includes(tagFilter)) return false
    const q = query.trim().toLowerCase()
    return !q || f.name.toLowerCase().includes(q) || (f.tags || []).some(t => t.includes(q))
  })

  const exportFile = (flow: Flow) => {
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
    const flow = makeFlow(uniqueFlowName(name, state.flows), steps, vars, tags)
    dispatch({ type: 'create', flow })
    setNotes(warnings)
    onOpen(flow.id)
  }

  const newFlow = () => {
    const flow = makeFlow('Untitled flow')
    dispatch({ type: 'create', flow })
    onOpen(flow.id)
  }

  const deleteFlow = (f: Flow) => {
    setPopover(null)
    dispatch({ type: 'delete-flow', id: f.id })
    showToast(`"${f.name}" deleted`, {
      kind: 'danger',
      action: { label: 'Undo', fn: () => dispatch({ type: 'undo' }) },
    })
  }

  // Flip a flow's live state without opening it — keep disabled flows around
  // instead of deleting them; their triggers just stop firing.
  const toggleActive = (f: Flow) => {
    const enabling = f.active === false
    dispatch({ type: 'toggle-active', id: f.id })
    showToast(enabling ? `"${f.name}" enabled — triggers live` : `"${f.name}" disabled — triggers paused`, {
      kind: enabling ? 'success' : 'info',
    })
  }

  // Duplicate via the portable format so the copy gets fresh step ids. Starts
  // disabled so a cloned schedule/webhook doesn't immediately double-fire.
  const duplicateFlow = (f: Flow) => {
    setPopover(null)
    const { name, steps, vars, tags } = hydrateFlow(serializeFlow(f))
    const flow = { ...makeFlow(uniqueFlowName(`${name} copy`, state.flows), steps, vars, tags), active: false }
    dispatch({ type: 'create', flow })
    showToast(`Duplicated "${f.name}" — the copy starts disabled`, { kind: 'success' })
  }

  const onRowEnter = (e: React.MouseEvent<HTMLDivElement>, f: Flow) => {
    clearTimeout(leaveTimer.current)
    const rect = e.currentTarget.getBoundingClientRect()
    const top = rect.top + rect.height / 2 - 80
    const openLeft = rect.right + POPOVER_W + 20 > window.innerWidth
    setPopover({ flow: f, top, left: rect.right, openLeft })
  }

  const onRowLeave = () => {
    leaveTimer.current = window.setTimeout(() => setPopover(null), 180)
  }

  const onPopEnter = () => clearTimeout(leaveTimer.current)
  const onPopLeave = () => { leaveTimer.current = window.setTimeout(() => setPopover(null), 100) }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Flows</h1>
        <span className="page-sub">{projectFlows.length} workflow{projectFlows.length === 1 ? '' : 's'}</span>
        <span className="spacer" />
        <button className="btn" onClick={() => fileRef.current?.click()} title="Import a .flow.json file">
          <Upload size={14} /> Import
        </button>
        <button className="btn primary" onClick={newFlow} data-tut="new-flow">
          <Plus size={14} /> New flow
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = '' }}
        />
      </div>

      <div className="page-filters">
        <div className="search" style={{ margin: 0, maxWidth: 320, flex: 1 }}>
          <Search size={13} />
          <input placeholder="Search flows and tags" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        {allTags.map(t => (
          <button key={t} className={`tag-chip${tagFilter === t ? ' on' : ''}`} onClick={() => setTagFilter(cur => (cur === t ? null : t))}>
            {t}
          </button>
        ))}
      </div>

      {notes.length > 0 && <div className="compose-warnings" style={{ margin: '0 0 12px' }}>{notes.map(n => <div key={n}>{n}</div>)}</div>}

      <div className="flow-compact">
        {visible.map(f => {
          const triggerId = f.steps[0]?.toolId || ''
          const TriggerIcon = TRIGGER_ICONS[triggerId] ?? Terminal
          const triggerLabel = TRIGGER_LABELS[triggerId] ?? (triggerId.split('.')[1] ?? 'Manual')
          const accent = TRIGGER_ACCENT[triggerId] ?? 'var(--accent)'
          const steps = countSteps(f)
          return (
            <div
              key={f.id}
              className="flow-row"
              onClick={() => onOpen(f.id)}
              onMouseEnter={e => onRowEnter(e, f)}
              onMouseLeave={onRowLeave}
            >
              <div className="fr-icon" style={{ color: accent }}>
                <TriggerIcon size={13} />
              </div>
              <span className="fr-name">{f.name}</span>
              <span className="fr-trigger" style={{ color: accent, background: `${accent}18` }}>{triggerLabel}</span>
              <span className="fr-steps">{steps}s</span>
              <span className="spacer" />
              <button
                className={`live-badge toggle${f.active === false ? ' off' : ''}`}
                title={f.active === false ? 'Disabled — triggers paused. Click to enable.' : 'Live — triggers fire. Click to disable.'}
                onClick={e => { e.stopPropagation(); toggleActive(f) }}
              >
                {f.active === false ? 'Off' : 'Live'}
              </button>
              <span className="fr-time">{ago(f.updatedAt)}</span>
              <button
                className={`btn icon fr-action${f.docs?.trim() ? ' has-docs' : ''}`}
                title={f.docs?.trim() ? 'Documentation — diagram + write-up' : 'Documentation — diagram (no write-up yet)'}
                onClick={e => { e.stopPropagation(); onOpenDocs(f.id) }}
              >
                <BookText size={12} />
              </button>
              <button className="btn icon fr-action" title="Duplicate" onClick={e => { e.stopPropagation(); duplicateFlow(f) }}>
                <Copy size={12} />
              </button>
              <button className="btn icon fr-action" title="Export" onClick={e => { e.stopPropagation(); exportFile(f) }}>
                <Download size={12} />
              </button>
              <button className="btn icon danger fr-action" title="Delete" onClick={e => { e.stopPropagation(); deleteFlow(f) }}>
                <Trash2 size={12} />
              </button>
            </div>
          )
        })}
        {visible.length === 0 && <div className="settings-note" style={{ padding: 20 }}>No flows match — create one or import a file.</div>}
      </div>

      {popover && (
        <FlowPopover
          // Resolve the live flow by id so an in-place toggle relabels the
          // popover badge instead of showing the snapshot from hover time.
          state={{ ...popover, flow: state.flows.find(f => f.id === popover.flow.id) ?? popover.flow }}
          onOpen={() => { setPopover(null); onOpen(popover.flow.id) }}
          onExport={() => exportFile(popover.flow)}
          onDelete={() => deleteFlow(popover.flow)}
          onDuplicate={() => duplicateFlow(popover.flow)}
          onToggle={() => toggleActive(state.flows.find(f => f.id === popover.flow.id) ?? popover.flow)}
          onMouseEnter={onPopEnter}
          onMouseLeave={onPopLeave}
        />
      )}
    </div>
  )
}
