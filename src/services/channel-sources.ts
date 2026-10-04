import type { LiveStreamRef } from '../types/programme.ts'
import { eligibleOf, type SourceFilter, type SourceMode } from './channel-curation.ts'
import type { ImportedVideo } from './channels-import.ts'

/**
 * What a channel is made from. A YouTube source (a channel, @handle, a video standing for its uploader,
 * or a playlist) and an imported TVN list contribute scheduled programmes; a stream source is a
 * continuous live feed the browser plays itself. `tvn` stands for a curated channel's own shipped
 * programming, which TVN schedules itself. Another resolver joins by adding a kind here.
 */
export type SourceKind = 'tvn' | 'youtube' | 'collection' | 'podcast' | 'audio' | 'audio-hls' | 'video' | 'video-hls'

export type SourceState = 'unchecked' | 'ready' | 'online' | 'unavailable' | 'unsupported' | 'failed'

/**
 * Public information about a source's creator, typed in by the viewer for their own channel. TVN never
 * looks any of it up: it is only what the creator publishes for public or business contact.
 */
export interface SourceInfo {
  website?: string
  /** Official social and creator pages, one address each. */
  links?: string[]
  contactPage?: string
  email?: string
  phone?: string
}

export interface SourceStatus {
  state: SourceState
  /** Scheduled programmes this source currently contributes, when it is a scheduled source. */
  playable?: number
  checkedAt: number
}

export type YouTubeSourceType = 'channel' | 'playlist'

export interface ChannelSource {
  /** Stable within its channel. */
  id: string
  kind: SourceKind
  /** What the viewer pasted: a page or stream address. Empty for an imported list. */
  url: string
  label: string
  enabled: boolean
  /** Identity the resolver found: a YouTube channel or playlist id, or an imported list's name. */
  ref?: string
  /** For a YouTube source: a channel's uploads, or one playlist and nothing else. */
  youtube?: YouTubeSourceType
  /** Everything this source's last scan found; its filter decides which of them are eligible. */
  videos?: ImportedVideo[]
  status?: SourceStatus
  info?: SourceInfo
  /** A scheduled source's include and exclude rules (src/services/channel-curation.ts). Absent: everything is eligible. */
  filter?: SourceFilter
  /** How far back a scheduled source reaches. Absent: recent. */
  mode?: SourceMode
  /** How many videos the provider says the source holds; what can be scheduled is often fewer. */
  listed?: number
  /** Where TVN's lookup picks the source up for its next batch (a YouTube listing position, never a credential). */
  more?: string
  /** Every batch the provider lists has been read. */
  complete?: boolean
  /** The viewer loaded past the first batch: a rescan adds new programmes and keeps the older ones loaded. */
  deep?: boolean
}

interface SourceType {
  label: string
  /** A continuous live feed rather than scheduled programmes. */
  live: boolean
  media: 'audio' | 'video'
  format?: LiveStreamRef['format']
}

export const SOURCE_TYPES: Record<SourceKind, SourceType> = {
  tvn: { label: 'TVN programming', live: false, media: 'video' },
  youtube: { label: 'YouTube', live: false, media: 'video' },
  collection: { label: 'Imported list', live: false, media: 'video' },
  podcast: { label: 'Podcast', live: false, media: 'audio' },
  audio: { label: 'Live audio', live: true, media: 'audio', format: 'direct' },
  'audio-hls': { label: 'HLS audio', live: true, media: 'audio', format: 'hls' },
  video: { label: 'Live video', live: true, media: 'video', format: 'direct' },
  'video-hls': { label: 'HLS stream', live: true, media: 'video', format: 'hls' },
}

/** The kinds a viewer can add by address; an imported list only arrives with its channel. */
export const ADDABLE_KINDS: readonly SourceKind[] = ['youtube', 'podcast', 'audio', 'audio-hls', 'video', 'video-hls']

export function isStreamSource(source: Pick<ChannelSource, 'kind'>): boolean {
  return SOURCE_TYPES[source.kind].live
}

/** The channel's live stream: the first enabled stream source, which then carries the channel. */
export function liveStreamOf(sources: readonly ChannelSource[]): { source: ChannelSource; stream: LiveStreamRef; media: 'audio' | 'video' } | null {
  const source = sources.find((item) => item.enabled && isStreamSource(item))
  if (!source) return null
  const type = SOURCE_TYPES[source.kind]
  return { source, stream: { url: source.url, format: type.format ?? 'direct' }, media: type.media }
}

