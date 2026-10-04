import { describeSource, type ProviderId, type SourceForm } from '../sources/providers.ts'
import type { ImportedVideo } from './channels-import.ts'

/** TVN's own feed reader (a Netlify Function in production, the Vite server locally). It needs no key. */
export const FEED_API = '/api/feed'

/** Calls the reader may take to read a long archive, a slice at a time. */
const MAX_CALLS = 40
const MEASURE_BATCH = 16
const MEASURE_PARALLEL = 2

export interface SourceSummary {
  shape: 'feed' | 'archive'
  via: 'address' | 'announced' | 'directory' | 'archive'
  /** Archive pages read. */
  pages: number
  /** Episodes the source listed. */
  listed: number
  media: { audio: number; video: number; youtube: number }
  excluded: { members: number; unsupported: number; unmeasured: number }
  /** Episodes the publisher itself labels a part, preview or excerpt: public segments, not whole programmes. */
  segments: number
}

export interface FoundFeed {
  /** The canonical source address, kept as the source and read again on a rescan. */
  feedUrl: string
  website: string | null
  title: string
  description: string
  /** Episodes with public media, as programmes: a file in `media`, or a YouTube id as the id. */
  episodes: ImportedVideo[]
  summary: SourceSummary
  /** Who publishes it, and whether it is one video, a collection or a live stream. */
  provider: ProviderId
  form: SourceForm
  /** A live stream, which becomes a channel of its own with no episodes. */
  live?: { url: string; media: 'video' | 'audio'; format: 'hls' | 'direct' }
}

const READER_PROVIDERS: readonly ProviderId[] = ['vimeo', 'odysee', 'bitchute', 'hls', 'direct', 'website', 'x']

const httpsUrl = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

const SEGMENT = /\bpart\s*(?:1|one|i)\s*(?:of|\/)\s*\d+\b|\b(?:preview|excerpt|sample|teaser|trailer|first\s+hour)\b/i

/** Whether the publisher's own title says the episode is a part or preview of something longer. */
export const isSegment = (title: string): boolean => SEGMENT.test(title)

interface Row {
  id: string
  title: string
  durationSec: number
  published?: string
  media?: string
  type: string
  youtube?: string
  summary?: string
  image?: string
  page?: string
  web?: 'website' | 'post'
}

function rowOf(raw: unknown): Row | null {
  const { id, title, durationSec, published, media, type, youtube, summary, image, page, web } = (raw ?? {}) as Record<string, unknown>
  if (typeof id !== 'string' || typeof title !== 'string' || typeof durationSec !== 'number' || !(durationSec >= 0)) return null
  const file = httpsUrl(media)
  const art = httpsUrl(image)
  const link = httpsUrl(page)
  const video = typeof youtube === 'string' && /^[\w-]{11}$/.test(youtube) ? youtube : null
  if (!file && !video) return null
  return {
    id: video ?? id,
    title: title.slice(0, 200),
    durationSec: Math.round(durationSec),
    ...(typeof published === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(published) ? { published } : {}),
    ...(file && !video ? { media: file } : {}),
    type: video ? 'youtube' : typeof type === 'string' ? type : 'audio/mpeg',
    ...(video ? { youtube: video } : {}),
    ...(typeof summary === 'string' && summary.trim() ? { summary: summary.trim().slice(0, 300) } : {}),
    ...(art ? { image: art } : {}),
    ...(link ? { page: link } : {}),
    ...(file && (web === 'website' || web === 'post') ? { web } : {}),
  }
}

const programmeOf = (row: Row): ImportedVideo => ({
  id: row.id,
  title: row.title,
  durationSec: row.durationSec,
  ...(row.media ? { media: row.media } : {}),
  ...(row.media && (row.type.startsWith('video/') || row.web) ? { mediaKind: 'video' as const } : {}),
  ...(row.web ? { web: row.web } : {}),
  ...(row.published ? { published: row.published } : {}),
  ...(row.summary ? { summary: row.summary } : {}),
  ...(row.image ? { image: row.image } : {}),
  ...(row.page ? { page: row.page } : {}),
})

async function readJson(read: typeof fetch, url: string, fresh: boolean): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = fresh ? await read(url, { cache: 'no-store' }) : await read(url)
  } catch {
    throw new Error('TVN could not reach its feed reader')
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok || !body) throw new Error(typeof body?.error === 'string' ? body.error : 'That feed could not be read')
  return body
}

/**
 * A podcast feed, a publisher's website that announces one, or a public episode archive, read through TVN's
 * feed reader. A long archive arrives a slice at a time; lengths the publisher did not state are read from
 * each file's header. `onProgress` hears how far the reading has got.
 */
