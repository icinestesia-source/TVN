import { connect as tcpConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { measureMedia } from './media-probe.ts'
import { attr, dayOf, FeedError, fetchText, field, fnv, publicFeedUrl, refusal, TIMEOUT_MS, USER_AGENT } from './web-read.ts'
import type { FeedEpisode, ResolvedFeed } from './podcast-feed.ts'
import { isXHost, resolveXPost } from './web-programmes.ts'

/**
 * Public video sources beyond podcasts and websites, each read the way its publisher offers it to anyone:
 * Vimeo through its oEmbed record and public RSS, Odysee and BitChute through their public RSS and the plain
 * media each one links, Rumble through its channel pages' own video lists and their public HLS playlists or files, and a direct file or HLS stream by what the server says it is. Nothing here signs in,
 * decodes a protected stream or keeps an expiring signed address: a source is stored by its stable public
 * address and read again from it.
 */

export type SourceProvider = 'vimeo' | 'odysee' | 'bitchute' | 'rumble' | 'rss' | 'archive' | 'hls' | 'direct' | 'website' | 'x'
export type SourceForm = 'video' | 'collection' | 'live'

export interface LiveSource {
  url: string
  media: 'video' | 'audio'
  format: 'hls' | 'direct'
}

type ParseFeed = (xml: string, feedUrl: string) => Omit<ResolvedFeed, 'feedUrl' | 'shape' | 'via'>

/** Addresses where a broadcaster sends a stream (OBS and the like), never where anyone watches it. */
export const INGEST_SCHEME = /^(?:rtmps?|rtsp|rtsps|srt|rist|udp|rtp):\/\//i
export const INGEST_MESSAGE = 'That is an ingest address: TVN needs the public playback URL (.m3u8 or watch page)'

/** Query parameters that make an address a personal or expiring link, which TVN never stores. */
const SIGNED_PARAM = /^(?:token|sig|signature|expires?|exp|policy|key-pair-id|hdnts|hdnea|x-amz-signature|x-amz-credential|x-goog-signature|auth|access_token|st|e|md5|hash)$/i

export function isSignedUrl(url: URL): boolean {
  return [...url.searchParams.keys()].some((name) => SIGNED_PARAM.test(name))
}

const VIMEO_HOST = /^(?:www\.|player\.)?vimeo\.com$/i
const ODYSEE_HOST = /^(?:www\.)?odysee\.com$/i
const BITCHUTE_HOST = /^(?:www\.|api\.|old\.)?bitchute\.com$/i
const RUMBLE_HOST = /^(?:www\.)?rumble\.com$/i

const VIMEO_PAGES = new Set(['showcase', 'album', 'event', 'ondemand', 'live', 'groups', 'categories', 'search', 'watch', 'upload', 'features', 'blog', 'help', 'join', 'log_in', 'manage', 'settings', 'stock', 'solutions', 'enterprise', 'pricing', 'create'])

const json = async (url: string, read: typeof fetch): Promise<Record<string, unknown> | null> => {
  try {
    const response = await read(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) return null
    return (await response.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const web = (value: unknown): string | undefined => publicFeedUrl(text(value))?.toString()

function one(feedUrl: string, provider: SourceProvider, episode: FeedEpisode, website: string | null = null): ResolvedFeed {
  return { feedUrl, website, title: episode.title, description: '', episodes: [episode], listed: 1, unplayable: 0, shape: 'feed', via: 'address', provider, form: 'video' }
}

// --- Vimeo -----------------------------------------------------------------------------------------------

export const vimeoPlayerUrl = (id: string) => `https://player.vimeo.com/video/${id}`

async function vimeoVideo(id: string, read: typeof fetch): Promise<ResolvedFeed> {
  const page = `https://vimeo.com/${id}`
  const record = await json(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(page)}`, read)
  if (!record) throw new FeedError(404, 'That Vimeo video is private, removed, or does not allow embedding')
  const durationSec = Math.round(Number(record.duration) || 0)
  if (durationSec <= 0) throw new FeedError(422, 'That Vimeo video has no length TVN can schedule (a live event, perhaps)')
  const published = dayOf(text(record.upload_date))
  const image = web(record.thumbnail_url)
  return one(
    page,
    'vimeo',
    {
      id: `vimeo-${id}`,
      title: text(record.title).slice(0, 200) || `Vimeo ${id}`,
      durationSec,
      ...(published ? { published } : {}),
      media: vimeoPlayerUrl(id),
      type: 'video/vimeo',
      page,
      ...(image ? { image } : {}),
    },
    web(record.author_url) ?? null,
  )
}

async function vimeoCollection(feedUrl: string, rss: string, read: typeof fetch, keep: number): Promise<ResolvedFeed> {
  const page = await fetchText(rss, read)
  const blocks = page.text.match(/<item\b[\s\S]*?<\/item>/gi) ?? []
  const episodes: FeedEpisode[] = []
  for (const block of blocks) {
    const link = field(block, 'link') ?? ''
    const id = link.match(/\/(\d{5,12})\/?$/)?.[1] ?? field(block, 'guid')?.match(/clip(\d{5,12})/)?.[1]
    const title = field(block, 'title')
    const content = block.match(/<media:content\b[^>]*>/i)?.[0]
    const durationSec = content ? Math.round(Number(attr(content, 'duration')) || 0) : 0
    if (!id || !title || durationSec < 30) continue
    const published = dayOf(field(block, 'pubDate'))
    const thumb = block.match(/<media:thumbnail\b[^>]*>/i)?.[0]
    const image = thumb ? web(attr(thumb, 'url')) : undefined
    const summary = (field(block, 'description') ?? '').slice(0, 300)
    episodes.push({
      id: `vimeo-${id}`,
      title: title.slice(0, 200),
      durationSec,
      ...(published ? { published } : {}),
      media: vimeoPlayerUrl(id),
      type: 'video/vimeo',
      page: `https://vimeo.com/${id}`,
      ...(image ? { image } : {}),
      ...(summary ? { summary } : {}),
    })
  }
  if (episodes.length === 0) throw new FeedError(422, 'That Vimeo page lists no public videos TVN can play')
  const head = page.text.slice(0, page.text.search(/<item\b/i) >>> 0 || page.text.length)
  const title = (field(head, 'title') ?? '').replace(/^Vimeo\s*\/\s*/i, '').replace(/['’]s videos$/i, '') || 'Vimeo'
  return {
    feedUrl,
    website: feedUrl,
    title,
    description: (field(head, 'description') ?? '').slice(0, 500),
    episodes: episodes.slice(0, keep),
    listed: blocks.length,
    unplayable: blocks.length - episodes.length,
    shape: 'feed',
    via: 'address',
    provider: 'vimeo',
    form: 'collection',
  }
}

async function vimeo(url: URL, read: typeof fetch, keep: number): Promise<ResolvedFeed> {
  const parts = url.pathname.split('/').filter(Boolean)
  if (url.hostname.toLowerCase().startsWith('player.')) {
    const id = parts[0] === 'video' && /^\d{5,12}$/.test(parts[1] ?? '') ? parts[1] : null
    if (!id) throw new FeedError(422, 'That Vimeo address names no video')
    if (url.searchParams.has('h')) throw new FeedError(403, 'That is a private Vimeo link: TVN plays public Vimeo videos only')
    return vimeoVideo(id, read)
  }
  const id = [...parts].reverse().find((part) => /^\d{5,12}$/.test(part))
  if (id) {
    const at = parts.indexOf(id)
    // vimeo.com/<id>/<hash> is an unlisted video shared by private link.
    if (/^[0-9a-f]{6,}$/i.test(parts[at + 1] ?? '') || url.searchParams.has('h')) throw new FeedError(403, 'That is a private Vimeo link: TVN plays public Vimeo videos only')
    return vimeoVideo(id, read)
  }
  if (parts[0] === 'channels' && parts[1]) {
    const name = encodeURIComponent(parts[1])
    return vimeoCollection(`https://vimeo.com/channels/${name}`, `https://vimeo.com/channels/${name}/videos/rss`, read, keep)
  }
  if (parts.length >= 1 && !VIMEO_PAGES.has(parts[0].toLowerCase()) && /^[\w.-]{2,64}$/.test(parts[0])) {
    const name = encodeURIComponent(parts[0])
    return vimeoCollection(`https://vimeo.com/${name}`, `https://vimeo.com/${name}/videos/rss`, read, keep)
  }
  throw new FeedError(422, 'That Vimeo page (showcase, event or On Demand) has no public feed TVN can read')
}

// --- Odysee ----------------------------------------------------------------------------------------------

const odyseeTitle = (title: string) => title.replace(/\s+on Odysee$/i, '').trim()

async function odyseeChannel(channel: string, read: typeof fetch, keep: number, parse: ParseFeed): Promise<ResolvedFeed> {
  const rss = `https://odysee.com/$/rss/${channel}`
  const page = await fetchText(rss, read)
  const parsed = parse(page.text, rss)
  const episodes = parsed.episodes.filter((episode) => /^(?:video|audio)\//.test(episode.type))
  if (episodes.length === 0) throw new FeedError(422, 'That Odysee channel lists no public videos TVN can play')
  const feedUrl = `https://odysee.com/${channel}`
  return { ...parsed, feedUrl, website: feedUrl, title: odyseeTitle(parsed.title) || channel, episodes: episodes.slice(0, keep), shape: 'feed', via: 'address', provider: 'odysee', form: 'collection' }
}

async function odysee(url: URL, read: typeof fetch, keep: number, parse: ParseFeed): Promise<ResolvedFeed> {
  const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
  const rest = parts[0] === '$' && parts[1] === 'rss' ? parts.slice(2) : parts
  if (rest[0]?.startsWith('@') && rest.length === 1) return odyseeChannel(rest[0], read, keep, parse)
  const claim = rest[rest.length - 1]
  if (!claim || claim.startsWith('$') || !claim.includes(':')) throw new FeedError(422, 'TVN reads public Odysee channels (@name) and videos; that Odysee page is neither')
  const page = `https://odysee.com/${rest.map(encodeURIComponent).join('/').replace(/%3A/gi, ':').replace(/%40/g, '@')}`
  const record = await json(`https://odysee.com/$/oembed?url=${encodeURIComponent(page)}&format=json`, read)
  const author = text(record?.author_url).match(/odysee\.com\/(@[^/?#]+)/)?.[1]
  const channel = rest[0]?.startsWith('@') ? rest[0] : author ? decodeURIComponent(author) : null
  if (!channel) throw new FeedError(404, 'That Odysee video could not be found, or belongs to no public channel')
  const listed = await odyseeChannel(channel, read, 1000, parse)
  const [slug, prefix = ''] = claim.split(':')
  const episode = listed.episodes.find((item) => {
    const at = item.page?.match(/odysee\.com\/(?:@[^/]+\/)?([^/:]+):([0-9a-f]+)/)
    return at !== null && at !== undefined && at[1] === slug && at[2].startsWith(prefix)
  })
  if (!episode) throw new FeedError(404, "That Odysee video is older than its channel's public feed reaches")
  return one(page, 'odysee', episode, listed.feedUrl)
}

// --- BitChute --------------------------------------------------------------------------------------------

/** The plain public file a BitChute embed page plays, with its title. */
async function bitchuteMedia(id: string, read: typeof fetch): Promise<{ media: string; title: string } | null> {
  const page = await fetchText(`https://api.bitchute.com/embed/${id}/`, read).catch(() => null)
  if (!page) return null
  const source = page.text.match(/<source\b[^>]*>/i)?.[0]
  const src = source ? publicFeedUrl(attr(source, 'src') ?? '', page.url) : null
  if (!src || !/(?:^|\.)bitchute\.com$/i.test(src.hostname) || isSignedUrl(src)) return null
  const title = (page.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim()
  return { media: src.toString(), title }
}

async function bitchute(url: URL, read: typeof fetch, keep: number): Promise<ResolvedFeed> {
  const parts = url.pathname.split('/').filter(Boolean)
  const video = (parts[0] === 'video' || parts[0] === 'embed') && /^[\w-]{6,20}$/.test(parts[1] ?? '') ? parts[1] : null
  if (video) {
    const found = await bitchuteMedia(video, read)
    if (!found) throw new FeedError(404, 'That BitChute video has no public file TVN can play')
    const page = `https://www.bitchute.com/video/${video}/`
    return one(page, 'bitchute', { id: `bitchute-${video}`, title: found.title || `BitChute ${video}`, durationSec: 0, media: found.media, type: 'video/mp4', page })
  }
  const at = parts.indexOf('channel')
  const name = at >= 0 && /^[\w-]{2,64}$/.test(parts[at + 1] ?? '') ? parts[at + 1] : null
  if (!name) throw new FeedError(422, 'TVN reads public BitChute channels and videos; that BitChute page is neither')
  const rss = await fetchText(`https://api.bitchute.com/feeds/rss/channel/${name}/`, read)
  const blocks = (rss.text.match(/<item\b[\s\S]*?<\/item>/gi) ?? []).slice(0, Math.min(keep, 30))
  const items = blocks
    .map((block) => {
      const id = (field(block, 'guid') ?? '').trim() || (field(block, 'link') ?? '').match(/\/(?:embed|video)\/([\w-]+)/)?.[1] || ''
      return { id, title: field(block, 'title') ?? '', published: dayOf(field(block, 'pubDate')), summary: (field(block, 'description') ?? '').slice(0, 300) }
    })
    .filter((item) => /^[\w-]{6,20}$/.test(item.id) && item.title)
  const found = await Promise.all(items.map((item) => bitchuteMedia(item.id, read)))
  const episodes: FeedEpisode[] = []
  items.forEach((item, index) => {
    const media = found[index]?.media
    if (!media) return
    episodes.push({
      id: `bitchute-${item.id}`,
      title: item.title.slice(0, 200),
      durationSec: 0,
      ...(item.published ? { published: item.published } : {}),
      media,
      type: 'video/mp4',
      page: `https://www.bitchute.com/video/${item.id}/`,
      ...(item.summary ? { summary: item.summary } : {}),
    })
  })
  if (episodes.length === 0) throw new FeedError(422, 'That BitChute channel lists no public videos TVN can play')
  const head = rss.text.slice(0, rss.text.search(/<item\b/i) >>> 0 || rss.text.length)
  const feedUrl = `https://www.bitchute.com/channel/${name}/`
  return {
    feedUrl,
    website: feedUrl,
    title: field(head, 'title') || name,
    description: (field(head, 'description') ?? '').slice(0, 500),
    episodes,
    listed: blocks.length,
    unplayable: blocks.length - episodes.length,
    shape: 'feed',
    via: 'address',
    provider: 'bitchute',
    form: 'collection',
  }
}

// --- Rumble ----------------------------------------------------------------------------------------------

const RUMBLE_PAGE_SIZE = 25
const RUMBLE_MAX_PAGES = 8
const RUMBLE_PLAYLIST = /^https:\/\/rumble\.com\/hls-vod\/[\w-]{6,40}\/playlist\.m3u8$/

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})

const RUMBLE_FILE_HOST = /(?:^|\.)rumble\.cloud$/i
const RUMBLE_FILE_HEIGHT = 720

/**
 * What Rumble plays a video from: its public HLS playlist when it lists one, or else (older videos, whose
 * playlist is empty) the plain public MP4 nearest 720p. Never a signed address.
 */
function rumbleMedia(videos: readonly unknown[]): { media: string; type: 'video/hls' | 'video/mp4' } | null {
  const list = videos.map(record)
  const playlist = list.map((item) => text(item.url)).find((url) => RUMBLE_PLAYLIST.test(url))
  if (playlist) return { media: playlist, type: 'video/hls' }
  const files = list
    .map((item) => ({ url: publicFeedUrl(text(item.url)), height: Number(item.res) || 0 }))
    .filter((file): file is { url: URL; height: number } => file.url !== null && file.url.protocol === 'https:' && RUMBLE_FILE_HOST.test(file.url.hostname) && /\.mp4$/i.test(file.url.pathname) && !isSignedUrl(file.url) && file.url.search === '')
  if (files.length === 0) return null
  const within = files.filter((file) => file.height <= RUMBLE_FILE_HEIGHT).sort((a, b) => b.height - a.height)
  const best = within[0] ?? [...files].sort((a, b) => a.height - b.height)[0]
  return { media: best.url.toString(), type: 'video/mp4' }
}

/** The videos a Rumble channel page lists in its own grid: public, free, finished, and this channel's. */
export function rumbleGrid(html: string, channelUrl: string): { listed: number; episodes: FeedEpisode[]; name: string } {
  const block = html.match(/<rum-videos-grid>\s*<script type="application\/json">([\s\S]*?)<\/script>/i)?.[1]
  let items: unknown[] = []
  try {
    items = block ? ((record(JSON.parse(block)).items as unknown[]) ?? []) : []
  } catch {
    items = []
  }
  const own = items.map(record).filter((item) => item.object_type === 'video' && text(record(item.by).url).toLowerCase() === channelUrl.toLowerCase())
  let name = ''
  const episodes: FeedEpisode[] = []
  for (const item of own) {
    name ||= text(record(item.by).name)
    const found = rumbleMedia(Array.isArray(item.videos) ? item.videos : [])
    const id = text(item.permalink_id)
    const durationSec = Math.round(Number(item.duration) || 0)
    const page = publicFeedUrl(text(item.url))
    const playable = item.visibility === 'public' && item.availability == null && item.is_age_restricted !== true && item.live !== true && item.live_placeholder !== true && item.is_short !== true
    if (!playable || !found || !/^v[0-9a-z]{3,12}$/.test(id) || durationSec <= 0 || !page || page.hostname !== 'rumble.com') continue
    const published = dayOf(text(item.upload_date))
    const image = web(item.thumb)
    episodes.push({
      id: `rumble-${id}`,
      title: text(item.title).slice(0, 200) || `Rumble ${id}`,
      durationSec,
      ...(published ? { published } : {}),
      ...found,
      page: page.toString(),
      ...(image ? { image } : {}),
    })
  }
  return { listed: own.length, episodes, name }
}

async function rumbleVideo(url: URL, read: typeof fetch): Promise<ResolvedFeed> {
  const page = `https://rumble.com${url.pathname}`
  const oembed = await json(`https://rumble.com/api/Media/oembed.json?url=${encodeURIComponent(page)}`, read)
  const embed = text(oembed?.html).match(/rumble\.com\/embed\/(v[0-9a-z]{3,12})\//)?.[1] ?? url.pathname.match(/^\/embed\/(v[0-9a-z]{3,12})/)?.[1]
  const player = embed ? await json(`https://rumble.com/embedJS/u3/?request=video&ver=2&v=${embed}`, read) : null
  const files = Object.entries(record(record(player?.ua).mp4)).map(([height, file]) => ({ url: record(file).url, res: Number(height) }))
  const found = player ? rumbleMedia([record(record(player.u).hls), ...files, { url: record(record(player.u).mp4).url, res: Number(record(record(record(player.u).mp4).meta).h) }]) : null
  if (!player || !found) throw new FeedError(404, 'That Rumble video is private, removed, or has no public stream TVN can play')
  const durationSec = Math.round(Number(player.duration) || 0)
  if (Number(player.live) || durationSec <= 0) throw new FeedError(422, 'That Rumble video is a live stream or has no length TVN can schedule')
  const link = text(player.l)
  const address = /^\/v[0-9a-z]+[\w-]*\.html$/.test(link) ? `https://rumble.com${link}` : page
  const published = dayOf(text(player.pubDate))
  const image = web(player.i)
  return one(
    address,
    'rumble',
    {
      id: `rumble-${address.match(/\/(v[0-9a-z]{3,12})(?:-|\.html)/)?.[1] ?? embed}`,
      title: (text(player.title) || text(oembed?.title)).replace(/\s+/g, ' ').slice(0, 200) || 'Rumble video',
      durationSec,
      ...(published ? { published } : {}),
      ...found,
      page: address,
      ...(image ? { image } : {}),
    },
    web(record(player.author).url) ?? web(oembed?.author_url) ?? null,
  )
}

async function rumble(url: URL, read: typeof fetch, keep: number): Promise<ResolvedFeed> {
  const parts = url.pathname.split('/').filter(Boolean)
  if (/^v[0-9a-z]+[\w-]*\.html$/i.test(parts[0] ?? '') || parts[0] === 'embed') return rumbleVideo(url, read)
  const kind = parts[0] === 'c' || parts[0] === 'user' ? parts[0] : null
  const name = kind && /^[\w-]{2,64}$/.test(parts[1] ?? '') ? parts[1] : null
  if (!kind || !name) throw new FeedError(422, 'TVN reads public Rumble channels and videos; that Rumble page is neither')
  const channelUrl = `https://rumble.com/${kind}/${name}`
  const episodes: FeedEpisode[] = []
  let listed = 0
  let title = ''
  const pages = Math.min(RUMBLE_MAX_PAGES, Math.max(1, Math.ceil(keep / RUMBLE_PAGE_SIZE)))
  for (let n = 1; n <= pages && episodes.length < keep; n++) {
    const page = await fetchText(`${channelUrl}/videos${n > 1 ? `?page=${n}` : ''}`, read).catch((error: unknown) => {
      if (n === 1) throw error
      return null
    })
    if (!page) break
    const grid = rumbleGrid(page.text, channelUrl)
    title ||= grid.name
    listed += grid.listed
    episodes.push(...grid.episodes)
    if (grid.listed < RUMBLE_PAGE_SIZE) break
  }
  if (episodes.length === 0) throw new FeedError(422, 'That Rumble channel lists no public videos TVN can play')
  return {
    feedUrl: channelUrl,
    website: channelUrl,
    title: title || name,
    description: '',
    episodes: episodes.slice(0, keep),
    listed,
    unplayable: listed - episodes.length,
    shape: 'feed',
    via: 'address',
    provider: 'rumble',
    form: 'collection',
  }
}

// --- Direct media, HLS and DASH --------------------------------------------------------------------------

export interface Probe {
  url: string
  type: string
  /** The file's full size, when the server states one. */
  length: number
  ranged: boolean
  /** An Icecast/SHOUTcast stream, and the station name it gives. */
  icy: boolean
  icyName: string
  head: string
}

const PROBE_BYTES = 4096

const stationName = (value: string | null): string => (value ?? '').replace(/[^ -~\u00a0-\uffff]|[<>]/g, '').trim().slice(0, 80)

/** The type, station name and Icecast headers a radio server's 200 reply gives, or null for anything else. */
export type IcyPeek = (url: URL) => Promise<{ type: string; name: string; icy: boolean } | null>

/**
 * Fetch refuses a SHOUTcast "ICY 200 OK" status line, and a status line ended by a bare newline, as malformed
 * HTTP; radio servers send both, so the reply's head is read over a plain socket instead.
 */
export const icyPeek: IcyPeek = (url) =>
  new Promise((resolve) => {
    const secure = url.protocol === 'https:'
    const port = Number(url.port) || (secure ? 443 : 80)
    const socket = secure ? tlsConnect({ host: url.hostname, port, servername: url.hostname }) : tcpConnect({ host: url.hostname, port })
    let got = ''
    const done = (value: { type: string; name: string; icy: boolean } | null) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(TIMEOUT_MS, () => done(null))
    socket.on('error', () => done(null))
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      socket.write(`GET ${url.pathname}${url.search} HTTP/1.0\r\nHost: ${url.host}\r\nUser-Agent: ${USER_AGENT}\r\nIcy-MetaData: 0\r\n\r\n`)
    })
    socket.on('data', (chunk: Buffer) => {
      got += chunk.toString('latin1')
      const end = got.search(/\r?\n\r?\n/)
      if (end < 0 && got.length < PROBE_BYTES) return
      const [status, ...lines] = got.slice(0, end < 0 ? PROBE_BYTES : end).split(/\r?\n/)
      if (!/^(?:ICY|HTTP\/1\.[01]) 200\b/i.test(status)) return done(null)
      const header = (name: string) => lines.find((line) => line.toLowerCase().startsWith(`${name}:`))?.slice(name.length + 1).trim() ?? ''
      const icy = status.toUpperCase().startsWith('ICY') || lines.some((line) => /^icy-/i.test(line))
      done({ type: header('content-type').toLowerCase().split(';')[0].trim(), name: header('icy-name'), icy })
    })
  })

/** Follows an address's redirects by hand to the server fetch could not read, and asks it whether it is a SHOUTcast stream. */
async function icyProbe(raw: string, read: typeof fetch, peek: IcyPeek): Promise<Probe | null> {
  let url = publicFeedUrl(raw)
  for (let hop = 0; url && hop < 5; hop += 1) {
    let response: Response
    try {
      response = await read(url.toString(), { headers: { 'user-agent': USER_AGENT }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (error) {
      if (error instanceof Error && /timeout|abort/i.test(error.name)) return null
      const icy = await peek(url)
      if (!icy || !(icy.icy || /^(?:audio|video)\//.test(icy.type))) return null
      const ext = url.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? ''
      const type = /^(?:audio|video)\//.test(icy.type) ? icy.type : (MEDIA_EXT[ext] ?? 'audio/mpeg')
      return { url: raw, type, length: 0, ranged: false, icy: true, icyName: stationName(icy.name), head: '' }
    }
    await response.body?.cancel().catch(() => undefined)
    const next = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null
    if (!next) return null
    url = publicFeedUrl(next, url.toString())
  }
  return null
}

/** The first few kilobytes of an address and what its server says it is; the rest is never downloaded. */
export async function probeUrl(raw: string, read: typeof fetch, peek: IcyPeek = icyPeek): Promise<Probe | null> {
  let response: Response
  try {
    response = await read(raw, { headers: { 'user-agent': USER_AGENT, range: `bytes=0-${PROBE_BYTES - 1}` }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (error) {
    if (error instanceof Error && /timeout|abort/i.test(error.name)) return null
    return icyProbe(raw, read, peek)
  }
  const refused = refusal(response, 'That address')
  if (refused) throw refused
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  const type = (response.headers.get('content-type') ?? '').toLowerCase().split(';')[0].trim()
  const total = response.headers.get('content-range')?.match(/\/(\d+)\s*$/)?.[1]
  const length = Number(total ?? (response.status === 200 ? response.headers.get('content-length') : 0)) || 0
  const ranged = response.status === 206 || (response.headers.get('accept-ranges') ?? '').toLowerCase() === 'bytes'
  const icy = [...response.headers.keys()].some((name) => name.toLowerCase().startsWith('icy-'))
  const icyName = stationName(response.headers.get('icy-name'))
  let head = ''
  if (response.body) {
    const reader = response.body.getReader()
    const bytes: Uint8Array[] = []
    let got = 0
    try {
      while (got < PROBE_BYTES) {
        const { done, value } = await reader.read()
        if (done) break
        bytes.push(value)
        got += value.length
      }
    } catch {
      // What arrived is enough to tell.
    }
    await reader.cancel().catch(() => undefined)
    const all = new Uint8Array(got)
    let at = 0
    for (const chunk of bytes) {
      all.set(chunk.subarray(0, Math.max(0, Math.min(chunk.length, got - at))), at)
      at += chunk.length
    }
    head = new TextDecoder('utf-8', { fatal: false }).decode(all.subarray(0, PROBE_BYTES))
  }
  const finalUrl = publicFeedUrl(response.url || raw)
  return { url: finalUrl ? finalUrl.toString() : raw, type, length, ranged, icy, icyName, head }
}

const HLS_TYPE = /mpegurl/i
const DASH_TYPE = /dash\+xml/i
const MEDIA_EXT: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav' }

export interface Playlist {
  live: boolean
  durationSec: number
  audioOnly: boolean
  drm: boolean
}

/** What an HLS media playlist says of itself: VOD when it ends (#EXT-X-ENDLIST or a VOD type), live otherwise. */
export function readMediaPlaylist(body: string): Omit<Playlist, 'audioOnly'> {
  const ended = /#EXT-X-ENDLIST\b/.test(body) || /#EXT-X-PLAYLIST-TYPE:\s*VOD\b/i.test(body)
  const durationSec = Math.round([...body.matchAll(/#EXTINF:\s*([\d.]+)/g)].reduce((sum, match) => sum + Number(match[1]), 0))
  const drm = /#EXT-X-(?:SESSION-)?KEY:[^\n]*(?:METHOD=SAMPLE-AES|KEYFORMAT=)/i.test(body)
  return { live: !ended, durationSec, drm }
}

/** A master playlist's first variant (and whether every variant is sound only), or null for a media playlist. */
export function firstVariant(body: string, base: string): { url: string; audioOnly: boolean } | null {
  const lines = body.split(/\r?\n/)
  const infos = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.startsWith('#EXT-X-STREAM-INF'))
  if (infos.length === 0) return null
  const audioOnly = infos.every(({ line }) => {
    const codecs = line.match(/CODECS="([^"]*)"/i)?.[1]
    return codecs !== undefined && !/avc|hvc|hev|vp0?9|av01|dvh/i.test(codecs) && !/RESOLUTION=/i.test(line)
  })
  const uri = lines.slice(infos[0].index + 1).find((line) => line.trim() && !line.startsWith('#'))
  const url = uri ? publicFeedUrl(uri.trim(), base) : null
  return url ? { url: url.toString(), audioOnly } : null
}

const GENERIC_SEGMENT = /^(?:index|master|playlist|manifest|live|stream|chunklist|listen|(?:mp3|aac|aacp|ogg|opus|flac|hls|hifi|lofi|high|low)?[-_ ]?\d*k?)$/i

const nameOf = (url: URL): string => {
  const segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment).replace(/\.[a-z0-9]{2,5}$/i, ''))
  const file = segments.reverse().find((segment) => !GENERIC_SEGMENT.test(segment))
  const host = url.hostname.replace(/^www\./, '')
  return file ? `${file.replace(/[_-]+/g, ' ').slice(0, 80)}` : host
}

async function hlsSource(probe: Probe, read: typeof fetch): Promise<ResolvedFeed> {
  const master = (await fetchText(probe.url, read)).text
  if (!/^#EXTM3U/.test(master.trimStart())) throw new FeedError(422, 'That address is not an HLS playlist')
  const variant = firstVariant(master, probe.url)
  const body = variant ? (await fetchText(variant.url, read)).text : master
  const playlist = readMediaPlaylist(body)
  if (playlist.drm || /#EXT-X-SESSION-KEY:[^\n]*KEYFORMAT=/i.test(master)) throw new FeedError(403, 'That stream is DRM-protected, which TVN does not play')
  const url = new URL(probe.url)
  const title = nameOf(url)
  const media = variant?.audioOnly ? 'audio' : 'video'
  if (playlist.live) {
    return { feedUrl: probe.url, website: null, title, description: '', episodes: [], listed: 0, unplayable: 0, shape: 'feed', via: 'address', provider: 'hls', form: 'live', live: { url: probe.url, media, format: 'hls' } }
  }
  if (playlist.durationSec < 30) throw new FeedError(422, 'That HLS recording is too short to schedule')
  return one(probe.url, 'hls', { id: `hls-${fnv(probe.url)}`, title, durationSec: playlist.durationSec, media: probe.url, type: media === 'audio' ? 'audio/hls' : 'video/hls' })
}

/**
 * A direct file, an HLS stream or a DASH manifest, by what the server says it is (the extension only breaks
 * a tie for a server that calls everything octet-stream). Null when the address is a page or a feed.
 */
async function mediaSource(start: URL, read: typeof fetch, peek: IcyPeek): Promise<ResolvedFeed | null> {
  const probe = await probeUrl(start.toString(), read, peek)
  if (!probe) return null
  const url = new URL(probe.url)
  const page = probe.type.startsWith('text/html') || /xml/.test(probe.type)
  const signed = new FeedError(400, 'That is a signed, expiring link: paste the permanent public address instead')
  if (isSignedUrl(start)) {
    if (page) return null
    throw signed
  }
  // A radio station's public address often redirects to a signed node for each listener; only a live stream is
  // kept by the address it was given, so the signed one is never stored.
  const signedOnArrival = isSignedUrl(url)
  if (signedOnArrival && page) return null
  const ext = url.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? ''
  const vague = !probe.type || probe.type === 'application/octet-stream' || probe.type === 'binary/octet-stream'
  if (HLS_TYPE.test(probe.type) || /^#EXTM3U/.test(probe.head.trimStart()) || (vague && ext === 'm3u8')) {
    if (signedOnArrival) throw signed
    return hlsSource(probe, read)
  }
  if (DASH_TYPE.test(probe.type) || /<MPD\b/.test(probe.head) || (vague && ext === 'mpd')) {
    throw new FeedError(415, "DASH (.mpd) streams are not supported yet: use the stream's HLS (.m3u8) address")
  }
  const type = /^(?:audio|video)\//.test(probe.type) ? probe.type : vague ? (MEDIA_EXT[ext] ?? '') : ''
  if (!type) return null
  const media = type.startsWith('audio/') ? 'audio' : 'video'
  const title = probe.icyName || nameOf(url)
  // A stream has no end to measure: Icecast says so, as does sound with no size that cannot be read in parts.
  if (probe.icy || (media === 'audio' && !probe.length && !probe.ranged)) {
    const address = start.toString()
    return { feedUrl: address, website: null, title, description: '', episodes: [], listed: 0, unplayable: 0, shape: 'feed', via: 'address', provider: 'direct', form: 'live', live: { url: address, media, format: 'direct' } }
  }
  if (signedOnArrival) throw signed
  if (!probe.ranged) throw new FeedError(422, "That file's server cannot send part of a file, so TVN could not join it mid-programme")
  const measured = await measureMedia(probe.url, type, read).catch(() => null)
  if (measured && 'locked' in measured) throw new FeedError(403, 'That file needs a sign-in or subscription, which TVN does not use')
  const durationSec = measured ? Math.round(measured.seconds) : 0
  return one(probe.url, 'direct', { id: `file-${fnv(probe.url)}`, title, durationSec, media: probe.url, type })
}

/** A known video provider's address, or a direct file or stream; null for a page or feed the podcast reader takes. */
export async function resolveUrlSource(start: URL, read: typeof fetch, keep: number, parse: ParseFeed, peek: IcyPeek = icyPeek): Promise<ResolvedFeed | null> {
  const host = start.hostname.toLowerCase()
  if (VIMEO_HOST.test(host)) return vimeo(start, read, keep)
  if (ODYSEE_HOST.test(host)) return odysee(start, read, keep, parse)
  if (BITCHUTE_HOST.test(host)) return bitchute(start, read, keep)
  if (RUMBLE_HOST.test(host)) return rumble(start, read, keep)
  if (isXHost(host)) return resolveXPost(start, read)
  return mediaSource(start, read, peek)
}
