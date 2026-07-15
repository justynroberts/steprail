// MIT License - Copyright (c) fintonlabs.com
// The flows home: built for dozens of workflows. Search, tag filters, live
// status, and file import/export (variables and tags travel in the file).
import { useMemo, useRef, useState } from 'react'
import {
  Clock, Download, GitBranch, GitMerge, Globe, LayoutGrid,
  List, Plus, Search, Sparkles, Terminal, Trash2, Upload, Webhook, Workflow, Zap,
} from 'lucide-react'
import { StepHanDialog } from './StepHanDialog'
import type { Flow } from '../types'
import { useDispatch, useEditor } from '../state'
import { makeFlow } from '../blueprints'
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

// Per-trigger accent color for the top gradient bar
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

// Mini icon chain — same visual language as blueprint cards
function FlowChain({ steps }: { steps: Flow['steps'] }) {
  const MAX = 5
  const shown = steps.slice(0, MAX)
  const extra = steps.length - MAX
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
      {steps.length === 0 && <span className="flow-chain-empty">No steps yet</span>}
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

export function FlowsHome({ onOpen }: { onOpen: (id: string) => void }) {
  const state = useEditor()
  const dispatch = useDispatch()
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const [stephanOpen, setStephanOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  const allTags = useMemo(() => [...new Set(state.flows.flatMap(f => f.tags || []))].sort(), [state.flows])

  const visible = state.flows.filter(f => {
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
    const flow = makeFlow(name, steps, vars, tags)
    dispatch({ type: 'create', flow })
    setNotes(warnings)
    onOpen(flow.id)
  }

  const newFlow = () => {
    const flow = makeFlow('Untitled flow')
    dispatch({ type: 'create', flow })
    onOpen(flow.id)
  }

  const deleteFlow = (e: React.MouseEvent, f: Flow) => {
    e.stopPropagation()
    dispatch({ type: 'delete-flow', id: f.id })
    showToast(`"${f.name}" deleted`, {
      kind: 'danger',
      action: { label: 'Undo', fn: () => dispatch({ type: 'undo' }) },
    })
  }

  return (
    <div className="page">
      {stephanOpen && <StepHanDialog onOpen={onOpen} onClose={() => setStephanOpen(false)} />}
      <div className="page-head">
        <h1>Flows</h1>
        <span className="page-sub">{state.flows.length} workflow{state.flows.length === 1 ? '' : 's'}</span>
        <span className="spacer" />
        <button className="btn stephan-btn" onClick={() => setStephanOpen(true)} title="StepHan — describe a job, get a flow">
          <Sparkles size={14} /> StepHan
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()} title="Import a .flow.json file — variables and tags included">
          <Upload size={14} /> Import
        </button>
        <div className="seg" style={{ fontSize: 12 }}>
          <button className={viewMode === 'grid' ? 'on' : ''} onClick={() => setViewMode('grid')} title="Grid view"><LayoutGrid size={13} /></button>
          <button className={viewMode === 'list' ? 'on' : ''} onClick={() => setViewMode('list')} title="List view"><List size={13} /></button>
        </div>
        <button className="btn primary" onClick={newFlow}>
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

      {viewMode === 'grid' ? (
        <div className="flow-grid">
          {visible.map(f => {
            const triggerId = f.steps[0]?.toolId || ''
            const TriggerIcon = TRIGGER_ICONS[triggerId] ?? Terminal
            const triggerLabel = TRIGGER_LABELS[triggerId] ?? (triggerId.split('.')[1] ?? 'Manual')
            const accent = TRIGGER_ACCENT[triggerId] ?? 'var(--accent)'
            const steps = countSteps(f)
            return (
              <div
                key={f.id}
                className="flow-card"
                style={{ '--flow-accent': accent } as React.CSSProperties}
                onClick={() => onOpen(f.id)}
              >
                <div className="flow-card-head">
                  <div className="flow-card-icon" style={{ background: `${accent}20`, color: accent }}>
                    <TriggerIcon size={14} />
                  </div>
                  <div className="flow-card-name">{f.name}</div>
                  <div className="flow-card-actions">
                    <button className="btn icon" title="Export" onClick={e => { e.stopPropagation(); exportFile(f) }}><Download size={12} /></button>
                    <button className="btn icon danger" title="Delete" onClick={e => deleteFlow(e, f)}><Trash2 size={12} /></button>
                  </div>
                </div>

                <FlowChain steps={f.steps} />

                <div className="flow-card-meta">
                  <span className="flow-card-trigger" style={{ color: accent }}>{triggerLabel}</span>
                  <span className="flow-card-dot">·</span>
                  <span>{steps} step{steps === 1 ? '' : 's'}</span>
                  <span className="spacer" />
                  <span className={`live-badge${f.active === false ? ' off' : ''}`}>{f.active === false ? 'Off' : 'Live'}</span>
                </div>

                {(f.tags || []).length > 0 && (
                  <div className="flow-card-tags">
                    {(f.tags || []).map(t => <span key={t} className="tag-chip small">{t}</span>)}
                  </div>
                )}
                <div className="flow-card-footer">{ago(f.updatedAt)}</div>
              </div>
            )
          })}
          {visible.length === 0 && <div className="settings-note" style={{ padding: 20 }}>No flows match — create one or import a file.</div>}
        </div>
      ) : (
        <div className="flow-table">
          {visible.map(f => {
            const triggerId = f.steps[0]?.toolId || ''
            const TriggerIcon = TRIGGER_ICONS[triggerId] ?? Terminal
            const triggerLabel = TRIGGER_LABELS[triggerId] ?? (triggerId.split('.')[1] ?? 'Manual')
            const accent = TRIGGER_ACCENT[triggerId] ?? 'var(--accent)'
            const steps = countSteps(f)
            return (
              <div key={f.id} className="flow-line" onClick={() => onOpen(f.id)}>
                <div className="flow-line-icon" style={{ color: accent }}><TriggerIcon size={13} /></div>
                <span className="fl-name">{f.name}</span>
                <span className="fl-trigger" style={{ color: accent }}>{triggerLabel}</span>
                <span className="fl-steps">{steps}s</span>
                <span className="flow-row-tags">
                  {(f.tags || []).map(t => <span key={t} className="tag-chip small">{t}</span>)}
                </span>
                <span className="spacer" />
                <span className={`live-badge${f.active === false ? ' off' : ''}`}>{f.active === false ? 'Off' : 'Live'}</span>
                <span className="fl-updated">{ago(f.updatedAt)}</span>
                <button className="btn icon fl-action" title="Export as file" onClick={e => { e.stopPropagation(); exportFile(f) }}>
                  <Download size={13} />
                </button>
                <button className="btn icon danger fl-action" title="Delete flow" onClick={e => deleteFlow(e, f)}>
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
          {visible.length === 0 && <div className="settings-note" style={{ padding: 20 }}>No flows match — create one or import a file.</div>}
        </div>
      )}
    </div>
  )
}
