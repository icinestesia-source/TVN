import { USER_NUMBER_LIMIT, USER_NUMBER_START } from '../data/network.ts'
import type { StoredSource } from './channels-import.ts'
import { sourcesOf } from './channel-editor.ts'
import { canonicalYouTubeUrl, youTubeSourceType, type ChannelSource, type SourceInfo, type SourceKind } from './channel-sources.ts'
import type { UploaderOf } from './user-network.ts'

/**
 * A portable copy of the viewer's User Network (1001+): which channels exist, on which numbers, made
 * from which sources, with the viewer's names, switches and running orders. It is a description to
 * rebuild from, not a backup of the browser: Channel 000 files, playback state, viewing history and
 * anything secret are never part of it, and nothing is changed by making one.
 */
export const USER_NETWORK_FORMAT = 'tvn-user-network-v1'
export const USER_NETWORK_VERSION = 1
/** An imported list carries its programmes, because nothing else can rebuild it. At most this many per list. */
export const MAX_LIST_VIDEOS = 500

export type ExportSourceType =
  | 'youtube-channel'
  | 'youtube-playlist'
  | 'collection'
  | 'tvn'
  | 'audio'
  | 'audio-hls'
  | 'video'
  | 'video-hls'

export interface ExportVideo {
  id: string
  title: string
  durationSec: number
}

export interface ExportSource {
  sourceType: ExportSourceType
  /** The address to resolve again: a canonical YouTube channel or playlist, or a stream. Empty for an imported list without a known uploader. */
  url: string
  /** YouTube channel or playlist id, or an imported list's name. */
  providerId?: string
  label: string
  enabled: boolean
  info?: SourceInfo
  /** An imported list's YouTube channel, when TVN knows it. */
  uploaderChannelId?: string
  /** An imported list's programmes (id, title, seconds), in list order, at most MAX_LIST_VIDEOS. */
  videos?: ExportVideo[]
  /** Programmes left out of `videos` by the bound. */
  videosOmitted?: number
}

export interface ExportChannel {
  number: number
  name: string
  state: 'populated' | 'empty'
  /** Listed in the Guide and on the air. */
  enabled: boolean
  /** The viewer has edited this channel's sources or name in the Channel Editor. */
  edited: boolean
  /** An imported list's own name, kept under a renamed channel. */
  listName?: string
  /** The viewer's running order (video ids). Absent while TVN arranges the channel itself. */
  runningOrder?: string[]
  sources: ExportSource[]
}

export interface UserNetworkExport {
  format: typeof USER_NETWORK_FORMAT
  version: typeof USER_NETWORK_VERSION
  exportedAt: string
  numbering: { first: number; limit: number }
  channels: ExportChannel[]
}

const SECRET_PARAM = /^(?:key|api[-_]?key|token|access[-_]?token|auth|authorization|secret|signature|sig|password|pass|session|sid)$/i

/** A shareable address: web addresses only, without credentials or secret-looking query parameters. */
export function shareableUrl(raw: string): string {
  if (!raw) return ''
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return ''
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
  url.username = ''
  url.password = ''
  for (const name of [...url.searchParams.keys()]) if (SECRET_PARAM.test(name)) url.searchParams.delete(name)
  return url.toString()
}

function sourceTypeOf(source: ChannelSource): ExportSourceType {
  if (source.kind === 'youtube') return youTubeSourceType(source) === 'playlist' ? 'youtube-playlist' : 'youtube-channel'
  return source.kind
}

function exportSource(source: ChannelSource, uploaderOf: UploaderOf): ExportSource {
  const sourceType = sourceTypeOf(source)
  const base: ExportSource = {
    sourceType,
    url: '',
    ...(source.ref ? { providerId: source.ref } : {}),
    label: source.label,
    enabled: source.enabled,
    ...(source.info ? { info: structuredClone(source.info) } : {}),
  }
  if (source.kind === 'youtube') return { ...base, url: shareableUrl(canonicalYouTubeUrl(source)) }
  if (source.kind === 'collection') {
    const uploader = source.ref ? uploaderOf(source.ref) : null
    const all = source.videos ?? []
    const videos = all.slice(0, MAX_LIST_VIDEOS).map(({ id, title, durationSec }) => ({ id, title, durationSec }))
    return {
      ...base,
      url: uploader ? `https://www.youtube.com/channel/${uploader}` : '',
      ...(uploader ? { uploaderChannelId: uploader } : {}),
      videos,
      ...(all.length > videos.length ? { videosOmitted: all.length - videos.length } : {}),
    }
  }
  if (source.kind === 'tvn') return base
  return { ...base, url: shareableUrl(source.url) }
}

function exportChannel(record: StoredSource, uploaderOf: UploaderOf): ExportChannel {
  const number = record.channelNumber as number
  if (record.emptySlot) return { number, name: record.name, state: 'empty', enabled: true, edited: false, sources: [] }
  return {
    number,
    name: record.name,
    state: 'populated',
    enabled: record.automatic,
    edited: record.channelSources !== undefined,
    ...(record.listName ? { listName: record.listName } : {}),
    ...(record.runningOrder?.length ? { runningOrder: [...record.runningOrder] } : {}),
    sources: sourcesOf(record).map((source) => exportSource(source, uploaderOf)),
  }
}

