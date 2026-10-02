import { USER_NUMBER_LIMIT, USER_NUMBER_START } from '../data/network.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme, ProgrammeType } from '../types/programme.ts'
import { inOrder, inventoryOf, liveStreamOf, refreshOrigin, type ChannelSource } from './channel-sources.ts'
import type { ArchiveLookup } from './user-archive.ts'
import { planArchive, runningOrder } from './user-depth.ts'

export interface ImportedVideo {
  id: string
  title: string
  durationSec: number
  watched?: boolean
}

export interface ImportedSource {
  id: string
  name: string
  videos: ImportedVideo[]
}

export interface ParsedExport {
  version: string
  sources: ImportedSource[]
  videoCount: number
  totalSeconds: number
  watchedCount: number
  warnings: string[]
}

export interface StoredSource {
  id: string
  name: string
  /** The channel's scheduled inventory; with `channelSources`, the enabled sources' programmes. */
  videos: ImportedVideo[]
  channelNumber: number | null
  inLibrary: boolean
  automatic: boolean
  updatedAt: number
  /** Present once the channel has been edited: what it is made from, including disabled sources. */
  channelSources?: ChannelSource[]
  /** The imported list's own name, kept when the viewer renames the channel. */
  listName?: string
  /** The viewer's own running order (video ids); without it TVN arranges the channel itself. */
  runningOrder?: string[]
  /** How an added channel was named: one YouTube channel's uploads, or one playlist and nothing else. */
  sourceType?: 'youtube-channel' | 'youtube-playlist'
  /** A cleared user channel: the number is kept, nothing airs, and the next added channel fills it. */
  emptySlot?: true
  /** The named user whose tab lists the channel (src/data/user-network/users.ts); none means TVN's. */
  owner?: string
}

export const EMPTY_SLOT_PREFIX = 'slot:'
export const EMPTY_SLOT_NAME = 'Empty channel'

/** The record a cleared user channel leaves behind: same number, no sources, ready to be filled again. */
export function emptySlotRecord(channelNumber: number, now: number): StoredSource {
  return {
    id: `${EMPTY_SLOT_PREFIX}${channelNumber}`,
    name: EMPTY_SLOT_NAME,
    videos: [],
    channelNumber,
    inLibrary: false,
    automatic: true,
    updatedAt: now,
    channelSources: [],
    emptySlot: true,
  }
}

/** The lowest empty slot, which a new channel takes before any higher number. */
export function firstEmptySlot(sources: readonly StoredSource[]): StoredSource | undefined {
  return sources
    .filter((source) => source.emptySlot && source.channelNumber !== null)
    .sort((a, b) => (a.channelNumber ?? 0) - (b.channelNumber ?? 0))[0]
}

export interface ImportMode {
  library: boolean
  automatic: boolean
}

export interface ImportPlan {
  sources: StoredSource[]
  created: number
  updated: number
  libraryVideos: number
  automaticChannels: number
  unassigned: number
}

const PALETTE = ['#1d4e89', '#0f5f5a', '#6b3f1d', '#3d4c1e', '#5c2d4a', '#1e3d6e', '#7a2e2e', '#2c4a3e']

