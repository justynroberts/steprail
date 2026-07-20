// MIT License - Copyright (c) fintonlabs.com
// Turn a flow (the same tree Rail.tsx and engine.ts walk) into documentation
// artifacts: a Mermaid flowchart and a starter Markdown description. Both are
// deterministic — no LLM — so they're always in sync with the current flow.
//
// Branches render as labeled edges into parallel lanes that merge back into a
// single "done" terminal, mirroring how the rail shows lanes rejoining.
import type { Flow, Step } from './types'
import { toolById } from './tools'

const toolName = (toolId: string) => toolById(toolId)?.name || toolId.split('.')[1] || toolId

// Mermaid ids must be alnum; derive a stable one from the step id.
const nodeId = (step: Step) => 'n' + step.id.replace(/[^a-zA-Z0-9]/g, '')

// Quoted-label safe: keep it on one visual line with a muted tool subtitle.
const label = (step: Step) => {
  const clean = (s: string) => s.replace(/["`]/g, "'").replace(/[\r\n]+/g, ' ').trim()
  return `"${clean(step.name || toolName(step.toolId))}<br/>${clean(toolName(step.toolId))}"`
}

// Node shape encodes role: trigger = stadium, branch = hexagon, else rectangle.
function nodeDef(step: Step): string {
  const id = nodeId(step)
  const l = label(step)
  if (step.toolId.startsWith('trigger.')) return `  ${id}([${l}])`
  if (step.branches?.length) return `  ${id}{{${l}}}`
  return `  ${id}[${l}]`
}

type Incoming = { id: string; edgeLabel?: string }

// Walk a step list; return the node ids that should connect to whatever follows.
function walk(steps: Step[], incoming: Incoming[], lines: string[]): Incoming[] {
  let prev = incoming
  for (const step of steps) {
    const id = nodeId(step)
    lines.push(nodeDef(step))
    for (const p of prev) lines.push(p.edgeLabel ? `  ${p.id} -->|${p.edgeLabel}| ${id}` : `  ${p.id} --> ${id}`)
    if (step.branches?.length) {
      const exits: Incoming[] = []
      for (const lane of step.branches) {
        const laneLabel = (lane.label || 'lane').replace(/["|]/g, "'")
        const laneOut = walk(lane.steps, [{ id, edgeLabel: laneLabel }], lines)
        // An empty lane passes straight through, carrying its label to the merge.
        if (laneOut.length === 0) exits.push({ id, edgeLabel: laneLabel })
        else exits.push(...laneOut)
      }
      prev = exits
    } else {
      prev = [{ id }]
    }
  }
  return prev
}

// A Mermaid `flowchart TD` for the flow. Renders in the app and in any Markdown
// host that supports Mermaid (GitHub, Scrivenry, Notion, …).
export function flowToMermaid(flow: Flow): string {
  const lines: string[] = ['flowchart TD']
  if (!flow.steps.length) {
    lines.push('  empty["(no steps yet)"]')
    return lines.join('\n')
  }
  const exits = walk(flow.steps, [], lines)
  lines.push('  done([done])')
  for (const e of exits) lines.push(e.edgeLabel ? `  ${e.id} -->|${e.edgeLabel}| done` : `  ${e.id} --> done`)
  return lines.join('\n')
}

// A numbered, lane-aware step outline for the starter doc.
function outline(steps: Step[], depth: number, out: string[], counter: { n: number }): void {
  const pad = '  '.repeat(depth)
  for (const step of steps) {
    const marker = depth === 0 ? `${counter.n++}.` : '-'
    out.push(`${pad}${marker} **${step.name || toolName(step.toolId)}** — ${toolName(step.toolId)}`)
    for (const lane of step.branches || []) {
      out.push(`${pad}  - _lane "${lane.label}"_`)
      outline(lane.steps, depth + 2, out, counter)
    }
  }
}

// Which connection types the flow needs, for the "Before you run" checklist.
function connectionsNeeded(steps: Step[], acc: Set<string>): void {
  for (const step of steps) {
    const tool = toolById(step.toolId)
    for (const f of tool?.fields || []) {
      if (f.kind === 'connection' && f.connType) acc.add(f.connType)
    }
    for (const lane of step.branches || []) connectionsNeeded(lane.steps, acc)
  }
}

// Deterministic starter documentation when a flow has none yet — the user (or
// StepHan) can refine it, but every flow reads as documented from the start.
export function describeFlow(flow: Flow): string {
  const first = flow.steps[0]
  const trigger = first ? `Starts on **${toolName(first.toolId)}** — ${first.name}.` : 'No trigger yet.'
  const stepLines: string[] = []
  outline(flow.steps, 0, stepLines, { n: 1 })
  const conns = new Set<string>()
  connectionsNeeded(flow.steps, conns)
  const before = conns.size
    ? [...conns].map(c => `- A **${c}** connection (add it in Secrets).`).join('\n')
    : '- Nothing — this flow needs no external connections.'
  return [
    `## What this does`,
    trigger,
    ``,
    `## Steps`,
    stepLines.join('\n') || '- (no steps yet)',
    ``,
    `## Before you run`,
    before,
  ].join('\n')
}

// The full Markdown artifact for copy/export: the prose (authored or starter)
// followed by the always-current Mermaid diagram — one paste documents a flow.
export function flowDocMarkdown(flow: Flow): string {
  const prose = flow.docs?.trim() || describeFlow(flow)
  return `# ${flow.name}\n\n${prose}\n\n## Diagram\n\n\`\`\`mermaid\n${flowToMermaid(flow)}\n\`\`\`\n`
}
