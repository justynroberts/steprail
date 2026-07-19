// MIT License - Copyright (c) fintonlabs.com
// SSRF-hardened JSON fetch for author-supplied URLs (dynamic form dropdowns).
// Blocks loopback / private / link-local / CGNAT / cloud-metadata targets,
// refuses redirects, caps the response size, and requires a JSON content-type.
import net from 'node:net'
import { lookup } from 'node:dns/promises'

const ipv4ToInt = ip => {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return null
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0
}

const isBlockedV4 = ip => {
  const n = ipv4ToInt(ip)
  if (n === null) return true // unparseable → treat as unsafe
  const inRange = (base, bits) => {
    const b = ipv4ToInt(base)
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (n & mask) === (b & mask)
  }
  return (
    inRange('0.0.0.0', 8) || inRange('10.0.0.0', 8) || inRange('100.64.0.0', 10) ||
    inRange('127.0.0.0', 8) || inRange('169.254.0.0', 16) || inRange('172.16.0.0', 12) ||
    inRange('192.0.0.0', 24) || inRange('192.168.0.0', 16) || inRange('198.18.0.0', 15) ||
    inRange('224.0.0.0', 4) || inRange('240.0.0.0', 4)
  )
}

export const isBlockedIp = ip => {
  if (net.isIPv4(ip)) return isBlockedV4(ip)
  const low = String(ip).toLowerCase().replace(/%.*$/, '') // strip zone id
  if (low === '::1' || low === '::' || low === 'fd00:ec2::254') return true
  if (low.startsWith('fe8') || low.startsWith('fe9') || low.startsWith('fea') || low.startsWith('feb')) return true // fe80::/10
  if (low.startsWith('fc') || low.startsWith('fd')) return true // fc00::/7 ULA
  const m = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/) // IPv4-mapped
  if (m) return isBlockedV4(m[1])
  return false
}

// Resolve the host and reject if ANY resolved address is non-public.
export async function assertPublicHttpUrl(raw) {
  let url
  try { url = new URL(raw) } catch { throw new Error('invalid URL') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http/https URLs are allowed')
  if (net.isIP(url.hostname) && isBlockedIp(url.hostname)) throw new Error('URL points at a private or reserved address')
  const addrs = await lookup(url.hostname, { all: true })
  if (!addrs.length) throw new Error('host did not resolve')
  for (const a of addrs) if (isBlockedIp(a.address)) throw new Error('URL resolves to a private or reserved address')
  return url
}

// Fetch JSON with all the guards. Throws on any violation.
export async function fetchJsonSafely(raw, { timeoutMs = 5000, maxBytes = 256 * 1024 } = {}) {
  await assertPublicHttpUrl(raw)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(raw, { signal: ctrl.signal, redirect: 'error', headers: { accept: 'application/json' } })
    if (!r.ok) throw new Error(`upstream responded ${r.status}`)
    if (!/json/i.test(r.headers.get('content-type') || '')) throw new Error('response is not JSON')
    const declared = Number(r.headers.get('content-length') || 0)
    if (declared && declared > maxBytes) throw new Error('response too large')
    const reader = r.body.getReader()
    const chunks = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > maxBytes) { ctrl.abort(); throw new Error('response too large') }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    clearTimeout(timer)
  }
}
