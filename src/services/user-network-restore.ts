import { USER_NUMBER_LIMIT, USER_NUMBER_START } from '../data/network.ts'
import { cleanName, keptOrder } from './channel-editor.ts'
import { canonicalYouTubeUrl, inventoryOf, type ChannelSource } from './channel-sources.ts'
import { EMPTY_SLOT_NAME, emptySlotRecord, sourceIdFor, type ImportedVideo, type StoredSource } from './channels-import.ts'
import { ADDED_PREFIX } from './user-network.ts'
import { storedKindOf, validateUserNetworkExport, type ExportChannel, type ExportSource, type UserNetworkExport } from './user-network-export.ts'

/**
 * IMPORT at the top of the Guide: a tvn-user-network-v1 file restores the viewer's User Network (1001+).
 * It is a restore, not a merge: the file's channels replace every 1001+ channel in this browser, on the
 * file's own numbers. TVN channels 001–999, Channel 000 and anything kept outside the User Network are
 * left exactly as they are. Nothing is changed until the file has passed validation and the viewer has
 * confirmed; a file that fails is refused whole.
 */

export type ReadResult = { ok: true; value: UserNetworkExport; channels: number; empty: number } | { ok: false; errors: string[] }

/** Parse and validate the text of a chosen file. Reads only. */
export function readUserNetworkFile(text: string): ReadResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['Not a JSON file'] }
  }
  const checked = validateUserNetworkExport(data)
  if (!checked.ok) return checked
  const empty = checked.value.channels.filter((channel) => channel.state === 'empty').length
  return { ok: true, value: checked.value, channels: checked.value.channels.length, empty }
}

const cleanVideos = (videos: readonly { id: string; title: string; durationSec: number }[] = []): ImportedVideo[] =>
  videos.filter((video) => video.id.trim() && video.durationSec >= 0).map(({ id, title, durationSec }) => ({ id, title, durationSec }))

/** A YouTube channel or playlist id from its canonical address, when the file does not name it. */
function youTubeRef(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get('list') ?? parsed.pathname.match(/\/channel\/(UC[0-9A-Za-z_-]{22})/)?.[1] ?? undefined
  } catch {
    return undefined
  }
}

function channelSource(source: ExportSource, index: number): ChannelSource {
  const base = { id: `s${index + 1}`, label: source.label, enabled: source.enabled, ...(source.info ? { info: structuredClone(source.info) } : {}) }
  if (source.sourceType === 'youtube-channel' || source.sourceType === 'youtube-playlist') {
    const ref = source.providerId || youTubeRef(source.url)
    const youtube = source.sourceType === 'youtube-playlist' ? ('playlist' as const) : ('channel' as const)
    return { ...base, kind: 'youtube', url: ref ? canonicalYouTubeUrl({ ref, url: source.url, youtube }) : source.url, ...(ref ? { ref } : {}), youtube, videos: [] }
  }
  if (source.sourceType === 'collection') {
    return { ...base, kind: 'collection', url: '', ref: source.providerId || source.label, videos: cleanVideos(source.videos) }
  }
  if (source.sourceType === 'tvn') return { ...base, kind: 'tvn', url: '', ...(source.providerId ? { ref: source.providerId } : {}) }
  return { ...base, kind: storedKindOf(source.sourceType), url: source.url }
}

/** The record id TVN would have given this channel: an added YouTube source's id, or an imported list's. */
function recordId(channel: ExportChannel, sources: readonly ChannelSource[], taken: Set<string>, seen: Map<string, number>): string {
  const first = sources[0]
  let id: string
  if (first?.kind === 'youtube' && first.ref) id = `${ADDED_PREFIX}${first.ref}`
  else if (first?.kind === 'collection') id = sourceIdFor(channel.listName ?? first.ref ?? channel.name, seen)
  else id = `user:${channel.number}`
  if (taken.has(id)) id = `${id}-${channel.number}`
  taken.add(id)
  return id
}

/**
 * The stored records the file describes, before any YouTube source has been read again: YouTube
 * channels and playlists come back as addresses to resolve, imported lists with their own programmes.
 * Never carries watched marks, playback state, Channel 000 or object URLs, since the file holds none.
 */
export function recordsFromExport(doc: UserNetworkExport, now: number): StoredSource[] {
  const taken = new Set<string>()
  const seen = new Map<string, number>()
  return doc.channels
    .filter((channel) => channel.number >= USER_NUMBER_START && channel.number < USER_NUMBER_LIMIT)
    .map((channel): StoredSource => {
      if (channel.state === 'empty') {
        taken.add(`slot:${channel.number}`)
        return { ...emptySlotRecord(channel.number, now), name: cleanName(channel.name, EMPTY_SLOT_NAME) }
      }
      const sources = channel.sources.map(channelSource)
      const id = recordId(channel, sources, taken, seen)
      const first = sources[0]
      const record: StoredSource = {
        id,
        name: cleanName(channel.name, first?.label || `Channel ${channel.number}`),
        videos: inventoryOf(sources),
        channelNumber: channel.number,
        inLibrary: sources.some((source) => source.kind === 'collection'),
        automatic: channel.enabled,
        updatedAt: now,
        ...(channel.runningOrder?.length ? { runningOrder: [...channel.runningOrder] } : {}),
      }
      const plain = !channel.edited && sources.length === 1 && ((first.kind === 'youtube' && Boolean(first.ref)) || first.kind === 'collection')
      if (plain && first.kind === 'youtube') return { ...record, sourceType: first.youtube === 'playlist' ? 'youtube-playlist' : 'youtube-channel' }
      if (plain) return { ...record, ...(channel.listName ? { listName: channel.listName } : {}) }
      return { ...record, channelSources: sources, ...(channel.listName ? { listName: channel.listName } : {}) }
    })
}

