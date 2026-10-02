import { USER_NUMBER_LIMIT, USER_NUMBER_START } from '../data/network.ts'
import type { StoredSource } from './channels-import.ts'
import {
  cleanArtwork,
  cleanEditorial,
  cleanFilter,
  CURATION_STATUSES,
  EDITORIAL_TEXT_FIELDS,
  RELATED_NUMBER_MAX,
  SOURCE_MODES, sourceModeOf, type ChannelEditorial, type SourceFilter, type SourceMode } from './channel-curation.ts'
import { sourcesOf } from './channel-editor.ts'
import { canonicalYouTubeUrl, youTubeSourceType, type ChannelSource, type SourceInfo, type SourceKind } from './channel-sources.ts'
import type { UploaderOf } from './user-network.ts'
import { checkUserName, ownerOf, TVN_OWNER, USER_ID } from '../data/user-network/users.ts'

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
  published?: string
  year?: number
  lists?: string[]
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
  /** Include and exclude rules (src/services/channel-curation.ts). Absent in older files: everything is eligible. */
  filter?: SourceFilter
  /** ARCHIVE or ALL. Absent in older files: recent. */
  mode?: SourceMode
}

export interface ExportChannel {
  number: number
  /** TVN_OWNER, or the id of a named user in `users`. Absent in files from before named users. */
  owner?: string
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
  /** The viewer's editorial notes: intent only, never what plays. Absent in older files. */
  editorial?: ChannelEditorial
  sources: ExportSource[]
}

/** A named user, by the stable id its channels name as `owner`. TVN is built in and never listed here. */
export interface ExportUser {
  id: string
  name: string
}

/**
 * Named users are an addition to tvn-user-network-v1, not a new format: a file with `users` gives every channel
 * an `owner` (TVN_OWNER or one of those ids); a file without them, from before named users, is all TVN's.
 */