/** The export document for the stored User Network. Reads only; the records passed in are never changed. */
export function buildUserNetworkExport(stored: readonly StoredSource[], now: Date, uploaderOf: UploaderOf = () => null): UserNetworkExport {
  const channels = stored
    .filter((record) => record.channelNumber !== null && record.channelNumber >= USER_NUMBER_START && record.channelNumber < USER_NUMBER_LIMIT)
    .map((record) => exportChannel(record, uploaderOf))
    .sort((a, b) => a.number - b.number)
  return {
    format: USER_NETWORK_FORMAT,
    version: USER_NETWORK_VERSION,
    exportedAt: now.toISOString(),
    numbering: { first: USER_NUMBER_START, limit: USER_NUMBER_LIMIT },
    channels,
  }
}

/** `TVN_User_Network_YYYY-MM-DD.json`, by the viewer's own calendar. */
export function exportFilename(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `TVN_User_Network_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

export function serialiseUserNetworkExport(document: UserNetworkExport): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

const SOURCE_TYPES: readonly ExportSourceType[] = ['youtube-channel', 'youtube-playlist', 'collection', 'tvn', 'audio', 'audio-hls', 'video', 'video-hls']
const STORED_KINDS: Record<ExportSourceType, SourceKind> = {
  'youtube-channel': 'youtube',
  'youtube-playlist': 'youtube',
  collection: 'collection',
  tvn: 'tvn',
  audio: 'audio',
  'audio-hls': 'audio-hls',
  video: 'video',
  'video-hls': 'video-hls',
}

/** The stored kind an exported source type rebuilds as; for a later IMPORT. */
export function storedKindOf(sourceType: ExportSourceType): SourceKind {
  return STORED_KINDS[sourceType]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Check a file against tvn-user-network-v1 before anything is built from it. Returns every problem
 * found, so a later IMPORT can refuse a file whole rather than half-apply it.
 */
export function validateUserNetworkExport(data: unknown): { ok: true; value: UserNetworkExport } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!isRecord(data)) return { ok: false, errors: ['Not a TVN User Network file'] }
  if (data.format !== USER_NETWORK_FORMAT) errors.push(`Unknown format ${JSON.stringify(data.format)}`)
  if (data.version !== USER_NETWORK_VERSION) errors.push(`Unsupported version ${JSON.stringify(data.version)}`)
  if (typeof data.exportedAt !== 'string' || Number.isNaN(Date.parse(data.exportedAt))) errors.push('exportedAt is not a date')
  if (!Array.isArray(data.channels)) {
    errors.push('channels is not a list')
    return { ok: false, errors }
  }
  const seen = new Set<number>()
  data.channels.forEach((channel, index) => {
    const at = `channels[${index}]`
    if (!isRecord(channel)) {
      errors.push(`${at} is not a channel`)
      return
    }
    const number = channel.number
    if (typeof number !== 'number' || !Number.isInteger(number) || number < USER_NUMBER_START || number >= USER_NUMBER_LIMIT) errors.push(`${at}.number is not a User Network number`)
    else if (seen.has(number)) errors.push(`${at}.number ${number} appears twice`)
    else seen.add(number)
    if (typeof channel.name !== 'string' || !channel.name.trim()) errors.push(`${at}.name is missing`)
    if (channel.state !== 'populated' && channel.state !== 'empty') errors.push(`${at}.state must be populated or empty`)
    if (typeof channel.enabled !== 'boolean') errors.push(`${at}.enabled is not true or false`)
    if (channel.runningOrder !== undefined && (!Array.isArray(channel.runningOrder) || channel.runningOrder.some((id) => typeof id !== 'string')))
      errors.push(`${at}.runningOrder is not a list of video ids`)
    if (!Array.isArray(channel.sources)) {
      errors.push(`${at}.sources is not a list`)
      return
    }
    if (channel.state === 'empty' && channel.sources.length > 0) errors.push(`${at} is empty but has sources`)
    channel.sources.forEach((source, sourceIndex) => {
      const where = `${at}.sources[${sourceIndex}]`
      if (!isRecord(source)) {
        errors.push(`${where} is not a source`)
        return
      }
      if (!SOURCE_TYPES.includes(source.sourceType as ExportSourceType)) errors.push(`${where}.sourceType is unknown`)
      if (typeof source.url !== 'string' || (source.url !== '' && shareableUrl(source.url) === '')) errors.push(`${where}.url is not a web address`)
      if (typeof source.enabled !== 'boolean') errors.push(`${where}.enabled is not true or false`)
      if (typeof source.label !== 'string') errors.push(`${where}.label is missing`)
      if ((source.sourceType === 'youtube-channel' || source.sourceType === 'youtube-playlist') && !source.url) errors.push(`${where} has no YouTube address`)
      if (source.videos !== undefined) {
        const ok =
          Array.isArray(source.videos) &&
          source.videos.length <= MAX_LIST_VIDEOS &&
          source.videos.every((video) => isRecord(video) && typeof video.id === 'string' && typeof video.title === 'string' && typeof video.durationSec === 'number')
        if (!ok) errors.push(`${where}.videos is not a bounded list of programmes`)
      }
    })
  })
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: data as unknown as UserNetworkExport }
}

/** Hand the file to the browser as a download; the temporary address is released straight after. */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
