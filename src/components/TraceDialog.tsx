// MIT License - Copyright (c) fintonlabs.com
// The trace viewer: one waterfall bar per span on the run's timeline,
// status-colored, retries and holds shown as events. Click a span for its
// attributes. Copy OTLP to hand the same trace to Jaeger/Tempo/any collector.
import { useEffect, useState } from 'react'
import { Check, ClipboardCopy, Route, X } from 'lucide-react'
import { fetchTrace, fetchTraceOtlp, type Trace, type TraceSpan } from '../api'

export function TraceDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [trace, setTrace] = useState<Trace | null>(null)
  const [selected, setSelected] = useState<TraceSpan | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void fetchTrace(runId).then(setTrace)
  }, [runId])

  const copyOtlp = async () => {
    const otlp = await fetchTraceOtlp(runId)
    if (!otlp) return
    await navigator.clipboard.writeText(otlp)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const min = trace?.root.start ?? 0
  const total = Math.max(1, (trace?.root.end ?? 1) - min)
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - min) / total) * 100))

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmdk trace-dialog">
        <div className="cmdk-input">
          <Route size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ flex: 1, fontWeight: 590, fontSize: 14 }}>Trace</span>
          {trace && <span className="trace-id" title="W3C trace id">{trace.traceId}</span>}
          <button className="btn" onClick={copyOtlp}>
            {copied ? <Check size={13} /> : <ClipboardCopy size={13} />} {copied ? 'Copied' : 'Copy OTLP'}
          </button>
          <button className="btn icon" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="trace-body">
          {!trace && <div className="settings-note">Loading trace…</div>}
          {trace && (
            <>
              <div className="trace-row root">
                <span className="tr-name">{trace.root.name}</span>
                <div className="tr-track">
                  <div className="tr-bar root" style={{ left: '0%', width: '100%' }} />
                </div>
                <span className="tr-ms">{trace.root.end - trace.root.start} ms</span>
              </div>
              {trace.spans.map(span => (
                <button
                  key={span.spanId}
                  className={`trace-row${selected?.spanId === span.spanId ? ' sel' : ''}`}
                  onClick={() => setSelected(s => (s?.spanId === span.spanId ? null : span))}
                >
                  <span className="tr-name">{span.name}</span>
                  <div className="tr-track">
                    <div
                      className={`tr-bar ${span.status}`}
                      style={{ left: `${pct(span.start)}%`, width: `${Math.max(0.8, pct(span.end) - pct(span.start))}%` }}
                    />
                    {span.events.map((e, i) => (
                      <span key={i} className="tr-event" title={`${e.name}${e.note ? `: ${e.note}` : ''}`} style={{ left: `${pct(e.time)}%` }} />
                    ))}
                  </div>
                  <span className="tr-ms">{span.end - span.start} ms</span>
                </button>
              ))}
              {trace.spans.length === 0 && <div className="settings-note">No spans yet — the run may still be starting.</div>}
              {selected && (
                <div className="trace-detail">
                  <div className="fv-head"><span className="fv-title">{selected.name} · {selected.tool}</span></div>
                  <div className="fv-rows">
                    <div className="fv-row"><span className="fv-key">span</span><span className="fv-val">{selected.spanId}</span></div>
                    <div className="fv-row"><span className="fv-key">duration</span><span className="fv-val number">{selected.end - selected.start} ms</span></div>
                    <div className="fv-row"><span className="fv-key">status</span><span className="fv-val" style={{ color: selected.status === 'error' ? 'var(--err)' : 'var(--ok)' }}>{selected.status}</span></div>
                    {selected.error && <div className="fv-row"><span className="fv-key">error</span><span className="fv-val">{selected.error}</span></div>}
                    {Object.entries(selected.attrs || {}).map(([k, v]) => (
                      <div className="fv-row" key={k}><span className="fv-key">{k}</span><span className="fv-val">{String(v)}</span></div>
                    ))}
                    {selected.events.map((e, i) => (
                      <div className="fv-row" key={`ev-${i}`}><span className="fv-key">event · {e.name}</span><span className="fv-val">{e.note || new Date(e.time).toISOString()}</span></div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
