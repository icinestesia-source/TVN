import { DEMO_FILMS } from '../data/media.ts'
import { USER_NUMBER_START } from '../data/network.ts'
import type { MediaItem } from '../director/types.ts'
import { liveCams, liveEndpoint } from '../dynamic/providers.ts'
import { SOURCE_TYPES, type ChannelSource } from '../services/channel-sources.ts'
import type { StoredSource } from '../services/channels-import.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'

/**
 * One provenance path for everything TVN plays: TVN channel → programme → source → creator → originating
 * service → original identifier and address. Every field comes from a record TVN already keeps (the
 * catalogue, the generated source register, the live-provider config, the viewer's own User Network);
 * a link is only offered when such a record names it, and nothing is ever inferred from a title or name.
 */

/** public/independent/sources.json, written by scripts/source_register.py. */
export interface RegisterEntry {
  name: string
  provider: 'YouTube'
  /** The publisher's YouTube channel, as acquisition recorded it. */
  channelUrl?: string
  /** The publisher's own official address, as the source manifest recorded it. */
  website?: string
}

export interface SourceRegister {
  format: 'tvn-source-register-v1'
  catalogueGeneratedAt?: number
  sources: Record<string, RegisterEntry>
}

export const REGISTER_PATH = '/independent/sources.json'

export const EMPTY_REGISTER: SourceRegister = { format: 'tvn-source-register-v1', sources: {} }

export function readRegister(raw: unknown): SourceRegister {
  const doc = raw as Partial<SourceRegister> | null
  if (!doc || doc.format !== 'tvn-source-register-v1' || !doc.sources || typeof doc.sources !== 'object') return EMPTY_REGISTER
  return { format: doc.format, catalogueGeneratedAt: doc.catalogueGeneratedAt, sources: doc.sources }
}

export type CreditKind = 'catalogue' | 'live' | 'cam' | 'demo' | 'user' | 'stream' | 'session' | 'tvn'

export interface Credit {
  kind: CreditKind
  title: string
  /** The creator, uploader or publisher, exactly as recorded; null when no record names one. */
  creator: string | null
  /** The service the programme is delivered from. */
  provider: string
  /** The programme itself at its originating service. */
  originalUrl?: string
  /** The creator's channel or page at that service. */
  sourceUrl?: string
  website?: string
  /** Only when a record states the terms. */
  licence?: string
  /** Original identifier at the originating service. */
  originalId?: string
  note?: string
}

export const LOCAL_SESSION_NOTE = 'Media selected locally by the viewer. Not uploaded to TVN.'
export const TVN_CARD_NOTE = 'A TVN presentation card. No third-party programme is playing.'

const VIDEO_ID = /^[\w-]{11}$/
const CHANNEL_ID = /^UC[\w-]{22}$/

export function watchUrl(videoId: string | null | undefined): string | undefined {
  return videoId && VIDEO_ID.test(videoId) ? `https://www.youtube.com/watch?v=${videoId}` : undefined
}

/** A YouTube channel's page from its channel id or @handle; anything else has no address. */
export function youtubeChannelUrl(ref: string | null | undefined): string | undefined {
  if (!ref) return undefined
  const id = ref.startsWith('yt:') ? ref.slice(3) : ref
  if (CHANNEL_ID.test(id)) return `https://www.youtube.com/channel/${id}`
  if (/^@[\w.-]{3,}$/.test(id)) return `https://www.youtube.com/${id}`
  return undefined
}

/** A web address the viewer or a record supplied, kept only if it really is one. */
export function webUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '')
  } catch {
    return raw
  }
}

const indexes = new WeakMap<readonly MediaItem[], Map<string, MediaItem>>()

/** The catalogue record behind a YouTube video id; built once per library and only when asked. */
export function libraryItem(library: readonly MediaItem[], videoId: string): MediaItem | undefined {
  let index = indexes.get(library)
  if (!index) {
    index = new Map()
    for (const item of library) if (item.provider === 'youtube' && item.externalId && !index.has(item.externalId)) index.set(item.externalId, item)
    indexes.set(library, index)
  }
  return index.get(videoId)
}

export function sourceIdOf(item: MediaItem | undefined): string | undefined {
  return (item as { sourceId?: string } | undefined)?.sourceId
}

/** Demonstration films carry their own recorded credit, "Creator, Licence". */
function demoFilm(videoId: string): { title: string; creator: string; licence?: string } | null {
  const film = DEMO_FILMS.find((entry) => entry.videoId === videoId)
  if (!film) return null
  const at = film.credit.lastIndexOf(',')
  return at > 0 ? { title: film.title, creator: film.credit.slice(0, at).trim(), licence: film.credit.slice(at + 1).trim() } : { title: film.title, creator: film.credit }
}