export function parseChannelsExport(text: string): ParsedExport {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON')
  }
  if (!data || typeof data !== 'object') throw new Error('The file has no channel list')
  const record = data as { v?: unknown; channels?: unknown }
  if (!Array.isArray(record.channels)) throw new Error('The file has no channel list')

  const warnings: string[] = []
  const seenIds = new Map<string, number>()
  const sources: ImportedSource[] = []
  let videoCount = 0
  let totalSeconds = 0
  let watchedCount = 0

  for (const entry of record.channels) {
    if (!entry || typeof entry !== 'object') {
      warnings.push('Skipped a channel that was not an object')
      continue
    }
    const raw = entry as { name?: unknown; videos?: unknown }
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!name) {
      warnings.push('Skipped a channel with no name')
      continue
    }
    if (!Array.isArray(raw.videos)) {
      warnings.push(`Skipped ${name}: no video list`)
      continue
    }

    const videos: ImportedVideo[] = []
    const seenVideos = new Set<string>()
    for (const item of raw.videos) {
      if (!item || typeof item !== 'object') continue
      const video = item as { id?: unknown; title?: unknown; durationSec?: unknown; watched?: unknown }
      const id = typeof video.id === 'string' ? video.id.trim() : ''
      const title = typeof video.title === 'string' ? video.title.trim() : ''
      const durationSec = typeof video.durationSec === 'number' ? video.durationSec : Number.NaN
      if (!id || !title || !Number.isFinite(durationSec) || durationSec <= 0) {
        warnings.push(`Skipped a video on ${name}`)
        continue
      }
      if (seenVideos.has(id)) continue
      seenVideos.add(id)
      videos.push({
        id,
        title,
        durationSec: Math.round(durationSec),
        watched: video.watched === true ? true : undefined,
      })
      videoCount += 1
      totalSeconds += Math.round(durationSec)
      if (video.watched === true) watchedCount += 1
    }

    if (videos.length === 0) {
      warnings.push(`Skipped ${name}: no playable videos`)
      continue
    }
    sources.push({ id: sourceIdFor(name, seenIds), name, videos })
  }

  if (sources.length === 0) throw new Error('No channels could be read from that file')

  return {
    version: typeof record.v === 'string' ? record.v : '',
    sources,
    videoCount,
    totalSeconds,
    watchedCount,
    warnings,
  }
}

export function sourceIdFor(name: string, seen: Map<string, number>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'channel'
  const count = seen.get(base) ?? 0
  seen.set(base, count + 1)
  return count === 0 ? `src:${base}` : `src:${base}-${count + 1}`
}

export function allocateUserNumber(taken: Set<number>): number | null {
  for (let number = USER_NUMBER_START; number < USER_NUMBER_LIMIT; number += 1) {
    if (!taken.has(number)) return number
  }
  return null
}

/**
 * Stage 2 stored automatic channels in 701–899. Those numbers now belong
 * to the default network, so move any assigned number below 1001 upward
 * without dropping the source record or its videos.
 */
export function migrateLegacyUserNumbers(existing: readonly StoredSource[]): {
  sources: StoredSource[]
  migrated: number
} {
  const taken = new Set<number>()
  for (const source of existing) {
    if (source.channelNumber !== null && source.channelNumber >= USER_NUMBER_START) {
      taken.add(source.channelNumber)
    }
  }
  const ordered = existing
    .filter((source) => source.channelNumber !== null && source.channelNumber < USER_NUMBER_START)
    .sort((left, right) => (left.channelNumber ?? 0) - (right.channelNumber ?? 0))
  const renumber = new Map<string, number>()
  for (const source of ordered) {
    const number = allocateUserNumber(taken)
    if (number === null) continue
    taken.add(number)
    renumber.set(source.id, number)
  }
  if (renumber.size === 0) {
    return { sources: existing.map((source) => ({ ...source, videos: source.videos.slice() })), migrated: 0 }
  }
  return {
    migrated: renumber.size,
    sources: existing.map((source) => {
      const number = renumber.get(source.id)
      const copy = { ...source, videos: source.videos.slice() }
      if (number === undefined) return copy
      return { ...copy, channelNumber: number, automatic: source.automatic || source.channelNumber !== null }
    }),
  }
}

export function libraryVideos(sources: readonly StoredSource[]): ImportedVideo[] {
  const seen = new Set<string>()
  const videos: ImportedVideo[] = []
  for (const source of sources) {
    if (!source.inLibrary) continue
    for (const video of source.videos) {
      if (seen.has(video.id)) continue
      seen.add(video.id)
      videos.push(video)
    }
  }
  return videos
}

