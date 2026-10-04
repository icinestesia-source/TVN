import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Turn a YouTube channel or video link into that channel's recent uploads, without an API key.
 * Runs on the server (a Netlify Function in production, the Vite server in development) because
 * YouTube's pages cannot be read from the browser. Only public page data is read.
 */

export interface ResolvedVideo {
  id: string
  title: string
  durationSec: number
  /** Upload day (YYYY-MM-DD), where the source's public feed, or the feed of a playlist it lists, gave one. */
  published?: string
  /** The channel that uploaded it, as the listing links it: its name, id and @handle where the link carries one. */
  creator?: VideoCreator
}

export interface VideoCreator {
  name: string
  channelId?: string
  handle?: string
}

/** The uploader a listing entry links to: only a real channel link counts, and a handle only from its own address. */
function creatorFrom(name: unknown, endpoint: unknown): VideoCreator | undefined {
  const { browseId, canonicalBaseUrl } = (endpoint ?? {}) as { browseId?: unknown; canonicalBaseUrl?: unknown }
  if (typeof name !== 'string' || !name.trim() || typeof browseId !== 'string' || !/^UC[0-9A-Za-z_-]{22}$/.test(browseId)) return undefined
  const handle = typeof canonicalBaseUrl === 'string' ? canonicalBaseUrl.match(/^\/@([\w.-]{3,30})$/)?.[1] : undefined
  return { name: name.trim(), channelId: browseId, ...(handle ? { handle } : {}) }
}

function lockupCreator(metadata: unknown): VideoCreator | undefined {
  let found: VideoCreator | undefined
  walk(metadata, (node) => {
    if (found) return
    const text = node.text as { content?: unknown; commandRuns?: { onTap?: { innertubeCommand?: { browseEndpoint?: unknown } } }[] } | undefined
    if (text && Array.isArray(text.commandRuns)) found = creatorFrom(text.content, text.commandRuns[0]?.onTap?.innertubeCommand?.browseEndpoint)
  })
  return found
}

export interface ResolvedChannel {
  channelId: string
  /** What the link named: a whole channel's uploads, or one playlist and nothing else. */
  sourceType: 'youtube-channel' | 'youtube-playlist'
  title: string
  videos: ResolvedVideo[]
  scanned: number
  refused: number
  /** The channel that owns a playlist, from the playlist's own header; how a curator confirms it is official. */
  ownerId?: string
  /** Listing pages read: one for RECENT, more for ARCHIVE and ALL while the list continues. */
  pages?: number
  /** Videos the list itself says it holds, from its header; embeddable and long enough ones are fewer. */
  listed?: number
  /** Where the next batch of the same list starts, when the list goes on past what was read. */
  next?: string
  /**
   * The link was a YouTube Mix (RD…): a list YouTube generates for each viewer, which no public interface
   * lists for keeps. Its seed video leads, and the rest is the seed's uploader, as for a single video.
   */
  mix?: { list: string; seed: string }
}

/** One more batch of a list already read: the videos past where the last read stopped. */
export interface ResolvedBatch {
  videos: ResolvedVideo[]
  refused: number
  listed?: number
  next?: string
}

/** A playlist a channel lists, and whether that channel itself owns it. */
export interface DiscoveredPlaylist {
  id: string
  title: string
  ownerId: string | null
  /** Owned by the channel it was discovered on. */
  official: boolean
  videos: number | null
}

export type ChannelInput =
  | { kind: 'channel'; id: string }
  | { kind: 'handle'; handle: string }
  | { kind: 'path'; path: string }
  | { kind: 'video'; id: string; mix?: string }
  | { kind: 'playlist'; id: string }
  /** A Mix with no seed video in the link: nothing public names what it would play. */
  | { kind: 'mix'; id: string }

export class ChannelError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const CHANNEL_ID = /^UC[0-9A-Za-z_-]{22}$/
const VIDEO_ID = /^[0-9A-Za-z_-]{11}$/
/** A listed playlist. Mixes and personal lists (RD…, LL, WL) are not public programme sources. */
const PLAYLIST_ID = /^(?:PL|OL|UU|FL)[0-9A-Za-z_-]{10,64}$/
/** A YouTube Mix or radio: generated per viewer, so it is recognised but never read as a durable playlist. */
const MIX_ID = /^RD[0-9A-Za-z_-]{2,64}$/
const MIN_SECONDS = 61
const KEEP = 60
/** ARCHIVE and ALL follow the list's own continuation, a bounded number of pages, and keep up to this many embeddable videos. */
const WIDE_KEEP = 400
/** Listing pages read (about 100 videos each): RECENT reads the first only. */
export const PAGE_LIMIT = { recent: 1, wide: 5 } as const
/** Playlists looked at, and confirmed one by one, when discovering a channel's playlists. */
const DISCOVER_LIMIT = 30
const CONCURRENCY = 8
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
  'accept-language': 'en-GB,en;q=0.9',
  cookie: 'SOCS=CAI; CONSENT=YES+cb',
}

