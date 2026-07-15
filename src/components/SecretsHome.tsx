// MIT License - Copyright (c) fintonlabs.com
// Secrets: named credentials stored server-side. Table view — one row per
// secret, expandable for inline test + replace. No cards.
import { useMemo, useState } from 'react'
import {
  CheckCircle2, ChevronDown, ChevronRight, Cloud, Database, GitBranch,
  KeyRound, Loader2, Mail, MessageSquare, Network, Plus, RefreshCw,
  Siren, Sparkles, Terminal, Trash2, XCircle, Zap,
} from 'lucide-react'
import type { ConnectionMeta, Project, Settings, Step } from '../types'
import { toolById } from '../tools'
import { useEditor } from '../state'
import { projectOf } from '../projects'
import { addConnection, deleteConnection, replaceConnectionSecret, testConnection } from '../api'

interface TypeMeta {
  label: string
  hint: string
  multiline?: boolean
  placeholder?: string
  icon: typeof Database
  color: string
  helpText?: string
}

export const CONN_TYPE_META: Record<string, TypeMeta> = {
  postgres:   { label: 'PostgreSQL',       hint: 'postgres://user:pass@host:5432/db',            icon: Database,    color: 'var(--cat-data)' },
  anthropic:  { label: 'Anthropic',        hint: 'sk-ant-…',                                     icon: Sparkles,    color: 'var(--cat-ai)' },
  slack:      { label: 'Slack webhook',    hint: 'https://hooks.slack.com/services/…',            icon: MessageSquare, color: 'var(--cat-notify)' },
  smtp:       { label: 'SMTP',             hint: 'smtp://user:pass@host:587',                     icon: Mail,        color: 'var(--cat-notify)' },
  pagerduty:  { label: 'PagerDuty',        hint: 'Events v2 routing key',                         icon: Siren,       color: 'var(--cat-notify)' },
  apikey:     { label: 'Bearer token',     hint: 'Sent as Authorization: Bearer …',               icon: KeyRound,    color: 'var(--cat-logic)' },
  mcp:        { label: 'MCP server',       hint: 'npx -y @modelcontextprotocol/server-… or https://host/mcp', icon: Network, color: 'var(--cat-infra)' },
  ssh: {
    label: 'SSH', hint: '',
    multiline: true, icon: Terminal, color: 'var(--cat-infra)',
    helpText: 'Paste a PEM private key (-----BEGIN … PRIVATE KEY-----) or a plain password. Host and user are configured per step.',
  },
  aws: {
    label: 'AWS',
    hint: '{"accessKeyId":"AKIA…","secretAccessKey":"…","region":"us-east-1"}',
    icon: Cloud, color: 'var(--cat-infra)',
    helpText: 'JSON with accessKeyId, secretAccessKey, and region. Used by Terraform and Lambda steps.',
  },
  k8s: {
    label: 'Kubeconfig', hint: 'apiVersion: v1\nclusters:\n- cluster: …',
    multiline: true, icon: Network, color: 'var(--cat-infra)',
    helpText: 'Full kubeconfig YAML (kubectl config view --raw). Written to a 0600 temp file per run.',
  },
  github: {
    label: 'GitHub token', hint: 'ghp_… or github_pat_…',
    icon: GitBranch, color: 'var(--cat-infra)',
    helpText: 'Personal Access Token. Referenced in HTTP steps as a Bearer token.',
  },
}

// A step references a connection either by name (explicit) or by empty string
// (meaning "use the first connection of this type" — the default). Secrets
// are strictly project-scoped, so both resolve within the project's pool.
const countUsages = (steps: Step[], name: string, type: string, isDefault: boolean): number =>
  steps.reduce((n, s) => {
    const tool = toolById(s.toolId)
    const connFields = tool?.fields.filter(f => f.kind === 'connection' && f.connType === type) || []
    const hit = connFields.some(f => {
      const v = s.config[f.key] || ''
      return v === name || (isDefault && v === '')
    }) ? 1 : 0
    const nested = (s.branches || []).reduce((m, b) => m + countUsages(b.steps, name, type, isDefault), 0)
    return n + hit + nested
  }, 0)

