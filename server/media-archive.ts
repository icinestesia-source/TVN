import { attr, dayOf, decodeText, FeedError, fetchText, fnv, publicFeedUrl, sameSite, TIMEOUT_MS, USER_AGENT } from './web-read.ts'

/**
 * A publisher's public episode archive as a source: its archive page (and the pages after it), the episode
 * pages it links to on the same site, and the public media each episode page plainly carries: an audio or
 * video file, or a player from a provider TVN already plays (YouTube) or can resolve to the provider's own
 * public file (BitChute). Structured metadata (JSON-LD, Open Graph) is preferred to the page's text.
 *
 * Bounded: the publisher's own site only, so many archive pages, so many episodes, a time budget per call.
 * It never signs in, runs a page's scripts, decodes a hidden address, or reads anything that answers with a
 * sign-in: a members' page or file is counted as excluded, never worked around.
 */

export interface ArchiveEpisode {
  id: string
  title: string
  /** 0 until measured: the reader's measuring call reads the file's own header. */
  durationSec: number
  published?: string
  /** A public audio or video file. */
  media?: string
  /** 'youtube' for a YouTube programme; otherwise the file's MIME type. */
  type: string
  youtube?: string
  page: string
  image?: string
  description?: string
}

export interface ArchiveRead {
  title: string
  description: string
  website: string
  episodes: ArchiveEpisode[]
  excluded: { members: number; unsupported: number }
  /** Archive pages read in this call. */
  pages: number
  /** Where to carry on, when the archive has more than one call could read. */
  next?: string
}

