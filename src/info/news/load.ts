import { asNewsSnapshot, newsIsStale } from './normalize.ts'
import type { NewsSnapshot } from './types.ts'
import { NEWS_SNAPSHOT_URL } from './types.ts'

const CACHE_KEY = 'tvn.info-news.v1'

export type NewsLoadState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: NewsSnapshot; stale: boolean; fromCache: boolean }
  | { status: 'unavailable'; message: string; snapshot: NewsSnapshot | null }

function readSessionCache(): NewsSnapshot | null {
  try {
    return asNewsSnapshot(JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null'))
  } catch {
    return null
  }
}

function writeSessionCache(snapshot: NewsSnapshot): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(snapshot))
  } catch {
    // Private browsing may refuse storage.
  }
}

/** Fetch the published news snapshot. Never throws; keeps the last good copy when the network fails. */
export async function loadNewsSnapshot(url = NEWS_SNAPSHOT_URL): Promise<NewsLoadState> {
  const cached = typeof sessionStorage === 'undefined' ? null : readSessionCache()
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`News unavailable (${response.status})`)
    const snapshot = asNewsSnapshot(await response.json())
    if (!snapshot) throw new Error('News data could not be read')
    if (typeof sessionStorage !== 'undefined') writeSessionCache(snapshot)
    return { status: 'ready', snapshot, stale: newsIsStale(snapshot), fromCache: false }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'News unavailable'
    if (cached) return { status: 'ready', snapshot: cached, stale: true, fromCache: true }
    return { status: 'unavailable', message, snapshot: null }
  }
}
