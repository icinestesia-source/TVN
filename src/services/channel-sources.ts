import type { LiveStreamRef } from '../types/programme.ts'
import { eligibleOf, type SourceFilter, type SourceMode } from './channel-curation.ts'
import type { ImportedVideo } from './channels-import.ts'

/**
 * What a channel is made from. A YouTube source (a channel, @handle, a video standing for its uploader,
 * or a playlist) and an imported TVN list contribute scheduled programmes; a stream source is a
 * continuous live feed the browser plays itself. `tvn` stands for a curated channel's own shipped
 * programming, which TVN schedules itself. Another resolver joins by adding a kind here.
 */
export type SourceKind = 'tvn' | 'youtube' | 'collection' | 'podcast' | 'website' | 'audio' | 'audio-hls' | 'video' | 'video-hls'

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

/** A website's slot when it is first added: it has no length of its own. */
export const WEBSITE_SLOT_SECONDS = 600
/** The slots the editor offers a website or post, beside a custom number of minutes. */
export const SLOT_CHOICES: readonly number[] = [300, 600, 900, 1800]

/** A stable id for a website TVN shows without asking its reader (one on this computer, while developing). */
export function localWebsiteId(url: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < url.length; index += 1) hash = Math.imul(hash ^ url.charCodeAt(index), 0x01000193)
  return `web-${(hash >>> 0).toString(36)}`
}

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
  /** Programmes (video ids) the viewer deleted from the schedule: never eligible again, whatever a rescan or LOAD reads. */
  removed?: string[]
  /** The source's share of the channel's airtime, in percent, applied when the channel is rescheduled. Absent: an equal part of what is left. */
  share?: number
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
  website: { label: 'Website', live: false, media: 'video' },
  audio: { label: 'Live audio', live: true, media: 'audio', format: 'direct' },
  'audio-hls': { label: 'HLS audio', live: true, media: 'audio', format: 'hls' },
  video: { label: 'Live video', live: true, media: 'video', format: 'direct' },
  'video-hls': { label: 'HLS stream', live: true, media: 'video', format: 'hls' },
}

/** The kinds a viewer can add by address; an imported list only arrives with its channel. */
export const ADDABLE_KINDS: readonly SourceKind[] = ['youtube', 'podcast', 'website', 'audio', 'audio-hls', 'video', 'video-hls']

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

/** The sources as the scheduler sees them: programmes still held back for a rescan left out. */
export function airingSources(sources: readonly ChannelSource[]): ChannelSource[] {
  return sources.map((source) => (source.videos?.some((video) => video.pending) ? { ...source, videos: source.videos.filter((video) => !video.pending) } : source))
}

/** How a running order was made: sorted A–Z or newest first, shuffled, rebuilt from every eligible programme, or arranged by hand. */
export type OrderKind = 'az' | 'latest' | 'random' | 'rebuilt' | 'manual'

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
  if (source.kind === 'website') {
    const what = isXPostUrl(source.url) ? 'X post' : 'Website'
    if (state === 'unavailable') return `${what} · SITE CANNOT BE EMBEDDED`
    if (state === 'failed') return `${what} · could not be checked just now`
    if (state === 'unchecked') return `${what} · not checked yet · Rescan to check it can be shown`
    const slot = source.videos?.[0]?.durationSec
    return `${what} · interactive · ${slot ? `${Math.round(slot / 60)} min slot` : 'no slot yet'}`
  }
  if (state === 'failed') return 'Resolution failed'
  if (state === 'unavailable' && singleVideoId(source)) return 'YouTube single video · cannot play outside YouTube (its publisher’s choice, or not on air)'
  if (state === 'unavailable' && source.kind === 'youtube') return 'YouTube · cannot play outside YouTube (its publisher’s choice)'
  if (state === 'unavailable') return 'Unavailable'
  if (state === 'unsupported') return 'This browser cannot play this stream'
  const matching = source.filter ? ` · ${eligibleOf(source).length} match the filter` : ''
  if (source.kind === 'youtube') {
    const what = youTubeSourceType(source) === 'playlist' ? 'YouTube playlist' : 'YouTube uploader'
    return state === 'unchecked' ? `${what} · not scanned yet` : `${what} · ${source.status?.playable ?? source.videos?.length ?? 0} playable${matching}`
  }
  if (singleVideoId(source)) return state === 'unchecked' ? 'YouTube single video · not read yet' : 'YouTube single video · just this video'
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
/** A video site TVN's server reads like a feed (its channels, lists and single videos), whatever the page path. */
const READER_HOST = /^(?:(?:www\.|player\.)?vimeo\.com|(?:www\.)?odysee\.com|(?:www\.|old\.)?bitchute\.com|(?:www\.)?rumble\.com)$/i
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
  // A website is the page itself, shown in a sandboxed frame: https only, or this computer while developing TVN.
  if (hint === 'website' || (hint === 'auto' && isXPostUrl(url.toString()))) {
    if (url.protocol !== 'https:' && !isLocalDevelopment(url)) throw new Error('A Website programme needs an https:// address')
    return { kind: 'website', url: url.toString() }
  }
  if (youtube || hint === 'youtube') {
    if (!youtube) throw new Error('That is not a YouTube address')
    const handle = url.pathname.split('/').filter(Boolean)
    if (handle.length === 1 && YOUTUBE_HANDLE.test(decodeURIComponent(handle[0])) && !url.search) return { kind: 'youtube', url: `https://www.youtube.com/${decodeURIComponent(handle[0])}` }
    return { kind: 'youtube', url: url.toString() }
  }
  if (hint === 'podcast' || (hint === 'auto' && (FEED_PATH.test(url.pathname) || READER_HOST.test(url.hostname)))) return { kind: 'podcast', url: url.toString() }
  if (/\.(?:pls|m3u|asx|xspf)$/i.test(url.pathname)) throw new Error('Paste the stream address inside that playlist file')
  if (hint !== 'auto') return { kind: hint, url: url.toString() }
  if (/\.m3u8$/i.test(url.pathname)) return { kind: /radio|audio|aac|icecast/i.test(url.toString()) ? 'audio-hls' : 'video-hls', url: url.toString() }
  if (VIDEO_FILE.test(url.pathname)) return { kind: 'video', url: url.toString() }
  if (AUDIO_FILE.test(url.pathname)) return { kind: 'audio', url: url.toString() }
  return { kind: 'audio', url: url.toString() }
}

