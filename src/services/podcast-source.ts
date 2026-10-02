import type { ImportedVideo } from './channels-import.ts'

/** TVN's own feed reader (a Netlify Function in production, the Vite server locally). It needs no key. */
export const FEED_API = '/api/feed'

export interface FoundFeed {
  /** The canonical feed address, kept as the source and read again on a rescan. */
  feedUrl: string
  website: string | null
  title: string
  description: string
  /** Episodes with public media, as programmes: each carries its audio file in `media`. */
  episodes: ImportedVideo[]
}

const httpsUrl = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/** A podcast feed, or a publisher's website that announces one, read through TVN's feed reader. */
export async function lookUpFeed(
  link: string,
  read: typeof fetch = fetch,
  options: { fresh?: boolean; mode?: 'recent' | 'archive' | 'all'; now?: () => number } = {},
): Promise<FoundFeed> {
  const wide = options.mode === 'archive' || options.mode === 'all' ? `&mode=${options.mode}` : ''
  const query = `${FEED_API}?url=${encodeURIComponent(link.trim())}${wide}`
  let response: Response
  try {
    response = options.fresh ? await read(`${query}&refresh=${(options.now ?? Date.now)()}`, { cache: 'no-store' }) : await read(query)
  } catch {
    throw new Error('TVN could not reach its feed reader')
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok || !body) throw new Error(typeof body?.error === 'string' ? body.error : 'That feed could not be read')
  const feedUrl = httpsUrl(body.feedUrl)
  if (!feedUrl || !Array.isArray(body.episodes)) throw new Error('That feed could not be read')
  const episodes = body.episodes.flatMap((row): ImportedVideo[] => {
    const { id, title, durationSec, published, media } = (row ?? {}) as Record<string, unknown>
    const file = httpsUrl(media)
    if (typeof id !== 'string' || typeof title !== 'string' || typeof durationSec !== 'number' || !(durationSec > 0) || !file) return []
    return [{ id, title, durationSec: Math.round(durationSec), media: file, ...(typeof published === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(published) ? { published } : {}) }]
  })
  if (episodes.length === 0) throw new Error('That feed lists no episodes with public audio TVN can play')
  return {
    feedUrl,
    website: httpsUrl(body.website),
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : new URL(feedUrl).hostname,
    description: typeof body.description === 'string' ? body.description.slice(0, 500) : '',
    episodes,
  }
}
