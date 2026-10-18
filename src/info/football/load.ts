import { loadPublishedSnapshot } from '../load-snapshot.ts'
import { asFootballSnapshot, footballIsStale } from './normalize.ts'
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

export async function loadFootballSnapshot(): Promise<FootballLoadState> {
  const cached = typeof sessionStorage === 'undefined' ? null : readSessionCache()
  const loaded = await loadPublishedSnapshot(FOOTBALL_API_URL, FOOTBALL_SNAPSHOT_URL, asFootballSnapshot)
  if ('value' in loaded) {
    const snapshot = loaded.value
    if (typeof sessionStorage !== 'undefined') writeSessionCache(snapshot)
    if (snapshot.unavailableReason && snapshot.matches.length === 0 && snapshot.tables.length === 0) {
      return { status: 'unavailable', message: snapshot.unavailableReason, snapshot }
    }
    return {
      status: 'ready',
      snapshot,
      stale: footballIsStale(snapshot) || loaded.fromStatic,
      fromCache: false,
    }
  }
  if (cached && (cached.matches.length || cached.tables.length)) {
    return { status: 'ready', snapshot: cached, stale: true, fromCache: true }
  }
  return { status: 'unavailable', message: loaded.error, snapshot: cached }
}
