// MIT License - Copyright (c) fintonlabs.com
// Infrastructure: define hosts and tag them (linux, east, prod…). A tag is a
// group; SSH and Ansible steps target a group by its tag, fanning out to every
// host that carries it. Strictly per-project, like Secrets.
import { useEffect, useMemo, useState } from 'react'
import { Plus, Server, Tag, Trash2 } from 'lucide-react'
import type { Host } from '../types'
import { fetchInfrastructure, saveInfrastructure } from '../api'
import { showToast } from '../toast'

const uid = () => Math.random().toString(36).slice(2, 10)
const parseTags = (s: string) => [...new Set(s.split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12)

export function InfrastructureHome({ projectId }: { projectId: string }) {
  const [hosts, setHosts] = useState<Host[]>([])
  const [loaded, setLoaded] = useState(false)
  const [address, setAddress] = useState('')
  const [tags, setTags] = useState('')
  const [user, setUser] = useState('')
  const [port, setPort] = useState('')

  useEffect(() => {
    setLoaded(false)
    void fetchInfrastructure(projectId).then(h => { setHosts(h); setLoaded(true) })
  }, [projectId])

  const persist = (next: Host[]) => { setHosts(next); void saveInfrastructure(projectId, next) }

  const addHost = () => {
    const addr = address.trim()
    if (!addr) return
    const host: Host = {
      id: uid(), address: addr, tags: parseTags(tags),
      ...(user.trim() ? { user: user.trim() } : {}),
      ...(port.trim() ? { port: port.trim() } : {}),
    }
    persist([host, ...hosts])
    setAddress(''); setTags(''); setUser(''); setPort('')
  }

  const removeHost = (id: string) => persist(hosts.filter(h => h.id !== id))

  const setHostTags = (id: string, value: string) =>
    persist(hosts.map(h => (h.id === id ? { ...h, tags: parseTags(value) } : h)))

  // Distinct tags → how many hosts carry each (the "groups").
  const groups = useMemo(() => {
    const m = new Map<string, number>()
    for (const h of hosts) for (const t of h.tags || []) m.set(t, (m.get(t) || 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [hosts])

  const copyTag = (t: string) => { void navigator.clipboard.writeText(t); showToast(`Copied tag “${t}” — paste it into an SSH or Ansible step's Target group`) }

  return (
    <div className="page">
      <div className="page-head">
        <Server size={18} />
        <h1>Infrastructure</h1>
        <span className="page-sub">{hosts.length} host{hosts.length === 1 ? '' : 's'} · {groups.length} group{groups.length === 1 ? '' : 's'}</span>
      </div>

      <div className="settings-note" style={{ marginBottom: 14 }}>
        Register hosts and tag them into groups. A <strong>tag is a group</strong> — an SSH or Ansible step targeting <span className="kbd">linux</span> runs on every host carrying that tag. Hosts are scoped to this project.
      </div>

      {/* Add-host row */}
      <div className="infra-add">
        <input placeholder="host or user@host  (e.g. web1.example.com)" value={address} onChange={e => setAddress(e.target.value)} onKeyDown={e => e.key === 'Enter' && addHost()} style={{ flex: 2 }} />
        <input placeholder="tags: linux, east" value={tags} onChange={e => setTags(e.target.value)} onKeyDown={e => e.key === 'Enter' && addHost()} style={{ flex: 2 }} />
        <input placeholder="user" value={user} onChange={e => setUser(e.target.value)} style={{ flex: 1, minWidth: 70 }} />
        <input placeholder="port" value={port} onChange={e => setPort(e.target.value)} style={{ width: 64 }} />
        <button className="btn primary" onClick={addHost} disabled={!address.trim()}><Plus size={13} /> Add host</button>
      </div>

      {/* Groups summary */}
      {groups.length > 0 && (
        <div className="infra-groups">
          {groups.map(([t, n]) => (
            <button key={t} className="infra-group-chip" title="Copy this tag to use as a Target group" onClick={() => copyTag(t)}>
              <Tag size={11} /> {t} <span className="infra-group-count">{n}</span>
            </button>
          ))}
        </div>
      )}

      {/* Host list */}
      <div className="infra-list">
        {hosts.map(h => (
          <div key={h.id} className="infra-row">
            <Server size={14} className="infra-row-icon" />
            <span className="infra-addr">{h.address}</span>
            {(h.user || h.port) && <span className="infra-meta">{h.user ? `user ${h.user}` : ''}{h.user && h.port ? ' · ' : ''}{h.port ? `port ${h.port}` : ''}</span>}
            <input className="infra-tags-input" value={(h.tags || []).join(', ')} placeholder="tags…" onChange={e => setHostTags(h.id, e.target.value)} />
            <button className="btn icon danger" title="Remove host" onClick={() => removeHost(h.id)}><Trash2 size={12} /></button>
          </div>
        ))}
        {loaded && hosts.length === 0 && (
          <div className="settings-note" style={{ padding: 20 }}>No hosts yet. Add one above, tag it (e.g. <span className="kbd">linux</span>, <span className="kbd">east</span>), then target the tag from an SSH or Ansible step.</div>
        )}
      </div>
    </div>
  )
}