const X_POST = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/\d{5,25}(?:\/(?:video|photo)\/\d+)?\/?(?:[?#]|$)/i

/** The address of one public X (Twitter) post, including its …/video/1 form. */
export function isXPostUrl(raw: string): boolean {
  return X_POST.test(raw.trim())
}

/** This computer, for trying a website while developing TVN: only when TVN itself runs here too. */
export function isLocalDevelopment(url: URL, page: string | undefined = typeof location === 'undefined' ? undefined : location.hostname): boolean {
  const local = (host: string) => host === 'localhost' || host === '127.0.0.1'
  return (url.protocol === 'http:' || url.protocol === 'https:') && local(url.hostname) && page !== undefined && local(page)
}

/**
 * The source types the editor offers beside DETECT, each one the runtime actually supports. A choice corrects
 * or confirms what detection would find; it never makes TVN treat an address as something it cannot read.
 */
export type SourceChoice =
  | 'auto'
  | 'youtube-video'
  | 'youtube-single'
  | 'youtube-channel'
  | 'youtube-playlist'
  | 'youtube-mix'
  | 'podcast'
  | 'website'
  | 'x-post'
  | 'vimeo'
  | 'odysee'
  | 'bitchute'
  | 'rumble'
  | 'video-hls'
  | 'audio-hls'
  | 'video'
  | 'audio'
  | 'media-file'

export const SOURCE_CHOICES: readonly { value: SourceChoice; label: string }[] = [
  { value: 'auto', label: 'Detect' },
  { value: 'youtube-video', label: 'YouTube video (its channel)' },
  { value: 'youtube-single', label: 'YouTube single video (just this video)' },
  { value: 'youtube-channel', label: 'YouTube channel' },
  { value: 'youtube-playlist', label: 'YouTube playlist' },
  { value: 'youtube-mix', label: 'YouTube Mix (seed video + its channel)' },
  { value: 'podcast', label: 'Podcast / RSS' },
  { value: 'website', label: 'Website' },
  { value: 'x-post', label: 'X / Twitter post' },
  { value: 'vimeo', label: 'Vimeo' },
  { value: 'odysee', label: 'Odysee' },
  { value: 'bitchute', label: 'BitChute' },
  { value: 'rumble', label: 'Rumble' },
  { value: 'video-hls', label: 'HLS live video' },
  { value: 'audio-hls', label: 'HLS live audio' },
  { value: 'video', label: 'Live video stream' },
  { value: 'audio', label: 'Live audio stream' },
  { value: 'media-file', label: 'Direct media file' },
]

const PROVIDER_HOSTS: Partial<Record<SourceChoice, [RegExp, string]>> = {
  vimeo: [/^(?:www\.|player\.)?vimeo\.com$/i, 'Vimeo'],
  odysee: [/^(?:www\.)?odysee\.com$/i, 'Odysee'],
  bitchute: [/^(?:www\.|api\.|old\.)?bitchute\.com$/i, 'BitChute'],
  rumble: [/^(?:www\.)?rumble\.com$/i, 'Rumble'],
}

/** The one video a YouTube address names (watch, youtu.be, shorts, live, embed), or null. */
export function youTubeVideoId(raw: string): string | null {
  let url: URL
  try {
    url = webAddress(raw)
  } catch {
    return null
  }
  if (!YOUTUBE_HOST.test(url.hostname)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  const id = url.hostname.toLowerCase() === 'youtu.be' ? parts[0] : parts[0] === 'watch' ? url.searchParams.get('v') : ['shorts', 'live', 'embed', 'v'].includes(parts[0] ?? '') ? parts[1] : null
  return id && /^[0-9A-Za-z_-]{11}$/.test(id) ? id : null
}

const SINGLE_VIDEO = /^https:\/\/www\.youtube\.com\/watch\?v=([0-9A-Za-z_-]{11})$/

export function singleVideoUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`
}

/** A source holding exactly one YouTube video: never widened to its channel. */
export function singleVideoId(source: Pick<ChannelSource, 'kind' | 'url'>): string | null {
  return source.kind === 'collection' ? (source.url.match(SINGLE_VIDEO)?.[1] ?? null) : null
}

/** What a YouTube address names, as far as the address alone says. */
export function youTubeLinkType(raw: string): 'video' | 'channel' | 'playlist' | 'mix' | null {
  let url: URL
  try {
    url = webAddress(raw)
  } catch {
    return /^@[\w.-]{3,100}$/.test(raw.trim()) || /^UC[0-9A-Za-z_-]{22}$/.test(raw.trim()) ? 'channel' : null
  }
  if (!YOUTUBE_HOST.test(url.hostname)) return null
  const list = url.searchParams.get('list') ?? ''
  if (/^RD[0-9A-Za-z_-]{2,64}$/.test(list)) return 'mix'
  if (/^(?:PL|OL|UU|FL)[0-9A-Za-z_-]{10,64}$/.test(list)) return 'playlist'
  const first = url.pathname.split('/').filter(Boolean)[0] ?? ''
  if (url.hostname.toLowerCase() === 'youtu.be' || ['watch', 'shorts', 'live', 'embed', 'v'].includes(first)) return 'video'
  return 'channel'
}

/** A pasted address as the source kind the chosen type reads it with, or the reason it is not that type. */
export function classifyChoice(raw: string, choice: SourceChoice): { kind: SourceKind; url: string } {
  if (choice === 'auto') return classifySourceUrl(raw)
  if (choice === 'youtube-single') {
    const id = youTubeVideoId(raw)
    if (!id) throw new Error(youTubeLinkType(raw) ? 'That YouTube address does not name one video' : 'That is not a YouTube address')
    return { kind: 'collection', url: singleVideoUrl(id) }
  }
  if (choice.startsWith('youtube-')) {
    const found = classifySourceUrl(raw, 'youtube')
    const named = youTubeLinkType(raw)
    const wanted = choice.slice('youtube-'.length)
    if (named !== wanted) {
      const said = { video: 'a video', channel: 'a channel', playlist: 'a playlist', mix: 'a Mix' }
      throw new Error(named ? `That YouTube address is ${said[named]}, not ${said[wanted as keyof typeof said]}` : 'That is not a YouTube address')
    }
    return found
  }
  if (choice === 'x-post') {
    if (!isXPostUrl(raw)) throw new Error('Paste the address of one public X post (x.com/…/status/…)')
    return classifySourceUrl(raw, 'website')
  }
  if (choice === 'website') return classifySourceUrl(raw, 'website')
  const host = PROVIDER_HOSTS[choice]
  if (host) {
    const url = webAddress(raw)
    if (!host[0].test(url.hostname)) throw new Error(`That is not a ${host[1]} address`)
    return { kind: 'podcast', url: url.toString() }
  }
  if (choice === 'media-file') {
    const url = webAddress(raw)
    if (!VIDEO_FILE.test(url.pathname) && !AUDIO_FILE.test(url.pathname)) throw new Error('That address does not name a media file (.mp4, .mp3 …)')
    return { kind: 'podcast', url: url.toString() }
  }
  return classifySourceUrl(raw, choice as SourceKind)
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

export function newSource(sources: readonly ChannelSource[], raw: string, hint: SourceKind | 'auto' | SourceChoice = 'auto'): ChannelSource {
  const { kind, url } = (SOURCE_CHOICES.some((choice) => choice.value === hint) ? classifyChoice(raw, hint as SourceChoice) : classifySourceUrl(raw, hint as SourceKind))
  if (sources.some((source) => source.url === url)) throw new Error('That source is already on this channel')
  return { id: nextSourceId(sources), kind, url, label: '', enabled: true, status: { state: 'unchecked', checkedAt: 0 } }
}
