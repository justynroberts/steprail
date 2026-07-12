// MIT License - Copyright (c) fintonlabs.com
export interface Schedule {
  freq: 'minutes' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'cron'
  every?: number
  time?: string
  day?: number
  cron?: string
}

export const DAY_NAMES: string[]
export const DEFAULT_SCHEDULE: Schedule
export function parseSchedule(value: string | undefined): Schedule
export function scheduleToCron(s: Schedule): string
export function scheduleSummary(s: Schedule): string
export function nextOccurrence(s: Schedule, fromMs: number): number | null
