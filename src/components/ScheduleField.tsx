// MIT License - Copyright (c) fintonlabs.com
// The schedule builder: plain-language choices, cron only as a peek.
import { CalendarClock } from 'lucide-react'
import type { Schedule } from '../schedule'
import { DAY_NAMES, parseSchedule, scheduleSummary, scheduleToCron } from '../schedule'

const FREQ_LABEL: Record<Schedule['freq'], string> = {
  minutes: 'Minutes',
  hourly: 'Hourly',
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  cron: 'Cron',
}

export function ScheduleField({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  const schedule = parseSchedule(value)
  const set = (patch: Partial<Schedule>) => onChange(JSON.stringify({ ...schedule, ...patch }))

  return (
    <div className="schedule-field">
      <div className="seg">
        {(Object.keys(FREQ_LABEL) as Schedule['freq'][]).map(freq => (
          <button key={freq} className={schedule.freq === freq ? 'on' : ''} onClick={() => set({ freq })}>
            {FREQ_LABEL[freq]}
          </button>
        ))}
      </div>

      <div className="schedule-detail">
        {schedule.freq === 'minutes' && (
          <label className="sched-inline">
            Every
            <input
              type="number" min={1} max={59}
              value={schedule.every || 15}
              onChange={e => set({ every: Math.max(1, Math.min(59, +e.target.value || 15)) })}
            />
            minutes
          </label>
        )}
        {(schedule.freq === 'daily' || schedule.freq === 'weekdays' || schedule.freq === 'weekly' || schedule.freq === 'hourly') && (
          <label className="sched-inline">
            {schedule.freq === 'hourly' ? 'At minute' : 'At'}
            {schedule.freq === 'hourly' ? (
              <input
                type="number" min={0} max={59}
                value={parseInt((schedule.time || '09:00').split(':')[1] || '0', 10)}
                onChange={e => set({ time: `00:${String(Math.max(0, Math.min(59, +e.target.value || 0))).padStart(2, '0')}` })}
              />
            ) : (
              <input
                type="time"
                value={schedule.time || '09:00'}
                onChange={e => set({ time: e.target.value || '09:00' })}
              />
            )}
          </label>
        )}
        {schedule.freq === 'weekly' && (
          <label className="sched-inline">
            on
            <select value={schedule.day ?? 1} onChange={e => set({ day: +e.target.value })}>
              {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>
        )}
        {schedule.freq === 'cron' && (
          <input
            className="sched-cron"
            placeholder="0 9 * * 1-5"
            value={schedule.cron || ''}
            onChange={e => set({ cron: e.target.value })}
          />
        )}
      </div>

      <div className="schedule-summary">
        <CalendarClock size={12} />
        {scheduleSummary(schedule)}
        <span className="sched-cron-peek">cron {scheduleToCron(schedule)}</span>
      </div>
    </div>
  )
}