export interface ProvenanceContext {
  library: readonly MediaItem[]
  register: SourceRegister
  /** The viewer's own User Network, read from this browser. */
  stored?: readonly StoredSource[]
  /** The viewer's own changes to TVN channels, read from this browser, by channel number. */
  curated?: Readonly<Record<string, { sources: readonly ChannelSource[] }>>
}

function fromRegister(sourceId: string | undefined, register: SourceRegister) {
  const entry = sourceId ? register.sources[sourceId] : undefined
  return entry ? { creator: entry.name, sourceUrl: webUrl(entry.channelUrl), website: webUrl(entry.website) } : null
}

/** The user-channel source a video came from: the scanned source holding it, else the channel's own origin. */
function userSourceFor(record: StoredSource | undefined, videoId: string): { creator: string; sourceUrl?: string } | null {
  if (!record) return null
  const holder = record.channelSources?.find((source) => source.videos?.some((video) => video.id === videoId))
  const by = holder?.videos?.find((video) => video.id === videoId)?.creator
  if (by) return { creator: by.name, sourceUrl: youtubeChannelUrl(by.handle ? `@${by.handle}` : by.channelId) }
  if (holder) return { creator: holder.label || record.name, sourceUrl: channelSourceUrl(holder) }
  return { creator: record.name, sourceUrl: youtubeChannelUrl(record.id) }
}

/** Where a channel source lives: a YouTube channel from its resolved id, else the address the viewer gave. */
export function channelSourceUrl(source: ChannelSource): string | undefined {
  if (source.kind === 'tvn' || source.kind === 'collection') return undefined
  if (source.kind === 'youtube') return youtubeChannelUrl(source.ref) ?? webUrl(source.url)
  return webUrl(source.url)
}

export function channelLabel(channel: Pick<Channel, 'number' | 'name'>): string {
  return `${String(channel.number).padStart(3, '0')} ${channel.name}`
}

/** What is on screen now, attributed from records only. */
export function creditFor(channel: Channel, programme: Programme, context: ProvenanceContext): Credit {
  const title = programme.title
  if (channel.origin === 'session') return { kind: 'session', title, creator: null, provider: 'Local file on this device', note: LOCAL_SESSION_NOTE }
  if (programme.liveStream) {
    const url = webUrl(programme.liveStream.url)
    return {
      kind: 'stream',
      title,
      creator: programme.creator ?? null,
      provider: `Direct stream · ${url ? hostOf(url) : 'unknown host'}`,
      originalUrl: url,
      note: channel.number >= USER_NUMBER_START ? 'A stream address added to your own User Network.' : undefined,
    }
  }
  const videoId = programme.videoId
  if (!videoId) return { kind: 'tvn', title, creator: null, provider: 'TVN', note: TVN_CARD_NOTE }
  const base = { title, provider: 'YouTube', originalUrl: watchUrl(videoId), originalId: videoId }

  if (channel.number >= USER_NUMBER_START) {
    const record = context.stored?.find((item) => item.channelNumber === channel.number)
    const found = userSourceFor(record, videoId)
    return { ...base, kind: 'user', creator: found?.creator ?? null, sourceUrl: found?.sourceUrl, note: 'From your own User Network.' }
  }
  if (channel.customLineup) {
    const holder = context.curated?.[String(channel.number)]?.sources.find((source) => source.videos?.some((video) => video.id === videoId))
    if (holder) return { ...base, kind: 'user', creator: holder.label || null, sourceUrl: channelSourceUrl(holder), note: 'A source you added to this TVN channel.' }
  }
  const cam = liveCams(channel.number).find((item) => item.videoId === videoId)
  if (cam) return { ...base, kind: 'cam', creator: cam.publisher ?? null, sourceUrl: youtubeChannelUrl(cam.sourceId) }
  const live = liveEndpoint(channel.number)
  if (live?.videoId === videoId) {
    const recorded = fromRegister(live.sourceId, context.register)
    return { ...base, kind: 'live', creator: recorded?.creator ?? live.publisher ?? null, sourceUrl: recorded?.sourceUrl, website: recorded?.website }
  }
  const demo = demoFilm(videoId)
  if (demo) return { ...base, kind: 'demo', creator: demo.creator, licence: demo.licence, note: 'A demonstration picture standing in for the scheduled programme.' }
  const recorded = fromRegister(sourceIdOf(libraryItem(context.library, videoId)), context.register)
  return { ...base, kind: 'catalogue', creator: recorded?.creator ?? programme.creator ?? null, sourceUrl: recorded?.sourceUrl, website: recorded?.website }
}

export function sourceTypeLabel(source: Pick<ChannelSource, 'kind'>): string {
  return SOURCE_TYPES[source.kind].label
}