export async function lookUpFeed(
  link: string,
  read: typeof fetch = fetch,
  options: { fresh?: boolean; mode?: 'recent' | 'archive' | 'all'; now?: () => number; onProgress?: (text: string) => void; as?: 'website' } = {},
): Promise<FoundFeed> {
  const wide = options.mode === 'archive' || options.mode === 'all' ? `&mode=${options.mode}` : ''
  const as = options.as === 'website' ? '&as=website' : ''
  const base = `${FEED_API}?url=${encodeURIComponent(link.trim())}${wide}${as}`
  const refresh = options.fresh ? `&refresh=${(options.now ?? Date.now)()}` : ''
  const rows = new Map<string, Row>()
  let first: Record<string, unknown> | null = null
  let cursor: string | null = null
  const excluded = { members: 0, unsupported: 0, unmeasured: 0 }
  let pages = 0
  let listed = 0
  for (let call = 0; call < MAX_CALLS; call += 1) {
    const body = await readJson(read, `${base}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${refresh}`, Boolean(options.fresh))
    first ??= body
    if (!httpsUrl(body.feedUrl) || !Array.isArray(body.episodes)) throw new Error('That feed could not be read')
    for (const raw of body.episodes) {
      const row = rowOf(raw)
      if (row && !rows.has(row.id)) rows.set(row.id, row)
    }
    const counts = (body.excluded ?? {}) as Record<string, unknown>
    excluded.members += typeof counts.members === 'number' ? counts.members : 0
    excluded.unsupported += typeof counts.unsupported === 'number' ? counts.unsupported : 0
    pages += typeof body.pages === 'number' ? body.pages : 0
    listed += typeof body.listed === 'number' ? body.listed : 0
    cursor = typeof body.next === 'string' ? body.next : null
    if (!cursor) break
    options.onProgress?.(`READING ${first.shape === 'archive' ? 'ARCHIVE' : 'FEED'} · ${rows.size} EPISODES SO FAR`)
  }
  if (!first) throw new Error('That feed could not be read')
  const provider = READER_PROVIDERS.find((value) => value === first.provider) ?? (first.shape === 'archive' ? 'archive' : 'rss')
  const form: SourceForm = first.form === 'video' || first.form === 'live' ? first.form : 'collection'
  const stream = (first.live ?? {}) as Record<string, unknown>
  if (form === 'live') {
    const url = httpsUrl(stream.url)
    if (!url) throw new Error('That stream could not be read')
    const feedUrl = httpsUrl(first.feedUrl) as string
    return {
      feedUrl,
      website: null,
      title: typeof first.title === 'string' && first.title.trim() ? first.title.trim().slice(0, 80) : new URL(feedUrl).hostname,
      description: '',
      episodes: [],
      summary: { shape: 'feed', via: 'address', pages: 0, listed: 0, media: { audio: 0, video: 0, youtube: 0 }, excluded: { members: 0, unsupported: 0, unmeasured: 0 }, segments: 0 },
      provider,
      form,
      live: { url, media: stream.media === 'audio' ? 'audio' : 'video', format: stream.format === 'hls' ? 'hls' : 'direct' },
    }
  }

  const unmeasured = [...rows.values()].filter((row) => row.durationSec === 0 && row.media)
  let measured = 0
  /** Measures a batch; a file that did not answer is handed back for one more try. */
  const measureBatch = async (batch: Row[], last: boolean): Promise<Row[]> => {
    const query = batch.map((row) => `measure=${encodeURIComponent(row.media ?? '')}&type=${encodeURIComponent(row.type)}`).join('&')
    const body = await readJson(read, `${FEED_API}?${query}`, false).catch(() => ({ durations: {} }))
    const durations = (body.durations ?? {}) as Record<string, unknown>
    const again: Row[] = []
    for (const row of batch) {
      const seconds = durations[row.media ?? '']
      if (seconds === -1) {
        rows.delete(row.id)
        excluded.members += 1
      } else if (typeof seconds === 'number' && seconds >= 30) {
        row.durationSec = Math.round(seconds)
      } else if (!last) {
        again.push(row)
      } else {
        rows.delete(row.id)
        excluded.unmeasured += 1
      }
    }
    if (!last) measured += batch.length - again.length
    options.onProgress?.(`MEASURING · ${measured} OF ${unmeasured.length}`)
    return again
  }
  // Publishers' file hosts are asked a few files at a time; one that was busy gets a second, gentler try.
  const pass = async (list: Row[], size: number, parallel: number, last: boolean): Promise<Row[]> => {
    const batches: Row[][] = []
    for (let index = 0; index < list.length; index += size) batches.push(list.slice(index, index + size))
    const again: Row[] = []
    for (let index = 0; index < batches.length; index += parallel) {
      for (const rest of await Promise.all(batches.slice(index, index + parallel).map((batch) => measureBatch(batch, last)))) again.push(...rest)
    }
    return again
  }
  await pass(await pass(unmeasured, MEASURE_BATCH, MEASURE_PARALLEL, false), 6, 1, true)

  const kept = [...rows.values()].filter((row) => row.durationSec > 0)
  if (kept.length === 0) throw new Error(excluded.members > 0 ? 'That source needs a sign-in or subscription, which TVN does not use' : 'That source lists no episodes with public media TVN can play')
  const feedUrl = httpsUrl(first.feedUrl) as string
  const shape = first.shape === 'archive' ? 'archive' : 'feed'
  const via = (['address', 'announced', 'directory', 'archive'] as const).find((value) => value === first.via) ?? 'address'
  return {
    feedUrl,
    website: httpsUrl(first.website),
    title: typeof first.title === 'string' && first.title.trim() ? first.title.trim().slice(0, 80) : new URL(feedUrl).hostname,
    description: typeof first.description === 'string' ? first.description.slice(0, 500) : '',
    episodes: kept.map(programmeOf),
    summary: {
      shape,
      via,
      pages,
      listed: listed || kept.length,
      media: {
        audio: kept.filter((row) => row.media && !row.type.startsWith('video/')).length,
        video: kept.filter((row) => row.media && row.type.startsWith('video/')).length,
        youtube: kept.filter((row) => row.youtube).length,
      },
      excluded,
      segments: kept.filter((row) => isSegment(row.title)).length,
    },
    provider,
    form,
  }
}

