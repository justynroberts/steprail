// MIT License - Copyright (c) fintonlabs.com
// First-class credentials: type-aware connection cards with real tests
// (Postgres connects, MCP lists tools, Anthropic pings the API), inline
// secret replacement, and usage counts across flows. Secrets never return
// to the browser.
import { useMemo, useState } from 'react'
import {
  CheckCircle2, Database, KeyRound, Loader2, Mail, MessageSquare,
  PlugZap, Plus, RefreshCw, Siren, Sparkles, Trash2, XCircle, Zap,
} from 'lucide-react'
import type { ConnectionMeta, Settings, Step } from '../types'
import { useEditor } from '../state'
import { addConnection, deleteConnection, replaceConnectionSecret, testConnection } from '../api'

const TYPE_INFO: Record<string, { label: string; hint: string; icon: typeof Database; color: string }> = {
  postgres: { label: 'PostgreSQL', hint: 'postgres://user:pass@host:5432/db', icon: Database, color: 'var(--cat-data)' },
  anthropic: { label: 'Anthropic', hint: 'sk-ant-…', icon: Sparkles, color: 'var(--cat-ai)' },
  slack: { label: 'Slack webhook', hint: 'https://hooks.slack.com/services/…', icon: MessageSquare, color: 'var(--cat-notify)' },
  smtp: { label: 'SMTP', hint: 'smtp://user:pass@host:587', icon: Mail, color: 'var(--cat-notify)' },
  pagerduty: { label: 'PagerDuty', hint: 'Events v2 routing key', icon: Siren, color: 'var(--cat-notify)' },
  apikey: { label: 'Bearer token', hint: 'Sent as Authorization: Bearer', icon: KeyRound, color: 'var(--cat-logic)' },
  mcp: { label: 'MCP server', hint: 'npx -y @modelcontextprotocol/server-… or https://host/mcp', icon: PlugZap, color: 'var(--cat-infra)' },
}

const countUsages = (steps: Step[], name: string): number =>
  steps.reduce((n, s) => {
    let hit = Object.entries(s.config).some(([k, v]) => (k === 'connection' || k === 'mcp') && v === name) ? 1 : 0
    for (const b of s.branches || []) hit += countUsages(b.steps, name)
    return n + hit
  }, 0)

function ConnectionCard({ conn, usage, onDelete }: { conn: ConnectionMeta; usage: number; onDelete: () => void }) {
  const info = TYPE_INFO[conn.type] || TYPE_INFO.apikey
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; note?: string; error?: string } | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [newSecret, setNewSecret] = useState('')

  const runTest = async () => {
    setTesting(true)
    setResult(null)
    setResult(await testConnection(conn.id))
    setTesting(false)
  }

  const replace = async () => {
    if (!newSecret.trim()) return
    await replaceConnectionSecret(conn.id, newSecret)
    setNewSecret('')
    setReplacing(false)
    setResult(null)
  }

  return (
    <div className="conn-card" style={{ '--cc-accent': info.color } as React.CSSProperties}>
      <div className="cc-head">
        <span className="cc-icon"><info.icon size={16} /></span>
        <span className="cc-titles">
          <span className="cc-name">{conn.name}</span>
          <span className="cc-type">{info.label} · {usage === 0 ? 'unused' : `used by ${usage} step${usage === 1 ? '' : 's'}`}</span>
        </span>
        <button className="btn icon danger cc-del" title={usage > 0 ? `In use by ${usage} steps — steps will fail without it` : 'Delete connection'} onClick={onDelete}>
          <Trash2 size={13} />
        </button>
      </div>
      {result && (
        <div className={`cc-result${result.ok ? '' : ' bad'}`}>
          {result.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
          <span>{result.ok ? result.note || 'Works' : result.error}</span>
        </div>
      )}
      {replacing && (
        <div className="cc-replace">
          <input
            type="password"
            className="var-input"
            placeholder={info.hint}
            value={newSecret}
            onChange={e => setNewSecret(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void replace()}
          />
          <button className="btn" onClick={() => void replace()} disabled={!newSecret.trim()}>Save</button>
        </div>
      )}
      <div className="cc-actions">
        <button className="btn" onClick={() => void runTest()} disabled={testing}>
          {testing ? <Loader2 size={13} className="spin" /> : <Zap size={13} />} Test
        </button>
        <button className="btn" onClick={() => setReplacing(r => !r)}>
          <RefreshCw size={13} /> Replace secret
        </button>
      </div>
    </div>
  )
}

export function ConnectionsManager({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const state = useEditor()
  const connections = settings.connections || []
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<ConnectionMeta['type']>('postgres')
  const [newSecret, setNewSecret] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const usages = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of connections) map[c.id] = state.flows.reduce((n, f) => n + countUsages(f.steps, c.name), 0)
    return map
  }, [connections, state.flows])

  const add = async () => {
    setError('')
    const result = await addConnection(newName, newType, newSecret)
    if ('error' in result) return setError(result.error)
    onChange({ connections: [...connections, result] })
    setNewName('')
    setNewSecret('')
    setAdding(false)
  }

  const remove = (id: string) => {
    void deleteConnection(id)
    onChange({ connections: connections.filter(c => c.id !== id) })
  }

  return (
    <div className="conn-manager">
      <div className="conn-grid">
        {connections.map(c => (
          <ConnectionCard key={c.id} conn={c} usage={usages[c.id] || 0} onDelete={() => remove(c.id)} />
        ))}
        <div className="conn-card add" onClick={() => !adding && setAdding(true)}>
          {!adding ? (
            <div className="cc-add-hint"><Plus size={16} /> Add connection</div>
          ) : (
            <div className="cc-add-form" onClick={e => e.stopPropagation()}>
              <select value={newType} onChange={e => setNewType(e.target.value as ConnectionMeta['type'])}>
                {Object.entries(TYPE_INFO).map(([value, t]) => <option key={value} value={value}>{t.label}</option>)}
              </select>
              <input className="var-input" placeholder="Name (e.g. orders-db)" value={newName} onChange={e => setNewName(e.target.value)} />
              <input className="var-input" type="password" placeholder={TYPE_INFO[newType].hint} value={newSecret} onChange={e => setNewSecret(e.target.value)} />
              {error && <div className="settings-note" style={{ color: 'var(--err)' }}>{error}</div>}
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn primary" onClick={() => void add()} disabled={!newName.trim() || !newSecret.trim()}>Add</button>
                <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="settings-note" style={{ marginTop: 10 }}>
        Secrets are stored server-side (owner-only file mode), redacted from run errors, and never sent back to the browser. Steps pick a connection by name; the first of each type is the default.
      </div>
    </div>
  )
}