export function parseChannelInput(raw: string): ChannelInput | null {
  const text = raw.trim()
  if (CHANNEL_ID.test(text)) return { kind: 'channel', id: text }
  if (/^@[\w.-]{3,}$/.test(text)) return { kind: 'handle', handle: text.slice(1) }
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '')
  const parts = url.pathname.split('/').filter(Boolean)
  const list = url.searchParams.get('list')
  const playlist = list && PLAYLIST_ID.test(list) ? list : null
  const mix = list && MIX_ID.test(list) ? list : null
  if (host === 'youtu.be') {
    if (!parts[0] || !VIDEO_ID.test(parts[0])) return null
    if (playlist) return { kind: 'playlist', id: playlist }
    return mix ? { kind: 'video', id: parts[0], mix } : { kind: 'video', id: parts[0] }
  }
  if (host !== 'youtube.com') return null
  const v = url.searchParams.get('v')
  if (parts[0] === 'playlist' && playlist) return { kind: 'playlist', id: playlist }
  // A Mix's own page: its seed is the video id after RD, when the id is that plain form.
  if (parts[0] === 'playlist' && mix) {
    const seed = mix.slice(2)
    return VIDEO_ID.test(seed) ? { kind: 'video', id: seed, mix } : { kind: 'mix', id: mix }
  }
  // A watch link that carries a real playlist means the playlist; a Mix keeps its seed video; Watch Later falls back to the video.
  if (parts[0] === 'watch' && playlist) return { kind: 'playlist', id: playlist }
  if (parts[0] === 'watch' && v && VIDEO_ID.test(v)) return mix ? { kind: 'video', id: v, mix } : { kind: 'video', id: v }
  if (['shorts', 'live', 'embed', 'v'].includes(parts[0] ?? '') && parts[1] && VIDEO_ID.test(parts[1])) return { kind: 'video', id: parts[1] }
  if (parts[0] === 'channel' && parts[1] && CHANNEL_ID.test(parts[1])) return { kind: 'channel', id: parts[1] }
  if (parts[0]?.startsWith('@') && parts[0].length > 1) return { kind: 'handle', handle: decodeURIComponent(parts[0].slice(1)) }
  if ((parts[0] === 'c' || parts[0] === 'user') && parts[1]) return { kind: 'path', path: `/${parts[0]}/${encodeURIComponent(decodeURIComponent(parts[1]))}` }
  return null
}

/** The owning channel of a channel page or a watch page. */
export function channelIdFromPage(html: string, kind: 'channel' | 'video'): string | null {
  const patterns =
    kind === 'video'
      ? [/"videoDetails":\{[^{}]*?"channelId":"(UC[0-9A-Za-z_-]{22})"/, /itemprop="channelId" content="(UC[0-9A-Za-z_-]{22})"/]
      : [/"externalId":"(UC[0-9A-Za-z_-]{22})"/, /rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})"/]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) return match[1]
  }
  return null
}

export function initialData(html: string): unknown {
  const match = html.match(/(?:var ytInitialData|window\["ytInitialData"\])\s*=\s*(\{.*?\});\s*<\/script>/s)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

export function parseClock(text: string): number {
  if (!/^\d+(:\d{2}){1,2}$/.test(text)) return 0
  return text.split(':').reduce((sum, part) => sum * 60 + Number(part), 0)
}

function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
  } else if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>
    visit(node)
    for (const child of Object.values(node)) walk(child, visit)
  }
}

function textOf(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const node = value as { content?: unknown; simpleText?: unknown; runs?: unknown }
  if (typeof node.content === 'string') return node.content
  if (typeof node.simpleText === 'string') return node.simpleText
  if (Array.isArray(node.runs)) return node.runs.map((run) => (run as { text?: string }).text ?? '').join('')
  return ''
}

