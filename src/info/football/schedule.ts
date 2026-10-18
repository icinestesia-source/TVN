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

/**
 * When football may refresh, Europe/London. Each half-hour inside the window is one slot,
 * so a workflow that already runs every half hour can publish scores without a site rebuild.
 * Saturday and Sunday cover the match day. Weeknights cover late kick-offs.
 */
export const FOOTBALL_MATCH_WINDOWS: readonly { weekday: number | 'weekend' | 'weekday'; fromHour: number; toHour: number; toMinute: number }[] = [
  { weekday: 'weekend', fromHour: 12, toHour: 23, toMinute: 30 },
  { weekday: 'weekday', fromHour: 19, toHour: 23, toMinute: 0 },
]

/** Kept for callers that list the old named slots. The live gate uses half-hour windows. */
export const FOOTBALL_SCHEDULE_SLOTS: readonly FootballScheduleSlot[] = [
  { weekday: 1, hour: 22, minute: 0 },
  { weekday: 2, hour: 22, minute: 0 },
  { weekday: 3, hour: 22, minute: 0 },
  { weekday: 4, hour: 22, minute: 0 },
  { weekday: 5, hour: 22, minute: 0 },
  { weekday: 6, hour: 12, minute: 0 },
  { weekday: 0, hour: 12, minute: 0 },
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

function inMatchWindow(london: { weekday: number; hour: number; minute: number }): boolean {
  const weekend = london.weekday === 0 || london.weekday === 6
  const minutes = london.hour * 60 + london.minute
  for (const window of FOOTBALL_MATCH_WINDOWS) {
    const applies = window.weekday === 'weekend' ? weekend : window.weekday === 'weekday' ? !weekend : window.weekday === london.weekday
    if (!applies) continue
    const from = window.fromHour * 60
    const to = window.toHour * 60 + window.toMinute
    if (minutes >= from && minutes < to) return true
  }
  return false
}

/**
 * Half-hour bucket inside a London match window. The same key is returned for the whole half hour,
 * so a second workflow run in that half hour does not call the provider again.
 */
export function footballSlotDue(now: Date, _windowMinutes = 25): { key: string; slot: FootballScheduleSlot } | null {
  const london = londonParts(now)
  if (!inMatchWindow(london)) return null
  const minute = london.minute < 30 ? 0 : 30
  const slot = { weekday: london.weekday, hour: london.hour, minute }
  return { key: slotKey(slot, london.dayKey), slot }
}

/** True when FORCE_FOOTBALL_INGEST=1 or workflow_dispatch sets FOOTBALL_INGEST_FORCE. */
export function footballIngestForced(env: Record<string, string | undefined>): boolean {
  const value = env.FOOTBALL_INGEST_FORCE ?? env.FORCE_FOOTBALL_INGEST
  return value === '1' || value === 'true'
}
