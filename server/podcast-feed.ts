import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * A podcast or RSS/Atom source, without a key: a feed address, or a publisher's website that announces its
 * feed the standard way (`<link rel="alternate" type="application/rss+xml">`, or a plainly linked feed).
 * Only the public feed is read. Episode pages are never scraped, and an episode whose audio the publisher
 * keeps behind a sign-in or subscription is not offered: TVN never works around one.
 */

export interface FeedEpisode {
  /** Stable for the episode: from its guid, or its enclosure when it has none. */
  id: string
  title: string
  durationSec: number
  /** The duration was estimated from the enclosure's size, because the feed gave none. */
  estimated?: boolean
  /** YYYY-MM-DD */
  published?: string
  /** The public audio (or video) file. */
  media: string
  type: string
}

export interface ResolvedFeed {
  /** The canonical feed address: what TVN reads again on a rescan. */
  feedUrl: string
  /** The publisher's site, when the feed names one. */
  website: string | null
  title: string
  description: string
  episodes: FeedEpisode[]
  /** Episodes the feed lists. */
  listed: number
  /** Listed episodes with no public media or no length TVN can use. */
  unplayable: number
}

export class FeedError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const RECENT_KEEP = 60
const WIDE_KEEP = 500
const MAX_BYTES = 12 * 1024 * 1024
const TIMEOUT_MS = 15_000
/** Used only when a feed gives no duration: a typical spoken-word MP3 (128 kbit/s). */
const ESTIMATE_BYTES_PER_SECOND = 16_000
const HEADERS = { 'user-agent': 'TVN feed reader (+https://tvn.lol)', accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5' }

/** Public web addresses only: no credentials, no local or private hosts. */
export function publicFeedUrl(raw: string, base?: string): URL | null {
  let url: URL
  try {
    url = base ? new URL(raw, base) : new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host.includes('.') && !host.includes(':')) return null
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null
  if (/^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return null
  if (host.includes(':') && /^(?:::1?|f[cd]|fe80)/i.test(host)) return null
  return url
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeText(raw: string): string {
  const cdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  return cdata
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
      }
      return ENTITIES[name.toLowerCase()] ?? whole
    })
    .replace(/\s+/g, ' ')
    .trim()
}

const attr = (tag: string, name: string): string | null => {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
  return match ? decodeText(match[2] ?? match[3] ?? '') : null
}

/** The first `<name>` element's text in a block (namespaced names such as itunes:duration included). */
const field = (block: string, name: string): string | null => {
  const escaped = name.replace(/[.:]/g, (char) => `\\${char}`)
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'i'))
  return match ? decodeText(match[1]) : null
}

/** Feeds a page announces: `<link rel="alternate">` first, then plainly linked feed addresses on the same site. */
export function discoverFeeds(html: string, pageUrl: string): string[] {
  const found: { url: string; rank: number }[] = []
  const add = (href: string | null, rank: number) => {
    if (!href) return
    const url = publicFeedUrl(href, pageUrl)
    if (url && !found.some((item) => item.url === url.toString())) found.push({ url: url.toString(), rank })
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase()
    const type = (attr(tag, 'type') ?? '').toLowerCase()
    if (!rel.split(/\s+/).includes('alternate') || !/application\/(?:rss|atom)\+xml/.test(type)) continue
    if (/comments/i.test(attr(tag, 'title') ?? '')) continue
    add(attr(tag, 'href'), /podcast/i.test(attr(tag, 'title') ?? '') ? 0 : 1)
  }
  const host = new URL(pageUrl).hostname
  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attr(tag, 'href')
    if (!href || !/(?:\/feed\/?(?:podcast\/?)?|\.rss|\/rss\/?|\.xml)(?:[?#]|$)/i.test(href)) continue
    const url = publicFeedUrl(href, pageUrl)
    if (url && url.hostname === host) add(url.toString(), /podcast/i.test(href) ? 2 : 3)
  }
  return found.sort((a, b) => a.rank - b.rank).map((item) => item.url)
}

/** "1:02:03", "59:51", "3723" → seconds; 0 when it cannot be read. */
export function parseDuration(text: string | null): number {
  if (!text) return 0
  const trimmed = text.trim()
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed))
  if (!/^\d{1,3}(?::\d{1,2}){1,2}$/.test(trimmed)) return 0
  return trimmed.split(':').reduce((sum, part) => sum * 60 + Number(part), 0)
}

function fnv(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

const dayOf = (text: string | null): string | undefined => {
  if (!text) return undefined
  const time = Date.parse(text)
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : undefined
}

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
  if (durationSec < 30) return null
  const guid = field(block, atom ? 'id' : 'guid') || url.toString()
  const published = dayOf(field(block, atom ? 'published' : 'pubDate') ?? field(block, 'updated'))
  return { id: `pod-${fnv(guid)}`, title, durationSec, ...(estimated ? { estimated } : {}), ...(published ? { published } : {}), media: url.toString(), type: type || 'audio/mpeg' }
}

