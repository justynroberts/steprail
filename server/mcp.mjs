// MIT License - Copyright (c) fintonlabs.com
// Minimal MCP client: JSON-RPC 2.0 over newline-delimited stdio (spawned
// command) or HTTP POST (plain JSON or single-event SSE responses). Enough
// for initialize / tools/list / tools/call against real MCP servers without
// pulling in an SDK.
import { spawn } from 'node:child_process'

const RPC_TIMEOUT = 30_000

function parseSseJson(text) {
  // Streamable-HTTP servers may answer with an SSE body; take the last data: payload.
  const datas = text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim())
  for (let i = datas.length - 1; i >= 0; i--) {
    try { return JSON.parse(datas[i]) } catch { /* keep looking */ }
  }
  throw new Error('MCP server returned an unreadable SSE response.')
}

async function connectHttp(url) {
  let nextId = 1
  let sessionId = null
  const call = async (method, params = {}, isNotification = false) => {
    const payload = isNotification
      ? { jsonrpc: '2.0', method, params }
      : { jsonrpc: '2.0', id: nextId++, method, params }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RPC_TIMEOUT),
    })
    sessionId = res.headers.get('mcp-session-id') || sessionId
    if (isNotification) return null
    if (!res.ok) throw new Error(`MCP server ${url} answered ${res.status}.`)
    const text = await res.text()
    const msg = res.headers.get('content-type')?.includes('event-stream') ? parseSseJson(text) : JSON.parse(text)
    if (msg.error) throw new Error(`MCP: ${msg.error.message || JSON.stringify(msg.error)}`)
    return msg.result
  }
  await call('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'newflow', version: '0.1.0' },
  })
  await call('notifications/initialized', {}, true)
  return {
    listTools: async () => (await call('tools/list')).tools || [],
    callTool: async (name, args) => await call('tools/call', { name, arguments: args }),
    close: () => {},
  }
}

async function connectStdio(commandLine) {
  const [bin, ...args] = commandLine.match(/(?:[^\s"]+|"[^"]*")+/g).map(p => p.replace(/^"|"$/g, ''))
  const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map()
  let nextId = 1
  let buffer = ''
  let spawnError = null
  child.on('error', err => {
    spawnError = err.code === 'ENOENT' ? new Error(`"${bin}" isn't installed where the newflow server runs.`) : err
    for (const [, p] of pending) p.reject(spawnError)
    pending.clear()
  })
  child.stdout.on('data', chunk => {
    buffer += chunk
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line)
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          if (msg.error) p.reject(new Error(`MCP: ${msg.error.message || JSON.stringify(msg.error)}`))
          else p.resolve(msg.result)
        }
      } catch { /* server logs on stdout — ignore non-JSON lines */ }
    }
  })

  const call = (method, params = {}, isNotification = false) =>
    new Promise((resolve, reject) => {
      if (spawnError) return reject(spawnError)
      const payload = isNotification
        ? { jsonrpc: '2.0', method, params }
        : { jsonrpc: '2.0', id: nextId, method, params }
      if (isNotification) {
        child.stdin.write(JSON.stringify(payload) + '\n')
        return resolve(null)
      }
      const id = nextId++
      pending.set(id, { resolve, reject })
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`MCP server did not answer ${method} within ${RPC_TIMEOUT / 1000}s.`))
      }, RPC_TIMEOUT)
      const wrapped = pending.get(id)
      pending.set(id, {
        resolve: v => { clearTimeout(timer); wrapped.resolve(v) },
        reject: e => { clearTimeout(timer); wrapped.reject(e) },
      })
      child.stdin.write(JSON.stringify(payload) + '\n')
    })

  await call('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'newflow', version: '0.1.0' },
  })
  await call('notifications/initialized', {}, true)
  return {
    listTools: async () => (await call('tools/list')).tools || [],
    callTool: async (name, args) => await call('tools/call', { name, arguments: args }),
    close: () => { try { child.kill() } catch { /* already gone */ } },
  }
}

// secret: "https://host/mcp" or a stdio command line.
export async function connectMcp(secret) {
  const value = String(secret || '').trim()
  if (!value) throw new Error('The MCP connection is empty.')
  return /^https?:\/\//i.test(value) ? connectHttp(value) : connectStdio(value)
}

// Flatten an MCP tool result into something the rail can display and token-ify.
export function mcpResultToOutput(result) {
  if (!result) return { result: null }
  const texts = (result.content || []).filter(c => c.type === 'text').map(c => c.text)
  const joined = texts.join('\n')
  let parsed
  try { parsed = JSON.parse(joined) } catch { /* plain text */ }
  const out = parsed && typeof parsed === 'object' ? parsed : { text: joined }
  if (result.isError) out.isError = true
  return out
}
