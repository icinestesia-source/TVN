import { USER_NUMBER_LIMIT, USER_NUMBER_START } from '../data/network.ts'
import {
  cleanEditorial,
  cleanFilter,
  rescanned,
  sourceModeOf,
  widenSource,
  type ChannelEditorial,
  type SourceMode,
} from './channel-curation.ts'
import type { ImportedVideo, StoredSource } from './channels-import.ts'
import {
  canonicalYouTubeUrl,
  inOrder,
  inventoryOf,
  isStreamSource,
  liveStreamOf,
  SOURCE_TYPES,
  type ChannelSource,
} from './channel-sources.ts'
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
  /** A user channel's editorial notes. Never kept for a TVN channel and never consulted by the scheduler. */
  editorial?: ChannelEditorial
}

/** The running order to keep: every enabled programme, the viewer's arrangement first. None while TVN arranges it. */
export function keptOrder(sources: readonly ChannelSource[], order: readonly string[] | undefined): string[] | undefined {
  if (!order?.length) return undefined
  return inOrder(inventoryOf(sources), order).map((video) => video.id)
}

export interface RescanDeps {
  /**
   * TVN's keyless lookup: a YouTube channel, @handle, video (for its uploader) or playlist. A rescan must
   * pass straight through to YouTube (no cached answer), or it would only replay the last scan.
   */
  resolveYouTube(
    url: string,
    options?: { mode?: SourceMode },
  ): Promise<{ channelId: string; sourceType?: 'youtube-channel' | 'youtube-playlist'; title: string; videos: readonly ImportedVideo[] }>
  /** Whether this browser can open the stream now. */
  probeStream(source: ChannelSource): Promise<'online' | 'unavailable' | 'unsupported'>
  /** The YouTube channel an imported list came from, when TVN knows it; such a list is refreshed from that channel. */
  uploaderOf?(listName: string): string | null
  /** TVN's shipped back catalogue for a source, which ARCHIVE and ALL add to it. */
  archiveOf?(source: ChannelSource): readonly ImportedVideo[]
}

/** The programmes of the playlists a source's filter names, each marked with its playlist. A playlist that cannot be read adds nothing. */
async function playlistVideos(source: ChannelSource, resolve: RescanDeps['resolveYouTube']): Promise<ImportedVideo[]> {
  const out: ImportedVideo[] = []
  for (const id of source.filter?.include?.playlists ?? []) {
    try {
      const found = await resolve(`https://www.youtube.com/playlist?list=${id}`, { mode: 'all' })
      for (const video of found.videos) out.push({ ...video, lists: [id] })
    } catch {
      /* a private or removed playlist leaves the rest of the source alone */
    }
  }
  return out
}

/** Programmes found in a filter's playlists join the source; one it already holds is marked with the playlist instead. */
export function withPlaylistVideos(videos: readonly ImportedVideo[], listed: readonly ImportedVideo[]): ImportedVideo[] {
  const out = videos.map((video) => ({ ...video }))
  const at = new Map(out.map((video, index) => [video.id, index]))
  for (const video of listed) {
    const index = at.get(video.id)
    if (index === undefined) {
      at.set(video.id, out.length)
      out.push({ ...video })
      continue
    }
    const lists = [...new Set([...(out[index].lists ?? []), ...(video.lists ?? [])])]
    out[index] = { ...out[index], lists }
  }
  return out
}

/** Sources with their modes applied: ARCHIVE and ALL hold TVN's shipped back catalogue too. Pure; nothing is fetched. */
export function widenSources(sources: readonly ChannelSource[], archiveOf: ((source: ChannelSource) => readonly ImportedVideo[]) | undefined): ChannelSource[] {
  return sources.map((source) => (archiveOf && sourceModeOf(source) !== 'recent' ? widenSource(source, archiveOf(source)) : source))
}

/** A rescanned list: the uploader's current programmes first, then everything it already had that they do not repeat. */
function mergedFresh(fresh: readonly ImportedVideo[], kept: readonly ImportedVideo[] = []): ImportedVideo[] {
  const seen = new Set(fresh.map((video) => video.id))
  return [...fresh.map((video) => ({ ...video })), ...kept.filter((video) => !seen.has(video.id)).map((video) => ({ ...video }))]
}

const copySource = (source: ChannelSource): ChannelSource => ({
  ...source,
  videos: source.videos?.map((video) => ({ ...video })),
  status: source.status ? { ...source.status } : undefined,
  ...(source.filter ? { filter: structuredClone(source.filter) } : {}),
})

/** A source as a user channel keeps it: filter in its canonical shape, mode only when it is not the default. */
function curatedSource(source: ChannelSource): ChannelSource {
  const { filter: _filter, mode: _mode, ...rest } = copySource(source)
  if (isStreamSource(source) || source.kind === 'tvn') return rest
  const filter = cleanFilter(source.filter)
  const mode = sourceModeOf(source)
  return { ...rest, ...(filter ? { filter } : {}), ...(mode !== 'recent' ? { mode } : {}) }
}

