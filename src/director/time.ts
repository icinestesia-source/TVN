import { BROADCAST_DAY_START, networkTimeZone } from './network.ts'

export type DayKind = 'weekday' | 'friday' | 'saturday' | 'sunday' | 'holiday' | 'specialEvent'

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  date: string
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, fmt)
  }
  return fmt
}

export function zonedParts(ms: number, timeZone = networkTimeZone()): ZonedParts {
  const bag: Record<string, string> = {}
  for (const part of formatter(timeZone).formatToParts(new Date(ms))) bag[part.type] = part.value
  let hour = Number(bag.hour)
  if (hour === 24) hour = 0
  const year = Number(bag.year)
  const month = Number(bag.month)
  const day = Number(bag.day)
  return {
    year,
    month,
    day,
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

/** Convert a civil time in the network zone to a UTC instant. DST is resolved by the zone, not a fixed offset. */
export function zonedTimeToUtc(date: string, hhmm: string, timeZone = networkTimeZone()): number {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = hhmm.split(':').map(Number)
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  const offsetAt = (instant: number) => {
    const parts = zonedParts(instant, timeZone)
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    return asUtc - instant
  }
  const corrected = guess - offsetAt(guess - offsetAt(guess))
  return corrected
}

export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export function clockMinutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(':').map(Number)
  return hour * 60 + minute
}

export function daysBetween(earlier: string, later: string): number {
  const a = Date.parse(`${earlier}T00:00:00Z`)
  const b = Date.parse(`${later}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/**
 * Calendar date that owns this instant.
 * Before the broadcast-day start, the instant still belongs to the previous television day.
 */
export function broadcastDateFor(nowMs: number, dayStart = BROADCAST_DAY_START, timeZone = networkTimeZone()): string {
  const parts = zonedParts(nowMs, timeZone)
  if (parts.hour * 60 + parts.minute < clockMinutes(dayStart)) return addCalendarDays(parts.date, -1)
  return parts.date
}

export function dayKindFor(date: string, timeZone = networkTimeZone()): DayKind {
  const utc = zonedTimeToUtc(date, '12:00', timeZone)
  const day = new Date(utc).getUTCDay()
  if (day === 0) return 'sunday'
  if (day === 5) return 'friday'
  if (day === 6) return 'saturday'
  return 'weekday'
}

export function broadcastWindow(
  date: string,
  dayStart = BROADCAST_DAY_START,
  timeZone = networkTimeZone(),
): { startMs: number; endMs: number } {
  const startMs = zonedTimeToUtc(date, dayStart, timeZone)
  const endMs = zonedTimeToUtc(addCalendarDays(date, 1), dayStart, timeZone)
  return { startMs, endMs }
}

/** Local clock time placed on the broadcast day. Times before the day start fall on the next calendar date. */
export function localStartMs(
  broadcastDate: string,
  hhmm: string,
  dayStart = BROADCAST_DAY_START,
  timeZone = networkTimeZone(),
): number {
  const day = clockMinutes(hhmm) >= clockMinutes(dayStart) ? broadcastDate : addCalendarDays(broadcastDate, 1)
  return zonedTimeToUtc(day, hhmm, timeZone)
}

export function broadcastMinute(hhmm: string, dayStart = BROADCAST_DAY_START): number {
  const mins = clockMinutes(hhmm)
  const start = clockMinutes(dayStart)
  return mins >= start ? mins : mins + 24 * 60
}

export function datesCovering(startMs: number, endMs: number, dayStart = BROADCAST_DAY_START): string[] {
  const dates = new Set<string>()
  let cursor = startMs
  const step = 6 * 60 * 60 * 1000
  while (cursor < endMs) {
    dates.add(broadcastDateFor(cursor, dayStart))
    cursor += step
  }
  dates.add(broadcastDateFor(Math.max(startMs, endMs - 1), dayStart))
  return [...dates].sort()
}
