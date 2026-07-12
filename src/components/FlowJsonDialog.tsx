// MIT License - Copyright (c) fintonlabs.com
// The whole flow as one JSON object: copy it out, paste one in, or copy a
// self-contained prompt so any LLM can author a flow for this editor.
import { useMemo, useState } from 'react'
import { Braces, Check, ClipboardCopy, Import, WandSparkles, X } from 'lucide-react'
import type { Flow } from '../types'
import { useDispatch } from '../state'
import { hydrateFlow, llmPrompt, serializeFlow } from '../flowjson'

export function FlowJsonDialog({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const dispatch = useDispatch()
  const initial = useMemo(() => JSON.stringify(serializeFlow(flow), null, 2), [flow])
  const [text, setText] = useState(initial)
  const [notes, setNotes] = useState<string[]>([])
  const [copied, setCopied] = useState<'json' | 'prompt' | null>(null)

  const copy = async (kind: 'json' | 'prompt') => {
    await navigator.clipboard.writeText(kind === 'json' ? text : llmPrompt('<describe the flow you want here>'))
    setCopied(kind)
    setTimeout(() => setCopied(null), 1600)
  }

  const doImport = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      setNotes([`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`])
      return
    }
    const { name, steps, vars, warnings } = hydrateFlow(parsed)
    if (!steps.length) {
      setNotes(warnings.length ? warnings : ['No usable steps found.'])
      return
    }
    dispatch({ type: 'load-steps', steps })
    dispatch({ type: 'rename', name })
    dispatch({ type: 'set-vars', vars })
    onClose()
  }

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmdk json-dialog">
        <div className="cmdk-input">
          <Braces size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ flex: 1, fontWeight: 590, fontSize: 14 }}>Flow as JSON</span>
          <button className="btn icon" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="json-body">
          <textarea
            className="json-text"
            spellCheck={false}
            value={text}
            onChange={e => { setText(e.target.value); setNotes([]) }}
          />
          {notes.length > 0 && (
            <div className="compose-warnings" style={{ margin: 0 }}>
              {notes.map(n => <div key={n}>{n}</div>)}
            </div>
          )}
          <div className="json-actions">
            <button className="btn" onClick={() => copy('prompt')} title="A self-contained prompt: paste it into any LLM, paste the JSON it returns back here">
              <WandSparkles size={13} /> {copied === 'prompt' ? 'Copied' : 'Copy LLM prompt'}
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => copy('json')}>
              {copied === 'json' ? <Check size={13} /> : <ClipboardCopy size={13} />} {copied === 'json' ? 'Copied' : 'Copy JSON'}
            </button>
            <button className="btn primary" onClick={doImport}>
              <Import size={13} /> Import into flow
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
