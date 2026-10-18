import { asFootballSnapshot, footballIsStale } from './normalize.ts'
import type { FootballSnapshot } from './types.ts'
import { FOOTBALL_SNAPSHOT_URL } from './types.ts'

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

export async function loadFootballSnapshot(url = FOOTBALL_SNAPSHOT_URL): Promise<FootballLoadState> {
  const cached = typeof sessionStorage === 'undefined' ? null : readSessionCache()
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Football unavailable (${response.status})`)
    const snapshot = asFootballSnapshot(await response.json())
    if (!snapshot) throw new Error('Football data could not be read')
    if (typeof sessionStorage !== 'undefined') writeSessionCache(snapshot)
    if (snapshot.unavailableReason && snapshot.matches.length === 0 && snapshot.tables.length === 0) {
      return { status: 'unavailable', message: snapshot.unavailableReason, snapshot }
    }
    return { status: 'ready', snapshot, stale: footballIsStale(snapshot), fromCache: false }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Football unavailable'
    if (cached && (cached.matches.length || cached.tables.length)) {
      return { status: 'ready', snapshot: cached, stale: true, fromCache: true }
    }
    return { status: 'unavailable', message, snapshot: cached }
  }
}