function SecretRow({ conn, usage, onDelete }: { conn: ConnectionMeta; usage: number; onDelete: () => void }) {
  const meta = CONN_TYPE_META[conn.type] || CONN_TYPE_META.apikey
  const Icon = meta.icon
  const [open, setOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; note?: string; error?: string } | null>(null)
  const [newSecret, setNewSecret] = useState('')
  const [saving, setSaving] = useState(false)

  const runTest = async () => {
    setTesting(true)
    setResult(null)
    setResult(await testConnection(conn.id))
    setTesting(false)
  }

  const save = async () => {
    if (!newSecret.trim()) return
    setSaving(true)
    await replaceConnectionSecret(conn.id, newSecret)
    setNewSecret('')
    setResult(null)
    setSaving(false)
  }

  return (
    <div className={`sec-row${open ? ' open' : ''}`} style={{ '--sec-accent': meta.color } as React.CSSProperties}>
      <div className="sec-main" onClick={() => setOpen(o => !o)}>
        <span className="sec-chevron">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
        <span className="sec-type-badge" style={{ background: meta.color }}>
          <Icon size={12} />
          <span>{meta.label}</span>
        </span>
        <span className="sec-name">{conn.name}</span>
        <span className="sec-usage">{usage === 0 ? <span className="sec-unused">unused</span> : `${usage} step${usage === 1 ? '' : 's'}`}</span>
        <button
          className="btn icon danger sec-del"
          title="Delete"
          onClick={e => { e.stopPropagation(); onDelete() }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {open && (
        <div className="sec-expand">
          {result && (
            <div className={`sec-result${result.ok ? '' : ' bad'}`}>
              {result.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              <span>{result.ok ? (result.note || 'Connected') : result.error}</span>
            </div>
          )}
          <div className="sec-actions-row">
            <button className="btn" onClick={() => void runTest()} disabled={testing}>
              {testing ? <Loader2 size={13} className="spin" /> : <Zap size={13} />} Test
            </button>
          </div>
          <div className="sec-replace">
            <span className="sec-replace-label">Replace secret</span>
            {meta.multiline ? (
              <textarea
                className="var-input"
                placeholder={meta.hint || 'Paste new value…'}
                value={newSecret}
                onChange={e => setNewSecret(e.target.value)}
                rows={5}
                style={{ fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
              />
            ) : (
              <input
                className="var-input"
                type={['aws', 'postgres', 'smtp'].includes(conn.type) ? 'text' : 'password'}
                placeholder={meta.hint}
                value={newSecret}
                onChange={e => setNewSecret(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && void save()}
              />
            )}
            <button className="btn primary" onClick={() => void save()} disabled={!newSecret.trim() || saving}>
              {saving ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Save
            </button>
          </div>
          {meta.helpText && <div className="settings-note" style={{ marginTop: 8 }}>{meta.helpText}</div>}
        </div>
      )}
    </div>
  )
}

function AddSecretForm({ onAdd, projectId }: { onAdd: (c: ConnectionMeta) => void; projectId: string }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<ConnectionMeta['type']>('postgres')
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const meta = CONN_TYPE_META[type] || CONN_TYPE_META.apikey

  const submit = async () => {
    if (!name.trim() || !secret.trim()) return
    setSaving(true)
    setError('')
    const result = await addConnection(name, type, secret, projectId)
    setSaving(false)
    if ('error' in result) { setError(result.error); return }
    onAdd(result)
    setName(''); setSecret(''); setOpen(false)
  }

  if (!open) {
    return (
      <button className="sec-add-btn" onClick={() => setOpen(true)}>
        <Plus size={14} /> Add secret
      </button>
    )
  }

  return (
    <div className="sec-add-form">
      <select value={type} onChange={e => { setType(e.target.value as ConnectionMeta['type']); setSecret('') }}>
        {Object.entries(CONN_TYPE_META).map(([v, t]) => (
          <option key={v} value={v}>{t.label}</option>
        ))}
      </select>
      <input
        className="var-input"
        placeholder="Name — used in step config to pick this secret"
        value={name}
        onChange={e => setName(e.target.value)}
      />
      {meta.multiline ? (
        <textarea
          className="var-input"
          placeholder={meta.hint || 'Value…'}
          value={secret}
          onChange={e => setSecret(e.target.value)}
          rows={6}
          style={{ fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
        />
      ) : (
        <input
          className="var-input"
          type={['aws', 'postgres', 'smtp'].includes(type) ? 'text' : 'password'}
          placeholder={meta.hint}
          value={secret}
          onChange={e => setSecret(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void submit()}
        />
      )}
      {meta.helpText && <div className="settings-note">{meta.helpText}</div>}
      {error && <div className="settings-note" style={{ color: 'var(--err)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" onClick={() => void submit()} disabled={!name.trim() || !secret.trim() || saving}>
          {saving ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Add
        </button>
        <button className="btn" onClick={() => { setOpen(false); setError('') }}>Cancel</button>
      </div>
    </div>
  )
}

export function SecretsHome({ settings, onChange, projectId, projects }: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  projectId: string
  projects: Project[]
}) {
  const state = useEditor()
  const connections = settings.connections || []
  const projectName = projects.find(p => p.id === projectId)?.name || 'Default'

  // Strictly this project's secrets — the tenant boundary.
  const visible = useMemo(
    () => connections.filter(c => (c.projectId || 'default') === projectId),
    [connections, projectId],
  )
  const projectFlows = useMemo(
    () => state.flows.filter(f => projectOf(f) === projectId),
    [state.flows, projectId],
  )

  const usages = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of visible) {
      // An unnamed reference resolves to the project's first secret of that
      // type — same rule the server applies at run time.
      const isDefault = visible.find(x => x.type === c.type)?.id === c.id
      map[c.id] = projectFlows.reduce((n, f) => n + countUsages(f.steps, c.name, c.type, isDefault), 0)
    }
    return map
  }, [visible, projectFlows])

  const remove = (id: string) => {
    void deleteConnection(id)
    onChange({ connections: connections.filter(c => c.id !== id) })
  }

  const add = (conn: ConnectionMeta) => {
    onChange({ connections: [...connections, conn] })
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Secrets</h1>
        <span className="page-sub">{projectName} project — stored server-side, never returned to the browser</span>
      </div>

      <div className="sec-table">
        {visible.length > 0 && (
          <div className="sec-head">
            <span />
            <span>Name</span>
            <span>Used by</span>
            <span />
          </div>
        )}
        {visible.map(c => (
          <SecretRow key={c.id} conn={c} usage={usages[c.id] || 0} onDelete={() => remove(c.id)} />
        ))}
        {visible.length === 0 && (
          <div className="sec-empty">No secrets in this project yet — add one below to connect databases, APIs, and infrastructure.</div>
        )}
      </div>

      <AddSecretForm onAdd={add} projectId={projectId} />

      <div className="settings-note" style={{ marginTop: 16, maxWidth: 560 }}>
        Secrets belong to this project only — a flow can never reach another project's secrets. They are encrypted at rest (AES-256-GCM; key auto-generated at <code>data/.encryption-key</code> or supplied via <code>STEPRAIL_ENCRYPTION_KEY</code>), decrypted only in memory at run time, redacted from error messages, and never echoed back to the browser. Steps reference a secret by name; when no name is given, the project's first secret of that type is used.
      </div>
    </div>
  )
}