/** Eligible programmes from the enabled scheduled sources (each through its filter and mode), in source order, each video once. */
export function inventoryOf(sources: readonly ChannelSource[]): ImportedVideo[] {
  const seen = new Set<string>()
  const videos: ImportedVideo[] = []
  for (const source of sources) {
    if (!source.enabled || isStreamSource(source)) continue
    for (const video of eligibleOf(source)) {
      if (seen.has(video.id)) continue
      seen.add(video.id)
      videos.push({ ...video })
    }
  }
  return videos
}

/** Programmes in the viewer's running order: the listed ones first, as listed, then any others as the sources give them. */
export function inOrder<T extends { id: string }>(videos: readonly T[], order?: readonly string[]): T[] {
  if (!order?.length) return [...videos]
  const byId = new Map(videos.map((video) => [video.id, video]))
  const listed = [...new Set(order)].flatMap((id) => byId.get(id) ?? [])
  const placed = new Set(listed.map((video) => video.id))
  return [...listed, ...videos.filter((video) => !placed.has(video.id))]
}

/**
 * New programmes for the source a channel was created from (its imported list, or the YouTube channel it
 * was added by), for a re-import or a second ADD of the same link. Other sources are left alone.
 */
export function refreshOrigin(
  record: { videos: ImportedVideo[]; channelSources?: ChannelSource[] },
  origin: { kind: 'collection' } | { kind: 'youtube'; ref: string },
  videos: readonly ImportedVideo[],
  now: number,
): { videos: ImportedVideo[]; channelSources?: ChannelSource[] } {
  if (!record.channelSources) return { videos: videos.map((video) => ({ ...video })) }
  const channelSources = record.channelSources.map((source) =>
    source.kind === origin.kind && (origin.kind === 'collection' || source.ref === origin.ref)
      ? { ...source, videos: videos.map((video) => ({ ...video })), status: { state: 'ready' as const, playable: videos.length, checkedAt: now } }
      : source,
  )
  return { videos: inventoryOf(channelSources), channelSources }
}

/** One short line for the viewer. Resolver internals stay in the developer diagnostics. */
export function sourceStatusText(source: ChannelSource, siblings: readonly ChannelSource[] = []): string {
  if (!source.enabled) return 'Disabled'
  if (source.kind === 'tvn') {
    if (liveStreamOf(siblings)) return 'TVN programming · replaced by the live stream'
    return inventoryOf(siblings).length > 0 ? 'TVN programming · with your added sources' : 'TVN programming · on air'
  }
  const state = source.status?.state ?? 'unchecked'
  if (state === 'failed') return 'Resolution failed'
  if (state === 'unavailable') return 'Unavailable'
  if (state === 'unsupported') return 'This browser cannot play this stream'
  const matching = source.filter ? ` · ${eligibleOf(source).length} match the filter` : ''
  if (source.kind === 'youtube') {
    const what = youTubeSourceType(source) === 'playlist' ? 'YouTube playlist' : 'YouTube uploader'
    return state === 'unchecked' ? `${what} · not scanned yet` : `${what} · ${source.status?.playable ?? source.videos?.length ?? 0} playable${matching}`
  }
  if (source.kind === 'collection') return `Imported list · ${source.videos?.length ?? 0} programmes${matching}`
  if (source.kind === 'podcast') return state === 'unchecked' ? 'Podcast · not read yet · Rescan to find its feed' : `Podcast · ${source.videos?.length ?? 0} episodes${matching}`
  const label = SOURCE_TYPES[source.kind].label
  if (state === 'unchecked') return `${label} · not checked yet`
  return source.kind.endsWith('-hls') ? `${label} · verified` : `${label} · online`
}

/** The stored type when there is one; older sources are read from their id or address. */
export function youTubeSourceType(source: Pick<ChannelSource, 'ref' | 'url' | 'youtube'>): YouTubeSourceType {
  if (source.youtube) return source.youtube
  if (source.ref) return source.ref.startsWith('UC') ? 'channel' : 'playlist'
  return /[?&]list=(?:PL|OL|UU|FL)/i.test(source.url) ? 'playlist' : 'channel'
}

/** The address TVN rescans: the resolved channel or playlist itself, never the video or handle first pasted. */
export function canonicalYouTubeUrl(source: Pick<ChannelSource, 'ref' | 'url' | 'youtube'>): string {
  if (!source.ref) return source.url
  return youTubeSourceType(source) === 'playlist'
    ? `https://www.youtube.com/playlist?list=${source.ref}`
    : `https://www.youtube.com/channel/${source.ref}`
}

