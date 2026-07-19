// MIT License - Copyright (c) fintonlabs.com
// Real executors, one per tool. No canned outputs: a step either does its
// job or fails with a plain-language error a person can act on. Connectors
// that need credentials read them from Settings and say exactly what to
// configure when missing.
import { spawn } from 'node:child_process'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectMcp, mcpResultToOutput } from './mcp.mjs'

const CLI_TIMEOUT = 120_000
const HTTP_TIMEOUT = 20_000

// Trust-on-first-use host keys live in the data dir, not ~/.ssh — in Docker
// ~/.ssh is the operator's keys mounted read-only, so recording there fails
// (and the data volume persists across container rebuilds, which ~ doesn't).
const KNOWN_HOSTS = path.join(process.env.STEPRAIL_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'), 'known_hosts')

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
    const { stdin, ...spawnOpts } = opts
    const child = spawn(bin, args, { ...spawnOpts, timeout: CLI_TIMEOUT })
    child.on('error', err => {
      if (err.code === 'ENOENT') resolve({ error: `${bin} isn't installed where the steprail server runs — install it (or run the server outside Docker) to use this step.` })
      else resolve({ error: `${bin} failed to start: ${err.message}` })
    })
    if (stdin !== undefined) {
      child.stdin?.on('error', () => {}) // EPIPE if the process dies early — the close handler reports it
      child.stdin?.write(stdin)
      child.stdin?.end()
    }
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
    body: JSON.stringify({ max_tokens: 2048, ...payload, model: payload.model || settings.model || 'claude-sonnet-4-6' }),
  })
  if (!res.ok) throw new Error(`Anthropic API: ${body?.error?.message || res.status}`)
  return body
}

async function anthropic(settings, prompt, model, connName) {
  const body = await anthropicRaw(settings, connName, { model, messages: [{ role: 'user', content: prompt }] })
  return { text: body.content?.[0]?.text || '', tokens: (body.usage?.input_tokens || 0) + (body.usage?.output_tokens || 0) }
}

