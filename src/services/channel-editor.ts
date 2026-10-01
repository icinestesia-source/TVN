import type { ImportedVideo, StoredSource } from './channels-import.ts'
import { inOrder, inventoryOf, isStreamSource, liveStreamOf, SOURCE_TYPES, type ChannelSource } from './channel-sources.ts'
import { ADDED_PREFIX } from './user-network.ts'

/**
 * The Channel Editor works on one channel at a time. Every function here takes the whole stored User
 * Network and gives back the same list with only the chosen channel replaced; the others are returned
 * as the very same records, so nothing else is rebuilt, renumbered or rescanned.
 */
export interface ChannelEdit {
  name: string
  sources: ChannelSource[]
  /** The viewer's running order (video ids); absent while TVN arranges the channel itself. */
  order?: string[]
}

/** The running order to keep: every enabled programme, the viewer's arrangement first. None while TVN arranges it. */
export function keptOrder(sources: readonly ChannelSource[], order: readonly string[] | undefined): string[] | undefined {
  if (!order?.length) return undefined
  return inOrder(inventoryOf(sources), order).map((video) => video.id)
}

export interface RescanDeps {
  /** TVN's keyless lookup: a YouTube channel, @handle, video (for its uploader) or playlist. */
  resolveYouTube(url: string): Promise<{ channelId: string; title: string; videos: readonly ImportedVideo[] }>
  /** Whether this browser can open the stream now. */
  probeStream(source: ChannelSource): Promise<'online' | 'unavailable' | 'unsupported'>
}

const copySource = (source: ChannelSource): ChannelSource => ({
  ...source,
  videos: source.videos?.map((video) => ({ ...video })),
  status: source.status ? { ...source.status } : undefined,
})

/** The channel's sources; a channel saved before sources existed is read as the one source it came from. */
export function sourcesOf(record: StoredSource): ChannelSource[] {
  if (record.channelSources) return record.channelSources.map(copySource)
  const videos = record.videos.map((video) => ({ ...video }))
  const status = { state: 'ready' as const, playable: videos.length, checkedAt: record.updatedAt }
  if (record.id.startsWith(ADDED_PREFIX)) {
    const ref = record.id.slice(ADDED_PREFIX.length)
    const url = ref.startsWith('UC') ? `https://www.youtube.com/channel/${ref}` : `https://www.youtube.com/playlist?list=${ref}`
    return [{ id: 's1', kind: 'youtube', url, label: record.name, enabled: true, ref, videos, status }]
  }
  const list = record.listName ?? record.name
  return [{ id: 's1', kind: 'collection', url: '', label: list, enabled: true, ref: list, videos, status }]
}

export function editOf(record: StoredSource): ChannelEdit {
  return { name: record.name, sources: sourcesOf(record), ...(record.runningOrder ? { order: [...record.runningOrder] } : {}) }
}

export function cleanName(name: string, fallback: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 80) || fallback
}

function withEdit(record: StoredSource, edit: ChannelEdit, now: number): StoredSource {
  const sources = edit.sources.map(copySource)
  const { runningOrder: _previous, ...rest } = record
  const order = keptOrder(sources, edit.order)
  return {
    ...rest,
    name: cleanName(edit.name, record.name),
    // An imported list keeps the name TVN knows it by, so renaming never loses its archive.
    ...(record.id.startsWith(ADDED_PREFIX) ? {} : { listName: record.listName ?? record.name }),
    channelSources: sources,
    videos: inventoryOf(sources),
    ...(order ? { runningOrder: order } : {}),
    updatedAt: now,
  }
}

/** Save one channel's name and sources. Throws if that channel is not a stored user channel. */
export function applyChannelEdit(all: readonly StoredSource[], channelNumber: number, edit: ChannelEdit, now: number): StoredSource[] {
  let found = false
  const next = all.map((record) => {
    if (record.channelNumber !== channelNumber) return record
    found = true
    return withEdit(record, edit, now)
  })
  if (!found) throw new Error('That channel is no longer in your User Network')
  return next
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Re-resolve the enabled sources of one channel. A disabled source is left exactly as it was; a
 * YouTube source that cannot be read keeps what it had, so a passing failure never empties a channel.
 */
export async function rescanSources(sources: readonly ChannelSource[], deps: RescanDeps, now: number): Promise<ChannelSource[]> {
  return Promise.all(
    sources.map(async (original): Promise<ChannelSource> => {
      const source = copySource(original)
      if (!source.enabled) return source
      if (source.kind === 'tvn') return { ...source, status: { state: 'ready', checkedAt: now } }
      if (source.kind === 'collection') return { ...source, status: { state: 'ready', playable: source.videos?.length ?? 0, checkedAt: now } }
      if (source.kind === 'youtube') {
        try {
          const found = await deps.resolveYouTube(source.url)
          const videos = found.videos.map((video) => ({ ...video }))
          return { ...source, ref: found.channelId, label: found.title || source.label, videos, status: { state: 'ready', playable: videos.length, checkedAt: now } }
        } catch {
          return { ...source, status: { state: 'failed', playable: source.videos?.length ?? 0, checkedAt: now } }
        }
      }
      const verdict = await deps.probeStream(source).catch(() => 'unavailable' as const)
      return { ...source, label: source.label || hostOf(source.url), status: { state: verdict, checkedAt: now } }
    }),
  )
}

/** A plain summary of one channel after a rescan. */
export function rescanSummary(sources: readonly ChannelSource[]): string {
  const enabled = sources.filter((source) => source.enabled)
  const failed = enabled.filter((source) => ['failed', 'unavailable', 'unsupported'].includes(source.status?.state ?? '')).length
  const live = liveStreamOf(sources)
  const programmes = inventoryOf(sources).length
  const lead = live
    ? `${SOURCE_TYPES[live.source.kind].label.toUpperCase()} · ${live.source.status?.state === 'online' ? 'ONLINE' : 'NOT RESPONDING'}`
    : enabled.length === 0
      ? 'NO SOURCES ENABLED'
      : programmes === 0 && enabled.some((source) => source.kind === 'tvn')
        ? 'TVN PROGRAMMING ON AIR'
        : `${programmes} PROGRAMMES`
  const problems = failed > 0 && !(live && failed === 1 && enabled.filter(isStreamSource).length === 1) ? ` · ${failed} ${failed === 1 ? 'SOURCE' : 'SOURCES'} FAILED` : ''
  return `RESCANNED · ${lead}${problems}`
}

/** Rescan one channel and save it; every other channel is untouched. */
export async function rescanChannel(
  all: readonly StoredSource[],
  channelNumber: number,
  edit: ChannelEdit,
  deps: RescanDeps,
  now: number,
): Promise<{ all: StoredSource[]; edit: ChannelEdit; message: string }> {
  if (!all.some((record) => record.channelNumber === channelNumber)) throw new Error('That channel is no longer in your User Network')
  const sources = await rescanSources(edit.sources, deps, now)
  const next = { ...edit, sources }
  return { all: applyChannelEdit(all, channelNumber, next, now), edit: next, message: rescanSummary(sources) }
}