const YOUTUBE_HOST = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)$/i
const YOUTUBE_HANDLE = /^@[\w.-]{3,100}$/
/** A host typed without a scheme: dotted labels ending in an alphabetic top-level domain, e.g. example.com. */
const PLAIN_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i
/** A page or feed rather than a stream: the site itself, a web page, or an address that names a feed. */
const FEED_PATH = /(?:^\/?$|\.(?:rss|xml|atom|html?|php|aspx?)$|\/(?:feed|rss|atom|podcasts?)(?:\/|$))/i
const AUDIO_FILE = /\.(?:mp3|aac|m4a|ogg|oga|opus|flac|wav)$/i
const VIDEO_FILE = /\.(?:mp4|m4v|webm|mov|ogv)$/i

/**
 * Work out what a pasted address is. `hint` is the viewer's choice when the address alone cannot say
 * (a stream with no file extension is taken as live audio, the usual shape of an internet radio station).
 */
export function classifySourceUrl(raw: string, hint: SourceKind | 'auto' = 'auto'): { kind: SourceKind; url: string } {
  const text = raw.trim()
  if (!text) throw new Error('Paste a source address')
  if (/^UC[0-9A-Za-z_-]{22}$/.test(text)) return { kind: 'youtube', url: text }
  // A bare handle names a YouTube channel; it is only a source once the lookup finds it.
  if (YOUTUBE_HANDLE.test(text) && (hint === 'auto' || hint === 'youtube')) return { kind: 'youtube', url: `https://www.youtube.com/${text}` }
  const url = webAddress(text)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only web addresses can be added')
  const youtube = YOUTUBE_HOST.test(url.hostname)
  if (hint === 'collection' || hint === 'tvn') throw new Error('That kind of source cannot be added by address')
  if (youtube || hint === 'youtube') {
    if (!youtube) throw new Error('That is not a YouTube address')
    const handle = url.pathname.split('/').filter(Boolean)
    if (handle.length === 1 && YOUTUBE_HANDLE.test(decodeURIComponent(handle[0])) && !url.search) return { kind: 'youtube', url: `https://www.youtube.com/${decodeURIComponent(handle[0])}` }
    return { kind: 'youtube', url: url.toString() }
  }
  if (hint === 'podcast' || (hint === 'auto' && FEED_PATH.test(url.pathname))) return { kind: 'podcast', url: url.toString() }
  if (/\.(?:pls|m3u|asx|xspf)$/i.test(url.pathname)) throw new Error('Paste the stream address inside that playlist file')
  if (hint !== 'auto') return { kind: hint, url: url.toString() }
  if (/\.m3u8$/i.test(url.pathname)) return { kind: /radio|audio|aac|icecast/i.test(url.toString()) ? 'audio-hls' : 'video-hls', url: url.toString() }
  if (VIDEO_FILE.test(url.pathname)) return { kind: 'video', url: url.toString() }
  if (AUDIO_FILE.test(url.pathname)) return { kind: 'audio', url: url.toString() }
  return { kind: 'audio', url: url.toString() }
}

/** A web page or feed rather than a stream or media file: ADD reads it for a feed or a public episode archive. */
export function isWebsiteSource(raw: string): boolean {
  const { kind, url } = classifySourceUrl(raw)
  if (kind === 'podcast') return true
  if (kind !== 'audio') return false
  return !/\.[a-z0-9]{2,5}$/i.test(new URL(url).pathname)
}

/**
 * A typed address as a URL. One with a scheme is read as it is; one without gets https:// only when it is
 * plainly a host name (example.com, www.example.com/path), so a word or phrase is never taken for a site.
 */
export function webAddress(text: string): URL {
  const trimmed = text.trim()
  const schemed = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  if (!schemed) {
    const host = trimmed.split(/[/?#]/, 1)[0].replace(/:\d{1,5}$/, '')
    if (/\s/.test(trimmed) || !PLAIN_HOST.test(host)) throw new Error('That is not a web address')
  }
  try {
    return new URL(schemed ? trimmed : `https://${trimmed}`)
  } catch {
    throw new Error('That is not a web address')
  }
}

export function nextSourceId(sources: readonly ChannelSource[]): string {
  let last = 0
  for (const source of sources) {
    const number = Number(source.id.replace(/^s/, ''))
    if (Number.isFinite(number) && number > last) last = number
  }
  return `s${last + 1}`
}

export function newSource(sources: readonly ChannelSource[], raw: string, hint: SourceKind | 'auto' = 'auto'): ChannelSource {
  const { kind, url } = classifySourceUrl(raw, hint)
  if (sources.some((source) => source.url === url)) throw new Error('That source is already on this channel')
  return { id: nextSourceId(sources), kind, url, label: '', enabled: true, status: { state: 'unchecked', checkedAt: 0 } }
}