/**
 * Union of two or more parsed catalogues.
 * The same collection name stays one source. Video ids inside that source stay one record.
 * A video that also belongs to a different collection keeps that second membership.
 */
export function mergeParsedExports(parts: readonly ParsedExport[]): ParsedExport {
  const byName = new Map<string, ImportedSource>()
  const warnings: string[] = []
  for (const part of parts) {
    warnings.push(...part.warnings)
    for (const source of part.sources) {
      const current = byName.get(source.name)
      if (!current) {
        byName.set(source.name, {
          id: source.id,
          name: source.name,
          videos: source.videos.map((video) => ({ ...video })),
        })
        continue
      }
      const seen = new Map(current.videos.map((video) => [video.id, video]))
      for (const video of source.videos) {
        const existing = seen.get(video.id)
        if (existing) {
          if (video.watched) existing.watched = true
          if (video.durationSec > existing.durationSec) existing.durationSec = video.durationSec
          continue
        }
        const copy = { ...video }
        current.videos.push(copy)
        seen.set(video.id, copy)
      }
    }
  }
  const sources = [...byName.values()]
  let videoCount = 0
  let totalSeconds = 0
  let watchedCount = 0
  const seenIds = new Set<string>()
  for (const source of sources) {
    for (const video of source.videos) {
      videoCount += 1
      if (seenIds.has(video.id)) continue
      seenIds.add(video.id)
      totalSeconds += video.durationSec
      if (video.watched) watchedCount += 1
    }
  }
  return {
    version: parts.find((part) => part.version)?.version ?? '2.4',
    sources,
    videoCount,
    totalSeconds,
    watchedCount,
    warnings,
  }
}

/**
 * Merge a parsed export into the stored user catalogue.
 * The same source id updates in place and keeps its channel number.
 */
export function planImport(
  existing: readonly StoredSource[],
  parsed: ParsedExport,
  mode: ImportMode,
  reservedNumbers: readonly number[],
  nowMs: number,
): ImportPlan {
  const migrated = migrateLegacyUserNumbers(existing)
  const byId = new Map(migrated.sources.map((source) => [source.id, { ...source, videos: source.videos.slice() }]))
  const taken = new Set<number>(reservedNumbers)
  for (const source of byId.values()) {
    if (source.channelNumber !== null) taken.add(source.channelNumber)
  }

  let created = 0
  let updated = 0
  let unassigned = 0
  // A cleared channel's number is filled before a new one is opened; the slot record gives way to the channel.
  const claim = (): number | null => {
    const slot = firstEmptySlot([...byId.values()])
    if (slot) {
      byId.delete(slot.id)
      return slot.channelNumber
    }
    const number = allocateUserNumber(taken)
    if (number !== null) taken.add(number)
    return number
  }

  for (const incoming of parsed.sources) {
    const current = byId.get(incoming.id)
    if (current) {
      // A channel the viewer has renamed keeps its name; its list's programmes are refreshed.
      if (!current.listName) current.name = incoming.name
      Object.assign(current, refreshOrigin(current, { kind: 'collection' }, incoming.videos, nowMs))
      current.updatedAt = nowMs
      if (mode.library) current.inLibrary = true
      if (mode.automatic) {
        current.automatic = true
        if (current.channelNumber === null) {
          const number = claim()
          if (number === null) unassigned += 1
          else current.channelNumber = number
        }
      }
      updated += 1
      continue
    }

    let channelNumber: number | null = null
    if (mode.automatic) {
      channelNumber = claim()
      if (channelNumber === null) unassigned += 1
    }
    byId.set(incoming.id, {
      id: incoming.id,
      name: incoming.name,
      videos: incoming.videos,
      channelNumber,
      inLibrary: mode.library,
      automatic: mode.automatic && channelNumber !== null,
      updatedAt: nowMs,
    })
    created += 1
  }

  const sources = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  return {
    sources,
    created,
    updated,
    libraryVideos: libraryVideos(sources).length,
    automaticChannels: sources.filter((source) => source.automatic && source.channelNumber !== null).length,
    unassigned,
  }
}

