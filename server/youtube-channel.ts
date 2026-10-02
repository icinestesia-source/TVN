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
}

export interface ResolvedChannel {
  channelId: string
  /** What the link named: a whole channel's uploads, or one playlist and nothing else. */
  sourceType: 'youtube-channel' | 'youtube-playlist'
  title: string
  videos: ResolvedVideo[]
  scanned: number
  refused: number
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
/** ARCHIVE and ALL keep every embeddable video the page lists (one page; no continuation is followed). */
const WIDE_KEEP = 200
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

export async function resolveChannel(raw: string, read: typeof fetch = fetch, options: { wide?: boolean } = {}): Promise<ResolvedChannel> {
  const keep = options.wide ? WIDE_KEEP : KEEP
  const input = parseChannelInput(raw)
  if (!input) throw new ChannelError(400, 'That is not a YouTube channel or video link')
  if (input.kind === 'playlist') {
    const data = initialData(await page(`https://www.youtube.com/playlist?list=${input.id}`, read))
    if (!data) throw new ChannelError(404, 'YouTube has no playlist at that link')
    const listed = videosFromPlaylistPage(data).filter((video) => video.durationSec >= MIN_SECONDS)
    if (listed.length === 0) throw new ChannelError(404, 'That playlist has no videos TVN can schedule')
    const kept = await embeddableVideos(listed, read, keep)
    if (kept.videos.length === 0) throw new ChannelError(422, 'That playlist does not allow its videos to play outside YouTube')
    return { channelId: input.id, sourceType: 'youtube-playlist', title: playlistTitleFrom(data) ?? input.id, videos: kept.videos, scanned: listed.length, refused: kept.refused }
  }
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

  const data = initialData(await page(`https://www.youtube.com/playlist?list=UU${channelId.slice(2)}`, read))
  title = title ?? channelTitleFrom(data)
  const listed = videosFromPlaylistPage(data).filter((video) => video.durationSec >= MIN_SECONDS)
  if (listed.length === 0) throw new ChannelError(404, 'That channel has no videos TVN can schedule')

  const { videos, refused } = await embeddableVideos(listed, read, keep)
  if (videos.length === 0) throw new ChannelError(422, 'That channel does not allow its videos to play outside YouTube')
  return { channelId, sourceType: 'youtube-channel', title: title ?? channelId, videos, scanned: listed.length, refused }
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
