import { loadPublishedSnapshot } from '../load-snapshot.ts'
import { applyLeagueOneSupplement, fetchLeagueOneDisplay, LEAGUE_ONE_CODE } from './league-one-source.ts'
import { addDaysIso, asFootballSnapshot, emptyFootballSnapshot, footballIsStale, todayIso } from './normalize.ts'
import type { FootballSnapshot } from './types.ts'
import { FOOTBALL_SNAPSHOT_URL } from './types.ts'

export const FOOTBALL_API_URL = '/api/info/football'

const CACHE_KEY = 'tvn.info-football.v1'

export type FootballLoadState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: FootballSnapshot; stale: boolean; fromCache: boolean }
  | { status: 'unavailable'; message: string; snapshot: FootballSnapshot | null }

function readSessionCache(): FootballSnapshot | null {
  try {
    return asFootballSnapshot(JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null'))
  } catch {
    return null
  }
}

function writeSessionCache(snapshot: FootballSnapshot): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(snapshot))
  } catch {
    // Private browsing may refuse storage.
  }
}

function hasLeagueOne(snapshot: FootballSnapshot): boolean {
  return (
    snapshot.matches.some((match) => match.competitionId === LEAGUE_ONE_CODE) ||
    snapshot.tables.some((table) => table.competitionId === LEAGUE_ONE_CODE)
  )
}

/** Fill League One from the public scoreboard when the published snapshot has none. */
async function ensureLeagueOne(snapshot: FootballSnapshot): Promise<FootballSnapshot> {
  if (hasLeagueOne(snapshot)) return snapshot
  const fromIso = addDaysIso(todayIso(), -7)
  const toIso = addDaysIso(todayIso(), 14)
  try {
    const supplement = await fetchLeagueOneDisplay({ dateFrom: fromIso, dateTo: toIso })
    return applyLeagueOneSupplement(snapshot, supplement, { fromIso, toIso })
  } catch {
    return snapshot
  }
}

export async function loadFootballSnapshot(): Promise<FootballLoadState> {
  const cached = typeof sessionStorage === 'undefined' ? null : readSessionCache()
  const loaded = await loadPublishedSnapshot(FOOTBALL_API_URL, FOOTBALL_SNAPSHOT_URL, asFootballSnapshot)
  const base = 'value' in loaded ? loaded.value : cached ?? emptyFootballSnapshot('value' in loaded ? '' : loaded.error)
  const snapshot = await ensureLeagueOne(base)
  const fromStatic = 'value' in loaded ? loaded.fromStatic : true
  if (typeof sessionStorage !== 'undefined' && (snapshot.matches.length || snapshot.tables.length)) writeSessionCache(snapshot)
  if (snapshot.unavailableReason && snapshot.matches.length === 0 && snapshot.tables.length === 0) {
    return { status: 'unavailable', message: snapshot.unavailableReason, snapshot }
  }
  if (!snapshot.matches.length && !snapshot.tables.length) {
    return { status: 'unavailable', message: 'value' in loaded ? snapshot.unavailableReason ?? 'Football data is empty' : loaded.error, snapshot }
  }
  return {
    status: 'ready',
    snapshot,
    stale: footballIsStale(snapshot) || fromStatic,
    fromCache: !('value' in loaded) && cached !== null,
  }
}