/** What the viewer sees before a source is saved: what TVN found, how, and what it left out and why. */
export function sourcePreviewLines(feed: FoundFeed): { label: string; value: string }[] {
  const { summary } = feed
  if (feed.live) {
    return [
      { label: 'Source', value: feed.title },
      { label: 'Type', value: describeSource(feed.provider, 'live') },
      { label: 'Media', value: feed.live.media === 'audio' ? 'Audio, joined live' : 'Video, joined live' },
    ]
  }
  if (feed.provider !== 'rss' && feed.provider !== 'archive') {
    const count = feed.episodes.length
    const lines = [
      { label: 'Source', value: feed.title },
      {
        label: 'Type',
        value: feed.episodes.length > 0 && feed.episodes.every((episode) => episode.web)
          ? `${feed.provider === 'x' ? 'X post · public embed' : 'Website · interactive page'} · ${Math.round(feed.episodes[0].durationSec / 60)} min slot`
          : describeSource(feed.provider, feed.form, feed.episodes.every((episode) => episode.mediaKind !== 'video')),
      },
      { label: 'Found', value: `${count} programme${count === 1 ? '' : 's'}${summary.listed > count ? ` of ${summary.listed} listed` : ''}` },
    ]
    const left = summary.excluded.members + summary.excluded.unsupported + summary.excluded.unmeasured
    if (left > 0) lines.push({ label: 'Left out', value: `${left} with no public media or readable length` })
    return lines
  }
  const type =
    summary.shape === 'archive'
      ? `Public episode archive${summary.pages > 1 ? ` · ${summary.pages} pages` : ''}`
      : summary.via === 'directory'
        ? "Podcast feed · the publisher's own, found in the public podcast directory"
        : 'Podcast feed'
  const media = [
    summary.media.audio ? `${summary.media.audio} audio` : '',
    summary.media.video ? `${summary.media.video} video` : '',
    summary.media.youtube ? `${summary.media.youtube} YouTube` : '',
  ].filter(Boolean)
  const left = [
    summary.excluded.members ? `${summary.excluded.members} members-only` : '',
    summary.excluded.unsupported ? `${summary.excluded.unsupported} in players TVN cannot use` : '',
    summary.excluded.unmeasured ? `${summary.excluded.unmeasured} with no readable length` : '',
  ].filter(Boolean)
  const lines = [
    { label: 'Source', value: feed.title },
    { label: 'Type', value: type },
    { label: 'Found', value: `${feed.episodes.length} episode${feed.episodes.length === 1 ? '' : 's'}${summary.listed > feed.episodes.length ? ` of ${summary.listed} listed` : ''}` },
    { label: 'Media', value: media.join(' · ') || 'none' },
  ]
  if (summary.segments > 0) {
    const all = summary.segments === feed.episodes.length
    lines.push({ label: 'Public segments', value: `${all ? 'All' : summary.segments} labelled by the publisher as a part or preview: not full programmes` })
  }
  if (left.length > 0) lines.push({ label: 'Left out', value: left.join(' · ') })
  return lines
}
