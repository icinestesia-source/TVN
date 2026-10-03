import type { IncomingMessage, ServerResponse } from 'node:http'
import { decodeCursor, encodeCursor, readArchive, type ArchiveEpisode, type Cursor } from './media-archive.ts'
import { measureMedia } from './media-probe.ts'
import { INGEST_MESSAGE, INGEST_SCHEME, resolveUrlSource, type LiveSource, type SourceForm, type SourceProvider } from './url-sources.ts'
import { attr, dayOf, FeedError, fetchText, field, fnv, parseDuration, publicFeedUrl, sameSite, TIMEOUT_MS, USER_AGENT } from './web-read.ts'

export { decodeText, FeedError, parseDuration, publicFeedUrl } from './web-read.ts'

/**
 * A podcast, RSS/Atom feed or public episode archive as a source, without a key. In order:
 *   1. the address is itself a feed;
 *   2. the website announces a feed the standard way (`<link rel="alternate">`, or a plainly linked feed);
 *   3. the public podcast directory lists a feed on the publisher's own site (Apple's keyless search);
 *      a feed verified by hand as the site's public one is tried before either, and a members', subscribers' or
 *      tokened feed is never taken, whichever route offers it;
 *   4. the page is an episode archive: its episode pages, and the public media each one plainly carries.
 * An episode whose media the publisher keeps behind a sign-in or subscription is never offered, nor is a later
 * part of a split interview or an item the publisher marks for members: TVN does not
 * sign in, run a page's scripts or decode a hidden address. Lengths a feed omits are read from the file.
 */

export interface FeedEpisode {
  /** Stable for the episode: from its guid, its file, or (for YouTube) the video id. */
  id: string
  title: string
  /** 0 until measured, for a file whose length the publisher did not state. */
  durationSec: number
  /** The duration was estimated from the enclosure's size, because the feed gave none. */
  estimated?: boolean
  /** YYYY-MM-DD */
  published?: string
  /** The public audio (or video) file. */
  media?: string
  /** The file's MIME type, or 'youtube'. */
  type: string
  youtube?: string
  page?: string
  image?: string
  /** The publisher's own few lines about the episode, as plain text. */
  summary?: string
}

export type SourceShape = 'feed' | 'archive'

export interface ResolvedFeed {
  /** The canonical source address: what TVN reads again on a rescan. */
  feedUrl: string
  /** The publisher's site, when the source names one. */
  website: string | null
  title: string
  description: string
  episodes: FeedEpisode[]
  /** Episodes the source lists. */
  listed: number
  /** Listed episodes with no public media or no length TVN can use. */
  unplayable: number
  shape: SourceShape
  /** How a feed was found: the address itself, the site's announcement, or the public podcast directory. */
  via: 'address' | 'announced' | 'directory' | 'archive'
  excluded?: { members: number; unsupported: number }
  /** Who publishes it, and whether it is one video, a collection or a live stream; absent for a podcast feed or archive. */
  provider?: SourceProvider
  form?: SourceForm
  /** A live stream: a channel of its own, joined live, with no episodes. */
  live?: LiveSource
  pages?: number
  /** The archive has more: ask again with this cursor. */
  next?: string
}

const RECENT_KEEP = 60
const WIDE_KEEP = 500
/** One call stays well inside a hosted function's time limit; a longer archive carries on in the next call. */
export const CALL_BUDGET_MS = 5000
/** Used only when a feed gives no duration: a typical spoken-word MP3 (128 kbit/s). */
const ESTIMATE_BYTES_PER_SECOND = 16_000
export const MEASURE_LIMIT = 24
const DIRECTORY = 'https://itunes.apple.com/search'