/** Videos listed on a playlist page, in page order (newest first for an uploads playlist). */
export function videosFromPlaylistPage(data: unknown): ResolvedVideo[] {
  const videos: ResolvedVideo[] = []
  const seen = new Set<string>()
  const push = (id: unknown, title: string, durationSec: number, creator?: VideoCreator) => {
    if (typeof id !== 'string' || !VIDEO_ID.test(id) || seen.has(id) || !title) return
    seen.add(id)
    videos.push({ id, title, durationSec, ...(creator ? { creator } : {}) })
  }
  walk(data, (node) => {
    const lockup = node.lockupViewModel as Record<string, unknown> | undefined
    if (lockup && lockup.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      let durationSec = 0
      walk(lockup.contentImage, (inner) => {
        const badge = inner.thumbnailBadgeViewModel as { text?: unknown } | undefined
        if (!durationSec && typeof badge?.text === 'string') durationSec = parseClock(badge.text)
      })
      const metadata = (lockup.metadata as { lockupMetadataViewModel?: { title?: unknown; metadata?: unknown } } | undefined)?.lockupMetadataViewModel
      push(lockup.contentId, textOf(metadata?.title), durationSec, lockupCreator(metadata?.metadata))
    }
    const legacy = node.playlistVideoRenderer as
      | { videoId?: unknown; title?: unknown; lengthSeconds?: unknown; shortBylineText?: { runs?: { text?: unknown; navigationEndpoint?: { browseEndpoint?: unknown } }[] } }
      | undefined
    if (legacy) {
      const run = legacy.shortBylineText?.runs?.[0]
      push(legacy.videoId, textOf(legacy.title), Number(legacy.lengthSeconds) || 0, creatorFrom(run?.text, run?.navigationEndpoint?.browseEndpoint))
    }
  })
  return videos
}

export function playlistTitleFrom(data: unknown): string | null {
  let title: string | null = null
  walk(data, (node) => {
    if (title) return
    const metadata = node.playlistMetadataRenderer as { title?: unknown } | undefined
    if (typeof metadata?.title === 'string' && metadata.title) title = metadata.title
  })
  return title
}

export function channelTitleFrom(data: unknown): string | null {
  let title: string | null = null
  walk(data, (node) => {
    if (title) return
    const channel = node.channelMetadataRenderer as { title?: unknown } | undefined
    if (typeof channel?.title === 'string') title = channel.title
    const owner = node.videoOwnerRenderer as { title?: unknown } | undefined
    if (owner && textOf(owner.title)) title = textOf(owner.title)
  })
  return title
}

/** The continuation token a listing ends with, if the list goes on. */
export function continuationOf(data: unknown): string | null {
  let token: string | null = null
  walk(data, (node) => {
    const command = node.continuationCommand as { token?: unknown } | undefined
    if (typeof command?.token === 'string') token = command.token
  })
  return token
}

/** How many videos a playlist's header says it holds. */
export function listedCountFrom(data: unknown): number | null {
  let count: number | null = null
  walk(data, (node) => {
    if (count !== null) return
    const header = node.playlistHeaderRenderer as { numVideosText?: unknown } | undefined
    const match = header ? textOf(header.numVideosText).match(/^([\d,]+)\s+videos?$/) : null
    if (match) count = Number(match[1].replace(/,/g, ''))
  })
  if (count !== null) return count
  // Newer playlist pages carry it as one of the header's metadata parts ("Playlist · 54 videos · …").
  walk(data, (node) => {
    if (count !== null || !Array.isArray(node.metadataParts)) return
    for (const part of node.metadataParts as { text?: unknown }[]) {
      const match = textOf(part?.text).match(/^([\d,]+)\s+videos?$/)
      if (match) {
        count = Number(match[1].replace(/,/g, ''))
        return
      }
    }
  })
  return count
}

/** The channel named in a playlist's header as its owner. */
export function playlistOwnerFrom(data: unknown): string | null {
  let owner: string | null = null
  walk(data, (node) => {
    if (owner) return
    const header = (node.pageHeaderViewModel ?? node.playlistHeaderRenderer) as Record<string, unknown> | undefined
    if (!header) return
    walk(header.metadata ?? header.ownerText ?? header, (inner) => {
      const id = (inner.browseEndpoint as { browseId?: unknown } | undefined)?.browseId
      if (!owner && typeof id === 'string' && CHANNEL_ID.test(id)) owner = id
    })
  })
  return owner
}