export const ARCHIVE_PAGES = 30
export const ARCHIVE_LINKS_PER_PAGE = 40
const MEDIA_FILE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|webm|mov)(?:[?#]|$)/i
const AUDIO_EXT = /^(?:mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i
const NOT_EPISODE = /\/(?:category|categories|tag|tags|author|page|feed|comments|wp-json|wp-content|wp-admin|wp-login\.php|xmlrpc\.php|search|cart|checkout|account|my-account|login|log-in|logout|register|signin|sign-in|signup|sign-up|subscribe|join|membership|members?|privacy(?:-policy)?|terms(?:-of-use|-of-service)?|cookies?|contact|about|donate|shop|store|faq|forum|events?)(?:[/.?#]|$)|\.(?:jpe?g|png|gif|webp|svg|pdf|zip|css|js|xml|rss)(?:[?#]|$)/i
const MEMBERS = /\b(?:members?[\s-]*only|subscribers?[\s-]*only|premium|log\s*in|sign\s*in|subscribe\s+to\s+(?:listen|watch)|unlock)\b/i
const LOGIN_PATH = /\/(?:login|log-in|signin|sign-in|subscribe|join|membership|members?|account|my-account|checkout|register|wp-login\.php)(?:[/.?#]|$)/i

/** Supported embedded players: the provider's own id, or the provider's public file. */
export const PROVIDERS = {
  youtube: /(?:youtube(?:-nocookie)?\.com\/(?:embed|shorts|live)\/|youtube\.com\/watch\?(?:[^"'\s]*&)?v=|youtu\.be\/)([\w-]{11})/i,
  bitchute: /bitchute\.com\/(?:embed|video)\/([\w-]{6,20})/i,
}

type Candidate = { kind: 'file'; url: string; type: string } | { kind: 'youtube'; id: string } | { kind: 'bitchute'; id: string }

export interface EpisodePage {
  title: string | null
  published?: string
  description?: string
  image?: string
  /** A sane duration the page itself states (JSON-LD), used only when the file cannot be measured. */
  statedSec?: number
  candidates: Candidate[]
}

const typeOfFile = (url: string, stated: string | null): string => {
  if (stated && /^(?:audio|video)\//i.test(stated)) return stated.toLowerCase()
  const ext = url.match(MEDIA_FILE)?.[1]?.toLowerCase() ?? ''
  if (ext === 'mp3') return 'audio/mpeg'
  if (AUDIO_EXT.test(ext)) return `audio/${ext === 'm4a' ? 'mp4' : ext}`
  return ext === 'webm' ? 'video/webm' : 'video/mp4'
}

/** ISO 8601 durations (PT1H2M3S); only a plausible programme length counts. */
export function isoSeconds(text: unknown): number {
  if (typeof text !== 'string') return 0
  const match = text.trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i)
  if (!match) return 0
  const seconds = Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0)
  return seconds >= 30 && seconds <= 12 * 3600 ? Math.round(seconds) : 0
}

/** Every JSON-LD object on a page, @graph flattened. Publishers' JSON-LD with raw line breaks is still read. */
export function jsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    out.push(record)
    if (record['@graph']) visit(record['@graph'])
  }
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1].trim()
    try {
      visit(JSON.parse(body))
    } catch {
      try {
        visit(JSON.parse(body.replace(/[\r\n\t]+/g, ' ')))
      } catch {
        // Unreadable structured data is simply not used.
      }
    }
  }
  return out
}

const typesOf = (record: Record<string, unknown>): string[] => (Array.isArray(record['@type']) ? record['@type'] : [record['@type']]).filter((type): type is string => typeof type === 'string')
const textOf = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? decodeText(value) : undefined)
const imageOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return imageOf(value[0])
  if (value && typeof value === 'object') return textOf((value as Record<string, unknown>).url)
  return undefined
}

const meta = (html: string, name: string): string | null => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if ((attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase() === name) return attr(tag, 'content')
  }
  return null
}

/** What an episode page says about itself, and the public media it plainly carries, best first. */
export function readEpisodePage(html: string, pageUrl: string): EpisodePage {
  const candidates: Candidate[] = []
  const seen = new Set<string>()
  const addFile = (raw: string | null | undefined, stated: string | null = null) => {
    if (!raw) return
    const url = publicFeedUrl(raw, pageUrl)
    // A file only: a script that serves a "song" or a stream is not an episode's media.
    if (!url || !MEDIA_FILE.test(url.pathname) || seen.has(url.toString())) return
    seen.add(url.toString())
    candidates.push({ kind: 'file', url: url.toString(), type: typeOfFile(url.pathname, stated) })
  }
  const addPlayer = (raw: string | null | undefined) => {
    if (!raw) return
    const youtube = raw.match(PROVIDERS.youtube)?.[1]
    if (youtube && !seen.has(`yt:${youtube}`)) {
      seen.add(`yt:${youtube}`)
      candidates.push({ kind: 'youtube', id: youtube })
      return
    }
    const bitchute = raw.match(PROVIDERS.bitchute)?.[1]
    if (bitchute && !seen.has(`bc:${bitchute}`)) {
      seen.add(`bc:${bitchute}`)
      candidates.push({ kind: 'bitchute', id: bitchute })
    }
  }

  const records = jsonLd(html)
  let title: string | undefined
  let published: string | undefined
  let description: string | undefined
  let image: string | undefined
  let statedSec = 0
  for (const record of records) {
    const types = typesOf(record)
    const episodic = types.some((type) => /^(?:PodcastEpisode|Episode|RadioEpisode|TVEpisode|VideoObject|AudioObject|Article|BlogPosting|NewsArticle)$/.test(type))
    if (!episodic) continue
    title ??= textOf(record.name) ?? textOf(record.headline)
    published ??= dayOf(textOf(record.datePublished) ?? textOf(record.uploadDate))
    description ??= textOf(record.description)
    image ??= imageOf(record.image ?? record.thumbnailUrl)
    statedSec ||= isoSeconds(record.duration ?? record.timeRequired)
    for (const media of [record, record.associatedMedia, record.audio, record.video].flat()) {
      if (!media || typeof media !== 'object') continue
      const item = media as Record<string, unknown>
      addFile(textOf(item.contentUrl), textOf(item.encodingFormat) ?? null)
      addPlayer(textOf(item.embedUrl))
    }
  }
  for (const tag of html.match(/<(?:audio|video|source)\b[^>]*>/gi) ?? []) addFile(attr(tag, 'src'), attr(tag, 'type'))
  for (const name of ['og:audio', 'og:audio:url', 'og:audio:secure_url', 'og:video', 'og:video:url', 'og:video:secure_url']) {
    const value = meta(html, name)
    addFile(value)
    addPlayer(value)
  }
  for (const tag of html.match(/<iframe\b[^>]*>/gi) ?? []) addPlayer(attr(tag, 'src') ?? attr(tag, 'data-src') ?? attr(tag, 'data-lazy-src'))
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (MEMBERS.test(decodeText(match[2]))) continue
    addFile(attr(`<a${match[1]}>`, 'href'))
  }

  const site = meta(html, 'og:site_name')
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const ogTitle = meta(html, 'og:title')
  const strip = (value: string | null | undefined) => (value && site ? value.replace(new RegExp(`\\s*[-|–—·:]\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '') : value) || null
  return {
    title: title ?? (heading ? decodeText(heading) || null : null) ?? strip(ogTitle) ?? strip(decodeText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')),
    ...(published ?? dayOf(meta(html, 'article:published_time')) ? { published: published ?? dayOf(meta(html, 'article:published_time')) } : {}),
    ...(description ?? meta(html, 'og:description') ? { description: (description ?? meta(html, 'og:description') ?? '').slice(0, 500) } : {}),
    ...(image ?? meta(html, 'og:image') ? { image: image ?? meta(html, 'og:image') ?? undefined } : {}),
    ...(statedSec ? { statedSec } : {}),
    candidates,
  }
}

/** The page's own content: site navigation, headers, footers and sidebars are not an archive's listing. */
function contentOf(html: string): string {
  const body = html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<body\b[\s\S]*$/i)?.[0] ?? html
  return body.replace(/<(header|nav|footer|aside|script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
}

/** Episode pages an archive page links to: the same site, in page order, never navigation, members' or login pages. */
export function episodeLinks(html: string, pageUrl: string): string[] {
  const base = new URL(pageUrl)
  const archivePath = base.pathname.replace(/\/page\/\d+\/?$/, '/').replace(/\/?$/, '/')
  const links: string[] = []
  for (const match of contentOf(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const tag = `<a${match[1]}>`
    const href = attr(tag, 'href')
    if (!href || href.startsWith('#') || /^(?:mailto|tel|javascript):/i.test(href)) continue
    const url = publicFeedUrl(href, pageUrl)
    if (!url || !sameSite(url.hostname, base.hostname)) continue
    url.hash = ''
    const path = url.pathname.replace(/\/?$/, '/')
    if (path === '/' || path === archivePath || NOT_EPISODE.test(url.pathname) || /[?&](?:page|paged|p)=\d+/i.test(url.search)) continue
    if (MEDIA_FILE.test(url.pathname) || MEMBERS.test(decodeText(match[2])) || MEMBERS.test(attr(tag, 'class') ?? '')) continue
    const key = url.toString()
    if (!links.includes(key)) links.push(key)
    if (links.length >= ARCHIVE_LINKS_PER_PAGE) break
  }
  return links
}

/** The archive's next page: rel="next", or the same archive's /page/N+1/ or ?page=N+1. */
export function nextArchivePage(html: string, pageUrl: string): string | null {
  const here = new URL(pageUrl)
  for (const tag of [...(html.match(/<link\b[^>]*>/gi) ?? []), ...(html.match(/<a\b[^>]*>/gi) ?? [])]) {
    if (!(attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/).includes('next')) continue
    const url = publicFeedUrl(attr(tag, 'href') ?? '', pageUrl)
    if (url && sameSite(url.hostname, here.hostname)) return url.toString()
  }
  const pathPage = here.pathname.match(/\/page\/(\d+)\/?$/)
  const queryPage = here.searchParams.get('page') ?? here.searchParams.get('paged')
  const number = Number(pathPage?.[1] ?? queryPage ?? 1)
  const root = here.pathname.replace(/\/page\/\d+\/?$/, '').replace(/\/$/, '')
  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    const url = publicFeedUrl(attr(tag, 'href') ?? '', pageUrl)
    if (!url || !sameSite(url.hostname, here.hostname)) continue
    const path = url.pathname.replace(/\/$/, '')
    if (path === `${root}/page/${number + 1}`) return url.toString()
    if (path === here.pathname.replace(/\/$/, '') && (url.searchParams.get('page') ?? url.searchParams.get('paged')) === String(number + 1)) return url.toString()
  }
  return null
}

/** A BitChute player's own public file, as its embed page names it. */
async function bitchuteFile(id: string, read: typeof fetch): Promise<string | null> {
  const page = await fetchText(`https://www.bitchute.com/embed/${id}/`, read).catch(() => null)
  if (!page) return null
  const source = (page.text.match(/<source\b[^>]*>/gi) ?? []).map((tag) => attr(tag, 'src')).find((src) => src && /\.mp4(?:[?#]|$)/i.test(src))
  const named = source ?? page.text.match(/["'](https:\/\/[a-z0-9.-]+\.bitchute\.com\/[^"'\s]+\.mp4)["']/i)?.[1]
  return named ? (publicFeedUrl(named)?.toString() ?? null) : null
}

/** A YouTube video's length and whether it may play outside YouTube, from its public watch page. */
async function youtubeLength(id: string, read: typeof fetch): Promise<number> {
  try {
    const response = await read(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers: { 'user-agent': USER_AGENT, 'accept-language': 'en' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) return 0
    const html = await response.text()
    if (/"playableInEmbed"\s*:\s*false/.test(html)) return 0
    return Number(html.match(/"lengthSeconds"\s*:\s*"(\d+)"/)?.[1]) || 0
  } catch {
    return 0
  }
}

type Outcome = { episode: ArchiveEpisode } | { excluded: 'members' | 'unsupported' } | null

async function episodeFrom(pageUrl: string, read: typeof fetch): Promise<Outcome> {
  let page
  try {
    page = await fetchText(pageUrl, read)
  } catch (error) {
    return error instanceof FeedError && error.status === 403 ? { excluded: 'members' } : null
  }
  // Sent to a sign-in or subscription page instead: a members' episode.
  if (LOGIN_PATH.test(new URL(page.url).pathname) && !LOGIN_PATH.test(new URL(pageUrl).pathname)) return { excluded: 'members' }
  const found = readEpisodePage(page.text, page.url)
  if (found.candidates.length === 0) return /<iframe\b[^>]*(?:player|embed|video|audio|podcast)|<video\b|<audio\b/i.test(page.text) ? { excluded: 'unsupported' } : null
  const title = (found.title ?? '').slice(0, 200)
  if (!title) return null
  const base = {
    title,
    page: page.url,
    ...(found.published ? { published: found.published } : {}),
    ...(found.image ? { image: found.image } : {}),
    ...(found.description ? { description: found.description } : {}),
  }
  for (const candidate of found.candidates) {
    if (candidate.kind === 'youtube') {
      const seconds = await youtubeLength(candidate.id, read)
      if (seconds >= 30) return { episode: { ...base, id: candidate.id, durationSec: seconds, type: 'youtube', youtube: candidate.id } }
      continue
    }
    const file = candidate.kind === 'file' ? candidate.url : await bitchuteFile(candidate.id, read)
    if (!file) continue
    const type = candidate.kind === 'file' ? candidate.type : 'video/mp4'
    return { episode: { ...base, id: `web-${fnv(file)}`, durationSec: found.statedSec ?? 0, media: file, type } }
  }
  return { excluded: 'unsupported' }
}

/** Where a slice ended: an archive page and link, or (`f`) a feed's byte offset and the items read before it. */
export interface Cursor {
  u: string
  k: number
  n: number
  f?: 1
}

export function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function decodeCursor(text: string | null): Cursor | null {
  if (!text) return null
  try {
    const value = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as Record<string, unknown>
    if (typeof value.u !== 'string' || !Number.isInteger(value.k) || !Number.isInteger(value.n) || (value.k as number) < 0 || (value.n as number) < 0) return null
    return { u: value.u, k: value.k as number, n: value.n as number, ...(value.f === 1 ? { f: 1 as const } : {}) }
  } catch {
    return null
  }
}

/**
 * Reads a slice of the archive that starts at `start` (or at the cursor), page by page, within the time the
 * caller allows. Several episode pages are read at once; the archive is never left mid-page without a cursor.
 */
export async function readArchive(
  start: { url: string; html: string },
  read: typeof fetch,
  options: { cursor?: { u: string; k: number; n: number } | null; deadline: number; clock?: () => number; parallel?: number },
): Promise<ArchiveRead> {
  const clock = options.clock ?? Date.now
  const parallel = options.parallel ?? 6
  const origin = new URL(start.url)
  const startPage = readEpisodePage(start.html, start.url)
  const title = (startPage.title ?? origin.hostname).slice(0, 80)
  const out: ArchiveRead = { title, description: (meta(start.html, 'og:description') ?? '').slice(0, 500), website: `${origin.origin}/`, episodes: [], excluded: { members: 0, unsupported: 0 }, pages: 0 }
  const seen = new Set<string>()
  let pageUrl = options.cursor?.u ?? start.url
  let skip = options.cursor?.k ?? 0
  let number = options.cursor?.n ?? 1
  let html = options.cursor && options.cursor.u !== start.url ? null : start.html
  while (number <= ARCHIVE_PAGES) {
    if (html === null) {
      const page = await fetchText(pageUrl, read).catch(() => null)
      if (!page || !sameSite(new URL(page.url).hostname, origin.hostname)) break
      html = page.text
    }
    const links = episodeLinks(html, pageUrl)
    for (let index = skip; index < links.length; index += parallel) {
      if (clock() >= options.deadline) {
        out.next = encodeCursor({ u: pageUrl, k: index, n: number })
        return out
      }
      const batch = links.slice(index, index + parallel)
      const outcomes = await Promise.all(batch.map((link) => episodeFrom(link, read)))
      for (const outcome of outcomes) {
        if (!outcome) continue
        if ('excluded' in outcome) {
          out.excluded[outcome.excluded] += 1
          continue
        }
        const key = outcome.episode.youtube ?? outcome.episode.media ?? outcome.episode.page
        if (seen.has(key)) continue
        seen.add(key)
        out.episodes.push(outcome.episode)
      }
    }
    // A page counts once, in the call that finishes it.
    out.pages += 1
    const next = nextArchivePage(html, pageUrl)
    if (!next || next === pageUrl) return out
    pageUrl = next
    skip = 0
    number += 1
    html = null
    if (clock() >= options.deadline) {
      out.next = encodeCursor({ u: pageUrl, k: 0, n: number })
      return out
    }
  }
  return out
}
