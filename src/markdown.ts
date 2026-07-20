// MIT License - Copyright (c) fintonlabs.com
// A compact, safe Markdown → HTML renderer for flow documentation. Everything is
// HTML-escaped first, so authored/LLM Markdown can never inject markup; only a
// known-safe subset (headings, emphasis, code, lists, links, rules, blockquotes)
// is re-introduced. Fenced ```mermaid blocks are handled by the caller, not here.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Inline formatting on already-escaped text. Split out code spans first so
// their contents are never re-formatted, then apply links, bold, italic to the
// rest. (Splitting avoids any placeholder collision with the text.)
function inline(text: string): string {
  return text.split(/(`[^`]+`)/).map(part => {
    if (part.startsWith('`') && part.endsWith('`')) return `<code>${part.slice(1, -1)}</code>`
    let t = part.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
      // Only http/mailto, and never let a quote in the URL break out of the
      // attribute (esc() upstream handles < >, but not quotes).
      if (!/^(https?:|mailto:)/i.test(href) || /["'<>]/.test(href)) return label
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
    })
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    t = t.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>')
    return t
  }).join('')
}

export function renderMarkdown(md: string): string {
  const lines = esc(md.replace(/\r\n/g, '\n')).split('\n')
  const html: string[] = []
  let i = 0
  let listType: 'ul' | 'ol' | null = null
  const closeList = () => { if (listType) { html.push(`</${listType}>`); listType = null } }

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block (non-mermaid — mermaid is stripped upstream).
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      closeList()
      const body: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++])
      i++ // closing fence
      html.push(`<pre><code>${body.join('\n')}</code></pre>`)
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      i++
      continue
    }

    if (/^\s*([-*+])\s+/.test(line)) {
      if (listType !== 'ul') { closeList(); html.push('<ul>'); listType = 'ul' }
      html.push(`<li>${inline(line.replace(/^\s*[-*+]\s+/, ''))}</li>`)
      i++
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      if (listType !== 'ol') { closeList(); html.push('<ol>'); listType = 'ol' }
      html.push(`<li>${inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`)
      i++
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      closeList()
      html.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`)
      i++
      continue
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      closeList()
      html.push('<hr/>')
      i++
      continue
    }

    if (line.trim() === '') {
      closeList()
      i++
      continue
    }

    // Paragraph: gather consecutive non-empty, non-structural lines.
    closeList()
    const para: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|\s*([-*+]|\d+\.)\s|```|\s*>|\s*(---|\*\*\*|___)\s*$)/.test(lines[i])) {
      para.push(lines[i++])
    }
    html.push(`<p>${inline(para.join(' '))}</p>`)
  }
  closeList()
  return html.join('\n')
}