/** Playlists listed on a channel's Playlists tab, in page order. */
export function playlistsFromChannelPage(data: unknown): { id: string; title: string; videos: number | null }[] {
  const found: { id: string; title: string; videos: number | null }[] = []
  const seen = new Set<string>()
  walk(data, (node) => {
    const lockup = node.lockupViewModel as Record<string, unknown> | undefined
    const grid = node.gridPlaylistRenderer as { playlistId?: unknown; title?: unknown; videoCountText?: unknown } | undefined
    let id: unknown = null
    let title = ''
    let count: number | null = null
    if (lockup?.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST') {
      id = lockup.contentId
      title = textOf((lockup.metadata as { lockupMetadataViewModel?: { title?: unknown } } | undefined)?.lockupMetadataViewModel?.title)
      walk(lockup.contentImage, (inner) => {
        const badge = inner.thumbnailBadgeViewModel as { text?: unknown } | undefined
        const match = typeof badge?.text === 'string' ? badge.text.match(/(\d[\d,]*)\s+video/) : null
        if (match && count === null) count = Number(match[1].replace(/,/g, ''))
      })
    } else if (grid) {
      id = grid.playlistId
      title = textOf(grid.title)
      const match = textOf(grid.videoCountText).match(/(\d[\d,]*)/)
      count = match ? Number(match[1].replace(/,/g, '')) : null
    }
    if (typeof id !== 'string' || !PLAYLIST_ID.test(id) || id.startsWith('FL') || seen.has(id) || !title) return
    seen.add(id)
    found.push({ id, title, videos: count })
  })
  return found
}

/** The next part of a listing through YouTube's own continuation endpoint, keyless, as the page itself would. */
async function continued(token: string, clientVersion: string, read: typeof fetch): Promise<unknown> {
  try {
    const response = await read('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST',
      headers: { ...HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'GB' } }, continuation: token }),
    })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

/** A playlist's videos over up to `pages` listing pages, with its title and owner from the first. */
interface ListingPage {
  /** The continuation this page was read from; null for the playlist's own first page. */
  token: string | null
  videos: ResolvedVideo[]
}

interface Listing {
  data: unknown
  videos: ResolvedVideo[]
  pages: number
  parts: ListingPage[]
  version: string
  /** The continuation after the last page read, while the list goes on. */
  end: string | null
}

/** A playlist's videos over up to `pages` listing pages, with its title and owner from the first. */
async function readPlaylist(id: string, read: typeof fetch, pages: number): Promise<Listing> {
  const html = await page(`https://www.youtube.com/playlist?list=${id}`, read)
  const data = initialData(html)
  if (!data) throw new ChannelError(404, 'YouTube has no playlist at that link')
  const first = videosFromPlaylistPage(data)
  const videos = [...first]
  const parts: ListingPage[] = [{ token: null, videos: first }]
  const seen = new Set(videos.map((video) => video.id))
  const version = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? '2.20260101.00.00'
  let token = continuationOf(data)
  while (token && parts.length < pages) {
    const next = await continued(token, version, read)
    if (!next) break
    const fresh = videosFromPlaylistPage(next).filter((video) => !seen.has(video.id))
    for (const video of fresh) seen.add(video.id)
    videos.push(...fresh)
    parts.push({ token, videos: fresh })
    token = continuationOf(next)
  }
  return { data, videos, pages: parts.length, parts, version, end: token }
}

/** Where a later batch picks a list up again: the page to read and how many of its schedulable videos were already taken. */
interface Cursor {
  list: string
  version: string
  token: string | null
  skip: number
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.list, cursor.version, cursor.token, cursor.skip])).toString('base64url')
}

export function decodeCursor(text: string): Cursor | null {
  try {
    const [list, version, token, skip] = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as unknown[]
    if (typeof list !== 'string' || !PLAYLIST_ID.test(list) || typeof version !== 'string' || !/^[\w.]{1,40}$/.test(version)) return null
    if (token !== null && (typeof token !== 'string' || token.length > 2000)) return null
    if (typeof skip !== 'number' || !Number.isInteger(skip) || skip < 0 || skip > 1000) return null
    return { list, version, token, skip }
  } catch {
    return null
  }
}

const schedulable = (videos: readonly ResolvedVideo[]) => videos.filter((video) => video.durationSec >= MIN_SECONDS)

/** The cursor after the first `taken` schedulable videos of a listing, or none when the list is exhausted. */
function cursorAfter(listId: string, listing: Pick<Listing, 'parts' | 'version' | 'end'>, taken: number): string | undefined {
  let left = taken
  for (const part of listing.parts) {
    const count = schedulable(part.videos).length
    if (left < count) return encodeCursor({ list: listId, version: listing.version, token: part.token, skip: left })
    left -= count
  }
  return listing.end ? encodeCursor({ list: listId, version: listing.version, token: listing.end, skip: 0 }) : undefined
}

/**
 * The next batch of a list: one listing page from where the cursor points, each video checked for embedded
 * playback as the first read was. Pages are read one at a time, so a caller sets the pace.
 */