export function channelsFromSources(
  sources: readonly StoredSource[],
  /** `users`: the named users' ids; a channel whose owner is not among them lists under TVN. */
  options: { refused?: ReadonlySet<string>; archive?: ArchiveLookup; users?: ReadonlySet<string> } = {},
): {
  channels: Channel[]
  programmes: Map<string, Programme[]>
} {
  const channels: Channel[] = []
  const programmes = new Map<string, Programme[]>()
  const refused = options.refused ?? new Set<string>()
  const playable = (videos: readonly ImportedVideo[]) => videos.filter((video) => !refused.has(video.id))

  // An edited channel stays listed whatever its sources hold, so the viewer can always come back to it.
  const automatic = sources
    .filter((source) => source.automatic && source.channelNumber !== null && (source.videos.length > 0 || source.channelSources !== undefined))
    .sort((a, b) => (a.channelNumber ?? 0) - (b.channelNumber ?? 0))

  for (const source of automatic) {
    const number = source.channelNumber as number
    const id = `user-${source.id}`
    const mark = source.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'US'
    const base: Channel = {
      id,
      number,
      name: source.name,
      shortName: mark,
      description: '',
      logo: mark,
      color: PALETTE[number % PALETTE.length],
      category: 'User',
      categoryId: 'user',
      enabled: true,
      origin: 'user-import',
      mediaKind: 'video',
      sources: [{ kind: 'youtube-channel', id: source.id, label: source.name }],
      scheduleMode: 'loop',
      phaseOffsetSeconds: phaseFor(source.id),
      ...(source.owner && (!options.users || options.users.has(source.owner)) ? { owner: source.owner } : {}),
    }

    if (source.emptySlot) {
      channels.push({ ...base, name: EMPTY_SLOT_NAME, shortName: '··', logo: '··', description: `Empty user channel ${number}. Add a source in the Guide to fill it.`, emptySlot: true })
      programmes.set(id, [emptySlotProgramme(id)])
      continue
    }

    const live = source.channelSources ? liveStreamOf(source.channelSources) : null
    if (live) {
      channels.push({
        ...base,
        description: `${source.name}. A continuous live stream.`,
        mediaKind: live.media,
        sources: [{ kind: 'stream', id: live.source.id, label: live.source.label || source.name }],
        playbackType: 'live-stream',
        liveSinceMs: source.updatedAt,
      })
      programmes.set(id, [liveStreamProgramme(id, source.name, live)])
      continue
    }

    const pool = source.channelSources ? inventoryOf(source.channelSources) : source.videos
    if (pool.length === 0) {
      channels.push({ ...base, description: `${source.name}. No enabled source has programmes.` })
      programmes.set(id, [holdingProgramme(id, source.name)])
      continue
    }
    // The uploader's shipped archive deepens the channel only while the source it belongs to is enabled.
    const archived =
      !source.channelSources ||
      source.channelSources.some((item) => item.enabled && (item.kind === 'collection' || (item.kind === 'youtube' && `yt:${item.ref}` === source.id)))
    const ownPlayable = playable(pool)
    const ordered = (source.runningOrder?.length ?? 0) > 0
    const archive = archived && !ordered ? planArchive(ownPlayable, playable(options.archive?.({ id: source.id, name: source.listName ?? source.name })?.videos ?? [])) : []
    // A collection none of whose videos can play embedded still lists them when the uploader has nothing
    // else playable, so the channel explains the refusal instead of vanishing.
    const own = ownPlayable.length > 0 || archive.length === 0 ? (ownPlayable.length > 0 ? ownPlayable : pool) : []
    const refusedCount = pool.length - ownPlayable.length
    const description = [
      `Imported collection. ${own.length} programmes`,
      archive.length > 0 ? ` plus ${archive.length} earlier uploads from the same channel` : '',
      ordered ? ' in your running order on a clock schedule.' : ' on a clock schedule.',
      refusedCount > 0 ? ` ${refusedCount} of its videos cannot play outside YouTube.` : '',
    ].join('')
    channels.push({ ...base, description })

    const ownIndex = new Map(pool.map((video, index) => [video.id, index + 1]))
    const entry = (video: ImportedVideo) => ({ key: video.id, item: { video, earlier: false, programmeId: `${id}-p${ownIndex.get(video.id)}` }, repeat: false })
    // The viewer's own order plays exactly as set, on a loop; otherwise TVN weaves in repeats and earlier uploads.
    const order = ordered
      ? inOrder(own, source.runningOrder).map(entry)
      : runningOrder(
          own.map(entry),
          archive.map((video) => ({ key: video.id, item: { video, earlier: true, programmeId: `${id}-a-${video.id}` }, repeat: false })),
        )
    const list: Programme[] = order.map(({ item: { video, earlier, programmeId }, repeat }) => ({
      id: repeat ? `${programmeId}-r` : programmeId,
      title: video.title,
      description: earlier
        ? `${video.title} on ${source.name}, an earlier upload from the same channel. The slot is the video's own duration.`
        : `${video.title} on ${source.name}. The slot is the video's own duration.`,
      videoId: video.id,
      durationSeconds: video.durationSec,
      mediaDurationSeconds: video.durationSec,
      thumbnail: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
      channelId: id,
      category: 'User',
      source: 'imported' as const,
      kind: 'programme' as const,
      programmeType: programmeTypeFor(video.durationSec),
      mediaKind: 'video' as const,
      sourceRef: `youtube:${video.id}`,
      playbackMode: 'linear' as const,
    }))
    programmes.set(id, list)
  }

  return { channels, programmes }
}

