import type { Programme } from '../types/programme.ts'

/** The same six places as a date, saying plainly that there is none. */
export const UNKNOWN_DATE = '(--/--/--)'

const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * A programme's date for the information overlay, as (DD/MM/YY): the publication or upload date its source
 * gave when it was read, never one guessed from the title or taken from today. The date is read as written
 * (the calendar day before any time of day), so no time zone moves it to another day. Anything missing or
 * malformed, and TVN's own placeholder listings, give (--/--/--).
 */
export function programmeDate(programme: Pick<Programme, 'publishedAt' | 'source'>): string {
  if (programme.source === 'demo' || typeof programme.publishedAt !== 'string') return UNKNOWN_DATE
  const match = programme.publishedAt.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/)
  if (!match) return UNKNOWN_DATE
  const [, year, month, day] = match
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  if (y < 1900 || y > 2099 || m < 1 || m > 12 || d < 1 || d > (m === 2 && !leap ? 28 : DAYS[m - 1])) return UNKNOWN_DATE
  return `(${day}/${month}/${year.slice(2)})`
}