export async function resolveBatch(text: string, read: typeof fetch = fetch): Promise<ResolvedBatch> {
  const cursor = decodeCursor(text)
  if (!cursor) throw new ChannelError(400, 'That batch link is not one TVN made')
  let data: unknown
  let listed: number | null = null
  if (cursor.token === null) {
    const first = await readPlaylist(cursor.list, read, 1)
    data = first.data
    listed = listedCountFrom(first.data)
  } else {
    data = await continued(cursor.token, cursor.version, read)
    if (!data) throw new ChannelError(502, 'YouTube did not answer')
  }
  const listing = schedulable(videosFromPlaylistPage(data)).slice(cursor.skip)
  const { videos, refused } = await embeddableVideos(listing, read, Number.POSITIVE_INFINITY)
  const token = continuationOf(data)
  return {
    videos: withDates(videos, await watchPageDates(videos, read)),
    refused,
    ...(listed !== null ? { listed } : {}),
    ...(token && token !== cursor.token ? { next: encodeCursor({ list: cursor.list, version: cursor.version, token, skip: 0 }) } : {}),
  }
}

/**
 * The playlists a channel lists, each confirmed against its own header: `official` only where the
 * channel itself owns it. Nothing is added; the curator chooses.
 */
export async function discoverPlaylists(raw: string, read: typeof fetch = fetch): Promise<{ channelId: string; title: string; playlists: DiscoveredPlaylist[] }> {
  const input = parseChannelInput(raw)
  if (!input || input.kind === 'playlist' || input.kind === 'mix') throw new ChannelError(400, 'Discovery starts from a YouTube channel or @handle')
  const channelId = await channelIdOf(input, read)
  const html = await page(`https://www.youtube.com/channel/${channelId}/playlists`, read)
  const data = initialData(html)
  const title = channelTitleFrom(data) ?? channelId
  const listed = playlistsFromChannelPage(data).slice(0, DISCOVER_LIMIT)
  const playlists: DiscoveredPlaylist[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(4, listed.length) }, async () => {
      while (next < listed.length) {
        const item = listed[next++]
        const ownerId = await page(`https://www.youtube.com/playlist?list=${item.id}`, read)
          .then((text) => playlistOwnerFrom(initialData(text)))
          .catch(() => null)
        playlists.push({ ...item, ownerId, official: ownerId === channelId })
      }
    }),
  )
  playlists.sort((a, b) => listed.findIndex((item) => item.id === a.id) - listed.findIndex((item) => item.id === b.id))
  return { channelId, title, playlists }
}

async function page(url: string, read: typeof fetch): Promise<string> {
  let response: Response
  try {
    response = await read(url, { headers: HEADERS })
  } catch {
    throw new ChannelError(502, 'YouTube could not be reached')
  }
  if (response.status === 404) throw new ChannelError(404, 'YouTube has no channel at that link')
  if (!response.ok) throw new ChannelError(502, 'YouTube did not answer')
  return response.text()
}

/** True unless YouTube's oEmbed says the publisher refuses embedding. */
async function embeddable(id: string, read: typeof fetch): Promise<boolean> {
  try {
    const response = await read(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`)
    return !(response.status === 401 || response.status === 403 || response.status === 404)
  } catch {
    return true
  }
}

/**
 * Upload days by video id from a channel's or playlist's public feed. Listing pages give only "3 years
 * ago", and the feed gives the exact day for the newest entries in one keyless request for the whole
 * source, never one per video.
 */
export function feedDates(xml: string): Map<string, string> {
  const days = new Map<string, string>()
  for (const entry of xml.split('<entry>').slice(1)) {
    const id = entry.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1]
    const day = entry.match(/<published>(\d{4}-\d{2}-\d{2})T/)?.[1]
    if (id && day && !days.has(id)) days.set(id, day)
  }
  return days
}

async function readFeedDates(query: string, read: typeof fetch): Promise<Map<string, string>> {
  try {
    const response = await read(`https://www.youtube.com/feeds/videos.xml?${query}`, { headers: HEADERS })
    return response.ok ? feedDates(await response.text()) : new Map()
  } catch {
    return new Map()
  }
}

/** Playlist feeds read for upload days: each dates its newest 15 videos, one request per playlist, never per video. */
export const DATE_PLAYLISTS = 12

/**
 * Upload days from the feeds of the playlists a channel lists. The channel's own feed dates only its newest
 * uploads; its playlists' feeds date older ones with the same exact day, so a wider list is dated too.
 */
async function readPlaylistDates(channelId: string, read: typeof fetch): Promise<Map<string, string>> {
  const days = new Map<string, string>()
  try {
    const listed = await page(`https://www.youtube.com/channel/${channelId}/playlists`, read)
      .then((html) => playlistsFromChannelPage(initialData(html)).slice(0, DATE_PLAYLISTS).map((list) => list.id))
      .catch(() => [])
    // The channel's own long-form and most-popular lists: the newest videos past any Shorts, and its best known.
    const lists = [`UULF${channelId.slice(2)}`, `UULP${channelId.slice(2)}`, ...listed]
    const found = await Promise.all(lists.map((list) => readFeedDates(`playlist_id=${list}`, read)))
    for (const map of found) for (const [id, day] of map) if (!days.has(id)) days.set(id, day)
  } catch {
    return days
  }
  return days
}

/** Watch pages read for upload days the feeds did not give: at most this many per answer, inside this long. */
export const WATCH_DATE_LIMIT = 120
export const WATCH_DATE_BUDGET_MS = 4_000

/** Upload days already read from watch pages: a video's day never changes, so it is not read twice. */
const watchDays = new Map<string, string>()
const WATCH_DAYS_KEPT = 50_000

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items]
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[out[index], out[other]] = [out[other], out[index]]
  }
  return out
}