/** The single listing of a live-stream channel: no duration and no programme boundaries. */
function liveStreamProgramme(channelId: string, name: string, live: NonNullable<ReturnType<typeof liveStreamOf>>): Programme {
  return {
    id: `${channelId}:live:${live.source.id}`,
    title: name,
    description: `${name}, a continuous live stream.`,
    videoId: null,
    durationSeconds: 0,
    channelId,
    category: 'User',
    source: 'imported',
    kind: 'programme',
    playbackMode: 'linear',
    playback: 'live',
    programmeType: 'live',
    mediaKind: live.media,
    sourceRef: `stream:${live.source.id}`,
    creator: live.source.label || undefined,
    liveStream: { ...live.stream },
  }
}

function emptySlotProgramme(channelId: string): Programme {
  return {
    id: `${channelId}-empty`,
    title: EMPTY_SLOT_NAME,
    description: 'This user channel is empty. Its number is kept for the next channel you add.',
    videoId: null,
    durationSeconds: 1800,
    channelId,
    category: 'User',
    source: 'imported',
    kind: 'programme',
    playbackMode: 'linear',
    caption: 'EMPTY USER CHANNEL · ADD A SOURCE IN THE GUIDE',
  }
}

function holdingProgramme(channelId: string, name: string): Programme {
  return {
    id: `${channelId}-empty`,
    title: name,
    description: 'No enabled source has programmes.',
    videoId: null,
    durationSeconds: 1800,
    channelId,
    category: 'User',
    source: 'imported',
    kind: 'programme',
    playbackMode: 'linear',
    caption: 'NO PROGRAMMES · EDIT THIS CHANNEL IN THE GUIDE',
  }
}

function programmeTypeFor(durationSec: number): ProgrammeType {
  if (durationSec >= 75 * 60) return 'film'
  if (durationSec < 8 * 60) return 'short'
  return 'episode'
}

function phaseFor(id: string): number {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 33 + id.charCodeAt(index)) >>> 0
  }
  return (hash % 3600) * 17 + 60
}

export function formatProgrammingHours(totalSeconds: number): string {
  return (totalSeconds / 3600).toFixed(1)
}