export function isFeed(text: string): boolean {
  const head = text.slice(0, 2000).replace(/^\uFEFF/, '').trimStart()
  return /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:rss|feed|rdf:RDF)\b/i.test(head)
}

/** A feed's publisher metadata and its episodes with public media, newest first as the feed lists them. */
export function parseFeed(xml: string, feedUrl: string): Omit<ResolvedFeed, 'feedUrl'> {
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
    website = link ? (publicFeedUrl(decodeText(link), feedUrl)?.toString() ?? null) : null
  }
  const description = (field(head, atom ? 'subtitle' : 'description') ?? field(head, 'itunes:summary') ?? '').slice(0, 500)
  const seen = new Set<string>()
  const episodes: FeedEpisode[] = []
  for (const block of blocks) {
    const episode = episodeFrom(block, atom, feedUrl)
    if (!episode || seen.has(episode.id)) continue
    seen.add(episode.id)
    episodes.push(episode)
  }
  return { website, title: title || new URL(feedUrl).hostname, description, episodes, listed: blocks.length, unplayable: blocks.length - episodes.length }
}

async function fetchText(url: string, read: typeof fetch): Promise<{ text: string; type: string; url: string }> {
  let response: Response
  try {
    response = await read(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new FeedError(502, 'That site could not be reached')
  }
  if (response.status === 401 || response.status === 403) throw new FeedError(403, 'That site needs a sign-in or subscription, which TVN does not use')
  if (response.status === 404) throw new FeedError(404, 'Nothing was found at that address')
  if (!response.ok) throw new FeedError(502, 'That site did not answer')
  const finalUrl = publicFeedUrl(response.url || url)
  if (!finalUrl) throw new FeedError(400, 'That address leads somewhere TVN does not read')
  const length = Number(response.headers.get('content-length')) || 0
  if (length > MAX_BYTES) throw new FeedError(413, 'That feed is too large to read')
  const text = await response.text()
  if (text.length > MAX_BYTES) throw new FeedError(413, 'That feed is too large to read')
  return { text, type: (response.headers.get('content-type') ?? '').toLowerCase(), url: finalUrl.toString() }
}

/** Whether the publisher serves an episode's media to anyone: a sign-in or paywall answers 401 or 403. */
async function mediaIsPublic(media: string, read: typeof fetch): Promise<boolean> {
  try {
    const response = await read(media, { method: 'HEAD', headers: { 'user-agent': HEADERS['user-agent'] }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (response.status === 401 || response.status === 402 || response.status === 403) return false
    return true
  } catch {
    return true
  }
}

export async function resolveFeed(raw: string, read: typeof fetch = fetch, options: { wide?: boolean } = {}): Promise<ResolvedFeed> {
  const start = publicFeedUrl(raw)
  if (!start) throw new FeedError(400, 'That is not a public web address')
  let page = await fetchText(start.toString(), read)
  let feedUrl = page.url
  if (!isFeed(page.text)) {
    const candidates = discoverFeeds(page.text, page.url)
    if (candidates.length === 0) throw new FeedError(404, 'That site does not announce a public RSS or Atom feed')
    let found: typeof page | null = null
    for (const candidate of candidates.slice(0, 3)) {
      const next = await fetchText(candidate, read).catch(() => null)
      if (next && isFeed(next.text)) {
        found = next
        break
      }
    }
    if (!found) throw new FeedError(404, 'The feed that site announces could not be read')
    page = found
    feedUrl = found.url
  }
  const parsed = parseFeed(page.text, feedUrl)
  if (parsed.episodes.length === 0) throw new FeedError(422, 'That feed lists no episodes with public audio TVN can play')
  if (!(await mediaIsPublic(parsed.episodes[0].media, read))) throw new FeedError(403, "That feed's episodes need a sign-in or subscription, which TVN does not use")
  return { feedUrl, ...parsed, episodes: parsed.episodes.slice(0, options.wide ? WIDE_KEEP : RECENT_KEEP) }
}

export async function handleFeedRequest(url: URL, read: typeof fetch = fetch): Promise<{ status: number; body: unknown }> {
  const link = url.searchParams.get('url') ?? ''
  if (!link.trim() || link.length > 500) return { status: 400, body: { error: 'Paste a podcast feed or website address' } }
  try {
    const mode = url.searchParams.get('mode')
    return { status: 200, body: await resolveFeed(link, read, { wide: mode === 'archive' || mode === 'all' }) }
  } catch (error) {
    if (error instanceof FeedError) return { status: error.status, body: { error: error.message } }
    return { status: 500, body: { error: 'The feed could not be read' } }
  }
}

export function feedCacheControl(url: URL, status: number): string {
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