/** A video's upload day as its own public watch page states it (its schema.org metadata, else its player details). */
export function watchPageDate(html: string): string | null {
  return (
    html.match(/<meta itemprop="(?:datePublished|uploadDate)" content="(\d{4}-\d{2}-\d{2})/)?.[1] ??
    html.match(/"(?:publishDate|uploadDate)":"(\d{4}-\d{2}-\d{2})/)?.[1] ??
    null
  )
}

/** One watch page, read only as far as its upload day; the rest of the page is never downloaded. */
async function readWatchDate(id: string, read: typeof fetch, ms: number): Promise<string | null> {
  try {
    const response = await read(`https://www.youtube.com/watch?v=${id}`, { headers: HEADERS, signal: AbortSignal.timeout(Math.max(1, ms)) })
    if (!response.ok) return null
    if (!response.body) return watchPageDate(await response.text())
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let text = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const from = Math.max(0, text.length - 200)
      text += decoder.decode(value, { stream: true })
      const day = watchPageDate(text.slice(from))
      if (day) {
        await reader.cancel().catch(() => undefined)
        return day
      }
    }
    return watchPageDate(text)
  } catch {
    return null
  }
}

/**
 * Upload days for the videos the public feeds left undated, from each video's own watch page: a few at a time,
 * inside a time budget, so an answer is never held up for long. What is not reached stays undated (never guessed)
 * and a later RESCAN or LOAD MORE dates it.
 */
export async function watchPageDates(videos: readonly ResolvedVideo[], read: typeof fetch, now: () => number = Date.now): Promise<Map<string, string>> {
  const days = new Map<string, string>()
  const unknown: ResolvedVideo[] = []
  for (const video of videos) {
    if (video.published) continue
    const known = watchDays.get(video.id)
    if (known) days.set(video.id, known)
    else unknown.push(video)
  }
  // Taken in no fixed order, so a RESCAN reaches the ones an earlier answer ran out of time for.
  const missing = shuffled(unknown).slice(0, WATCH_DATE_LIMIT)
  const deadline = now() + WATCH_DATE_BUDGET_MS
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, missing.length) }, async () => {
      while (next < missing.length && now() < deadline) {
        const video = missing[next++]
        const day = await readWatchDate(video.id, read, deadline - now())
        if (day) {
          days.set(video.id, day)
          if (watchDays.size >= WATCH_DAYS_KEPT) watchDays.delete(watchDays.keys().next().value as string)
          watchDays.set(video.id, day)
        }
      }
    }),
  )
  return days
}

const withDates = (videos: readonly ResolvedVideo[], days: ReadonlyMap<string, string>): ResolvedVideo[] =>
  videos.map((video) => {
    const published = video.published ?? days.get(video.id)
    return published ? { ...video, published } : video
  })

