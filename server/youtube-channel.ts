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
  /** Upload day (YYYY-MM-DD), where the source's public feed gave one. */
  published?: string
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
  | { kind: 'video'; id: string }
  | { kind: 'playlist'; id: string }

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
  if (host === 'youtu.be') {
    if (!parts[0] || !VIDEO_ID.test(parts[0])) return null
    return playlist ? { kind: 'playlist', id: playlist } : { kind: 'video', id: parts[0] }
  }
  if (host !== 'youtube.com') return null
  const v = url.searchParams.get('v')
  if (parts[0] === 'playlist' && playlist) return { kind: 'playlist', id: playlist }
  // A watch link that carries a real playlist means the playlist; mixes (RD…) and Watch Later fall back to the video.
  if (parts[0] === 'watch' && playlist) return { kind: 'playlist', id: playlist }
  if (parts[0] === 'watch' && v && VIDEO_ID.test(v)) return { kind: 'video', id: v }
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
  const push = (id: unknown, title: string, durationSec: number) => {
    if (typeof id !== 'string' || !VIDEO_ID.test(id) || seen.has(id) || !title) return
    seen.add(id)
    videos.push({ id, title, durationSec })
  }
  walk(data, (node) => {
    const lockup = node.lockupViewModel as Record<string, unknown> | undefined
    if (lockup && lockup.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      let durationSec = 0
      walk(lockup.contentImage, (inner) => {
        const badge = inner.thumbnailBadgeViewModel as { text?: unknown } | undefined
        if (!durationSec && typeof badge?.text === 'string') durationSec = parseClock(badge.text)
      })
      const metadata = (lockup.metadata as { lockupMetadataViewModel?: { title?: unknown } } | undefined)?.lockupMetadataViewModel
      push(lockup.contentId, textOf(metadata?.title), durationSec)
    }
    const legacy = node.playlistVideoRenderer as { videoId?: unknown; title?: unknown; lengthSeconds?: unknown } | undefined
    if (legacy) push(legacy.videoId, textOf(legacy.title), Number(legacy.lengthSeconds) || 0)
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
async function readPlaylist(id: string, read: typeof fetch, pages: number): Promise<{ data: unknown; videos: ResolvedVideo[]; pages: number }> {
  const html = await page(`https://www.youtube.com/playlist?list=${id}`, read)
  const data = initialData(html)
  if (!data) throw new ChannelError(404, 'YouTube has no playlist at that link')
  const videos = videosFromPlaylistPage(data)
  const seen = new Set(videos.map((video) => video.id))
  const version = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? '2.20260101.00.00'
  let token = continuationOf(data)
  let read_ = 1
  while (token && read_ < pages) {
    const next = await continued(token, version, read)
    if (!next) break
    read_ += 1
    for (const video of videosFromPlaylistPage(next)) {
      if (seen.has(video.id)) continue
      seen.add(video.id)
      videos.push(video)
    }
    token = continuationOf(next)
  }
  return { data, videos, pages: read_ }
}

/**
 * The playlists a channel lists, each confirmed against its own header: `official` only where the
 * channel itself owns it. Nothing is added; the curator chooses.
 */
export async function discoverPlaylists(raw: string, read: typeof fetch = fetch): Promise<{ channelId: string; title: string; playlists: DiscoveredPlaylist[] }> {
  const input = parseChannelInput(raw)
  if (!input || input.kind === 'playlist') throw new ChannelError(400, 'Discovery starts from a YouTube channel or @handle')
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
  if (input.kind === 'playlist') {
    const list = await readPlaylist(input.id, read, pages)
    const listed = list.videos.filter((video) => video.durationSec >= MIN_SECONDS)
    if (listed.length === 0) throw new ChannelError(404, 'That playlist has no videos TVN can schedule')
    const [kept, days] = await Promise.all([embeddableVideos(listed, read, keep), readFeedDates(`playlist_id=${input.id}`, read)])
    if (kept.videos.length === 0) throw new ChannelError(422, 'That playlist does not allow its videos to play outside YouTube')
    const ownerId = playlistOwnerFrom(list.data)
    return {
      channelId: input.id,
      sourceType: 'youtube-playlist',
      title: playlistTitleFrom(list.data) ?? input.id,
      videos: withDates(kept.videos, days),
      scanned: listed.length,
      refused: kept.refused,
      ...(ownerId ? { ownerId } : {}),
      pages: list.pages,
    }
  }
  const named = await channelNamed(input, read)
  const channelId = named.channelId
  // A channel's uploads are its own uploads playlist: RECENT reads its first page, ARCHIVE and ALL read on.
  const list = await readPlaylist(`UU${channelId.slice(2)}`, read, pages)
  const title = named.title ?? channelTitleFrom(list.data)
  const listed = list.videos.filter((video) => video.durationSec >= MIN_SECONDS)
  if (listed.length === 0) throw new ChannelError(404, 'That channel has no videos TVN can schedule')

  const [{ videos, refused }, days] = await Promise.all([embeddableVideos(listed, read, keep), readFeedDates(`channel_id=${channelId}`, read)])
  if (videos.length === 0) throw new ChannelError(422, 'That channel does not allow its videos to play outside YouTube')
  return { channelId, sourceType: 'youtube-channel', title: title ?? channelId, videos: withDates(videos, days), scanned: listed.length, refused, pages: list.pages }
}

async function channelNamed(input: Exclude<ChannelInput, { kind: 'playlist' }>, read: typeof fetch): Promise<{ channelId: string; title: string | null }> {
  let channelId: string | null = input.kind === 'channel' ? input.id : null
  let title: string | null = null
  if (input.kind === 'video') {
    channelId = channelIdFromPage(await page(`https://www.youtube.com/watch?v=${input.id}`, read), 'video')
  } else if (input.kind !== 'channel') {
    const html = await page(`https://www.youtube.com${input.kind === 'handle' ? `/@${encodeURIComponent(input.handle)}` : input.path}`, read)
    channelId = channelIdFromPage(html, 'channel')
    title = channelTitleFrom(initialData(html))
  }
  if (!channelId) throw new ChannelError(404, 'No YouTube channel was found at that link')
  return { channelId, title }
}

async function channelIdOf(input: Exclude<ChannelInput, { kind: 'playlist' }>, read: typeof fetch): Promise<string> {
  return (await channelNamed(input, read)).channelId
}

/** The first `keep` listed videos whose publishers allow embedded playback. */
async function embeddableVideos(listed: readonly ResolvedVideo[], read: typeof fetch, keep = KEEP): Promise<{ videos: ResolvedVideo[]; refused: number }> {
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
  return { videos: listed.filter((_, index) => verdicts[index]).slice(0, keep), refused: verdicts.filter((verdict) => verdict === false).length }
}

export async function handleChannelRequest(url: URL, read: typeof fetch = fetch): Promise<{ status: number; body: unknown }> {
  const link = url.searchParams.get('url') ?? ''
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