// The agentic loop: Claude sees the MCP server's tools, decides what to call,
// steprail executes the calls, and the transcript loops back until the model
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
      config.model,
      config.connection,
    )
    const label = labels.find(l => out.text.toLowerCase().includes(l.toLowerCase())) || out.text.trim().split('\n')[0]
    return { label, raw: out.text.trim() }
  },
  'ai.summarize': async (config, ctx) => {
    const style = config.style || 'bullets'
    // Tokens welcome: an explicit text (e.g. {{Fleet.hosts.*.stdout}} plus
    // anything else) wins; blank keeps the classic previous-step behavior.
    const text = (config.text || '').trim() || inputAsText(ctx.input)
    const out = await anthropic(ctx.settings, `Summarize the following as ${style}:\n\n${text}`, config.model, config.connection)
    return { summary: out.text }
  },

  // Infra — real CLIs on the machine running the server.
  'infra.terraform': async (config, ctx) => {
    const env = { ...process.env }
    const awsCreds = resolveConn(ctx.settings, 'aws', config.connection)
    if (awsCreds) {
      try {
        const c = JSON.parse(awsCreds)
        if (c.accessKeyId) env.AWS_ACCESS_KEY_ID = c.accessKeyId
        if (c.secretAccessKey) env.AWS_SECRET_ACCESS_KEY = c.secretAccessKey
        if (c.region) env.AWS_DEFAULT_REGION = c.region
        if (c.sessionToken) env.AWS_SESSION_TOKEN = c.sessionToken
      } catch { throw new Error('AWS connection must be JSON: {"accessKeyId":"…","secretAccessKey":"…","region":"…"}') }
    }
    // Inline HCL is written to a private temp dir and initialised before the
    // action; a directory on disk is used in place (files already there).
    const inline = (config.source || (config.hcl?.trim() ? 'inline' : 'dir')) === 'inline'
    let chdir
    let tmpDir = null
    if (inline) {
      if (!config.hcl?.trim()) throw new Error('Terraform: write the HCL, or switch source to a directory on disk.')
      const { tmpdir } = await import('node:os')
      const { join } = await import('node:path')
      const { mkdtempSync, writeFileSync } = await import('node:fs')
      tmpDir = mkdtempSync(join(tmpdir(), 'sr-tf-'))
      writeFileSync(join(tmpDir, 'main.tf'), config.hcl, { mode: 0o600 })
      chdir = tmpDir
      const init = await runCli('terraform', [`-chdir=${chdir}`, 'init', '-no-color', '-input=false'], { env })
      if (init.error) throw new Error(`Terraform init failed — ${init.error}`)
    } else {
      if (!config.dir?.trim()) throw new Error('Terraform: set the working dir, or switch source to inline HCL.')
      chdir = positional(config.dir)
    }
    try {
      const r = await runCli('terraform', [`-chdir=${chdir}`, config.action || 'plan', '-no-color', '-input=false', ...(config.action === 'apply' || config.action === 'destroy' ? ['-auto-approve'] : [])], { env })
      if (r.error) throw new Error(r.error)
      return { action: config.action || 'plan', ...r }
    } finally {
      if (tmpDir) { const { rmSync } = await import('node:fs'); rmSync(tmpDir, { recursive: true, force: true }) }
    }
  },
  'infra.k8s': async (config, ctx) => {
    const kubeconfigContent = resolveConn(ctx.settings, 'k8s', config.connection)
    let tmpDir = null
    let kubeconfigArgs = []
    if (kubeconfigContent) {
      const { tmpdir } = await import('node:os')
      const { join } = await import('node:path')
      const { mkdtempSync, writeFileSync } = await import('node:fs')
      // mkdtempSync creates a 0o700 directory with a cryptographically random suffix,
      // eliminating the predictable-path symlink-race that Date.now() would allow.
      tmpDir = mkdtempSync(join(tmpdir(), 'sr-kube-'))
      writeFileSync(join(tmpDir, 'config'), kubeconfigContent, { mode: 0o600 })
      kubeconfigArgs = ['--kubeconfig', join(tmpDir, 'config')]
    }
    try {
      // Two modes: apply a manifest, or run a kubectl command outright.
      // Commands are split on whitespace and spawned without a shell — no
      // pipes or $(...); tokens have already been resolved into the string.
      // Because {{tokens}} can carry data from external webhooks, refuse the
      // flags that would redirect kubectl at other clusters or credentials —
      // an injected "--server https://evil" must fail, not exfiltrate.
      const command = (config.command || '').trim()
      let tail
      if ((config.mode === 'command' || (!config.manifest && command)) && command) {
        tail = command.replace(/^kubectl\s+/, '').split(/\s+/)
        if (!tail.length || !tail[0]) throw new Error('The kubectl command is empty — open this step and fill it in.')
        const forbidden = /^--?(kubeconfig|context|cluster|server|token|user|username|password|as|as-group|as-uid|client-key|client-certificate|certificate-authority|certificate-authority-data|insecure-skip-tls-verify|tls-server-name)(=|$)/
        const bad = tail.find(t => forbidden.test(t))
        if (bad) throw new Error(`"${bad}" is not allowed in a kubectl command — the cluster and credentials come from this step's Context and Kubeconfig fields.`)
      } else {
        tail = config.manifest ? ['apply', '-f', positional(config.manifest)] : ['get', 'pods']
      }
      const args = [...kubeconfigArgs, '--context', positional(config.context), ...tail]
      const r = await runCli('kubectl', args)
      if (r.error) throw new Error(r.error)
      return r
    } finally {
      if (tmpDir) {
        const { rmSync } = await import('node:fs')
        try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
      }
    }
  },
  'infra.docker': async config => {
    const r = await runCli('docker', ['build', '-t', positional(config.tag), '--', positional(config.context || '.')])
    if (r.error) throw new Error(r.error)
    return { image: config.tag, ...r }
  },
  'infra.ssh': async (config, ctx) => {
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')

    // Two run modes: a single command in argv, or a multi-line script piped
    // over stdin into `bash -s` on the remote host. The Command/Script tab
    // sets config.mode; older steps fall back to whichever field is filled.
    const command = (config.command || '').trim()
    const script = (config.script || '').trim()
    const mode = config.mode === 'script' || (config.mode !== 'command' && !command && script) ? 'script' : 'command'
    if (mode === 'command' && !command) throw new Error('SSH: write a command in the Command tab (or switch to Script).')
    if (mode === 'script' && !script) throw new Error('SSH: write a script in the Script tab (or switch to Command).')
    const remote = mode === 'command' ? command : 'bash -s'
    const stdin = mode === 'command' ? undefined : script.replace(/\r\n?/g, '\n') + '\n'

    // Host(s): a comma/newline list. Each entry is host, user@host,
    // host:port, or user@host:port — the same command/script runs on every
    // one, in parallel.
    const targets = String(config.host || '').split(/[\n,]+/).map(t => t.trim()).filter(Boolean)
    if (!targets.length) throw new Error('SSH: set at least one host.')
    if (targets.length > 20) throw new Error(`SSH: ${targets.length} hosts is more than the cap of 20 per step — split the list.`)

    const sshPool = (ctx.settings.connections || []).filter(c => c.type === 'ssh')
    // mkdtempSync creates a 0o700 directory with a cryptographically random
    // suffix, eliminating the predictable-path symlink race.
    const tmpDir = mkdtempSync(join(tmpdir(), 'sr-ssh-'))
    const keyFiles = new Map() // secret material -> key file path (shared across hosts)
    try {
      const runTarget = async raw => {
        // user@ and :port in the entry override the step-level fields.
        const at = raw.lastIndexOf('@')
        const userPart = at > 0 ? raw.slice(0, at) : (config.user || '').trim()
        const hostPort = at > 0 ? raw.slice(at + 1) : raw
        const colon = hostPort.lastIndexOf(':')
        const host = positional(colon > 0 ? hostPort.slice(0, colon) : hostPort)
        const port = colon > 0 ? String(parseInt(hostPort.slice(colon + 1), 10) || 22)
          : config.port ? String(parseInt(config.port, 10) || 22) : ''

        // Per-host credentials: an SSH secret NAMED like the host wins, so a
        // fleet with different logins is just a list of named secrets. Else
        // the step's chosen secret, else the project default.
        const named = sshPool.find(c => c.name.toLowerCase() === host.toLowerCase())
        const keyMaterial = named ? named.secret : resolveConn(ctx.settings, 'ssh', config.connection)
        const isPem = keyMaterial && keyMaterial.trim().startsWith('-----BEGIN')
        let keyArgs = []
        let sshpassEnv = null
        if (keyMaterial) {
          if (isPem) {
            let file = keyFiles.get(keyMaterial)
            if (!file) {
              file = join(tmpDir, `id${keyFiles.size}`)
              writeFileSync(file, keyMaterial.trim().replace(/\r\n?/g, '\n') + '\n', { mode: 0o600 })
              keyFiles.set(keyMaterial, file)
            }
            keyArgs = ['-i', file, '-o', 'StrictHostKeyChecking=accept-new']
          } else {
            // Plain password — sshpass reads it from the env, never argv.
            sshpassEnv = { ...process.env, SSHPASS: keyMaterial }
            keyArgs = ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'PasswordAuthentication=yes']
          }
        }
        const target = userPart ? `${userPart}@${host}` : host
        const batchMode = isPem || !keyMaterial ? ['-o', 'BatchMode=yes'] : []
        const cmd = sshpassEnv ? 'sshpass' : 'ssh'
        const sshArgs = ['-o', 'ConnectTimeout=10', '-o', `UserKnownHostsFile=${KNOWN_HOSTS}`, ...batchMode, ...keyArgs, ...(port ? ['-p', port] : []), '--', target, remote]
        const args = sshpassEnv ? ['-e', 'ssh', ...sshArgs] : sshArgs
        const r = await runCli(cmd, args, { ...(sshpassEnv ? { env: sshpassEnv } : {}), ...(stdin !== undefined ? { stdin } : {}) })
        return r.error ? { name: raw, ok: false, error: r.error } : { name: raw, ok: true, exitCode: r.exitCode, stdout: r.output }
      }

      // Parallel in waves of 5 — fast for a fleet, gentle on the box running this.
      const results = []
      for (let i = 0; i < targets.length; i += 5) {
        results.push(...await Promise.all(targets.slice(i, i + 5).map(t =>
          runTarget(t).catch(err => ({ name: t, ok: false, error: err.message })),
        )))
      }

      // One host keeps the original flat shape so existing flows and tokens
      // are untouched.
      if (results.length === 1) {
        const r = results[0]
        if (!r.ok) throw new Error(r.error)
        return { host: targets[0], exitCode: r.exitCode, stdout: r.stdout }
      }
      const okCount = results.filter(r => r.ok).length
      const failedHosts = results.filter(r => !r.ok).map(r => r.name)
      if (!okCount) {
        const first = results.find(r => !r.ok)
        throw new Error(`SSH: all ${targets.length} hosts failed — ${first.name}: ${first.error}`)
      }
      return {
        ok: okCount,
        failed: failedHosts.length,
        failedHosts,
        hosts: Object.fromEntries(results.map(r => [r.name, r.ok ? { ok: true, exitCode: r.exitCode, stdout: r.stdout } : { ok: false, error: r.error }])),
        output: results.map(r => `── ${r.name}\n${r.ok ? r.stdout : `ERROR: ${r.error}`}`).join('\n\n'),
      }
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    }
  },
  'infra.ansible': async (config, ctx) => {
    const { tmpdir } = await import('node:os')
    const { join, resolve } = await import('node:path')
    const { mkdtempSync, writeFileSync, rmSync, existsSync } = await import('node:fs')
    const tmpDir = mkdtempSync(join(tmpdir(), 'sr-ansible-'))
    try {
      const fromGit = (config.source || 'inline') === 'git'
      let workDir = tmpDir
      let playbookFile
      if (fromGit) {
        if (!config.repo?.trim()) throw new Error('Ansible: set the git repo URL, or switch Playbook source to inline.')
        const refArgs = config.ref?.trim() ? ['--branch', positional(config.ref.trim())] : []
        const clone = await runCli('git', ['clone', '--depth', '1', '--quiet', ...refArgs, '--', config.repo.trim(), join(tmpDir, 'repo')])
        if (clone.error) throw new Error(`Ansible: could not clone the repo — ${clone.error}`)
        workDir = join(tmpDir, 'repo')
        const rel = (config.path || 'site.yml').trim()
        playbookFile = resolve(workDir, rel)
        if (!playbookFile.startsWith(workDir)) throw new Error('Ansible: the playbook path must stay inside the repo.')
        if (!existsSync(playbookFile)) throw new Error(`Ansible: the repo has no file "${rel}" — check Playbook path.`)
      } else {
        if (!config.playbook?.trim()) throw new Error('Ansible: write the playbook YAML, or switch Playbook source to git.')
        playbookFile = join(tmpDir, 'playbook.yml')
        writeFileSync(playbookFile, config.playbook, { mode: 0o600 })
      }

      // Inventory comes either inline (a "host1,host2" list, or pasted
      // INI/YAML) or pulled from git (its own repo, or the playbook repo when
      // the repo URL is left blank). Blank means ansible's implicit localhost.
      const args = [playbookFile]
      const invFromGit = (config.invSource || (config.invRepo?.trim() ? 'git' : 'inline')) === 'git'
      const inv = (config.inventory || '').trim()
      if (invFromGit) {
        let invBase
        if (config.invRepo?.trim()) {
          const invRefArgs = config.invRef?.trim() ? ['--branch', positional(config.invRef.trim())] : []
          const invClone = await runCli('git', ['clone', '--depth', '1', '--quiet', ...invRefArgs, '--', config.invRepo.trim(), join(tmpDir, 'inv')])
          if (invClone.error) throw new Error(`Ansible: could not clone the inventory repo — ${invClone.error}`)
          invBase = join(tmpDir, 'inv')
        } else if (fromGit) {
          invBase = workDir // same checkout as the playbook
        } else {
          throw new Error('Ansible: set an Inventory git repo, or switch Inventory source to inline.')
        }
        const invFile = resolve(invBase, (config.invPath || 'inventory').trim())
        if (!invFile.startsWith(invBase)) throw new Error('Ansible: the inventory path must stay inside the repo.')
        if (!existsSync(invFile)) throw new Error(`Ansible: the inventory repo has no file "${(config.invPath || 'inventory').trim()}" — check Inventory path.`)
        args.push('-i', invFile)
      } else if (inv) {
        // Legacy: a bare path with a git-sourced playbook resolves in that repo.
        const repoInv = fromGit && !inv.includes('\n') ? resolve(workDir, inv) : ''
        if (repoInv && repoInv.startsWith(workDir) && existsSync(repoInv)) {
          args.push('-i', repoInv)
        } else if (!/[\n=:\[]/.test(inv)) {
          // Comma list — the trailing comma tells ansible it's hosts, not a file.
          args.push('-i', positional(inv.endsWith(',') ? inv : inv + ','))
        } else {
          const invFile = join(tmpDir, /^\s*(-|\w+:)/m.test(inv) && !inv.includes('[') ? 'inventory.yml' : 'inventory.ini')
          writeFileSync(invFile, inv + '\n', { mode: 0o600 })
          args.push('-i', invFile)
        }
      }
      if (config.user?.trim()) args.push('-u', positional(config.user.trim()))

      // Credentials reuse the SSH connection type: a PEM key becomes a 0600
      // --private-key file; a plain password rides in an extra-vars FILE as
      // ansible_password — never in argv, never in the process list.
      const secrets = {}
      const keyMaterial = resolveConn(ctx.settings, 'ssh', config.connection)
      if (keyMaterial) {
        if (keyMaterial.trim().startsWith('-----BEGIN')) {
          const keyFile = join(tmpDir, 'id')
          writeFileSync(keyFile, keyMaterial.trim().replace(/\r\n?/g, '\n') + '\n', { mode: 0o600 })
          args.push('--private-key', keyFile)
        } else {
          secrets.ansible_password = keyMaterial
          secrets.ansible_ssh_pass = keyMaterial
        }
      }
      let extra = {}
      if (config.extraVars?.trim()) {
        try { extra = JSON.parse(config.extraVars) } catch {
          throw new Error('Ansible: Extra vars must be a JSON object like {"app_version": "1.2"}.')
        }
      }
      if (Object.keys(extra).length || Object.keys(secrets).length) {
        const varsFile = join(tmpDir, 'extra-vars.json')
        writeFileSync(varsFile, JSON.stringify({ ...extra, ...secrets }), { mode: 0o600 })
        args.push('--extra-vars', '@' + varsFile)
      }

      const env = {
        ...process.env,
        // Same trust-on-first-use posture as the SSH step: unknown hosts are
        // accepted and recorded on first contact, but a CHANGED key refuses —
        // that's what blocks man-in-the-middle after first use. The extra
        // args restate ansible's defaults, which ANSIBLE_SSH_ARGS replaces.
        ANSIBLE_HOST_KEY_CHECKING: 'True',
        ANSIBLE_SSH_ARGS: `-C -o ControlMaster=auto -o ControlPersist=60s -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${KNOWN_HOSTS}`,
        ANSIBLE_FORCE_COLOR: '0',
        ANSIBLE_RETRY_FILES_ENABLED: 'False',
        ANSIBLE_LOCAL_TEMP: join(tmpDir, '.ansible-tmp'),
      }
      const r = await runCli('ansible-playbook', args, { env, cwd: workDir })

      // The PLAY RECAP lines carry per-host counters in both success and
      // failure output — parse them either way.
      const hosts = {}
      for (const line of (r.output || r.error || '').split('\n')) {
        const m = /^(\S+)\s*:\s*ok=(\d+)\s+changed=(\d+)\s+unreachable=(\d+)\s+failed=(\d+)/.exec(line.trim())
        if (m) hosts[m[1]] = { ok: +m[2], changed: +m[3], unreachable: +m[4], failed: +m[5] }
      }
      const total = key => Object.values(hosts).reduce((n, h) => n + h[key], 0)
      if (r.error) {
        const failing = (r.error.match(/fatal: \[[^\]]+\]: [^\n]*/) || [])[0]
        throw new Error(failing ? `Ansible playbook failed — ${failing.slice(0, 300)}` : `Ansible: ${r.error.slice(-400)}`)
      }
      return { ok: total('ok'), changed: total('changed'), failed: total('failed'), unreachable: total('unreachable'), hosts, output: r.output }
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    }
  },
  'infra.lambda': async (config, ctx) => {
    const env = { ...process.env }
    const awsCreds = resolveConn(ctx.settings, 'aws', config.connection)
    if (awsCreds) {
      try {
        const c = JSON.parse(awsCreds)
        if (c.accessKeyId) env.AWS_ACCESS_KEY_ID = c.accessKeyId
        if (c.secretAccessKey) env.AWS_SECRET_ACCESS_KEY = c.secretAccessKey
        if (c.region) env.AWS_DEFAULT_REGION = c.region
        if (c.sessionToken) env.AWS_SESSION_TOKEN = c.sessionToken
      } catch { throw new Error('AWS connection must be JSON: {"accessKeyId":"…","secretAccessKey":"…","region":"…"}') }
    }
    const r = await runCli('aws', ['lambda', 'invoke', '--function-name', positional(config.fn), '/dev/stdout'], { env })
    if (r.error) throw new Error(r.error)
    return r
  },
  'infra.git': async (config, ctx) => {
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { mkdtempSync, writeFileSync, rmSync, existsSync } = await import('node:fs')
    const op = config.op || 'status'
    const remote = (config.remote || 'origin').trim() || 'origin'
    const ref = (config.ref || '').trim()

    // A GitHub token authenticates HTTPS network ops. It must never touch argv
    // (leaks via /proc/PID/cmdline) or the URL — so it goes into a 0600 git
    // config file referenced through GIT_CONFIG_GLOBAL, the same off-argv
    // discipline the SSH/Ansible executors use for keys and passwords.
    const token = resolveConn(ctx.settings, 'github', config.connection)
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    let authDir = null
    if (token) {
      authDir = mkdtempSync(join(tmpdir(), 'sr-gitauth-'))
      const b64 = Buffer.from(`x-access-token:${token}`).toString('base64')
      writeFileSync(join(authDir, 'config'), `[http]\n\textraheader = Authorization: Basic ${b64}\n`, { mode: 0o600 })
      env.GIT_CONFIG_GLOBAL = join(authDir, 'config')
      env.GIT_CONFIG_SYSTEM = '/dev/null' // ignore host-wide config too
    }
    // Real git refuses to commit/tag without an identity; supply a bot one.
    const idArgs = ['-c', 'user.name=steprail', '-c', 'user.email=steprail@localhost']

    try {
      // Clone stands alone — it creates the checkout later ops (and later
      // steps) work in. A blank dir clones to a scratch dir whose path we return.
      if (op === 'clone') {
        if (!config.repo?.trim()) throw new Error('Git clone: set the Repo URL.')
        const dest = config.dir?.trim() ? positional(config.dir.trim()) : join(mkdtempSync(join(tmpdir(), 'sr-git-')), 'repo')
        const args = ['clone', '--quiet']
        if (ref) args.push('--branch', positional(ref))
        args.push('--', config.repo.trim(), dest)
        const r = await runCli('git', args, { env })
        if (r.error) throw new Error(r.error)
        const head = await runCli('git', ['-C', dest, 'log', '--oneline', '-1'], { env })
        return { op, dir: dest, ref: ref || undefined, exitCode: 0, output: (head.output || 'cloned').trim() }
      }

      // Every other op runs inside an existing checkout.
      const cwd = config.dir?.trim() ? positional(config.dir.trim()) : null
      if (!cwd) throw new Error(`Git ${op}: set the Working directory (the repo checkout).`)
      if (!existsSync(join(cwd, '.git'))) throw new Error(`Git ${op}: "${cwd}" isn't a git repo — clone first, or fix the Working directory.`)
      const git = (...a) => runCli('git', ['-C', cwd, ...a], { env })

      let r
      switch (op) {
        case 'status': r = await git('status', '--short', '--branch'); break
        case 'log': r = await git('log', '--oneline', '-20', ...(ref ? [positional(ref)] : [])); break
        case 'checkout': {
          if (!ref) throw new Error('Git checkout: set the Branch / tag / commit.')
          r = await git('checkout', positional(ref))
          if (r.error) r = await git('checkout', '-b', positional(ref)) // not found → create it
          break
        }
        case 'commit': {
          const files = (config.files || '').trim()
          const add = files ? files.split(/[\s,]+/).filter(Boolean).map(positional) : ['-A']
          const staged = await git('add', ...add)
          if (staged.error) throw new Error(staged.error)
          if (!config.message?.trim()) throw new Error('Git commit: set a Message.')
          r = await git(...idArgs, 'commit', '-m', config.message)
          break
        }
        case 'push': r = await git('push', positional(remote), ref ? positional(ref) : 'HEAD'); break
        case 'pull': r = await git('pull', '--no-rebase', positional(remote), ...(ref ? [positional(ref)] : [])); break
        case 'merge':
          if (!ref) throw new Error('Git merge: set the Branch / tag / commit to merge in.')
          r = await git(...idArgs, 'merge', '--no-edit', positional(ref)); break
        case 'tag':
          if (!ref) throw new Error('Git tag: put the tag name in Branch / tag / commit.')
          r = config.message?.trim()
            ? await git(...idArgs, 'tag', '-a', positional(ref), '-m', config.message)
            : await git('tag', positional(ref))
          break
        default: throw new Error(`Git: unknown operation "${op}".`)
      }
      if (r.error) throw new Error(r.error)
      const br = await git('rev-parse', '--abbrev-ref', 'HEAD')
      return { op, dir: cwd, branch: (br.output || '').trim() || undefined, exitCode: 0, output: (r.output || 'done').trim() }
    } finally {
      if (authDir) rmSync(authDir, { recursive: true, force: true })
    }
  },

  // Data
  'data.http': async (config, ctx) => {
    const method = config.method || 'GET'
    if (!config.url?.trim()) throw new Error('HTTP request: URL is required.')
    // Guard against tokens accidentally appended to the URL (e.g. "https://x.com /hooks/path").
    if (/\s/.test(config.url)) throw new Error(`HTTP request: URL contains a space — check that no extra tokens were appended to the URL field. Got: "${config.url.slice(0, 80)}"`)
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
    const file = path.join(process.env.STEPRAIL_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'), 'memory.json')
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
        from: ctx.settings.smtpFrom || 'steprail@fintonlabs.com',
        to: config.to,
        subject: config.subject || `steprail: ${ctx.flow.name}`,
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
        payload: { summary: `${ctx.flow.name}: ${config.service}`, source: 'steprail', severity: 'error', custom_details: ctx.input },
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