export interface RestoreDeps {
  /** TVN's keyless lookup of a YouTube channel or playlist. */
  resolveYouTube(url: string): Promise<{ channelId: string; title: string; videos: readonly ImportedVideo[] }>
}

/** The YouTube sources a restored record must read again: its own when plain, its enabled ones when edited. */
function youTubeSourcesOf(record: StoredSource): ChannelSource[] {
  if (record.channelSources) return record.channelSources.filter((source) => source.kind === 'youtube' && source.enabled)
  if (!record.id.startsWith(ADDED_PREFIX)) return []
  const ref = record.id.slice(ADDED_PREFIX.length)
  const youtube = record.sourceType === 'youtube-playlist' ? ('playlist' as const) : ('channel' as const)
  return [{ id: 's1', kind: 'youtube', url: canonicalYouTubeUrl({ ref, url: '', youtube }), label: record.name, enabled: true, ref, youtube }]
}

/**
 * Read every enabled YouTube source again through TVN's keyless lookup, a few at a time. A source that
 * cannot be read stays in its channel, marked failed and without programmes, so the channel keeps its
 * number and can be rescanned later. Names, switches and running orders are the file's.
 */
export async function resolveRestored(
  records: readonly StoredSource[],
  deps: RestoreDeps,
  now: number,
  parallel = 4,
): Promise<{ records: StoredSource[]; failed: number }> {
  const jobs = records.flatMap((record, index) => youTubeSourcesOf(record).map((source) => ({ index, source })))
  const found = new Map<string, readonly ImportedVideo[] | null>()
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const { source } = jobs[next++]
      const url = canonicalYouTubeUrl(source)
      if (found.has(url)) continue
      found.set(url, null)
      try {
        found.set(url, (await deps.resolveYouTube(url)).videos)
      } catch {
        found.set(url, null)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker))
  let failed = 0
  const out = records.map((record) => {
    const wanted = youTubeSourcesOf(record)
    if (wanted.length === 0) return record
    const read = (source: ChannelSource) => found.get(canonicalYouTubeUrl(source)) ?? null
    failed += wanted.filter((source) => read(source) === null).length
    const order = (sources: readonly ChannelSource[]) => keptOrder(sources, record.runningOrder) ?? record.runningOrder
    if (!record.channelSources) {
      const videos = cleanVideos(read(wanted[0]) ?? [])
      const sources: ChannelSource[] = [{ ...wanted[0], videos }]
      const runningOrder = videos.length > 0 ? order(sources) : record.runningOrder
      return { ...record, videos, ...(runningOrder?.length ? { runningOrder } : {}) }
    }
    const channelSources = record.channelSources.map((source): ChannelSource => {
      if (source.kind !== 'youtube' || !source.enabled) return source
      const videos = read(source)
      return videos === null
        ? { ...source, status: { state: 'failed', playable: 0, checkedAt: now } }
        : { ...source, videos: cleanVideos(videos), status: { state: 'ready', playable: videos.length, checkedAt: now } }
    })
    const videos = inventoryOf(channelSources)
    const runningOrder = videos.length > 0 ? order(channelSources) : record.runningOrder
    const { runningOrder: _old, ...rest } = record
    return { ...rest, channelSources, videos, ...(runningOrder?.length ? { runningOrder } : {}) }
  })
  return { records: out, failed }
}

/** The whole stored list after a restore: every 1001+ channel replaced by the file's; everything else untouched. */
export function restoreUserNetwork(existing: readonly StoredSource[], restored: readonly StoredSource[]): StoredSource[] {
  const userNumber = (record: StoredSource) => record.channelNumber !== null && record.channelNumber >= USER_NUMBER_START && record.channelNumber < USER_NUMBER_LIMIT
  const restoredIds = new Set(restored.map((record) => record.id))
  // A record outside 1001+ with the same id as a restored channel (a list kept in the library only) gives way to it.
  const kept = existing.filter((record) => !userNumber(record) && !restoredIds.has(record.id))
  return [...kept, ...restored.filter(userNumber)]
}

/**
 * Favourites after a restore. Curated and Channel 000 favourites stay. A 1001+ favourite stays on its
 * number when the restored network has that number (the viewer is restoring stable numbers); one whose
 * number the restored network does not have is dropped, so a channel added there later never inherits it.
 * Nothing is reseeded.
 */
export function favouritesAfterRestore(favourites: readonly number[], restored: readonly StoredSource[]): number[] {
  const numbers = new Set(restored.map((record) => record.channelNumber))
  return favourites.filter((number) => number < USER_NUMBER_START || numbers.has(number))
}