/** Feeds a page announces: `<link rel="alternate">` first, then plainly linked feed addresses on the same site. */
export function discoverFeeds(html: string, pageUrl: string): string[] {
  const found: { url: string; rank: number }[] = []
  const add = (href: string | null, rank: number) => {
    if (!href) return
    const url = publicFeedUrl(href, pageUrl)
    if (url && !found.some((item) => item.url === url.toString())) found.push({ url: url.toString(), rank })
  }
  for (const tag of html.replace(/<!--[\s\S]*?-->/g, '').match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase()
    const type = (attr(tag, 'type') ?? '').toLowerCase()
    if (!rel.split(/\s+/).includes('alternate') || !/application\/(?:rss|atom)\+xml/.test(type)) continue
    if (/comments/i.test(attr(tag, 'title') ?? '')) continue
    add(attr(tag, 'href'), /podcast/i.test(attr(tag, 'title') ?? '') ? 0 : 1)
  }
  const host = new URL(pageUrl).hostname
  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attr(tag, 'href')
    if (!href || !/(?:\/feed\/?(?:podcast\/?)?|\.rss|\/rss\/?|\.xml)(?:[?#]|$)/i.test(href) || /sitemap/i.test(href)) continue
    const url = publicFeedUrl(href, pageUrl)
    if (url && url.hostname === host) add(url.toString(), /podcast/i.test(href) ? 2 : 3)
  }
  return found.sort((a, b) => a.rank - b.rank).map((item) => item.url)
}

/** A later part of a split interview, or an item the publisher marks for members: never a public programme. */
const WITHHELD = /\bpart\s*(?:[2-9]|two|three|ii|iii)\s*(?:of|\/)\s*\d+\b|\bmembers?(?:[\s-]+only)\b|\bsubscribers?[\s-]+only\b/i

export const isWithheld = (title: string): boolean => WITHHELD.test(title)

function episodeFrom(block: string, atom: boolean, feedUrl: string): FeedEpisode | null {
  const title = field(block, 'title')
  let media: string | null = null
  let type = ''
  let length = 0
  if (atom) {
    for (const tag of block.match(/<link\b[^>]*>/gi) ?? []) {
      if ((attr(tag, 'rel') ?? '').toLowerCase() !== 'enclosure') continue
      media = attr(tag, 'href')
      type = (attr(tag, 'type') ?? '').toLowerCase()
      length = Number(attr(tag, 'length')) || 0
      break
    }
  } else {
    const tag = block.match(/<enclosure\b[^>]*>/i)?.[0]
    if (tag) {
      media = attr(tag, 'url')
      type = (attr(tag, 'type') ?? '').toLowerCase()
      length = Number(attr(tag, 'length')) || 0
    }
  }
  const url = media ? publicFeedUrl(media, feedUrl) : null
  if (!title || !url) return null
  if (type && !/^(?:audio|video)\//.test(type)) return null
  let durationSec = parseDuration(field(block, 'itunes:duration') ?? field(block, 'duration'))
  let estimated = false
  if (!durationSec && length > 200_000 && (!type || type === 'audio/mpeg')) {
    durationSec = Math.round(length / ESTIMATE_BYTES_PER_SECOND)
    estimated = true
  }
  // A stated length under 30 seconds is a trailer or a stub; an unstated one is measured from the file.
  if (durationSec > 0 && durationSec < 30) return null
  const guid = field(block, atom ? 'id' : 'guid') || url.toString()
  const published = dayOf(field(block, atom ? 'published' : 'pubDate') ?? field(block, 'updated'))
  const image = block.match(/<itunes:image\b[^>]*>/i)?.[0]
  const art = image ? publicFeedUrl(attr(image, 'href') ?? '', feedUrl)?.toString() : undefined
  const about = (field(block, atom ? 'summary' : 'description') ?? field(block, 'itunes:summary') ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const summary = about.length > 300 ? `${about.slice(0, 297).replace(/\s+\S*$/, '')}…` : about
  const link = atom ? null : field(block, 'link')
  const page = link ? publicFeedUrl(link, feedUrl)?.toString() : undefined
  return {
    id: `pod-${fnv(guid)}`,
    title,
    durationSec,
    ...(estimated ? { estimated } : {}),
    ...(published ? { published } : {}),
    media: url.toString(),
    type: type || 'audio/mpeg',
    ...(page ? { page } : {}),
    ...(art ? { image: art } : {}),
    ...(summary ? { summary } : {}),
  }
}

export function isFeed(text: string): boolean {
  const head = text.slice(0, 2000).replace(/^\uFEFF/, '').trimStart()
  return /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:rss|feed|rdf:RDF)\b/i.test(head)
}

/** A feed's publisher metadata and its episodes with public media, newest first as the feed lists them. */
export function parseFeed(xml: string, feedUrl: string): Omit<ResolvedFeed, 'feedUrl' | 'shape' | 'via'> {
  if (!isFeed(xml)) throw new FeedError(422, 'That address is not an RSS or Atom feed')
  const atom = /<feed\b/i.test(xml.slice(0, 2000))
  const blocks = xml.match(atom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi) ?? []
  const head = xml.slice(0, xml.search(atom ? /<entry\b/i : /<item\b/i) >>> 0 || xml.length)
  const title = field(head, 'title') ?? ''
  let website: string | null = null
  if (atom) {
    for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
      const rel = (attr(tag, 'rel') ?? 'alternate').toLowerCase()
      if (rel === 'alternate') website = publicFeedUrl(attr(tag, 'href') ?? '', feedUrl)?.toString() ?? null
    }
  } else {
    const link = head.match(/<link>([\s\S]*?)<\/link>/i)?.[1]
    website = link ? (publicFeedUrl(link.replace(/<!\[CDATA\[|\]\]>/g, '').trim(), feedUrl)?.toString() ?? null) : null
  }
  const description = (field(head, atom ? 'subtitle' : 'description') ?? field(head, 'itunes:summary') ?? '').slice(0, 500)
  const seen = new Set<string>()
  const episodes: FeedEpisode[] = []
  let members = 0
  for (const block of blocks) {
    const episode = episodeFrom(block, atom, feedUrl)
    if (!episode || seen.has(episode.id)) continue
    if (isWithheld(episode.title)) {
      members += 1
      continue
    }
    seen.add(episode.id)
    episodes.push(episode)
  }
  return {
    website,
    title: title || new URL(feedUrl).hostname,
    description,
    episodes,
    listed: blocks.length,
    unplayable: blocks.length - episodes.length,
    ...(members ? { excluded: { members, unsupported: 0 } } : {}),
  }
}

/** Whether the publisher serves an episode's media to anyone: a sign-in or paywall answers 401 or 403. */
async function mediaIsPublic(media: string, read: typeof fetch): Promise<boolean> {
  try {
    const response = await read(media, { method: 'HEAD', headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (response.status === 401 || response.status === 402 || response.status === 403) return false
    return true
  } catch {
    return true
  }
}

/** A long feed is read only as far as the episodes TVN keeps; one cut short for time says where to carry on. */
const readFeed = (url: string, read: typeof fetch, keep: number, deadline?: number, from?: number) =>
  fetchText(url, read, { stopAfter: { tag: /<\/(?:item|entry)>/, count: keep + 1, ...(deadline ? { deadline } : {}) }, ...(from ? { from } : {}) })

/** The rest of a feed after `cut`, if this read stopped for time before the episodes TVN keeps. */
const feedNext = (feedUrl: string, cut: number | undefined, before: number, listed: number, keep: number): { next: string } | Record<string, never> =>
  cut !== undefined && before + listed < keep ? { next: encodeCursor({ u: feedUrl, k: before + listed, n: cut, f: 1 }) } : {}

async function feedResult(page: { text: string; url: string; cut?: number }, read: typeof fetch, keep: number, via: ResolvedFeed['via']): Promise<ResolvedFeed> {
  const parsed = parseFeed(page.text, page.url)
  if (parsed.episodes.length === 0) throw new FeedError(422, 'That feed lists no episodes with public audio TVN can play')
  const first = parsed.episodes[0].media
  if (first && !(await mediaIsPublic(first, read))) throw new FeedError(403, "That feed's episodes need a sign-in or subscription, which TVN does not use")
  return { feedUrl: page.url, ...parsed, episodes: parsed.episodes.slice(0, keep), shape: 'feed', via, ...feedNext(page.url, page.cut, 0, parsed.listed, keep) }
}

/** A later slice of a feed, read from where the last one stopped. */
async function feedRest(cursor: Cursor, read: typeof fetch, keep: number, deadline: number): Promise<ResolvedFeed> {
  const left = keep - cursor.k
  if (left <= 0) throw new FeedError(400, 'That cursor is past the episodes TVN keeps')
  const rest = await readFeed(cursor.u, read, left, deadline, cursor.n)
  const atom = !/<\/item>/i.test(rest.text) && /<\/entry>/i.test(rest.text)
  const parsed = parseFeed(`${atom ? '<feed>' : '<rss>'}${rest.text}`, cursor.u)
  return { ...parsed, feedUrl: cursor.u, website: null, description: '', episodes: parsed.episodes.slice(0, left), shape: 'feed', via: 'address', ...feedNext(cursor.u, rest.cut, cursor.k, parsed.listed, keep) }
}

/** The site's own name, for looking it up in the podcast directory. */
function siteName(html: string): string | null {
  const og = html.match(/<meta\b[^>]*property\s*=\s*["']og:site_name["'][^>]*>/i)?.[0]
  const named = og ? attr(og, 'content') : null
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const name = named || (title ? title.replace(/<[^>]+>/g, '').split(/\s[|–—·-]\s/)[0] : '')
  const clean = (name ?? '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()
  return clean.length >= 2 && clean.length <= 80 ? clean : null
}

/** Feeds the public podcast directory lists for this site, hosted on the publisher's own domain, in its order. */
export async function directoryFeeds(html: string, pageUrl: string, read: typeof fetch): Promise<string[]> {
  const name = siteName(html)
  if (!name) return []
  const host = new URL(pageUrl).hostname
  const found: string[] = []
  try {
    const response = await read(`${DIRECTORY}?media=podcast&entity=podcast&limit=25&term=${encodeURIComponent(name)}`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) return []
    const body = (await response.json()) as { results?: { feedUrl?: unknown }[] }
    for (const result of body.results ?? []) {
      const url = typeof result.feedUrl === 'string' ? publicFeedUrl(result.feedUrl) : null
      if (url && sameSite(url.hostname, host) && !found.includes(url.toString())) found.push(url.toString())
    }
  } catch {
    return found
  }
  return found
}

/** The first feed the public podcast directory lists for this site. */
export async function directoryFeed(html: string, pageUrl: string, read: typeof fetch): Promise<string | null> {
  return (await directoryFeeds(html, pageUrl, read))[0] ?? null
}

/**
 * Public feeds verified by hand for sites that announce none, so a busy or reordered directory never sends TVN
 * to the site's archive pages instead. Each is still read and checked like any other feed.
 */
export const VERIFIED_PUBLIC_FEEDS: Readonly<Record<string, string>> = {
  'veritas7.com': 'https://veritas7.com/vs.rss',
}

export function verifiedPublicFeed(pageUrl: string): string | null {
  const host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '')
  return VERIFIED_PUBLIC_FEEDS[host] ?? null
}

/** A feed address that belongs to members, subscribers or patrons, or carries a personal token: never a public source. */
const PRIVATE_FEED = /(?:^|[/._?&=-])(?:members?|membership|subscribers?|subscription|private|premium|patrons?|paid|vip|supporters?|exclusive|insiders?)(?:[/._?&=-]|$)|[?&](?:token|key|auth|access_token|apikey|api_key|sig|signature|uid|user|secret|pass(?:word)?)=/i
/** A feed whose own title says it is for members or subscribers. */
const PRIVATE_TITLE = /\b(?:members?(?:[\s-]+only)?|subscribers?(?:[\s-]+only)?|premium|patrons?|private feed|supporters?)\b/i

export const isPrivateFeed = (url: string): boolean => PRIVATE_FEED.test(url.replace(/^https?:\/\/[^/]+/i, ''))

/**
 * The feeds worth reading for a website, best first: a verified public record, then what the site announces,
 * then what the public directory lists. Addresses for members, subscribers or a personal token are dropped,
 * and a feed that says it is public outranks one that says nothing.
 */
export function rankFeedCandidates(candidates: readonly { url: string; rank: number }[]): string[] {
  const seen = new Set<string>()
  return candidates
    .filter((candidate) => !isPrivateFeed(candidate.url))
    .map((candidate, index) => ({ ...candidate, index, score: candidate.rank - (/public/i.test(candidate.url) ? 0.5 : 0) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((candidate) => candidate.url)
    .filter((url) => (seen.has(url) ? false : (seen.add(url), true)))
}

const archiveEpisode = (episode: ArchiveEpisode): FeedEpisode => ({
  id: episode.id,
  title: episode.title,
  durationSec: episode.durationSec,
  ...(episode.published ? { published: episode.published } : {}),
  ...(episode.media ? { media: episode.media } : {}),
  type: episode.type,
  ...(episode.youtube ? { youtube: episode.youtube } : {}),
  page: episode.page,
  ...(episode.image ? { image: episode.image } : {}),
})

export async function resolveFeed(
  raw: string,
  read: typeof fetch = fetch,
  options: { wide?: boolean; cursor?: string | null; clock?: () => number } = {},
): Promise<ResolvedFeed> {
  const clock = options.clock ?? Date.now
  const deadline = clock() + CALL_BUDGET_MS
  const keep = options.wide ? WIDE_KEEP : RECENT_KEEP
  if (INGEST_SCHEME.test(raw.trim())) throw new FeedError(400, INGEST_MESSAGE)
  const start = publicFeedUrl(raw)
  if (!start) throw new FeedError(400, 'That is not a public web address')
  const cursor = decodeCursor(options.cursor ?? null)
  if (cursor && !sameSite(new URL(cursor.u).hostname, start.hostname)) throw new FeedError(400, 'That cursor belongs to another site')
  if (cursor?.f) return feedRest(cursor, read, keep, deadline)
  if (!cursor) {
    const source = await resolveUrlSource(start, read, keep, parseFeed)
    if (source) return source
  }

  const page = await readFeed(start.toString(), read, keep, deadline)
  if (isFeed(page.text)) return feedResult(page, read, keep, 'address')
  if (!cursor) {
    const announced = discoverFeeds(page.text, page.url).slice(0, 3)
    const verified = verifiedPublicFeed(page.url)
    const tried = new Set<string>()
    const tryFeeds = async (urls: readonly string[], via: ResolvedFeed['via']): Promise<ResolvedFeed | null> => {
      for (const candidate of urls) {
        if (tried.has(candidate)) continue
        tried.add(candidate)
        const next = await readFeed(candidate, read, keep, deadline).catch(() => null)
        if (!next || !isFeed(next.text)) continue
        const found = await feedResult(next, read, keep, via).catch(() => null)
        if (found && !isPrivateFeed(found.feedUrl) && !PRIVATE_TITLE.test(found.title)) return found
      }
      return null
    }
    const first = await tryFeeds(rankFeedCandidates([...(verified ? [{ url: verified, rank: -1 }] : []), ...announced.map((url, rank) => ({ url, rank }))]), 'announced')
    if (first) return first
    const listed = rankFeedCandidates((await directoryFeeds(page.text, page.url, read)).map((url, rank) => ({ url, rank }))).slice(0, 3)
    const found = await tryFeeds(listed, 'directory')
    if (found) return found
  }
  const archive = await readArchive({ url: page.url, html: page.text }, read, { cursor, deadline, clock })
  if (archive.episodes.length === 0 && !archive.next && !cursor) {
    if (archive.excluded.members > 0) throw new FeedError(403, "That site's episodes need a sign-in or subscription, which TVN does not use")
    throw new FeedError(404, 'This URL cannot currently be used by TVN: no public feed, archive, video or stream')
  }
  return {
    feedUrl: page.url,
    website: archive.website,
    title: archive.title,
    description: archive.description,
    episodes: archive.episodes.slice(0, keep).map(archiveEpisode),
    listed: archive.episodes.length + archive.excluded.members + archive.excluded.unsupported,
    unplayable: archive.excluded.members + archive.excluded.unsupported,
    shape: 'archive',
    via: 'archive',
    excluded: archive.excluded,
    pages: archive.pages,
    ...(archive.next ? { next: archive.next } : {}),
  }
}

/** Lengths for public files a source did not state, read from each file's header: -1 for a members' file. */
export async function measureFiles(files: readonly { url: string; type: string }[], read: typeof fetch = fetch): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  await Promise.all(
    files.slice(0, MEASURE_LIMIT).map(async ({ url, type }) => {
      const measured = await measureMedia(url, type, read)
      out[url] = 'locked' in measured ? -1 : measured.seconds
    }),
  )
  return out
}

export async function handleFeedRequest(url: URL, read: typeof fetch = fetch): Promise<{ status: number; body: unknown }> {
  const measure = url.searchParams.getAll('measure')
  if (measure.length > 0) {
    if (measure.length > MEASURE_LIMIT || measure.some((item) => item.length > 1000)) return { status: 400, body: { error: 'Too many files to measure at once' } }
    const types = url.searchParams.getAll('type')
    return { status: 200, body: { durations: await measureFiles(measure.map((item, index) => ({ url: item, type: types[index] ?? '' })), read) } }
  }
  const link = url.searchParams.get('url') ?? ''
  if (!link.trim() || link.length > 500) return { status: 400, body: { error: 'Paste a podcast feed or website address' } }
  try {
    const mode = url.searchParams.get('mode')
    return { status: 200, body: await resolveFeed(link, read, { wide: mode === 'archive' || mode === 'all', cursor: url.searchParams.get('cursor') }) }
  } catch (error) {
    if (error instanceof FeedError) return { status: error.status, body: { error: error.message } }
    return { status: 500, body: { error: 'The feed could not be read' } }
  }
}

export function feedCacheControl(url: URL, status: number): string {
  if (status === 200 && url.searchParams.has('measure')) return 'public, max-age=86400'
  return status === 200 && !url.searchParams.has('refresh') ? 'public, max-age=900' : 'no-store'
}

/** Connect-style middleware for the Vite development and preview servers. */
export function feedMiddleware(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL((request as IncomingMessage & { originalUrl?: string }).originalUrl ?? request.url ?? '/', 'http://localhost')
  void handleFeedRequest(url).then(({ status, body }) => {
    response.statusCode = status
    response.setHeader('content-type', 'application/json')
    response.setHeader('cache-control', feedCacheControl(url, status))
    response.end(JSON.stringify(body))
  })
}
