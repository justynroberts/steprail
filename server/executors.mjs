// MIT License - Copyright (c) fintonlabs.com
// Real executors, one per tool. No canned outputs: a step either does its
// job or fails with a plain-language error a person can act on. Connectors
// that need credentials read them from Settings and say exactly what to
// configure when missing.
import { spawn } from 'node:child_process'
import vm from 'node:vm'
import { connectMcp, mcpResultToOutput } from './mcp.mjs'

const CLI_TIMEOUT = 120_000
const HTTP_TIMEOUT = 20_000

// ---------- named connections ----------
// Settings hold a list of named credentials ({id, name, type, secret}) so a
// step can say WHICH database / workspace / key it means. Legacy single-value
// settings keys act as the unnamed default for each type.
const LEGACY_KEY = {
  postgres: 'postgresUrl',
  slack: 'slackWebhookUrl',
  smtp: 'smtpUrl',
  pagerduty: 'pagerdutyRoutingKey',
  anthropic: 'anthropicKey',
}

export function resolveConn(settings, type, name) {
  const pool = (settings.connections || []).filter(c => c.type === type)
  if (name && name.trim()) {
    const hit = pool.find(c => c.name.toLowerCase() === name.trim().toLowerCase())
    if (!hit) throw new Error(`No ${type} connection named "${name}" — add it in Settings → Connections.`)
    return hit.secret
  }
  if (pool.length) return pool[0].secret
  return settings[LEGACY_KEY[type]] || null
}

// Never let credentials ride along in URLs quoted by error messages.
const safeUrl = u => {
  try {
    const url = new URL(u)
    url.username = ''
    url.password = ''
    return url.toString()
  } catch {
    return String(u).replace(/\/\/[^@/]+@/, '//')
  }
}

// CLI args come from step config: refuse flag smuggling and end option
// parsing explicitly where the tool supports it.
const positional = value => {
  const v = String(value ?? '')
  if (v.startsWith('-')) throw new Error(`"${v}" looks like a CLI flag — step fields take plain values only.`)
  return v
}

// ctx: { settings, input (previous step output), outputs (token map),
//        trigger (payload for trigger steps), flow }
// config arrives with {{tokens}} already resolved.

const runCli = (bin, args, opts = {}) =>
  new Promise(resolve => {
    let out = ''
    const child = spawn(bin, args, { ...opts, timeout: CLI_TIMEOUT })
    child.on('error', err => {
      if (err.code === 'ENOENT') resolve({ error: `${bin} isn't installed where the newflow server runs — install it (or run the server outside Docker) to use this step.` })
      else resolve({ error: `${bin} failed to start: ${err.message}` })
    })
    child.stdout?.on('data', d => { out += d })
    child.stderr?.on('data', d => { out += d })
    child.on('close', code => {
      const tail = out.trim().split('\n').slice(-25).join('\n').slice(-4000)
      if (code === 0) resolve({ exitCode: 0, output: tail })
      else resolve({ error: `${bin} exited with code ${code}: ${tail.slice(-500) || 'no output'}` })
    })
  })

const httpJson = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT) })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text.slice(0, 4000) }
  return { res, body }
}

async function anthropicRaw(settings, connName, payload) {
  const key = resolveConn(settings, 'anthropic', connName)
  if (!key) throw new Error('No Anthropic API key — add one in Settings → Connections to use AI steps.')
  const { res, body } = await httpJson('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: payload.model || settings.model || 'claude-sonnet-4-6', max_tokens: 2048, ...payload }),
  })
  if (!res.ok) throw new Error(`Anthropic API: ${body?.error?.message || res.status}`)
  return body
}

async function anthropic(settings, prompt, model, connName) {
  const body = await anthropicRaw(settings, connName, { model, messages: [{ role: 'user', content: prompt }] })
  return { text: body.content?.[0]?.text || '', tokens: (body.usage?.input_tokens || 0) + (body.usage?.output_tokens || 0) }
}

