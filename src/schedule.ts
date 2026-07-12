// MIT License - Copyright (c) fintonlabs.com
// Friendly scheduling. A schedule is a tiny JSON value a person (or LLM)
// can read; cron is compiled output, never the interface.
export interface Schedule {
  freq: 'minutes' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'cron'
  every?: number // minutes: run every N minutes
  time?: string // HH:MM for daily/weekdays/weekly
  day?: number // 0-6 (Sun-Sat) for weekly
  cron?: string // escape hatch
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const DEFAULT_SCHEDULE: Schedule = { freq: 'daily', time: '09:00' }

// Tolerant parse: JSON schedule, a bare cron string, or nothing.
export function parseSchedule(value: string | undefined): Schedule {
  if (!value || !value.trim()) return { ...DEFAULT_SCHEDULE }
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && typeof parsed.freq === 'string') return parsed as Schedule
  } catch {
    // Not JSON — treat a 5-part string as cron (imports from LLMs often do this).
    if (value.trim().split(/\s+/).length === 5) return { freq: 'cron', cron: value.trim() }
  }
  return { ...DEFAULT_SCHEDULE }
}

const timeParts = (time?: string): [number, number] => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || '')
  if (!m) return [9, 0]
  return [Math.min(23, +m[1]), Math.min(59, +m[2])]
}

export function scheduleToCron(s: Schedule): string {
  const [h, min] = timeParts(s.time)
  switch (s.freq) {
    case 'minutes': return `*/${Math.max(1, Math.min(59, s.every || 15))} * * * *`
    case 'hourly': return `${min} * * * *`
    case 'daily': return `${min} ${h} * * *`
    case 'weekdays': return `${min} ${h} * * 1-5`
    case 'weekly': return `${min} ${h} * * ${s.day ?? 1}`
    case 'cron': return s.cron || '* * * * *'
  }
}

const friendlyTime = (time?: string): string => {
  const [h, min] = timeParts(time)
  const ampm = h >= 12 ? 'pm' : 'am'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return min === 0 ? `${hour12}${ampm}` : `${hour12}:${String(min).padStart(2, '0')}${ampm}`
}

export function scheduleSummary(s: Schedule): string {
  switch (s.freq) {
    case 'minutes': return `Every ${s.every || 15} minutes`
    case 'hourly': return 'Every hour'
    case 'daily': return `Every day at ${friendlyTime(s.time)}`
    case 'weekdays': return `Weekdays at ${friendlyTime(s.time)}`
    case 'weekly': return `Every ${DAY_NAMES[s.day ?? 1]} at ${friendlyTime(s.time)}`
    case 'cron': return `Custom cron: ${s.cron || '—'}`
  }
}
