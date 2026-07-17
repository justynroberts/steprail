// MIT License - Copyright (c) fintonlabs.com
// The LLM authoring prompt: everything a model needs to write a valid
// steprail flow as one JSON object. The tool catalog section is GENERATED
// from toolcore, so new tools and fields document themselves — never edit
// the catalog text by hand. Used by the browser (Copy LLM prompt, AI
// compose) and by scripts that emit docs/LLM-AUTHORING.md.
import { TOOL_CORE } from './toolcore.mjs'

const KIND_NOTE = {
  code: 'multi-line text',
  json: 'a JSON value (object or array), written as JSON',
  number: 'a number',
  select: null, // options listed instead
  schedule: 'a schedule (see the trigger.schedule rule below)',
  form: 'a JSON array of form fields (see the form-fields rule below)',
  secret: 'a secret string — prefer leaving it for the user to fill in',
  generated: 'a URL path — use "/hooks/<random-uuid>"',
  connection: null, // described via connType
}

function fieldDoc(f) {
  const parts = []
  if (f.kind === 'connection') {
    parts.push(`the NAME of a saved ${f.connType} secret (optional — blank uses the project default). Never put a raw credential here.`)
  } else if (f.kind === 'select' && f.options?.length) {
    parts.push(`one of: ${f.options.join(' | ')}`)
  } else if (KIND_NOTE[f.kind]) {
    parts.push(KIND_NOTE[f.kind])
  }
  if (f.placeholder && f.kind !== 'select') parts.push(`e.g. ${JSON.stringify(f.placeholder.split('\n')[0])}`)
  return `    - "${f.key}"${f.required ? ' (REQUIRED)' : ''}: ${f.label}${parts.length ? ` — ${parts.join('; ')}` : ''}`
}

function outputShape(tool) {
  try {
    return JSON.stringify(tool.sample({}))
  } catch {
    return null
  }
}

// One documented block per tool, grouped by category, fully generated.
export function detailedCatalog() {
  const order = ['trigger', 'ai', 'infra', 'data', 'logic', 'notify']
  const lines = []
  for (const cat of order) {
    lines.push(`\n## ${cat.toUpperCase()} tools`)
    for (const t of TOOL_CORE.filter(x => x.category === cat)) {
      lines.push(`\n### ${t.id} — ${t.name}`)
      lines.push(`${t.description}.`)
      if (t.fields.length) {
        lines.push('  Config keys:')
        for (const f of t.fields) lines.push(fieldDoc(f))
      } else {
        lines.push('  No config.')
      }
      if (t.branching) lines.push('  Branching: carries "branches": [{"label": "...", "steps": [...]}].')
      const shape = outputShape(t)
      if (shape) lines.push(`  Output shape (reference fields as {{<step name>.<field>}}): ${shape}`)
    }
  }
  return lines.join('\n')
}

// A complete, self-contained prompt for any LLM to author a flow.
export function llmPrompt(brief) {
  return `You design automation workflows for steprail, a rail-based orchestrator. Reply with ONLY one JSON object — no prose, no markdown fences.

# Response format

{
  "name": "<flow name>",
  "tags": ["optional", "lowercase"],
  "vars": {"region": "eu-west-1"},
  "steps": [
    {"tool": "<tool id>", "name": "<short unique step name>", "config": {"<key>": "<value>"}},
    {"tool": "logic.branch", "name": "Route", "config": {"on": "label"}, "branches": [
      {"label": "urgent", "steps": [{"tool": "notify.pagerduty", "name": "Page", "config": {}}]},
      {"label": "else", "steps": [{"tool": "notify.slack", "name": "Post", "config": {"message": "routine: {{Classify.label}}"}}]}
    ]}
  ]
}

# How flows execute

- "steps" run top to bottom — array order IS the wiring; there are no edges.
- The FIRST step must be a trigger.* tool (or omit a trigger only for a manually-run flow).
- A branching step carries "branches"; each lane is its own step list. Nesting caps at 3 deep.
- logic.branch routes on its "on" config: a dotted field path into the previous step's output (e.g. "label" or "response.status"), or a {{token}}. The lane whose label equals that value (case-insensitive) runs; a lane labeled "else"/"default"/"otherwise" catches everything unmatched. With "on" blank, ALL lanes run in parallel and the rail resumes after every lane finishes.
- When a step fails, the rest of its lane is skipped and the error shows on that step in plain language.

# Tokens (text substitution in any config value)

- {{<step name>.<field>}} — an earlier step's output; nested paths use dots ({{Fetch.response.items.0.id}}). Step names are the namespace — keep them short and unique.
- Trigger payloads read the same way: {{<trigger step name>.body.email}} for webhooks, {{<form step name>.<field key>}} for forms.
- {{var.<key>}} — flow variables from the top-level "vars" object.
- {{config.<key>}} — project-wide values the user sets in Config; use for environment names and base URLs you cannot know.
- {{system.now}} / {{system.date}} / {{system.time}} / {{system.flow}} / {{system.runId}}.
- Inside a loop: {{item.<field>}} (current item; plain values wrap as {{item.value}}) and {{loop.index}} / {{loop.count}}.
- For data.http, tokens belong in "body", "headers", or the PATH of "url" (e.g. "https://api.example.com/orders/{{Order.id}}") — never append extra tokens after the URL.

# Special value formats

- trigger.schedule "schedule": JSON like {"freq":"daily","time":"19:00"} — freq: minutes|hourly|daily|weekdays|weekly, "every" (number) for minutes, "day" 0-6 for weekly. A 5-part cron string also works.
- trigger.form "fields" and trigger.mcp "inputs": JSON array like [{"key":"name","label":"Your name","type":"text","required":true}] — type: text|long|email|number|choice|yesno; "options" is a comma list for choice. Submissions reach later steps as {{<step name>.<key>}}.
- Webhook/git/form paths: use "/hooks/<random-uuid>" (forms: "/forms/<slug>") — unguessable by default.
- logic.wait "duration": like "30s", "15m", "2h", "1d".
- logic.until: repeats the steps AFTER it until "condition" (JavaScript over \`input\`, the previous pass's last output) is true, up to "max" (≤25) passes.
- logic.loop: iterates the steps after it once per item of its input list (≤20 items).
- logic.subflow: runs another flow BY NAME (same project only); "vars" is a JSON object overriding the child's {{var.*}} for that run.
- logic.approval: parks the run until a human approves in the app.
- data.memory saves/loads values across runs by key.
- data.transform / logic conditions run real JavaScript in a sandbox where \`input\` is the previous step's output.

# Credentials

Fields of kind "connection" name a secret the user saved in the app (scoped to their project). Leave them blank to use the project's default of that type, or set the name if the brief mentions one. NEVER write API keys, passwords, or PEM keys into config values.

# Tool catalog (use exact ids; fill every REQUIRED key with a sensible value)
${detailedCatalog()}

# Brief

${brief}`
}
