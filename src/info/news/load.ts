import { loadPublishedSnapshot } from '../load-snapshot.ts'
import { asNewsSnapshot, newsIsStale } from './normalize.ts'
import type { NewsSnapshot } from './types.ts'
import { NEWS_SNAPSHOT_URL } from './types.ts'

export const NEWS_API_URL = '/api/info/news'

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
export async function loadNewsSnapshot(): Promise<NewsLoadState> {
  const cached = typeof sessionStorage === 'undefined' ? null : readSessionCache()
  const loaded = await loadPublishedSnapshot(NEWS_API_URL, NEWS_SNAPSHOT_URL, asNewsSnapshot)
  if ('value' in loaded) {
    if (typeof sessionStorage !== 'undefined') writeSessionCache(loaded.value)
    return {
      status: 'ready',
      snapshot: loaded.value,
      stale: newsIsStale(loaded.value) || loaded.fromStatic,
      fromCache: false,
    }
  }
  if (cached) return { status: 'ready', snapshot: cached, stale: true, fromCache: true }
  return { status: 'unavailable', message: loaded.error, snapshot: null }
}
