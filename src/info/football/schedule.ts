/**
 * Football ingest slots in Europe/London (handles GMT/BST via Intl).
 * Cron is best-effort; callers should gate with `footballSlotDue` and a slot key
 * so clock-change windows do not double-run the same logical slot.
 */

export interface FootballScheduleSlot {
  /** 0 = Sunday … 6 = Saturday (Date.getDay / London weekday) */
  weekday: number
  hour: number
  minute: number
}

/** Initial UK-local refresh schedule from Phase B.2. */
export const FOOTBALL_SCHEDULE_SLOTS: readonly FootballScheduleSlot[] = [
  { weekday: 1, hour: 22, minute: 0 }, // Monday
  { weekday: 2, hour: 22, minute: 0 },
  { weekday: 3, hour: 22, minute: 0 },
  { weekday: 4, hour: 22, minute: 0 },
  { weekday: 5, hour: 22, minute: 0 },
  { weekday: 6, hour: 17, minute: 0 }, // Saturday afternoon
  { weekday: 6, hour: 22, minute: 30 }, // Saturday evening
  { weekday: 0, hour: 22, minute: 0 }, // Sunday
]

const LONDON = 'Europe/London'

function londonParts(date: Date): { weekday: number; hour: number; minute: number; dayKey: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const weekdayName = get('weekday')
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    weekday: map[weekdayName] ?? 0,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    dayKey: `${get('year')}-${get('month')}-${get('day')}`,
  }
}

export function slotKey(slot: FootballScheduleSlot, dayKey: string): string {
  return `${dayKey}T${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}-wd${slot.weekday}`
}

/**
 * If `now` (UTC instant) falls within `windowMinutes` after a London schedule slot, return that slot's key.
 * Otherwise null. Duplicate prevention is the caller's responsibility via the returned key.
 */
export function footballSlotDue(now: Date, windowMinutes = 25): { key: string; slot: FootballScheduleSlot } | null {
  const london = londonParts(now)
  for (const slot of FOOTBALL_SCHEDULE_SLOTS) {
    if (slot.weekday !== london.weekday) continue
    const slotMinutes = slot.hour * 60 + slot.minute
    const nowMinutes = london.hour * 60 + london.minute
    const delta = nowMinutes - slotMinutes
    if (delta >= 0 && delta < windowMinutes) {
      return { key: slotKey(slot, london.dayKey), slot }
    }
  }
  return null
}

/** True when FORCE_FOOTBALL_INGEST=1 or workflow_dispatch sets FOOTBALL_INGEST_FORCE. */
export function footballIngestForced(env: Record<string, string | undefined>): boolean {
  const value = env.FOOTBALL_INGEST_FORCE ?? env.FORCE_FOOTBALL_INGEST
  return value === '1' || value === 'true'
}
