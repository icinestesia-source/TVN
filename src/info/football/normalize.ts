import type { FootballMatch, FootballSnapshot, LeagueTable, MatchStatus } from './types.ts'
import { FOOTBALL_STALE_MINUTES } from './types.ts'

export function asFootballSnapshot(value: unknown): FootballSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const doc = value as Record<string, unknown>
  if (doc.format !== 'tvn-info-football-v1' || typeof doc.updatedIso !== 'string') return null
  if (!Array.isArray(doc.competitions) || !Array.isArray(doc.matches) || !Array.isArray(doc.tables)) return null
  return value as FootballSnapshot
}

export function footballIsStale(snapshot: FootballSnapshot, nowMs = Date.now()): boolean {
  const updated = Date.parse(snapshot.updatedIso)
  if (!Number.isFinite(updated)) return true
  const minutes = snapshot.staleAfterMinutes > 0 ? snapshot.staleAfterMinutes : FOOTBALL_STALE_MINUTES
  return nowMs - updated > minutes * 60_000
}

/** Map football-data.org status strings onto TVN statuses. */
export function matchStatusOf(raw: string | undefined | null): MatchStatus {
  const value = (raw ?? '').toUpperCase()
  if (value === 'FINISHED' || value === 'AWARDED') return 'finished'
  if (value === 'POSTPONED') return 'postponed'
  if (value === 'CANCELLED' || value === 'CANCELED' || value === 'SUSPENDED') return 'cancelled'
  if (value === 'IN_PLAY' || value === 'PAUSED' || value === 'LIVE' || value === 'HALFTIME') return 'in-play'
  // SCHEDULED, TIMED, and any other pre-kickoff status stay on the fixture list.
  if (value === 'SCHEDULED' || value === 'TIMED' || value === 'RESERVED') return 'scheduled'
  return 'scheduled'
}

export function statusLabel(status: MatchStatus, liveReliable: boolean): string {
  if (status === 'finished') return 'Finished'
  if (status === 'postponed') return 'Postponed'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'in-play') return liveReliable ? 'Live' : 'Delayed'
  return 'Scheduled'
}

/** Viewer-local calendar day as YYYY-MM-DD (avoids UTC day-boundary shifts). */
export function localDayIso(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayIso(now = new Date()): string {
  return localDayIso(now)
}

/** Local calendar day of a kickoff instant. */
export function kickoffLocalDayIso(kickoffIso: string): string {
  const ms = Date.parse(kickoffIso)
  if (!Number.isFinite(ms)) return kickoffIso.slice(0, 10)
  return localDayIso(new Date(ms))
}

/** Calendar-date arithmetic on YYYY-MM-DD strings (noon UTC anchor avoids DST edge cases). */
export function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function matchesOnDay(matches: readonly FootballMatch[], dayIso: string): FootballMatch[] {
  return matches.filter((match) => kickoffLocalDayIso(match.kickoffIso) === dayIso)
}

/** Inclusive local-day range covered by match kickoffs in a snapshot. */
export function snapshotLocalDayRange(matches: readonly FootballMatch[]): { fromIso: string; toIso: string } | null {
  if (!matches.length) return null
  let fromIso = kickoffLocalDayIso(matches[0]!.kickoffIso)
  let toIso = fromIso
  for (const match of matches) {
    const day = kickoffLocalDayIso(match.kickoffIso)
    if (day < fromIso) fromIso = day
    if (day > toIso) toIso = day
  }
  return { fromIso, toIso }
}

export function sortMatches(matches: readonly FootballMatch[]): FootballMatch[] {
  return [...matches].sort((a, b) => a.kickoffIso.localeCompare(b.kickoffIso) || a.home.localeCompare(b.home))
}

export function emptyFootballSnapshot(reason: string, updatedIso = new Date().toISOString()): FootballSnapshot {
  return {
    format: 'tvn-info-football-v1',
    updatedIso,
    staleAfterMinutes: FOOTBALL_STALE_MINUTES,
    provider: 'football-data.org',
    attribution: 'Data from football-data.org',
    liveReliable: false,
    competitions: [],
    matches: [],
    tables: [],
    unavailableReason:
      reason ||
      'Football fixtures and results have not been published yet. Configure FOOTBALL_DATA_TOKEN, run INFO ingest, then publish to Netlify Blobs.',
  }
}

export function buildFootballSnapshot(input: Omit<FootballSnapshot, 'format' | 'staleAfterMinutes'> & { staleAfterMinutes?: number }): FootballSnapshot {
  return {
    format: 'tvn-info-football-v1',
    staleAfterMinutes: input.staleAfterMinutes ?? FOOTBALL_STALE_MINUTES,
    updatedIso: input.updatedIso,
    provider: input.provider,
    attribution: input.attribution,
    liveReliable: input.liveReliable,
    competitions: input.competitions,
    matches: sortMatches(input.matches),
    tables: input.tables,
    ...(input.errors?.length ? { errors: input.errors } : {}),
    ...(input.unavailableReason ? { unavailableReason: input.unavailableReason } : {}),
  }
}

/** Narrow helper for tests: ensure table rows keep numeric fields. */
export function tableHasStandings(table: LeagueTable): boolean {
  return table.rows.length > 0 && table.rows.every((row) => Number.isFinite(row.points))
}
