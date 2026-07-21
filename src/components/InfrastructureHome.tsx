// MIT License - Copyright (c) fintonlabs.com
// Targets: define hosts and tag them into groups (linux, east, prod…). A tag is
// a group; SSH and Ansible steps target a group by its tag and fan out to every
// host that carries it. Rows are editable inline; hosts import from CSV. Per-project.
import { useEffect, useRef, useState } from 'react'
import { Plus, Server, Tag, Trash2, Upload } from 'lucide-react'
import type { Host } from '../types'
import { fetchInfrastructure, saveInfrastructure } from '../api'
import { showToast } from '../toast'

const uid = () => Math.random().toString(36).slice(2, 10)
const parseTags = (s: string) => [...new Set(s.split(/[,\s|;]+/).map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12)

// CSV rows: address, tags (space-separated), user, port. Header row optional.
function parseCsv(text: string): Host[] {
  const out: Host[] = []
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(',').map(c => c.trim())
    const address = cols[0]
    if (!address || /^(address|host)$/i.test(address)) continue // skip blanks + header
    out.push({
      id: uid(), address, tags: parseTags(cols[1] || ''),
      ...(cols[2] ? { user: cols[2] } : {}),
      ...(cols[3] ? { port: cols[3] } : {}),
    })
  }
  return out
}

export function InfrastructureHome({ projectId }: { projectId: string }) {
  const [hosts, setHosts] = useState<Host[]>([])
  const [loaded, setLoaded] = useState(false)
  const [address, setAddress] = useState('')
  const [tags, setTags] = useState('')
  const [user, setUser] = useState('')
  const [port, setPort] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLoaded(false)
    void fetchInfrastructure(projectId).then(h => { setHosts(h); setLoaded(true) })
  }, [projectId])

  const persist = (next: Host[]) => { setHosts(next); void saveInfrastructure(projectId, next) }

  const addHost = () => {
    const addr = address.trim()
    if (!addr) return
    persist([{ id: uid(), address: addr, tags: parseTags(tags), ...(user.trim() ? { user: user.trim() } : {}), ...(port.trim() ? { port: port.trim() } : {}) }, ...hosts])
    setAddress(''); setTags(''); setUser(''); setPort('')
  }

  // Commit an inline edit on blur (tags parse; empty user/port drop out).
  const commit = (id: string, field: 'address' | 'tags' | 'user' | 'port', value: string) => {
    persist(hosts.map(h => {
      if (h.id !== id) return h
      if (field === 'tags') return { ...h, tags: parseTags(value) }
      const v = value.trim()
      const next = { ...h, [field]: v }
      if (!v) delete (next as Record<string, unknown>)[field]
      return next
    }))
  }

  const removeHost = (id: string) => persist(hosts.filter(h => h.id !== id))

  const importCsv = async (file: File) => {
    const added = parseCsv(await file.text())
    if (!added.length) { showToast('No hosts found in that CSV — expected: address, tags, user, port', { kind: 'danger' }); return }
    persist([...added, ...hosts])
    showToast(`Imported ${added.length} target${added.length === 1 ? '' : 's'}`)
  }

  // Distinct tags → host counts (the groups).
  const groups = [...hosts.reduce((m, h) => { for (const t of h.tags || []) m.set(t, (m.get(t) || 0) + 1); return m }, new Map<string, number>())].sort((a, b) => a[0].localeCompare(b[0]))
  const copyTag = (t: string) => { void navigator.clipboard.writeText(t); showToast(`Copied “${t}” — paste it into an SSH or Ansible step's Target group`) }

  return (
    <div className="page targets-page">
      <div className="page-head">
        <Server size={16} />
        <h1>Targets</h1>
        <span className="page-sub">{hosts.length} host{hosts.length === 1 ? '' : 's'} · {groups.length} group{groups.length === 1 ? '' : 's'}</span>
      </div>

      <div className="settings-note infra-note">
        Register hosts and tag them into groups. A <strong>tag is a group</strong> — an SSH or Ansible step targeting <span className="kbd">linux</span> runs on every host carrying that tag. Scoped to this project.
      </div>

      <div className="infra-add">
        <input placeholder="host or user@host" value={address} onChange={e => setAddress(e.target.value)} onKeyDown={e => e.key === 'Enter' && addHost()} style={{ flex: 2 }} />
        <input placeholder="tags: linux east" value={tags} onChange={e => setTags(e.target.value)} onKeyDown={e => e.key === 'Enter' && addHost()} style={{ flex: 2 }} />
        <input placeholder="user" value={user} onChange={e => setUser(e.target.value)} style={{ flex: 1, minWidth: 60 }} />
        <input placeholder="port" value={port} onChange={e => setPort(e.target.value)} style={{ width: 56 }} />
        <button className="btn primary" onClick={addHost} disabled={!address.trim()}><Plus size={12} /> Add</button>
        <button className="btn" onClick={() => fileRef.current?.click()} title="Import hosts from a CSV: address, tags, user, port"><Upload size={12} /> CSV</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = '' }} />
      </div>

      {groups.length > 0 && (
        <div className="infra-groups">
          {groups.map(([t, n]) => (
            <button key={t} className="infra-group-chip" title="Copy this tag to use as a Target group" onClick={() => copyTag(t)}>
              <Tag size={10} /> {t} <span className="infra-group-count">{n}</span>
            </button>
          ))}
        </div>
      )}

      <div className="infra-list">
        {hosts.map(h => (
          <div key={h.id} className="target-row">
            <Server size={13} className="infra-row-icon" />
            <input className="t-in t-addr" defaultValue={h.address} placeholder="host or user@host" onBlur={e => commit(h.id, 'address', e.target.value)} />
            <input className="t-in t-tags" defaultValue={(h.tags || []).join(', ')} placeholder="tags" onBlur={e => commit(h.id, 'tags', e.target.value)} />
            <input className="t-in t-user" defaultValue={h.user || ''} placeholder="user" onBlur={e => commit(h.id, 'user', e.target.value)} />
            <input className="t-in t-port" defaultValue={h.port || ''} placeholder="port" onBlur={e => commit(h.id, 'port', e.target.value)} />
            <button className="btn icon danger" title="Remove host" onClick={() => removeHost(h.id)}><Trash2 size={12} /></button>
          </div>
        ))}
        {loaded && hosts.length === 0 && (
          <div className="settings-note" style={{ padding: 18 }}>No targets yet. Add one above or import a CSV, tag it (e.g. <span className="kbd">linux</span>, <span className="kbd">east</span>), then target the tag from an SSH or Ansible step.</div>
        )}
      </div>
    </div>
  )
}