export async function resolveChannel(raw: string, read: typeof fetch = fetch, options: { wide?: boolean } = {}): Promise<ResolvedChannel> {
  const keep = options.wide ? WIDE_KEEP : KEEP
  const input = parseChannelInput(raw)
  if (!input) throw new ChannelError(400, 'That is not a YouTube channel or video link')
  const pages = options.wide ? PAGE_LIMIT.wide : PAGE_LIMIT.recent
  if (input.kind === 'mix') throw new ChannelError(422, MIX_UNLISTED)
  if (input.kind === 'playlist') {
    const list = await readPlaylist(input.id, read, pages)
    const listed = schedulable(list.videos)
    if (listed.length === 0) throw new ChannelError(404, 'That playlist has no videos TVN can schedule')
    const [kept, days] = await Promise.all([embeddableVideos(listed, read, keep), readFeedDates(`playlist_id=${input.id}`, read)])
    if (kept.videos.length === 0) throw new ChannelError(422, 'That playlist does not allow its videos to play outside YouTube')
    const ownerId = playlistOwnerFrom(list.data)
    const count = listedCountFrom(list.data)
    const next = cursorAfter(input.id, list, kept.taken)
    const fed = withDates(kept.videos, days)
    return {
      channelId: input.id,
      sourceType: 'youtube-playlist',
      title: playlistTitleFrom(list.data) ?? input.id,
      videos: withDates(fed, await watchPageDates(fed, read)),
      scanned: listed.length,
      refused: kept.refused,
      ...(ownerId ? { ownerId } : {}),
      pages: list.pages,
      ...(count !== null ? { listed: count } : {}),
      ...(next ? { next } : {}),
    }
  }
  const named = await channelNamed(input, read)
  const channelId = named.channelId
  // A channel's uploads are its own uploads playlist: RECENT reads its first page, ARCHIVE and ALL read on.
  const uploads = `UU${channelId.slice(2)}`
  const list = await readPlaylist(uploads, read, pages)
  const title = named.title ?? channelTitleFrom(list.data)
  const listed = schedulable(list.videos)
  if (listed.length === 0) throw new ChannelError(404, 'That channel has no videos TVN can schedule')

  const [{ videos, refused, taken }, days, older] = await Promise.all([
    embeddableVideos(listed, read, keep),
    readFeedDates(`channel_id=${channelId}`, read),
    readPlaylistDates(channelId, read),
  ])
  const seed = input.kind === 'video' && input.mix && named.seed && (await embeddable(named.seed.id, read)) ? named.seed : null
  if (videos.length === 0 && !seed) throw new ChannelError(422, 'That channel does not allow its videos to play outside YouTube')
  const count = listedCountFrom(list.data)
  const next = cursorAfter(uploads, list, taken)
  const fed = withDates(withDates(videos, days), older)
  const dated = withDates(fed, await watchPageDates(fed, read))
  return {
    channelId,
    sourceType: 'youtube-channel',
    title: title ?? channelId,
    videos: seed ? [seed, ...dated.filter((video) => video.id !== seed.id)] : dated,
    ...(input.kind === 'video' && input.mix ? { mix: { list: input.mix, seed: input.id } } : {}),
    scanned: listed.length,
    refused,
    pages: list.pages,
    ...(count !== null ? { listed: count } : {}),
    ...(next ? { next } : {}),
  }
}

/** What a Mix link holds when its own list cannot be read. */
const MIX_UNLISTED = 'A YouTube Mix is made fresh for each viewer and cannot be listed; paste one of its videos instead'

/** The video a watch page is for, as its own player details give it. */
export function seedFromPage(html: string, id: string): ResolvedVideo | null {
  const details = html.match(/"videoDetails":\{"videoId":"([\w-]{11})","title":"((?:[^"\\]|\\.)*)","lengthSeconds":"(\d+)"/)
  if (!details || details[1] !== id) return null
  let title: string
  try {
    title = JSON.parse(`"${details[2]}"`) as string
  } catch {
    return null
  }
  const durationSec = Number(details[3])
  if (!title || durationSec < MIN_SECONDS) return null
  const published = html.match(/"publishDate":"(\d{4}-\d{2}-\d{2})/)?.[1]
  const creator = watchPageCreator(html)
  return { id, title, durationSec, ...(published ? { published } : {}), ...(creator ? { creator } : {}) }
}

/** The uploader a watch page names in its player details; the handle only from the owner's own profile address. */
export function watchPageCreator(html: string): VideoCreator | undefined {
  const raw = html.match(/"ownerChannelName":"((?:[^"\\]|\\.)*)"/)?.[1]
  const channelId = html.match(/"externalChannelId":"(UC[0-9A-Za-z_-]{22})"/)?.[1]
  if (raw === undefined || !channelId) return undefined
  let name: string
  try {
    name = JSON.parse(`"${raw}"`) as string
  } catch {
    return undefined
  }
  const handle = html.match(/"ownerProfileUrl":"https?:\/\/www\.youtube\.com\/@([\w.-]{3,30})"/)?.[1]
  return creatorFrom(name, { browseId: channelId, ...(handle ? { canonicalBaseUrl: `/@${handle}` } : {}) })
}

