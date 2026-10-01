import { USER_NUMBER_LIMIT, USER_NUMBER_START } from '../data/network.ts'
import { emptySlotRecord, firstEmptySlot, type ImportedVideo, type ParsedExport, type StoredSource } from './channels-import.ts'
import { refreshOrigin } from './channel-sources.ts'

/**
 * The User Network (1001+) belongs to the viewer and lives in this browser. A new viewer starts with the
 * bundled starter network; channels also arrive through Add Channel or a channel list file, and each
 * change appends after the last user channel without touching the ones already there.
 */
export const ADDED_PREFIX = 'yt:'

export interface AddedChannel {
  channelId: string
  /** Whether the link named a channel's uploads or one playlist; inferred from the id when the lookup does not say. */
  sourceType?: 'youtube-channel' | 'youtube-playlist'
  title: string
  videos: readonly ImportedVideo[]
}

export type UploaderOf = (collectionName: string) => string | null

/** The number after the last user channel, so a new channel always joins the bottom of the guide. */
export function nextUserNumber(sources: readonly StoredSource[]): number | null {
  let last = USER_NUMBER_START - 1
  for (const source of sources) if (source.channelNumber !== null && source.channelNumber > last) last = source.channelNumber
  const next = last + 1
  return next < USER_NUMBER_LIMIT ? next : null
}

/**
 * The number a new channel takes: the lowest empty slot (whose placeholder record is removed from
 * `sources` here), otherwise the number after the last user channel. A populated channel is never taken.
 */
export function claimUserNumber(sources: StoredSource[]): number | null {
  const slot = firstEmptySlot(sources)
  if (!slot) return nextUserNumber(sources)
  sources.splice(sources.indexOf(slot), 1)
  return slot.channelNumber
}

function uploaderIdOf(source: StoredSource, uploaderOf: UploaderOf): string | null {
  if (source.emptySlot) return null
  return source.id.startsWith(ADDED_PREFIX) ? source.id.slice(ADDED_PREFIX.length) : uploaderOf(source.name)
}

export function addChannelSource(
  existing: readonly StoredSource[],
  channel: AddedChannel,
  now: number,
  uploaderOf: UploaderOf = () => null,
): { sources: StoredSource[]; number: number | null; status: 'added' | 'updated' | 'duplicate' | 'full' } {
  const id = `${ADDED_PREFIX}${channel.channelId}`
  const sources = existing.map((source) => ({ ...source, videos: source.videos.slice() }))
  const same = sources.find((source) => source.id === id)
  if (same) {
    if (!same.channelSources) same.name = channel.title
    Object.assign(same, refreshOrigin(same, { kind: 'youtube', ref: channel.channelId }, channel.videos, now))
    same.updatedAt = now
    if (same.channelNumber === null) {
      same.channelNumber = claimUserNumber(sources)
      same.automatic = same.channelNumber !== null
    }
    return { sources, number: same.channelNumber, status: 'updated' }
  }
  const twin = sources.find((source) => source.channelNumber !== null && uploaderIdOf(source, uploaderOf) === channel.channelId)
  if (twin) return { sources, number: twin.channelNumber, status: 'duplicate' }
  const number = claimUserNumber(sources)
  if (number === null) return { sources, number: null, status: 'full' }
  sources.push({
    id,
    name: channel.title,
    sourceType: channel.sourceType ?? (channel.channelId.startsWith('UC') ? 'youtube-channel' : 'youtube-playlist'),
    videos: channel.videos.map((video) => ({ ...video })),
    channelNumber: number,
    inLibrary: false,
    automatic: true,
    updatedAt: now,
  })
  return { sources, number, status: 'added' }
}

/**
 * Install the bundled starter network after the viewer's own. A collection already present (the same
 * collection, the same name, or the same uploader added by link) is left exactly as it is.
 */
export function planTestChannels(
  existing: readonly StoredSource[],
  parsed: ParsedExport,
  now: number,
  uploaderOf: UploaderOf = () => null,
): { sources: StoredSource[]; added: number[]; skipped: number } {
  const sources = existing.map((source) => ({ ...source, videos: source.videos.slice() }))
  const ids = new Set(sources.map((source) => source.id))
  const names = new Set(sources.filter((source) => !source.emptySlot).map((source) => source.name.trim().toLowerCase()))
  const uploaders = new Set(sources.map((source) => uploaderIdOf(source, uploaderOf)).filter((id): id is string => id !== null))
  const added: number[] = []
  let skipped = 0
  for (const incoming of parsed.sources) {
    const uploader = uploaderOf(incoming.name)
    if (ids.has(incoming.id) || names.has(incoming.name.trim().toLowerCase()) || (uploader && uploaders.has(uploader))) {
      skipped += 1
      continue
    }
    const number = claimUserNumber(sources)
    if (number === null) break
    sources.push({
      id: incoming.id,
      name: incoming.name,
      videos: incoming.videos.map((video) => ({ ...video })),
      channelNumber: number,
      inLibrary: true,
      automatic: true,
      updatedAt: now,
    })
    ids.add(incoming.id)
    names.add(incoming.name.trim().toLowerCase())
    if (uploader) uploaders.add(uploader)
    added.push(number)
  }
  return { sources, added, skipped }
}

/**
 * A channel list file may be a TVN export (channels with their videos) or a plain list of YouTube links:
 * `["https://…", …]`, `{ "channels": ["https://…"] }` or `{ "channels": [{ "url": "https://…" }] }`.
 * Returns the links, or null when the file is an export.
 */
export function channelLinksFrom(text: string): string[] | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const list = Array.isArray(data) ? data : (data as { channels?: unknown } | null)?.channels
  if (!Array.isArray(list) || list.length === 0) return null
  const links = list.map((entry) =>
    typeof entry === 'string' ? entry : typeof (entry as { url?: unknown } | null)?.url === 'string' ? (entry as { url: string }).url : null,
  )
  return links.every((link): link is string => typeof link === 'string' && link.trim() !== '') ? links.map((link) => link.trim()) : null
}

/** Remove the named user channels, or every stored channel for 'all'. */
export function removeUserChannels(existing: readonly StoredSource[], numbers: 'all' | readonly number[]): StoredSource[] {
  if (numbers === 'all') return []
  const drop = new Set(numbers)
  return existing.filter((source) => source.channelNumber === null || !drop.has(source.channelNumber)).map((source) => ({ ...source, videos: source.videos.slice() }))
}

/**
 * Clear one user channel: its sources, programmes and running order go, its number stays as an empty
 * slot the viewer can edit or fill, and no other channel moves. Favourites name channels by number, so a
 * favourite on this number stays and comes back to life when the slot is filled.
 */
export function clearUserChannel(
  existing: readonly StoredSource[],
  channelNumber: number,
  now: number,
): { sources: StoredSource[]; status: 'cleared' | 'already-empty' | 'missing' } {
  if (channelNumber < USER_NUMBER_START || channelNumber >= USER_NUMBER_LIMIT) return { sources: existing.map((source) => ({ ...source, videos: source.videos.slice() })), status: 'missing' }
  const at = existing.findIndex((source) => source.channelNumber === channelNumber)
  const sources = existing.map((source) => ({ ...source, videos: source.videos.slice() }))
  if (at < 0) return { sources, status: 'missing' }
  if (existing[at].emptySlot) return { sources, status: 'already-empty' }
  sources[at] = emptySlotRecord(channelNumber, now)
  return { sources, status: 'cleared' }
}
