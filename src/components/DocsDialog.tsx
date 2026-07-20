// MIT License - Copyright (c) fintonlabs.com
// The flow's documentation panel: an always-current Mermaid diagram of the rail
// plus a Markdown write-up (authored by hand or by StepHan at compose time).
// Copy or download the whole thing as Markdown — the diagram travels as a
// ```mermaid block that renders on GitHub, Scrivenry, Notion, and the like.
import { useEffect, useMemo, useRef, useState } from 'react'
import { BookText, Check, ClipboardCopy, Download, Pencil, WandSparkles, X } from 'lucide-react'
import type { Flow } from '../types'
import { useDispatch } from '../state'
import { describeFlow, flowDocMarkdown, flowToMermaid } from '../diagram'
import { renderMarkdown } from '../markdown'

let mermaidSeq = 0

export function DocsDialog({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const dispatch = useDispatch()
  const mermaidText = useMemo(() => flowToMermaid(flow), [flow])
  const proseHtml = useMemo(() => renderMarkdown(flow.docs?.trim() || describeFlow(flow)), [flow])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(flow.docs || '')
  const [copied, setCopied] = useState<'md' | 'mermaid' | null>(null)
  const diagramRef = useRef<HTMLDivElement>(null)

  // Render the diagram with Mermaid, lazy-loaded so it never weighs down the
  // main bundle. securityLevel 'strict' keeps rendered SVG inert.
  useEffect(() => {
    let alive = true
    // Pull the live design tokens so the diagram blends into the app (and tracks
    // the dark/light toggle) instead of Mermaid's stock palette.
    const css = getComputedStyle(document.documentElement)
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
    void import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: {
          fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: '13px',
          background: 'transparent',
          primaryColor: v('--bg-surface', '#191a1b'),
          primaryTextColor: v('--text-2', '#d0d6e0'),
          primaryBorderColor: v('--border', 'rgba(255,255,255,0.14)'),
          lineColor: v('--text-3', '#8a8f98'),
          tertiaryColor: 'transparent',
          edgeLabelBackground: v('--bg-surface', '#191a1b'),
        },
        flowchart: { curve: 'basis', htmlLabels: true, padding: 14, nodeSpacing: 42, rankSpacing: 46, useMaxWidth: true },
      })
      try {
        const { svg } = await mermaid.render(`flowdiagram-${mermaidSeq++}`, mermaidText)
        if (alive && diagramRef.current) diagramRef.current.innerHTML = svg
      } catch {
        if (alive && diagramRef.current) diagramRef.current.textContent = 'Diagram could not be rendered.'
      }
    })
    return () => { alive = false }
  }, [mermaidText])

  const copy = async (kind: 'md' | 'mermaid') => {
    await navigator.clipboard.writeText(kind === 'md' ? flowDocMarkdown(flow) : mermaidText)
    setCopied(kind)
    setTimeout(() => setCopied(null), 1600)
  }

  const download = () => {
    const blob = new Blob([flowDocMarkdown(flow)], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${flow.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'flow'}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const save = () => { dispatch({ type: 'set-docs', docs: draft.trim() }); setEditing(false) }
  const startEdit = () => { setDraft(flow.docs?.trim() || describeFlow(flow)); setEditing(true) }

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmdk docs-dialog">
        <div className="cmdk-input">
          <BookText size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ flex: 1, fontWeight: 590, fontSize: 14 }}>Documentation</span>
          {!editing && (
            <button className="btn" onClick={startEdit} title="Edit the write-up (Markdown)">
              <Pencil size={13} /> Edit
            </button>
          )}
          <button className="btn icon" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="docs-body">
          <div className="docs-diagram" ref={diagramRef} aria-label="flow diagram">
            <span className="settings-note">Rendering diagram…</span>
          </div>

          {editing ? (
            <>
              <textarea
                className="json-text docs-edit"
                spellCheck={false}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder="# Markdown documentation for this flow"
              />
              <div className="json-actions">
                <button className="btn" onClick={() => setDraft(describeFlow(flow))} title="Replace with an auto-generated outline of this flow">
                  <WandSparkles size={13} /> Generate from flow
                </button>
                <span style={{ flex: 1 }} />
                <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
                <button className="btn primary" onClick={save}><Check size={13} /> Save</button>
              </div>
            </>
          ) : (
            <>
              {!flow.docs?.trim() && (
                <div className="settings-note">No write-up yet — showing an auto-generated outline. Click <strong>Edit</strong> to make it yours.</div>
              )}
              <div className="docs-prose" dangerouslySetInnerHTML={{ __html: proseHtml }} />
              <div className="json-actions">
                <button className="btn" onClick={() => copy('mermaid')} title="Copy just the Mermaid diagram source">
                  {copied === 'mermaid' ? <Check size={13} /> : <ClipboardCopy size={13} />} {copied === 'mermaid' ? 'Copied' : 'Copy Mermaid'}
                </button>
                <span style={{ flex: 1 }} />
                <button className="btn" onClick={download} title="Download as a .md file (diagram included)">
                  <Download size={13} /> Download .md
                </button>
                <button className="btn primary" onClick={() => copy('md')} title="Copy the whole doc as Markdown, diagram included">
                  {copied === 'md' ? <Check size={13} /> : <ClipboardCopy size={13} />} {copied === 'md' ? 'Copied' : 'Copy Markdown'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