// The agentic loop: Claude sees the MCP server's tools, decides what to call,
// newflow executes the calls, and the transcript loops back until the model
// finishes or the step budget runs out.
async function agentLoop(settings, config, ctx) {
  const mcp = await connectMcp(resolveConn(settings, 'mcp', config.mcp))
  try {
    const mcpTools = await mcp.listTools()
    const tools = mcpTools.map(t => ({
      name: String(t.name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
      description: t.description || t.name,
      input_schema: t.inputSchema || { type: 'object', properties: {} },
    }))
    const nameMap = Object.fromEntries(tools.map((t, i) => [t.name, mcpTools[i].name]))
    const maxSteps = Math.max(1, Math.min(20, parseInt(config.maxSteps, 10) || 8))
    const messages = [{
      role: 'user',
      content: `Goal: ${config.goal}\n\nContext from the previous step:\n${inputAsText(ctx.input)}\n\nUse the available tools as needed, then reply with your result.`,
    }]
    const toolCalls = []
    let tokens = 0
    for (let turn = 0; turn <= maxSteps; turn++) {
      const body = await anthropicRaw(settings, config.connection, { model: config.model, messages, tools })
      tokens += (body.usage?.input_tokens || 0) + (body.usage?.output_tokens || 0)
      const toolUses = (body.content || []).filter(c => c.type === 'tool_use')
      if (!toolUses.length || turn === maxSteps) {
        const text = (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n')
        return { result: text || '(no final text)', steps: turn, toolCalls, tokens }
      }
      messages.push({ role: 'assistant', content: body.content })
      const results = []
      for (const use of toolUses) {
        let resultText, isError = false
        try {
          const r = await mcp.callTool(nameMap[use.name] || use.name, use.input || {})
          resultText = (r.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n') || JSON.stringify(r)
          isError = Boolean(r.isError)
        } catch (err) {
          resultText = `Tool failed: ${err.message}`
          isError = true
        }
        toolCalls.push({ tool: use.name, ok: !isError })
        results.push({ type: 'tool_result', tool_use_id: use.id, content: resultText.slice(0, 8000), is_error: isError })
      }
      messages.push({ role: 'user', content: results })
    }
  } finally {
    mcp.close()
  }
}

const sandbox = (code, contextVars) => {
  try {
    return vm.runInNewContext(`(function(){ ${code} })()`, { ...contextVars, JSON, Math }, { timeout: 1000 })
  } catch (err) {
    throw new Error(`Your code threw: ${err.message}`)
  }
}

const inputAsText = input => {
  if (input === undefined || input === null) return '(no upstream data)'
  return typeof input === 'string' ? input : JSON.stringify(input, null, 2).slice(0, 6000)
}

export const EXECUTORS = {
  // Triggers: output whatever actually started the run.
  'trigger.webhook': async (config, ctx) =>
    ctx.trigger || { trigger: 'manual', path: config.path, firedAt: new Date().toISOString() },
  'trigger.git': async (config, ctx) =>
    ctx.trigger || { trigger: 'manual', repo: config.repo, branch: config.branch || 'main', firedAt: new Date().toISOString() },
  'trigger.file': async (config, ctx) =>
    ctx.trigger || { trigger: 'manual', glob: config.glob, firedAt: new Date().toISOString() },
  'trigger.schedule': async (config, ctx) =>
    ctx.trigger || { trigger: 'manual', firedAt: new Date().toISOString() },
  'trigger.form': async (config, ctx) =>
    ctx.trigger || { trigger: 'manual', note: 'Submit the hosted form to run with real answers.', path: config.path, firedAt: new Date().toISOString() },
  'trigger.mcp': async (config, ctx) =>
    ctx.trigger || { trigger: 'manual', note: 'Call this flow as an MCP tool to run with real arguments.', tool: config.toolName, firedAt: new Date().toISOString() },

  // AI — real Anthropic calls.
  'ai.prompt': async (config, ctx) => {
    const out = await anthropic(ctx.settings, config.prompt, config.model, config.connection)
    return { text: out.text, tokens: out.tokens }
  },
  'ai.agent': async (config, ctx) => {
    // With an MCP server attached this is a real tool-use loop; without one
    // it is a single reasoning call.
    if ((config.mcp || '').trim() || resolveConn(ctx.settings, 'mcp', '') ) {
      try {
        return await agentLoop(ctx.settings, config, ctx)
      } catch (err) {
        // Fall through to a plain call only if the MCP side is simply absent.
        if (!/No mcp connection|MCP connection is empty/.test(err.message)) throw err
      }
    }
    const out = await anthropic(
      ctx.settings,
      `You are an autonomous assistant. Goal: ${config.goal}\n\nContext from the previous step:\n${inputAsText(ctx.input)}\n\nWork the goal and reply with your result.`,
      config.model,
      config.connection,
    )
    return { result: out.text, tokens: out.tokens, toolCalls: [] }
  },
  'ai.mcptool': async (config, ctx) => {
    const mcp = await connectMcp(resolveConn(ctx.settings, 'mcp', config.connection))
    try {
      let args = {}
      if (config.args && config.args.trim()) {
        try { args = JSON.parse(config.args) } catch { throw new Error('Arguments must be a JSON object like {"path": "file.txt"}.') }
      }
      const result = await mcp.callTool(config.tool, args)
      const output = mcpResultToOutput(result)
      if (output.isError) throw new Error(`MCP tool "${config.tool}": ${output.text || 'returned an error'}`)
      return output
    } finally {
      mcp.close()
    }
  },
  'ai.extract': async (config, ctx) => {
    const { parseFormFields } = await import('../shared/formcore.mjs')
    const fields = parseFormFields(config.fields)
    if (!fields.length) throw new Error('Add at least one field to extract.')
    const typeFor = f => (f.type === 'number' ? { type: 'number' } : { type: 'string', description: f.label })
    const schema = {
      type: 'object',
      properties: Object.fromEntries(fields.map(f => [f.key, typeFor(f)])),
      required: fields.filter(f => f.required).map(f => f.key),
    }
    // tool_choice forces a structured reply — guaranteed parseable output.
    const body = await anthropicRaw(ctx.settings, config.connection, {
      model: config.model,
      messages: [{ role: 'user', content: `Extract the requested fields from this input:\n\n${inputAsText(ctx.input)}${config.hint ? `\n\nGuidance: ${config.hint}` : ''}` }],
      tools: [{ name: 'extract', description: 'Return the extracted fields', input_schema: schema }],
      tool_choice: { type: 'tool', name: 'extract' },
    })
    const use = (body.content || []).find(c => c.type === 'tool_use')
    if (!use) throw new Error('The model returned no structured output — try adding guidance.')
    return use.input
  },
  'ai.classify': async (config, ctx) => {
    const labels = config.labels.split(',').map(l => l.trim()).filter(Boolean)
    const out = await anthropic(
      ctx.settings,
      `Classify the following into exactly one of these labels: ${labels.join(', ')}.\n\n${inputAsText(ctx.input)}\n\nReply with ONLY the label.`,
      undefined,
      config.connection,
    )
    const label = labels.find(l => out.text.toLowerCase().includes(l.toLowerCase())) || out.text.trim().split('\n')[0]
    return { label, raw: out.text.trim() }
  },
  'ai.summarize': async (config, ctx) => {
    const style = config.style || 'bullets'
    const out = await anthropic(ctx.settings, `Summarize the following as ${style}:\n\n${inputAsText(ctx.input)}`, undefined, config.connection)
    return { summary: out.text }
  },

  // Infra — real CLIs on the machine running the server.
  'infra.terraform': async config => {
    const r = await runCli('terraform', [`-chdir=${positional(config.dir)}`, config.action || 'plan', '-no-color', ...(config.action === 'apply' || config.action === 'destroy' ? ['-auto-approve'] : [])])
    if (r.error) throw new Error(r.error)
    return { action: config.action || 'plan', ...r }
  },
  'infra.k8s': async config => {
    const args = ['--context', positional(config.context), ...(config.manifest ? ['apply', '-f', positional(config.manifest)] : ['get', 'pods'])]
    const r = await runCli('kubectl', args)
    if (r.error) throw new Error(r.error)
    return r
  },
  'infra.docker': async config => {
    const r = await runCli('docker', ['build', '-t', positional(config.tag), '--', positional(config.context || '.')])
    if (r.error) throw new Error(r.error)
    return { image: config.tag, ...r }
  },
  'infra.ssh': async config => {
    const r = await runCli('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', positional(config.host), config.command])
    if (r.error) throw new Error(r.error)
    return { host: config.host, exitCode: r.exitCode, stdout: r.output }
  },
  'infra.lambda': async config => {
    const r = await runCli('aws', ['lambda', 'invoke', '--function-name', positional(config.fn), '/dev/stdout'])
    if (r.error) throw new Error(r.error)
    return r
  },

  // Data
  'data.http': async (config, ctx) => {
    const method = config.method || 'GET'
    const headers = {}
    if (config.headers) {
      try { Object.assign(headers, JSON.parse(config.headers)) } catch { throw new Error('Headers must be a JSON object like {"x-key": "value"}.') }
    }
    if (config.body) headers['content-type'] = headers['content-type'] || 'application/json'
    if (config.connection) headers.authorization = `Bearer ${resolveConn(ctx.settings, 'apikey', config.connection)}`
    // W3C trace context: downstream services join this run's trace.
    if (ctx.trace) headers.traceparent = `00-${ctx.trace.traceId}-${ctx.trace.spanId}-01`
    let res, body
    try {
      ;({ res, body } = await httpJson(config.url, {
        method,
        headers: Object.keys(headers).length ? headers : undefined,
        body: method === 'POST' || method === 'PUT' ? config.body || undefined : undefined,
      }))
    } catch (err) {
      throw new Error(`Could not reach ${safeUrl(config.url)}: ${err.cause?.code || err.message}`)
    }
    return { status: res.status, ok: res.ok, url: safeUrl(config.url), response: body }
  },
  'data.postgres': async (config, ctx) => {
    const connUrl = resolveConn(ctx.settings, 'postgres', config.connection)
    if (!connUrl) throw new Error('No PostgreSQL connection — add one in Settings → Connections.')
    const { default: pg } = await import('pg')
    const client = new pg.Client({ connectionString: connUrl, connectionTimeoutMillis: 8000 })
    try {
      await client.connect()
      const result = await client.query(config.query)
      return { rowCount: result.rowCount, rows: result.rows.slice(0, 50) }
    } catch (err) {
      throw new Error(`PostgreSQL${config.connection ? ` (${config.connection})` : ''}: ${safeUrl(String(err.message))}`)
    } finally {
      await client.end().catch(() => {})
    }
  },
  'data.transform': async (config, ctx) => {
    const value = sandbox(config.code, { input: ctx.input })
    return { output: value === undefined ? null : value }
  },
  'data.filter': async (config, ctx) => {
    const input = ctx.input || {}
    const items = Array.isArray(input) ? input : input.items || input.rows || input.output || []
    if (!Array.isArray(items)) throw new Error('The previous step did not produce a list — Filter needs items, rows, or an array.')
    const kept = items.filter(item => {
      try {
        return Boolean(vm.runInNewContext(config.expr, { item, JSON, Math }, { timeout: 200 }))
      } catch (err) {
        throw new Error(`Condition failed on an item: ${err.message}`)
      }
    })
    return { kept: kept.slice(0, 50), keptCount: kept.length, dropped: items.length - kept.length }
  },

  // Persistent key/value memory: state that survives across runs — the
  // backbone of loops and long-lived agents.
  'data.memory': async (config, ctx) => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'memory.json')
    let store = {}
    try { store = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* fresh store */ }
    const key = (config.key || '').trim()
    if (!key) throw new Error('Memory needs a key.')
    const mode = config.mode || 'save'
    if (mode === 'load') return { key, value: store[key] ?? null, found: key in store }
    if (mode === 'append') {
      const list = Array.isArray(store[key]) ? store[key] : []
      list.push(config.value ?? ctx.input ?? null)
      store[key] = list.slice(-200)
    } else if (mode === 'forget') {
      delete store[key]
    } else {
      store[key] = config.value !== undefined && config.value !== '' ? config.value : ctx.input ?? null
    }
    const tmp = file + '.tmp'
    const fd = fs.openSync(tmp, 'w', 0o600)
    try { fs.writeSync(fd, JSON.stringify(store)) } finally { fs.closeSync(fd) }
    fs.renameSync(tmp, file)
    return { key, value: store[key] ?? null, mode }
  },

  // Logic — branch/wait/approval have queue-level semantics; these bodies
  // produce their outputs. (Routing, delays, and holds happen in the worker.)
  'logic.branch': async (config, ctx) => {
    const input = ctx.input || {}
    let value
    if (config.on && config.on.trim()) {
      value = config.on.includes('{{') ? config.on : config.on.split('.').reduce((cur, part) => (cur && typeof cur === 'object' ? cur[part.trim()] : undefined), input)
      if (value === undefined) value = config.on // literal fallback
    }
    return { value: value === undefined ? null : value }
  },
  'logic.loop': async (config, ctx) => {
    const items = sandbox(`return (${config.items})`, { input: ctx.input })
    if (!Array.isArray(items)) throw new Error(`"${config.items}" did not evaluate to a list.`)
    return { count: items.length, items: items.slice(0, 50), first: items[0] ?? null }
  },
  'logic.wait': async config => ({ waited: config.duration }),
  'logic.approval': async (config, ctx) => ({ approvedBy: ctx.approvedBy || 'unknown', at: new Date().toISOString() }),

  // Notify — real deliveries via credentials in Settings.
  'notify.slack': async (config, ctx) => {
    const webhook = resolveConn(ctx.settings, 'slack', config.connection)
    if (!webhook) throw new Error('Slack is not connected — add an incoming-webhook connection in Settings.')
    const { res, body } = await httpJson(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `${config.channel ? `[${config.channel}] ` : ''}${config.message || inputAsText(ctx.input)}` }),
    })
    if (!res.ok) throw new Error(`Slack webhook: ${res.status} ${typeof body === 'string' ? body.slice(0, 120) : ''}`)
    return { channel: config.channel, message: config.message, delivered: true }
  },
  'notify.email': async (config, ctx) => {
    const smtpUrl = resolveConn(ctx.settings, 'smtp', config.connection)
    if (!smtpUrl) throw new Error('Email is not connected — add an SMTP connection in Settings.')
    const { default: nodemailer } = await import('nodemailer')
    const transport = nodemailer.createTransport(smtpUrl)
    let info
    try {
      info = await transport.sendMail({
        from: ctx.settings.smtpFrom || 'newflow@fintonlabs.com',
        to: config.to,
        subject: config.subject || `newflow: ${ctx.flow.name}`,
        text: config.body || inputAsText(ctx.input),
      })
    } catch (err) {
      // Transport errors can echo the connection URL — never leak credentials.
      throw new Error(`Email send failed (${safeUrl(smtpUrl)}): ${String(err.message).slice(0, 160)}`)
    }
    return { messageId: info.messageId, accepted: info.accepted?.length > 0 }
  },
  'notify.pagerduty': async (config, ctx) => {
    const routingKey = resolveConn(ctx.settings, 'pagerduty', config.connection)
    if (!routingKey) throw new Error('PagerDuty is not connected — add an Events v2 routing-key connection in Settings.')
    const { res, body } = await httpJson('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        routing_key: routingKey,
        event_action: 'trigger',
        payload: { summary: `${ctx.flow.name}: ${config.service}`, source: 'newflow', severity: 'error', custom_details: ctx.input },
      }),
    })
    if (!res.ok) throw new Error(`PagerDuty: ${res.status} ${body?.message || ''}`)
    return { dedupKey: body.dedup_key, status: body.status }
  },
}

export async function executeStep(toolId, config, ctx) {
  const exec = EXECUTORS[toolId]
  if (!exec) throw new Error(`No executor for tool "${toolId}".`)
  return await exec(config, ctx)
}
