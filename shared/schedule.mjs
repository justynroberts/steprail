// MIT License - Copyright (c) fintonlabs.com
// Friendly scheduling, shared by client and server. A schedule is a tiny JSON
// value a person (or LLM) can read; cron is compiled output, never the interface.
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const DEFAULT_SCHEDULE = { freq: 'daily', time: '09:00' }

// Tolerant parse: JSON schedule, a bare cron string, or nothing.
export function parseSchedule(value) {
  if (!value || !value.trim()) return { ...DEFAULT_SCHEDULE }
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && typeof parsed.freq === 'string') return parsed
  } catch {
    // Not JSON — treat a 5-part string as cron (imports from LLMs often do this).
    if (value.trim().split(/\s+/).length === 5) return { freq: 'cron', cron: value.trim() }
  }
  return { ...DEFAULT_SCHEDULE }
}

const timeParts = (time) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || '')
  if (!m) return [9, 0]
  return [Math.min(23, +m[1]), Math.min(59, +m[2])]
}

export function scheduleToCron(s) {
  const [h, min] = timeParts(s.time)
  switch (s.freq) {
    case 'minutes': return `*/${Math.max(1, Math.min(59, s.every || 15))} * * * *`
    case 'hourly': return `${min} * * * *`
    case 'daily': return `${min} ${h} * * *`
    case 'weekdays': return `${min} ${h} * * 1-5`
    case 'weekly': return `${min} ${h} * * ${s.day ?? 1}`
    case 'cron': return s.cron || '* * * * *'
    default: return '* * * * *'
  }
}

const friendlyTime = (time) => {
  const [h, min] = timeParts(time)
  const ampm = h >= 12 ? 'pm' : 'am'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return min === 0 ? `${hour12}${ampm}` : `${hour12}:${String(min).padStart(2, '0')}${ampm}`
}

// Minimal 5-field cron matcher: supports *, N, N-M, */S, and comma lists.
const cronFieldMatches = (spec, value) =>
  spec.split(',').some(part => {
    const step = part.includes('/') ? +part.split('/')[1] : 1
    const range = part.split('/')[0]
    let lo = 0, hi = 59
    if (range !== '*') {
      if (range.includes('-')) [lo, hi] = range.split('-').map(Number)
      else lo = hi = +range
    } else {
      hi = 999
    }
    return value >= lo && value <= hi && (value - lo) % step === 0
  })

const cronMatches = (cron, d) => {
  const [min, hour, dom, mon, dow] = cron.trim().split(/\s+/)
  return (
    cronFieldMatches(min, d.getMinutes()) &&
    cronFieldMatches(hour, d.getHours()) &&
    cronFieldMatches(dom, d.getDate()) &&
    cronFieldMatches(mon, d.getMonth() + 1) &&
    cronFieldMatches(dow, d.getDay())
  )
}

// Next fire time (ms epoch) strictly after `fromMs`. Scans minute by minute —
// bounded to one year, plenty for every real schedule.
export function nextOccurrence(s, fromMs) {
  const cron = scheduleToCron(s)
  const start = new Date(fromMs)
  start.setSeconds(0, 0)
  for (let i = 1; i <= 366 * 24 * 60; i++) {
    const candidate = new Date(start.getTime() + i * 60_000)
    if (cronMatches(cron, candidate)) return candidate.getTime()
  }
  return null
}

export function scheduleSummary(s) {
  switch (s.freq) {
    case 'minutes': return `Every ${s.every || 15} minutes`
    case 'hourly': return 'Every hour'
    case 'daily': return `Every day at ${friendlyTime(s.time)}`
    case 'weekdays': return `Weekdays at ${friendlyTime(s.time)}`
    case 'weekly': return `Every ${DAY_NAMES[s.day ?? 1]} at ${friendlyTime(s.time)}`
    case 'cron': return `Custom cron: ${s.cron || '—'}`
    default: return 'Schedule'
  }
}