async function channelNamed(
  input: Exclude<ChannelInput, { kind: 'playlist' } | { kind: 'mix' }>,
  read: typeof fetch,
): Promise<{ channelId: string; title: string | null; seed?: ResolvedVideo }> {
  let channelId: string | null = input.kind === 'channel' ? input.id : null
  let title: string | null = null
  let seed: ResolvedVideo | null = null
  if (input.kind === 'video') {
    const html = await page(`https://www.youtube.com/watch?v=${input.id}`, read)
    channelId = channelIdFromPage(html, 'video')
    if (input.mix) seed = seedFromPage(html, input.id)
  } else if (input.kind !== 'channel') {
    const html = await page(`https://www.youtube.com${input.kind === 'handle' ? `/@${encodeURIComponent(input.handle)}` : input.path}`, read)
    channelId = channelIdFromPage(html, 'channel')
    title = channelTitleFrom(initialData(html))
  }
  if (!channelId) throw new ChannelError(404, 'No YouTube channel was found at that link')
  return { channelId, title, ...(seed ? { seed } : {}) }
}

async function channelIdOf(input: Exclude<ChannelInput, { kind: 'playlist' } | { kind: 'mix' }>, read: typeof fetch): Promise<string> {
  return (await channelNamed(input, read)).channelId
}

/** The first `keep` listed videos whose publishers allow embedded playback. */
async function embeddableVideos(
  listed: readonly ResolvedVideo[],
  read: typeof fetch,
  keep = KEEP,
): Promise<{ videos: ResolvedVideo[]; refused: number; taken: number }> {
  const verdicts = new Array<boolean | undefined>(listed.length)
  let next = 0
  const kept = () => verdicts.filter(Boolean).length
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, listed.length) }, async () => {
      while (next < listed.length && kept() < keep) {
        const index = next++
        verdicts[index] = await embeddable(listed[index].id, read)
      }
    }),
  )
  // Checks run in parallel, so some past the last kept video may be done; the next batch starts right after it.
  let taken = listed.length
  let count = 0
  for (let index = 0; index < listed.length; index += 1) {
    if (verdicts[index] && ++count === keep) {
      taken = index + 1
      break
    }
  }
  const before = verdicts.slice(0, taken)
  return { videos: listed.filter((_, index) => index < taken && verdicts[index]), refused: before.filter((verdict) => verdict === false).length, taken }
}

export async function handleChannelRequest(url: URL, read: typeof fetch = fetch): Promise<{ status: number; body: unknown }> {
  const link = url.searchParams.get('url') ?? ''
  const cursor = url.searchParams.get('cursor')
  if (cursor !== null) {
    if (cursor.length > 3000) return { status: 400, body: { error: 'That batch link is not one TVN made' } }
    try {
      return { status: 200, body: await resolveBatch(cursor, read) }
    } catch (error) {
      if (error instanceof ChannelError) return { status: error.status, body: { error: error.message } }
      return { status: 500, body: { error: 'The next programmes could not be read' } }
    }
  }
  if (!link.trim() || link.length > 500) return { status: 400, body: { error: 'Paste a YouTube channel or video link' } }
  try {
    const mode = url.searchParams.get('mode')
    if (mode === 'playlists') return { status: 200, body: await discoverPlaylists(link, read) }
    return { status: 200, body: await resolveChannel(link, read, { wide: mode === 'archive' || mode === 'all' }) }
  } catch (error) {
    if (error instanceof ChannelError) return { status: error.status, body: { error: error.message } }
    return { status: 500, body: { error: 'The channel could not be read' } }
  }
}

/**
 * Answers may be cached for a quarter of an hour, except an explicit RESCAN (a `refresh` parameter) and
 * failures: a viewer asking to refresh a channel must get YouTube's current list, not a remembered one.
 */
export function channelCacheControl(url: URL, status: number): string {
  return status === 200 && !url.searchParams.has('refresh') ? 'public, max-age=900' : 'no-store'
}

/** Connect-style middleware for the Vite development and preview servers. */
export function channelMiddleware(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL((request as IncomingMessage & { originalUrl?: string }).originalUrl ?? request.url ?? '/', 'http://localhost')
  void handleChannelRequest(url).then(({ status, body }) => {
    response.statusCode = status
    response.setHeader('content-type', 'application/json')
    response.setHeader('cache-control', channelCacheControl(url, status))
    response.end(JSON.stringify(body))
  })
}
