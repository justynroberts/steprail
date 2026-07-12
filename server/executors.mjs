// MIT License - Copyright (c) fintonlabs.com
// Real executors, one per tool. No canned outputs: a step either does its
// job or fails with a plain-language error a person can act on. Connectors
// that need credentials read them from Settings and say exactly what to
// configure when missing.
import { spawn } from 'node:child_process'
import vm from 'node:vm'

const CLI_TIMEOUT = 120_000
const HTTP_TIMEOUT = 20_000

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

async function anthropic(settings, prompt, model) {
  if (!settings.anthropicKey) throw new Error('No Anthropic API key — add one in Settings to use AI steps.')
  const { res, body } = await httpJson('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': settings.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: model || settings.model || 'claude-sonnet-4-6', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) throw new Error(`Anthropic API: ${body?.error?.message || res.status}`)
  return { text: body.content?.[0]?.text || '', tokens: (body.usage?.input_tokens || 0) + (body.usage?.output_tokens || 0) }
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

  // AI — real Anthropic calls.
  'ai.prompt': async (config, ctx) => {
    const out = await anthropic(ctx.settings, config.prompt, config.model)
    return { text: out.text, tokens: out.tokens }
  },
  'ai.agent': async (config, ctx) => {
    const out = await anthropic(
      ctx.settings,
      `You are an autonomous assistant. Goal: ${config.goal}\n\nContext from the previous step:\n${inputAsText(ctx.input)}\n\nWork the goal and reply with your result.`,
      config.model,
    )
    return { result: out.text, tokens: out.tokens }
  },
  'ai.classify': async (config, ctx) => {
    const labels = config.labels.split(',').map(l => l.trim()).filter(Boolean)
    const out = await anthropic(
      ctx.settings,
      `Classify the following into exactly one of these labels: ${labels.join(', ')}.\n\n${inputAsText(ctx.input)}\n\nReply with ONLY the label.`,
    )
    const label = labels.find(l => out.text.toLowerCase().includes(l.toLowerCase())) || out.text.trim().split('\n')[0]
    return { label, raw: out.text.trim() }
  },
  'ai.summarize': async (config, ctx) => {
    const style = config.style || 'bullets'
    const out = await anthropic(ctx.settings, `Summarize the following as ${style}:\n\n${inputAsText(ctx.input)}`)
    return { summary: out.text }
  },

  // Infra — real CLIs on the machine running the server.
  'infra.terraform': async config => {
    const r = await runCli('terraform', [`-chdir=${config.dir}`, config.action || 'plan', '-no-color', ...(config.action === 'apply' || config.action === 'destroy' ? ['-auto-approve'] : [])])
    if (r.error) throw new Error(r.error)
    return { action: config.action || 'plan', ...r }
  },
  'infra.k8s': async config => {
    const args = ['--context', config.context, ...(config.manifest ? ['apply', '-f', config.manifest] : ['get', 'pods'])]
    const r = await runCli('kubectl', args)
    if (r.error) throw new Error(r.error)
    return r
  },
  'infra.docker': async config => {
    const r = await runCli('docker', ['build', '-t', config.tag, config.context || '.'])
    if (r.error) throw new Error(r.error)
    return { image: config.tag, ...r }
  },
  'infra.ssh': async config => {
    const r = await runCli('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', config.host, config.command])
    if (r.error) throw new Error(r.error)
    return { host: config.host, exitCode: r.exitCode, stdout: r.output }
  },
  'infra.lambda': async config => {
    const r = await runCli('aws', ['lambda', 'invoke', '--function-name', config.fn, '/dev/stdout'])
    if (r.error) throw new Error(r.error)
    return r
  },

  // Data
  'data.http': async config => {
    const method = config.method || 'GET'
    let res, body
    try {
      ;({ res, body } = await httpJson(config.url, {
        method,
        headers: config.body ? { 'content-type': 'application/json' } : undefined,
        body: method === 'POST' || method === 'PUT' ? config.body || undefined : undefined,
      }))
    } catch (err) {
      throw new Error(`Could not reach ${config.url}: ${err.cause?.code || err.message}`)
    }
    return { status: res.status, ok: res.ok, url: config.url, response: body }
  },
  'data.postgres': async (config, ctx) => {
    if (!ctx.settings.postgresUrl) throw new Error('No PostgreSQL connection — add a connection URL in Settings.')
    const { default: pg } = await import('pg')
    const client = new pg.Client({ connectionString: ctx.settings.postgresUrl, connectionTimeoutMillis: 8000 })
    try {
      await client.connect()
      const result = await client.query(config.query)
      return { rowCount: result.rowCount, rows: result.rows.slice(0, 50) }
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
    if (!ctx.settings.slackWebhookUrl) throw new Error('Slack is not connected — add an incoming-webhook URL in Settings.')
    const { res, body } = await httpJson(ctx.settings.slackWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `${config.channel ? `[${config.channel}] ` : ''}${config.message || inputAsText(ctx.input)}` }),
    })
    if (!res.ok) throw new Error(`Slack webhook: ${res.status} ${typeof body === 'string' ? body.slice(0, 120) : ''}`)
    return { channel: config.channel, message: config.message, delivered: true }
  },
  'notify.email': async (config, ctx) => {
    if (!ctx.settings.smtpUrl) throw new Error('Email is not connected — add an SMTP URL in Settings (smtp://user:pass@host:587).')
    const { default: nodemailer } = await import('nodemailer')
    const transport = nodemailer.createTransport(ctx.settings.smtpUrl)
    const info = await transport.sendMail({
      from: ctx.settings.smtpFrom || 'newflow@fintonlabs.com',
      to: config.to,
      subject: config.subject || `newflow: ${ctx.flow.name}`,
      text: inputAsText(ctx.input),
    })
    return { messageId: info.messageId, accepted: info.accepted?.length > 0 }
  },
  'notify.pagerduty': async (config, ctx) => {
    if (!ctx.settings.pagerdutyRoutingKey) throw new Error('PagerDuty is not connected — add an Events v2 routing key in Settings.')
    const { res, body } = await httpJson('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        routing_key: ctx.settings.pagerdutyRoutingKey,
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