/** The channel's sources; a channel saved before sources existed is read as the one source it came from. */
export function sourcesOf(record: StoredSource): ChannelSource[] {
  if (record.channelSources) return record.channelSources.map(copySource)
  const videos = record.videos.map((video) => ({ ...video }))
  const status = { state: 'ready' as const, playable: videos.length, checkedAt: record.updatedAt }
  if (record.id.startsWith(ADDED_PREFIX)) {
    const ref = record.id.slice(ADDED_PREFIX.length)
    const url = ref.startsWith('UC') ? `https://www.youtube.com/channel/${ref}` : `https://www.youtube.com/playlist?list=${ref}`
    const youtube = record.sourceType === 'youtube-playlist' || (!record.sourceType && !ref.startsWith('UC')) ? 'playlist' : 'channel'
    return [{ id: 's1', kind: 'youtube', url, label: record.name, enabled: true, ref, youtube, videos, status }]
  }
  const list = record.listName ?? record.name
  return [{ id: 's1', kind: 'collection', url: '', label: list, enabled: true, ref: list, videos, status }]
}

export function editOf(record: StoredSource): ChannelEdit {
  return {
    name: record.name,
    sources: sourcesOf(record),
    ...(record.runningOrder ? { order: [...record.runningOrder] } : {}),
    ...(record.editorial ? { editorial: structuredClone(record.editorial) } : {}),
  }
}

export function cleanName(name: string, fallback: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 80) || fallback
}

function withEdit(record: StoredSource, edit: ChannelEdit, now: number): StoredSource {
  const sources = edit.sources.map(curatedSource)
  const { runningOrder: _previous, emptySlot: _empty, editorial: _notes, ...bare } = record
  const editorial = cleanEditorial(edit.editorial)
  const rest = { ...bare, ...(editorial ? { editorial } : {}) }
  const order = keptOrder(sources, edit.order)
  if (record.emptySlot) {
    // A slot stays empty until it has a source; the first source's title names it unless the viewer typed a name.
    if (sources.length === 0) {
      const { editorial: _old, ...slot } = record
      return { ...slot, name: cleanName(edit.name, record.name), ...(editorial ? { editorial } : {}), updatedAt: now }
    }
    const named = edit.name.trim() && edit.name.trim() !== record.name ? edit.name : sources.find((source) => source.label)?.label ?? record.name
    return {
      ...rest,
      name: cleanName(named, record.name),
      channelSources: sources,
      videos: inventoryOf(sources),
      ...(order ? { runningOrder: order } : {}),
      updatedAt: now,
    }
  }
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
  if (!Number.isInteger(channelNumber) || channelNumber < USER_NUMBER_START || channelNumber >= USER_NUMBER_LIMIT) {
    throw new Error('That channel is no longer in your User Network')
  }
  let found = false
  const next = all.map((record) => {
    if (record.channelNumber !== channelNumber) return record
    found = true
    return withEdit(record, edit, now)
  })
  if (!found) throw new Error('That channel is no longer in your User Network')
  return next
}

/** A recent source is looked up exactly as before; a wider mode asks the lookup for everything it lists. */
const wider = (mode: SourceMode): [] | [{ mode: SourceMode }] => (mode === 'recent' ? [] : [{ mode }])

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
 * A YouTube source is looked up again at its canonical channel or playlist address and replaced by what
 * YouTube lists now. An imported list whose uploader TVN knows is refreshed from that uploader, keeping
 * the programmes it already had; an imported list with no known uploader has nothing to ask and stays.
 */
export async function rescanSources(sources: readonly ChannelSource[], deps: RescanDeps, now: number): Promise<ChannelSource[]> {
  return Promise.all(
    sources.map(async (original): Promise<ChannelSource> => {
      const source = copySource(original)
      if (!source.enabled) return source
      if (source.kind === 'tvn') return { ...source, status: { state: 'ready', checkedAt: now } }
      if (source.kind === 'collection') {
        const uploader = source.ref ? deps.uploaderOf?.(source.ref) : null
        if (!uploader) return { ...source, status: { state: 'ready', playable: source.videos?.length ?? 0, checkedAt: now } }
        try {
          const mode = sourceModeOf(source)
          const found = await deps.resolveYouTube(`https://www.youtube.com/channel/${uploader}`, ...wider(mode))
          const fresh = withPlaylistVideos(mergedFresh(found.videos, source.videos), await playlistVideos(source, deps.resolveYouTube))
          const [widened] = widenSources([{ ...source, videos: fresh }], deps.archiveOf)
          const videos = widened.videos ?? []
          return { ...widened, status: { state: 'ready', playable: videos.length, checkedAt: now } }
        } catch {
          return { ...source, status: { state: 'failed', playable: source.videos?.length ?? 0, checkedAt: now } }
        }
      }
      if (source.kind === 'youtube') {
        try {
          const mode = sourceModeOf(source)
          const found = await deps.resolveYouTube(canonicalYouTubeUrl(source), ...wider(mode))
          const youtube = found.sourceType === 'youtube-playlist' ? 'playlist' : found.sourceType === 'youtube-channel' ? 'channel' : source.youtube
          const fresh = withPlaylistVideos(rescanned(found.videos, source.videos, mode), await playlistVideos(source, deps.resolveYouTube))
          const [widened] = widenSources([{ ...source, ref: found.channelId, ...(youtube ? { youtube } : {}), videos: fresh }], deps.archiveOf)
          const videos = widened.videos ?? []
          return {
            ...widened,
            label: found.title || source.label,
            status: { state: 'ready', playable: videos.length, checkedAt: now },
          }
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
