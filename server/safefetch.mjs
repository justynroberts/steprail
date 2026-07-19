// MIT License - Copyright (c) fintonlabs.com
// SSRF-hardened JSON fetch for author-supplied URLs (dynamic form dropdowns).
// Blocks loopback / private / link-local / CGNAT / cloud-metadata targets,
// refuses redirects, caps the response size, and requires a JSON content-type.
// The connection is PINNED to the exact address we validated (via a custom
// lookup on node:http/https), so there is no second DNS resolution and no
// rebinding window between the check and the fetch.
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
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

// Resolve the host and reject if ANY resolved address is non-public. Returns
// the parsed URL plus the validated addresses so the caller can pin to one.
export async function assertPublicHttpUrl(raw) {
  let url
  try { url = new URL(raw) } catch { throw new Error('invalid URL') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http/https URLs are allowed')
  if (net.isIP(url.hostname) && isBlockedIp(url.hostname)) throw new Error('URL points at a private or reserved address')
  const addresses = await lookup(url.hostname, { all: true })
  if (!addresses.length) throw new Error('host did not resolve')
  for (const a of addresses) if (isBlockedIp(a.address)) throw new Error('URL resolves to a private or reserved address')
  return { url, addresses }
}

// Fetch JSON with all the guards. Throws on any violation. Connects to the
// pre-validated IP (pinned lookup) so DNS can't rebind to a private address
// after the check; hostname still drives the Host header and TLS servername.
export async function fetchJsonSafely(raw, { timeoutMs = 5000, maxBytes = 256 * 1024 } = {}) {
  const { url, addresses } = await assertPublicHttpUrl(raw)
  const pinned = addresses[0]
  const pinnedLookup = (_hostname, options, cb) => {
    if (options && options.all) cb(null, [{ address: pinned.address, family: pinned.family }])
    else cb(null, pinned.address, pinned.family)
  }
  const lib = url.protocol === 'https:' ? https : http

  return await new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      { method: 'GET', lookup: pinnedLookup, headers: { accept: 'application/json' }, timeout: timeoutMs },
      res => {
        const status = res.statusCode || 0
        if (status >= 300 && status < 400) { res.destroy(); return reject(new Error('redirects are not allowed')) }
        if (status < 200 || status >= 300) { res.destroy(); return reject(new Error(`upstream responded ${status}`)) }
        if (!/json/i.test(res.headers['content-type'] || '')) { res.destroy(); return reject(new Error('response is not JSON')) }
        if (Number(res.headers['content-length'] || 0) > maxBytes) { res.destroy(); return reject(new Error('response too large')) }
        const chunks = []
        let total = 0
        res.on('data', d => {
          total += d.length
          if (total > maxBytes) { res.destroy(); reject(new Error('response too large')); return }
          chunks.push(d)
        })
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
          catch { reject(new Error('response is not valid JSON')) }
        })
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('request timed out')))
    req.on('error', reject)
    req.end()
  })
}