export interface UserNetworkExport {
  format: typeof USER_NETWORK_FORMAT
  version: typeof USER_NETWORK_VERSION
  exportedAt: string
  numbering: { first: number; limit: number }
  users?: ExportUser[]
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

function exportVideo({ id, title, durationSec, published, year, lists }: ExportVideo): ExportVideo {
  return { id, title, durationSec, ...(published ? { published } : {}), ...(year ? { year } : {}), ...(lists?.length ? { lists: [...lists] } : {}) }
}

export function exportSource(source: ChannelSource, uploaderOf: UploaderOf): ExportSource {
  const sourceType = sourceTypeOf(source)
  const scheduled = source.kind === 'youtube' || source.kind === 'collection'
  const filter = scheduled ? cleanFilter(source.filter) : undefined
  const mode = scheduled ? sourceModeOf(source) : 'recent'
  const base: ExportSource = {
    sourceType,
    url: '',
    ...(source.ref ? { providerId: source.ref } : {}),
    label: source.label,
    enabled: source.enabled,
    ...(source.info ? { info: structuredClone(source.info) } : {}),
    ...(filter ? { filter } : {}),
    ...(mode !== 'recent' ? { mode } : {}),
  }
  if (source.kind === 'youtube') return { ...base, url: shareableUrl(canonicalYouTubeUrl(source)) }
  if (source.kind === 'collection') {
    const uploader = source.ref ? uploaderOf(source.ref) : null
    const all = source.videos ?? []
    const videos = all.slice(0, MAX_LIST_VIDEOS).map(exportVideo)
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

export function exportChannel(record: StoredSource, uploaderOf: UploaderOf, users: readonly ExportUser[]): ExportChannel {
  const number = record.channelNumber as number
  const owner = ownerOf(record.owner, users)
  const editorial = cleanEditorial(record.editorial)
  const notes = editorial ? { editorial } : {}
  if (record.emptySlot) return { number, owner, name: record.name, state: 'empty', enabled: true, edited: false, ...notes, sources: [] }
  return {
    number,
    owner,
    name: record.name,
    state: 'populated',
    enabled: record.automatic,
    edited: record.channelSources !== undefined,
    ...(record.listName ? { listName: record.listName } : {}),
    ...(record.runningOrder?.length ? { runningOrder: [...record.runningOrder] } : {}),
    ...notes,
    sources: sourcesOf(record).map((source) => exportSource(source, uploaderOf)),
  }
}

/**
 * The export document for the stored User Network and its named users. Reads only; the records passed in are
 * never changed. A channel whose owner is not among `users` is exported as TVN's, so the file never names an
 * owner it does not list.
 */
export function buildUserNetworkExport(
  stored: readonly StoredSource[],
  now: Date,
  uploaderOf: UploaderOf = () => null,
  users: readonly ExportUser[] = [],
): UserNetworkExport {
  const listed = users.map(({ id, name }) => ({ id, name }))
  const channels = stored
    .filter((record) => record.channelNumber !== null && record.channelNumber >= USER_NUMBER_START && record.channelNumber < USER_NUMBER_LIMIT)
    .map((record) => exportChannel(record, uploaderOf, listed))
    .sort((a, b) => a.number - b.number)
  return {
    format: USER_NETWORK_FORMAT,
    version: USER_NETWORK_VERSION,
    exportedAt: now.toISOString(),
    numbering: { first: USER_NUMBER_START, limit: USER_NUMBER_LIMIT },
    users: listed,
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

const SECRET_FIELD = /^(?:api[-_]?key|key|keys|token|access[-_]?token|refresh[-_]?token|id[-_]?token|secret|client[-_]?secret|password|passwd|authorization|auth|cookie|credentials?)$/i
const SECRET_VALUE = /AIza[0-9A-Za-z_-]{30,}|\bya29\.[0-9A-Za-z_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/

/** Every place in a document that names or holds something secret; such a file is refused, never cleaned up. */
export function secretsIn(value: unknown, at: string, found: string[]): void {
  if (found.length >= 5) return
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) found.push(`${at} holds a key`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => secretsIn(item, `${at}[${index}]`, found))
    return
  }
  if (!isRecord(value)) return
  for (const [name, item] of Object.entries(value)) {
    if (SECRET_FIELD.test(name)) found.push(`${at}.${name} is a secret field`)
    else secretsIn(item, `${at}.${name}`, found)
  }
}

/** An address that carries credentials or a secret-looking query parameter. */
export function carriesSecret(raw: string): boolean {
  try {
    const url = new URL(raw)
    return Boolean(url.username || url.password) || [...url.searchParams.keys()].some((name) => SECRET_PARAM.test(name))
  } catch {
    return false
  }
}

const isText = (value: unknown) => typeof value === 'string'

/** A channel's editorial notes: every field optional, each of its own plain type. */
export function checkEditorial(value: unknown, at: string, errors: string[]): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    errors.push(`${at} is not a set of notes`)
    return
  }
  for (const [name, item] of Object.entries(value)) {
    if ((EDITORIAL_TEXT_FIELDS as readonly string[]).includes(name)) {
      if (!isText(item)) errors.push(`${at}.${name} is not text`)
    } else if (name === 'tags') {
      if (!Array.isArray(item) || !item.every(isText)) errors.push(`${at}.tags is not a list of words`)
    } else if (name === 'targetHours' || name === 'targetProgrammes') {
      if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) errors.push(`${at}.${name} is not a number`)
    } else if (name === 'status') {
      if (!(CURATION_STATUSES as readonly unknown[]).includes(item)) errors.push(`${at}.status must be ${CURATION_STATUSES.join(', ')}`)
    } else if (name === 'related') {
      const ok = Array.isArray(item) && item.every((number) => typeof number === 'number' && Number.isInteger(number) && number >= 1 && number <= RELATED_NUMBER_MAX)
      if (!ok) errors.push(`${at}.related is not a list of channel numbers`)
    } else if (name === 'artwork') {
      if (cleanArtwork(item) === undefined) errors.push(`${at}.artwork is not an https address`)
    } else errors.push(`${at}.${name} is not an editorial field`)
  }
}

/** A source filter: plain include and exclude rules; anything TVN would not keep refuses the file. */
function checkFilter(value: unknown, at: string, errors: string[]): void {
  if (value === undefined) return
  if (!isRecord(value) || Object.keys(value).some((name) => name !== 'include' && name !== 'exclude')) {
    errors.push(`${at} is not a filter`)
    return
  }
  const lists = (rules: unknown, names: readonly string[], where: string) => {
    if (rules === undefined) return
    if (!isRecord(rules)) {
      errors.push(`${where} is not a set of rules`)
      return
    }
    for (const [name, item] of Object.entries(rules)) {
      if (name === 'terms' || name === 'playlists') {
        if (!names.includes(name) || !Array.isArray(item) || !item.every(isText)) errors.push(`${where}.${name} is not a list of words`)
      } else if (name === 'minSeconds' || name === 'maxSeconds' || name === 'yearFrom' || name === 'yearTo') {
        if (!names.includes(name) || typeof item !== 'number' || !Number.isFinite(item)) errors.push(`${where}.${name} is not a number`)
      } else if (name === 'unknownYear') {
        if (!names.includes(name) || (item !== 'keep' && item !== 'drop')) errors.push(`${where}.unknownYear must be keep or drop`)
      } else if (name === 'shorts') {
        if (!names.includes(name) || typeof item !== 'boolean') errors.push(`${where}.shorts is not true or false`)
      } else errors.push(`${where}.${name} is not a filter rule`)
    }
  }
  lists(value.include, ['terms', 'playlists', 'minSeconds', 'maxSeconds', 'yearFrom', 'yearTo', 'unknownYear'], `${at}.include`)
  lists(value.exclude, ['terms', 'shorts'], `${at}.exclude`)
}

/**
 * One channel of a tvn-user-network-v1 or tvn-channel-v1 file: its number, name, state, running order,
 * editorial notes and sources. Owners and duplicate numbers are the containing file's to check.
 */
export function checkChannel(channel: unknown, at: string, errors: string[]): void {
  if (!isRecord(channel)) {
    errors.push(`${at} is not a channel`)
    return
  }
  const number = channel.number
  if (typeof number !== 'number' || !Number.isInteger(number) || number < USER_NUMBER_START || number >= USER_NUMBER_LIMIT) errors.push(`${at}.number is not a User Network number`)
  if (typeof channel.name !== 'string' || !channel.name.trim()) errors.push(`${at}.name is missing`)
  if (channel.state !== 'populated' && channel.state !== 'empty') errors.push(`${at}.state must be populated or empty`)
  if (typeof channel.enabled !== 'boolean') errors.push(`${at}.enabled is not true or false`)
  if (channel.runningOrder !== undefined && (!Array.isArray(channel.runningOrder) || channel.runningOrder.some((id) => typeof id !== 'string')))
    errors.push(`${at}.runningOrder is not a list of video ids`)
  checkEditorial(channel.editorial, `${at}.editorial`, errors)
  if (!Array.isArray(channel.sources)) {
    errors.push(`${at}.sources is not a list`)
    return
  }
  if (channel.state === 'empty' && channel.sources.length > 0) errors.push(`${at} is empty but has sources`)
  checkSources(channel.sources, at, errors)
}

/** Each exported source: a known type, a shareable address, plain rules. */
export function checkSources(sources: readonly unknown[], at: string, errors: string[]): void {
  sources.forEach((source, sourceIndex) => {
    const where = `${at}.sources[${sourceIndex}]`
    if (!isRecord(source)) {
      errors.push(`${where} is not a source`)
      return
    }
    if (!SOURCE_TYPES.includes(source.sourceType as ExportSourceType)) errors.push(`${where}.sourceType is unknown`)
    if (typeof source.url !== 'string' || (source.url !== '' && shareableUrl(source.url) === '')) errors.push(`${where}.url is not a web address`)
    else if (carriesSecret(source.url)) errors.push(`${where}.url carries a secret`)
    if (source.providerId !== undefined && typeof source.providerId !== 'string') errors.push(`${where}.providerId is not text`)
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
    checkFilter(source.filter, `${where}.filter`, errors)
    if (source.mode !== undefined && !SOURCE_MODES.includes(source.mode as SourceMode)) errors.push(`${where}.mode must be recent, archive or all`)
  })
}

/**
 * Check a file against tvn-user-network-v1 before anything is built from it. Returns every problem
 * found, so IMPORT refuses a file whole rather than half-apply it. Users and owners are checked with the
 * channels: a duplicate or malformed user, a user claiming TVN, or a channel naming an owner the file does
 * not list refuses the whole file.
 */
export function validateUserNetworkExport(data: unknown): { ok: true; value: UserNetworkExport } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!isRecord(data)) return { ok: false, errors: ['Not a TVN User Network file'] }
  secretsIn(data, 'file', errors)
  if (data.format !== USER_NETWORK_FORMAT) errors.push(`Unknown format ${JSON.stringify(data.format)}`)
  if (data.version !== USER_NETWORK_VERSION) errors.push(`Unsupported version ${JSON.stringify(data.version)}`)
  if (typeof data.exportedAt !== 'string' || Number.isNaN(Date.parse(data.exportedAt))) errors.push('exportedAt is not a date')
  if (!Array.isArray(data.channels)) {
    errors.push('channels is not a list')
    return { ok: false, errors }
  }
  const userIds = new Set<string>()
  const hasUsers = data.users !== undefined
  if (hasUsers && !Array.isArray(data.users)) errors.push('users is not a list')
  else if (hasUsers) {
    const named: ExportUser[] = []
    ;(data.users as unknown[]).forEach((user, index) => {
      const at = `users[${index}]`
      if (!isRecord(user) || typeof user.id !== 'string' || typeof user.name !== 'string') {
        errors.push(`${at} is not a user`)
        return
      }
      if (user.id === TVN_OWNER) errors.push(`${at} claims TVN, which is built in`)
      else if (!USER_ID.test(user.id)) errors.push(`${at}.id is not a user id`)
      else if (userIds.has(user.id)) errors.push(`${at}.id ${user.id} appears twice`)
      const checked = checkUserName(user.name, named)
      if (!checked.ok) errors.push(`${at}.name: ${checked.error}`)
      userIds.add(user.id)
      named.push({ id: user.id, name: user.name })
    })
  }
  const seen = new Set<number>()
  data.channels.forEach((channel, index) => {
    const at = `channels[${index}]`
    checkChannel(channel, at, errors)
    if (!isRecord(channel)) return
    const number = channel.number
    if (typeof number === 'number' && Number.isInteger(number) && number >= USER_NUMBER_START && number < USER_NUMBER_LIMIT) {
      if (seen.has(number)) errors.push(`${at}.number ${number} appears twice`)
      else seen.add(number)
    }
    if (channel.owner === undefined) {
      if (hasUsers) errors.push(`${at}.owner is missing`)
    } else if (typeof channel.owner !== 'string' || (channel.owner !== TVN_OWNER && !userIds.has(channel.owner))) {
      errors.push(`${at}.owner is not TVN or a listed user`)
    }
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
