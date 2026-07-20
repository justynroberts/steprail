// MIT License - Copyright (c) fintonlabs.com
import { describe, it, expect } from 'vitest'
import { flowToMermaid, describeFlow, flowDocMarkdown } from './diagram'
import { renderMarkdown } from './markdown'
import type { Flow } from './types'

const branching: Flow = {
  id: 'f1', name: 'Route alerts', updatedAt: 0,
  steps: [
    { id: 's1', toolId: 'trigger.webhook', name: 'Incoming', config: {} },
    { id: 's2', toolId: 'logic.branch', name: 'Route', config: { on: 'level' }, branches: [
      { id: 'b1', label: 'urgent', steps: [{ id: 's3', toolId: 'notify.pagerduty', name: 'Page', config: {} }] },
      { id: 'b2', label: 'else', steps: [{ id: 's4', toolId: 'notify.slack', name: 'Post', config: {} }] },
    ] },
  ],
}

describe('flowToMermaid', () => {
  it('emits a flowchart with a node per step and a merge terminal', () => {
    const m = flowToMermaid(branching)
    expect(m.startsWith('flowchart TD')).toBe(true)
    // one node id per step (prefixed 'n' + sanitized id)
    for (const id of ['ns1', 'ns2', 'ns3', 'ns4']) expect(m).toContain(id)
    expect(m).toContain('done([done])')
  })

  it('labels branch edges with the lane names and merges every lane back', () => {
    const m = flowToMermaid(branching)
    expect(m).toContain('-->|urgent|')
    expect(m).toContain('-->|else|')
    // both lane tips reach the terminal
    expect((m.match(/--> done/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('handles an empty flow without throwing', () => {
    const m = flowToMermaid({ id: 'e', name: 'Empty', updatedAt: 0, steps: [] })
    expect(m).toContain('flowchart TD')
  })
})

describe('describeFlow / flowDocMarkdown', () => {
  it('produces a starter doc naming the trigger and each step', () => {
    const doc = describeFlow(branching)
    expect(doc).toContain('## Steps')
    expect(doc).toContain('Page')
    expect(doc).toContain('Post')
  })

  it('flowDocMarkdown embeds the diagram as a mermaid fence', () => {
    const md = flowDocMarkdown(branching)
    expect(md).toContain('# Route alerts')
    expect(md).toContain('```mermaid')
    expect(md).toContain('flowchart TD')
  })
})

describe('renderMarkdown — escaped by construction', () => {
  it('escapes raw HTML so it cannot inject markup', () => {
    const html = renderMarkdown('Hello <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('renders headings, bold and lists', () => {
    const html = renderMarkdown('# Title\n\n**bold**\n\n- one\n- two')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<li>one</li>')
  })

  it('drops javascript: links but keeps https links', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('<a')
    expect(renderMarkdown('[x](https://example.com)')).toContain('href="https://example.com"')
  })

  it('refuses a URL that tries to break out of the href attribute', () => {
    const html = renderMarkdown('[x](https://a"onmouseover=alert(1))')
    expect(html).not.toContain('onmouseover')
  })
})
