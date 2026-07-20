// MIT License - Copyright (c) fintonlabs.com
// Reports: schedule forecast + consumption stats. Data from /api/reports.
import { useEffect, useState } from 'react'
import { Activity, Calendar, CheckCircle2, XCircle, Zap } from 'lucide-react'
import { fetchReports, type ReportData } from '../api'
import { parseSchedule, scheduleSummary } from '../schedule'

function relativeTime(ms: number): string {
  const diff = ms - Date.now()
  if (diff < 0) return 'overdue'
  const s = Math.floor(diff / 1000)
  if (s < 60) return `in ${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `in ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `in ${h}h ${m % 60}m`
  return `in ${Math.floor(h / 24)}d`
}

function fmt(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 2
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flex: 1 }}>
      <div style={{ width: '100%', height: 48, display: 'flex', alignItems: 'flex-end' }}>
        <div style={{ width: '100%', height: `${pct}%`, background: color, borderRadius: '2px 2px 0 0', minHeight: 2 }} />
      </div>
    </div>
  )
}

export function ReportsHome({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    void fetchReports(projectId).then(d => { setData(d); setLoading(false) })
    const t = window.setInterval(() => void fetchReports(projectId).then(setData), 30000)
    return () => window.clearInterval(t)
  }, [projectId])

  const stats = data?.stats
  const maxDayRuns = Math.max(1, ...(stats?.byDay.map(d => d.runs) || []))
  const maxDaySteps = Math.max(1, ...(stats?.byDay.map(d => d.steps) || []))
  const successRate = stats && stats.totalSteps > 0
    ? Math.round((stats.successSteps / stats.totalSteps) * 100)
    : null

  return (
    <div className="page">
      <div className="page-head">
        <h1>Reports</h1>
        <span className="page-sub">schedule forecast and run consumption</span>
      </div>

      {loading && <div className="settings-note">Loading...</div>}

      {!loading && (
        <>
          {/* ── Consumption ── */}
          <section className="report-section">
            <h2 className="report-h2"><Activity size={15} /> Consumption</h2>
            <div className="report-stat-row">
              <div className="report-stat">
                <span className="report-stat-value">{stats?.totalRuns ?? 0}</span>
                <span className="report-stat-label">Total runs</span>
              </div>
              <div className="report-stat">
                <span className="report-stat-value">{stats?.totalSteps ?? 0}</span>
                <span className="report-stat-label">Steps executed</span>
              </div>
              <div className="report-stat">
                <span className="report-stat-value" style={{ color: 'var(--ok)' }}>
                  <CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  {stats?.successSteps ?? 0}
                </span>
                <span className="report-stat-label">Succeeded</span>
              </div>
              <div className="report-stat">
                <span className="report-stat-value" style={{ color: stats?.errorSteps ? 'var(--err)' : undefined }}>
                  <XCircle size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  {stats?.errorSteps ?? 0}
                </span>
                <span className="report-stat-label">Failed {successRate !== null ? `(${successRate}% success)` : ''}</span>
              </div>
            </div>

            {stats && stats.byDay.length > 0 && (
              <div className="report-chart">
                <div className="report-chart-legend">
                  <span><span className="legend-dot" style={{ background: 'var(--accent)' }} /> Runs</span>
                  <span><span className="legend-dot" style={{ background: 'var(--cat-data)' }} /> Steps</span>
                </div>
                <div className="report-bars">
                  {stats.byDay.map((d, i) => (
                    <div key={d.date} className="report-bar-col" title={`${d.date}: ${d.runs} runs, ${d.steps} steps`}>
                      <div className="report-bar-pair">
                        <MiniBar value={d.runs} max={maxDayRuns} color="var(--accent)" />
                        <MiniBar value={d.steps} max={maxDaySteps} color="var(--cat-data)" />
                      </div>
                      {/* Sparse labels — every 5th day plus the last — so 30 bars stay readable. */}
                      <span className="report-bar-label">{i % 5 === 0 || i === stats.byDay.length - 1 ? d.date.slice(5) : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ── Schedule Forecast ── */}
          <section className="report-section">
            <h2 className="report-h2"><Calendar size={15} /> Schedule Forecast</h2>
            {!data?.schedule.length ? (
              <div className="settings-note">No scheduled flows — add a Schedule trigger to a flow to see it here.</div>
            ) : (
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Flow</th>
                    <th>Schedule</th>
                    <th>Next run</th>
                    <th>Steps</th>
                  </tr>
                </thead>
                <tbody>
                  {data.schedule.map(row => (
                    <tr key={row.flowId}>
                      <td>{row.flowName}</td>
                      <td style={{ color: 'var(--text-2)' }}>
                        {row.schedule ? scheduleSummary(parseSchedule(row.schedule)) : '—'}
                      </td>
                      <td>
                        <span className="report-next-badge" title={fmt(row.nextAt)}>
                          <Zap size={11} />
                          {relativeTime(row.nextAt)}
                        </span>
                        <span className="report-next-abs">{fmt(row.nextAt)}</span>
                      </td>
                      <td style={{ color: 'var(--text-3)' }}>{row.stepCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  )
}
