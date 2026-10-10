import { isOwnNumber } from '../data/network.ts'
import {
  cleanEditorial,
  cleanFilter,
  keepingDates,
  MAX_SOURCE_VIDEOS,
  rescanned,
  sourceModeOf,
  widenSource,
  type ChannelEditorial,
  type SourceMode,
} from './channel-curation.ts'
import type { ImportedVideo, StoredSource } from './channels-import.ts'
import {
  airingSources,
  canonicalYouTubeUrl,
  inOrder,
  inventoryOf,
  isLocalDevelopment,
  isStreamSource,
  liveStreamOf,
  localWebsiteId,
  singleVideoId,
  singleVideoUrl,
  SOURCE_TYPES,
  WEBSITE_SLOT_SECONDS,
  type ChannelSource,
  type OrderKind,
} from './channel-sources.ts'
import { ADDED_PREFIX } from './user-network.ts'
import { latestVideos } from '../view/programme-order.ts'
import type { OriginalOverride } from './original-sources.ts'
import type { FoundFeed } from './podcast-source.ts'

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
  /** With a running order: how many of its programmes are scheduled, from the top. Absent: all eligible programmes. */
  scheduleSize?: number
  /** The channel's editorial notes, status and related channels. Never consulted by the scheduler. */
  editorial?: ChannelEditorial
  /** A TVN channel only: the viewer's own description over the shipped one. */
  description?: string
  /** A TVN channel only: shipped programmes (by id) the viewer has left out of its running order. */
  excluded?: string[]
  /** A TVN channel only: what TVN has changed underneath the viewer's curation. Shown, never saved. */
  review?: string[]
  /** A TVN channel only: the viewer's decisions about TVN's original sources (src/services/original-sources.ts). */
  originals?: OriginalOverride[]
  /** With a running order: how it was made. */
  orderKind?: OrderKind
  /** `eligibilityKey` as the last successful rescan compiled the channel. */
  compiled?: string
  /** With a latest-first order: when its newest programme went to air (Latest first, live). */
  liveFromMs?: number
}

/** A latest-first order stays newest first whatever arrives; any other order is kept as the viewer left it. */
export function orderFor(sources: readonly ChannelSource[], edit: Pick<ChannelEdit, 'order' | 'orderKind'>): string[] | undefined {
  if (edit.orderKind === 'latest' && edit.order?.length) return latestVideos(inventoryOf(airingSources(sources))).map((video) => video.id)
  return keptOrder(sources, edit.order)
}

/** The running order to keep: every enabled programme on air, the viewer's arrangement first. None while TVN arranges it. */
export function keptOrder(sources: readonly ChannelSource[], order: readonly string[] | undefined): string[] | undefined {
  if (!order?.length) return undefined
  return inOrder(inventoryOf(airingSources(sources)), order).map((video) => video.id)
}

/**
 * A fingerprint of what decides the channel's eligible programmes: its sources (each enabled or not, with its
 * mode and filter), the schedule size and the programmes left out. A running order's arrangement is not part
 * of it: sorting or moving a programme changes the order, not what RESCAN would find.
 */
export function eligibilityKey(edit: Pick<ChannelEdit, 'sources'> & Partial<ChannelEdit>): string {
  const key = JSON.stringify([
    edit.sources.map((source) => [source.id, source.kind, source.url, source.enabled, sourceModeOf(source), cleanFilter(source.filter) ?? null]),
    edit.order?.length ? (edit.scheduleSize ?? null) : null,
    [...new Set(edit.excluded ?? [])].sort(),
    (edit.originals ?? []).map((item) => JSON.stringify(item)).sort(),
  ])
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Programme lengths the whole channel is limited to, in seconds; absent ends are open. */
export interface LengthRange {
  minSeconds?: number
  maxSeconds?: number
}

/** Sources whose programmes have their own lengths: not TVN's programming, a website's slot or a live stream. */
const lengthLimited = (source: Pick<ChannelSource, 'kind'>) => source.kind !== 'tvn' && source.kind !== 'website' && !isStreamSource(source)

/** The length limits every one of the channel's sources shares; none when they differ or no source has any. */
export function lengthRangeOf(sources: readonly ChannelSource[]): LengthRange {
  const limited = sources.filter(lengthLimited)
  if (limited.length === 0) return {}
  const { minSeconds, maxSeconds } = limited[0].filter?.include ?? {}
  const shared = limited.every((source) => source.filter?.include?.minSeconds === minSeconds && source.filter?.include?.maxSeconds === maxSeconds)
  return shared ? { ...(minSeconds !== undefined ? { minSeconds } : {}), ...(maxSeconds !== undefined ? { maxSeconds } : {}) } : {}
}

const outside = (seconds: number, range: LengthRange) =>
  (range.minSeconds !== undefined && seconds < range.minSeconds) || (range.maxSeconds !== undefined && seconds > range.maxSeconds)

/**
 * The channel limited to programmes of these lengths: each source's filter takes the limits, so what it holds
 * and every later rescan leave out the rest; TVN's own programmes outside them are left out of the running
 * order. A programme of unknown length (0) is never judged by it.
 */
export function withLengthRange(edit: ChannelEdit, range: LengthRange, tvnRows: readonly { id: string; durationSec: number }[] = []): ChannelEdit {
  const clean = cleanFilter({ include: range })?.include ?? {}
  const limits: LengthRange = { minSeconds: clean.minSeconds, maxSeconds: clean.maxSeconds }
  const sources = edit.sources.map((source) => {
    if (!lengthLimited(source)) return source
    const filter = cleanFilter({ ...source.filter, include: { ...source.filter?.include, ...limits } })
    if (filter) return { ...source, filter }
    const { filter: _filter, ...rest } = source
    return rest
  })
  const left = new Set(edit.excluded ?? [])
  const unfit = tvnRows.filter((row) => row.durationSec > 0 && !left.has(row.id) && outside(row.durationSec, limits)).map((row) => row.id)
  if (unfit.length === 0) return { ...edit, sources }
  return { ...edit, sources, excluded: [...left, ...unfit], orderKind: edit.orderKind ?? 'manual' }
}

/** Programmes the channel holds but does not schedule yet: what LOAD or a new source brought in. */
export function heldIds(sources: readonly ChannelSource[]): Set<string> {
  return new Set(sources.flatMap((source) => (source.videos ?? []).filter((video) => video.pending).map((video) => video.id)))
}

/** A source read further: whatever it did not hold before is held back from the schedule until the next rescan. */
export function holdNew(before: ChannelSource, after: ChannelSource): ChannelSource {
  const known = new Set((before.videos ?? []).map((video) => video.id))
  if (!after.videos?.some((video) => !known.has(video.id))) return after
  return { ...after, videos: after.videos.map((video) => (known.has(video.id) || video.pending ? video : { ...video, pending: true })) }
}

/** Every held programme let onto the schedule, as a rescan or rebuild compiles the channel. */
export function admitted(sources: readonly ChannelSource[]): ChannelSource[] {
  return sources.map((source) =>
    source.videos?.some((video) => video.pending) ? { ...source, videos: source.videos.map(({ pending: _pending, ...video }) => video) } : source,
  )
}

export interface RescanDeps {
  /**
   * TVN's keyless lookup: a YouTube channel, @handle, video (for its uploader) or playlist. A rescan must
   * pass straight through to YouTube (no cached answer), or it would only replay the last scan.
   */
  resolveYouTube(
    url: string,
    options?: { mode?: SourceMode; fresh?: boolean },
  ): Promise<{ channelId: string; sourceType?: 'youtube-channel' | 'youtube-playlist'; title: string; videos: readonly ImportedVideo[]; listed?: number; next?: string }>
  /** Whether this browser can open the stream now. */
  probeStream(source: ChannelSource): Promise<'online' | 'unavailable' | 'unsupported'>
  /** The YouTube channel an imported list came from, when TVN knows it; such a list is refreshed from that channel. */
  uploaderOf?(listName: string): string | null
  /** TVN's shipped back catalogue for a source, which ARCHIVE and ALL add to it. */
  archiveOf?(source: ChannelSource): readonly ImportedVideo[]
  /** TVN's keyless feed reader: a podcast feed, or a website that announces one; `as: 'website'` reads the page itself as a programme. */
  resolveFeed?(url: string, options?: { mode?: SourceMode; as?: 'website' }): Promise<FoundFeed>
}

/** The reader's answer when a page cannot be a programme at all, rather than merely could not be reached. */
const REFUSED_PAGE = /cannot be embedded|https:\/\/ address|sign-in|not the address of one x post|private, removed|no video or picture/i

/**
 * A website or post source read again: still allowed to be framed, its title and artwork current, and each
 * programme keeping the slot the viewer gave it. A page that now refuses framing schedules nothing.
 */
async function rescanWebsite(source: ChannelSource, deps: RescanDeps, now: number): Promise<ChannelSource> {
  const held = new Map((source.videos ?? []).map((video) => [video.id, video.durationSec]))
  let url: URL | null = null
  try {
    url = new URL(source.url)
  } catch {
    url = null
  }
  if (url && isLocalDevelopment(url)) {
    const id = localWebsiteId(url.toString())
    const videos: ImportedVideo[] = [{ id, title: source.label || url.host, durationSec: held.get(id) ?? WEBSITE_SLOT_SECONDS, media: url.toString(), web: 'website' }]
    return { ...source, label: source.label || url.host, videos, status: { state: 'ready', playable: 1, checkedAt: now } }
  }
  if (!deps.resolveFeed) return { ...source, status: { state: 'failed', playable: source.videos?.length ?? 0, checkedAt: now } }
  try {
    const found = await deps.resolveFeed(source.url, { as: 'website' })
    const videos = found.episodes.filter((video) => video.web).map((video) => ({ ...video, durationSec: held.get(video.id) ?? video.durationSec }))
    return { ...source, url: found.feedUrl, ref: found.feedUrl, label: source.label || found.title, videos, status: { state: 'ready', playable: videos.length, checkedAt: now } }
  } catch (error) {
    if (error instanceof Error && REFUSED_PAGE.test(error.message)) return { ...source, videos: [], status: { state: 'unavailable', playable: 0, checkedAt: now } }
    return { ...source, status: { state: 'failed', playable: source.videos?.length ?? 0, checkedAt: now } }
  }
}

/** A website or post given a new slot: every programme of that source plays for `seconds`. */
export function withWebsiteSlot(source: ChannelSource, seconds: number): ChannelSource {
  const slot = Math.round(seconds)
  if (source.kind !== 'website' || !Number.isFinite(slot) || slot < 60 || slot > 6 * 3600) return source
  return { ...source, videos: (source.videos ?? []).map((video) => ({ ...video, durationSec: slot })) }
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
    out[index] = {
      ...out[index],
      lists,
      ...(!out[index].published && video.published ? { published: video.published } : {}),
      ...(!out[index].creator && video.creator ? { creator: video.creator } : {}),
    }
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
  return [...keepingDates(fresh, kept), ...kept.filter((video) => !seen.has(video.id)).map((video) => ({ ...video }))]
}

const copySource = (source: ChannelSource): ChannelSource => ({
  ...source,
  videos: source.videos?.map((video) => ({ ...video })),
  status: source.status ? { ...source.status } : undefined,
  ...(source.filter ? { filter: structuredClone(source.filter) } : {}),
  ...(source.removed ? { removed: [...source.removed] } : {}),
})

/** A source as a user channel keeps it: filter in its canonical shape, mode only when it is not the default. */
export function curatedSource(source: ChannelSource): ChannelSource {
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
    ...(record.runningOrder && record.scheduleSize ? { scheduleSize: record.scheduleSize } : {}),
    ...(record.runningOrder && record.orderKind ? { orderKind: record.orderKind } : {}),
    ...(record.editorial ? { editorial: structuredClone(record.editorial) } : {}),
    ...(record.compiled ? { compiled: record.compiled } : {}),
    ...(record.runningOrder && record.orderKind === 'latest' && record.liveFromMs ? { liveFromMs: record.liveFromMs } : {}),
  }
}

/** A schedule size worth keeping: a whole number of programmes, only while it leaves some of a running order out. */
export function keptScheduleSize(order: readonly string[] | undefined, size: number | undefined): number | undefined {
  if (!order?.length || size === undefined || !Number.isFinite(size)) return undefined
  const whole = Math.floor(size)
  return whole >= 1 && whole < order.length ? whole : undefined
}

export function cleanName(name: string, fallback: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 80) || fallback
}

function withEdit(record: StoredSource, edit: ChannelEdit, now: number): StoredSource {
  const sources = edit.sources.map(curatedSource)
  const { runningOrder: _previous, scheduleSize: _size, emptySlot: _empty, editorial: _notes, orderKind: _kind, compiled: _compiled, liveFromMs: _live, ...bare } = record
  const editorial = cleanEditorial(edit.editorial)
  const order = orderFor(sources, edit)
  const scheduleSize = keptScheduleSize(order, edit.scheduleSize)
  const rest = {
    ...bare,
    ...(editorial ? { editorial } : {}),
    ...(scheduleSize ? { scheduleSize } : {}),
    ...(order && edit.orderKind ? { orderKind: edit.orderKind } : {}),
    ...(edit.compiled ? { compiled: edit.compiled } : {}),
    ...(order && edit.orderKind === 'latest' && edit.liveFromMs ? { liveFromMs: edit.liveFromMs } : {}),
  }
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
      videos: inventoryOf(airingSources(sources)),
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
    videos: inventoryOf(airingSources(sources)),
    ...(order ? { runningOrder: order } : {}),
    updatedAt: now,
  }
}

/** Save one channel's name and sources. Throws if that channel is not a stored user channel. */
export function applyChannelEdit(all: readonly StoredSource[], channelNumber: number, edit: ChannelEdit, now: number): StoredSource[] {
  if (!isOwnNumber(channelNumber)) {
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
  return admitted(await rescanEach(sources, deps, now))
}

/** Read, but refused by its publisher: a video kept on YouTube, which trying again will not change. */
function refusedByPublisher(caught: unknown): boolean {
  return caught instanceof Error && /does not allow it to play outside YouTube/.test(caught.message)
}

function rescanEach(sources: readonly ChannelSource[], deps: RescanDeps, now: number): Promise<ChannelSource[]> {
  return Promise.all(
    sources.map(async (original): Promise<ChannelSource> => {
      const source = copySource(original)
      if (!source.enabled) return source
      if (source.kind === 'tvn') return { ...source, status: { state: 'ready', checkedAt: now } }
      const single = singleVideoId(source)
      if (single) {
        if (source.videos?.length) return { ...source, status: { state: 'ready', playable: source.videos.length, checkedAt: now } }
        try {
          // YouTube's Mix of a video leads with that video, read from its own page and checked as embeddable.
          const found = await deps.resolveYouTube(`${singleVideoUrl(single)}&list=RD${single}`)
          const video = found.videos.find((item) => item.id === single)
          if (!video) return { ...source, status: { state: 'unavailable', playable: 0, checkedAt: now } }
          return { ...source, label: source.label || video.title, videos: [{ ...video }], status: { state: 'ready', playable: 1, checkedAt: now } }
        } catch (caught) {
          return { ...source, status: { state: refusedByPublisher(caught) ? 'unavailable' : 'failed', playable: 0, checkedAt: now } }
        }
      }
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
          const deep = heldDeeper(source, found.videos.length)
          const fresh = withPlaylistVideos(rescanned(found.videos, source.videos, mode, deep), await playlistVideos(source, deps.resolveYouTube))
          const [widened] = widenSources([{ ...source, ref: found.channelId, ...(youtube ? { youtube } : {}), videos: fresh }], deps.archiveOf)
          const videos = widened.videos ?? []
          return {
            ...widened,
            ...(deep ? { deep: true } : {}),
            ...pagingAfterRescan({ ...source, deep }, found),
            // What was typed (a handle, a video) gives way to the channel or playlist it resolved to.
            url: canonicalYouTubeUrl({ ref: found.channelId, url: source.url, ...(youtube ? { youtube } : {}) }),
            label: found.title || source.label,
            status: { state: 'ready', playable: videos.length, checkedAt: now },
          }
        } catch (caught) {
          return { ...source, status: { state: refusedByPublisher(caught) ? 'unavailable' : 'failed', playable: source.videos?.length ?? 0, checkedAt: now } }
        }
      }
      if (source.kind === 'podcast') {
        if (!deps.resolveFeed) return { ...source, status: { state: 'failed', playable: source.videos?.length ?? 0, checkedAt: now } }
        try {
          const found = await deps.resolveFeed(source.url, ...wider(sourceModeOf(source)))
          const info = found.website ? { ...source.info, website: source.info?.website ?? found.website } : source.info
          const deep = heldDeeper(source, found.episodes.length)
          const videos = deep ? mergedFresh(found.episodes, source.videos).slice(0, MAX_SOURCE_VIDEOS) : found.episodes.map((video) => ({ ...video }))
          return {
            ...source,
            url: found.feedUrl,
            ref: found.feedUrl,
            label: found.title || source.label,
            videos,
            ...(deep ? { deep: true } : {}),
            ...(info ? { info } : {}),
            status: { state: 'ready', playable: videos.length, checkedAt: now },
          }
        } catch {
          // A site with no feed, never read as a podcast: shown as the website it is, if it can be.
          if (!source.videos?.length && source.status?.state !== 'ready') {
            const site = await rescanWebsite({ ...source, kind: 'website' }, deps, now)
            if (site.status?.state === 'ready' && site.videos?.length) return site
          }
          return { ...source, status: { state: 'failed', playable: source.videos?.length ?? 0, checkedAt: now } }
        }
      }
      if (source.kind === 'website') return rescanWebsite(source, deps, now)
      const verdict = await deps.probeStream(source).catch(() => 'unavailable' as const)
      return { ...source, label: source.label || hostOf(source.url), status: { state: verdict, checkedAt: now } }
    }),
  )
}

/**
 * Whether a source holds more than one fresh read finds: it was read deeper (LOAD MORE, LOAD ALL, a whole feed
 * read when it was added), so a rescan adds what is new to what it holds and never cuts it back to the newest.
 */
function heldDeeper(source: ChannelSource, freshCount: number): boolean {
  return source.deep === true || (source.videos?.length ?? 0) > freshCount
}

/**
 * Where a rescanned YouTube source's next batch starts. A source loaded deeper keeps its own position, so
 * LOAD MORE carries on past what it holds rather than from the newest uploads again.
 */
function pagingAfterRescan(source: ChannelSource, found: { listed?: number; next?: string }): Pick<ChannelSource, 'listed' | 'more' | 'complete'> {
  const listed = found.listed ?? source.listed
  if (source.deep) return { ...(listed !== undefined ? { listed } : {}), ...(source.more ? { more: source.more } : {}), ...(source.complete ? { complete: true } : {}) }
  return { ...(listed !== undefined ? { listed } : {}), ...(found.next ? { more: found.next } : { complete: true }) }
}

export interface LoadMoreDeps {
  resolveYouTube: RescanDeps['resolveYouTube']
  resolveBatch(cursor: string, signal?: AbortSignal): Promise<{ videos: readonly ImportedVideo[]; listed?: number; next?: string }>
  /** A podcast or website feed read in full (its ALL mode). */
  resolveFeed?: RescanDeps['resolveFeed']
  /** The YouTube channel an imported list came from, when TVN knows it: such a list is read further from that channel. */
  uploaderOf?: RescanDeps['uploaderOf']
}

export interface LoadMoreOptions {
  /** LOAD ALL: keep reading batches until the source is exhausted or the safety ceiling is reached. */
  all?: boolean
  /**
   * RE-CHECK: read the whole source again from its start, uncached. A read that reaches the end leaves the source
   * holding exactly what it offers now (new programmes in, withdrawn ones out); a stopped one only adds.
   */
  recheck?: boolean
  signal?: AbortSignal
  onProgress?(loaded: number, listed: number | undefined): void
}

/** Whether a source can be read further than it has been; an imported list only when its uploader is known. */
export function canLoadMore(source: ChannelSource, uploaderKnown = false): boolean {
  const held = source.videos?.length ?? 0
  if (!source.enabled || held >= MAX_SOURCE_VIDEOS) return false
  // Holding well short of what the source lists: an earlier read stopped early, or a rescan cut it back, so it reads on.
  const cutShort = (source.kind === 'youtube' || source.kind === 'podcast') && source.listed !== undefined && held < source.listed * 0.9
  // A podcast is read whole again until a whole read has counted its episodes and it holds about that many.
  if (source.kind === 'podcast') return !source.deep || !source.complete || source.listed === undefined || cutShort
  // Only a read past the first batch proves the end was reached; a plain rescan finding no next page does not.
  if (source.complete && source.deep && !cutShort) return false
  return source.kind === 'youtube' || (source.kind === 'collection' && uploaderKnown)
}

/**
 * Read a source past its first batch: LOAD MORE adds the next batch with anything new, LOAD ALL reads on
 * until the provider's list ends, the ceiling is reached or the viewer cancels. Programmes already held
 * are never duplicated and keep every date already found; new ones join after them, oldest last. Each
 * batch is one listing page, read one after another, so TVN never floods the provider.
 */
export async function loadMoreSource(source: ChannelSource, deps: LoadMoreDeps, options: LoadMoreOptions = {}, now = Date.now()): Promise<ChannelSource> {
  if (source.kind === 'collection') {
    const uploader = source.ref ? deps.uploaderOf?.(source.ref) : null
    if (!uploader) throw new Error('TVN does not know which channel this list came from')
    const read = await loadMoreSource({ ...source, kind: 'youtube', youtube: 'channel', ref: uploader, url: `https://www.youtube.com/channel/${uploader}` }, deps, options, now)
    const { youtube: _youtube, ...rest } = read
    return { ...rest, kind: 'collection', url: source.url, ref: source.ref }
  }
  const recheck = options.recheck === true && (source.kind === 'youtube' || source.kind === 'podcast')
  const previous = (source.videos ?? []).map((video) => ({ ...video }))
  const held = recheck ? [] : previous.map((video) => ({ ...video }))
  const seen = new Set(held.map((video) => video.id))
  const add = (fresh: readonly ImportedVideo[]) => {
    let added = 0
    for (const video of keepingDates(fresh, recheck ? previous : held)) {
      if (seen.has(video.id) || held.length >= MAX_SOURCE_VIDEOS) continue
      seen.add(video.id)
      held.push(video)
      added += 1
    }
    return added
  }
  const done = (extra: Pick<ChannelSource, 'listed' | 'more' | 'complete'>): ChannelSource => {
    const { more: _more, complete: _complete, listed: _listed, ...rest } = source
    if (recheck && held.length === 0) throw new Error('The source listed nothing; what it held is kept')
    // A re-check cut short only adds: nothing is dropped unless the whole list was read. Programmes from the
    // filter's playlists come from those playlists, not this list, so they stay.
    if (recheck) for (const video of previous) if (!seen.has(video.id) && (!extra.complete || video.lists?.length) && held.length < MAX_SOURCE_VIDEOS) held.push(video)
    return { ...rest, ...extra, deep: true, videos: held, status: { state: 'ready', playable: held.length, checkedAt: now } }
  }
  if (source.kind === 'podcast') {
    if (!deps.resolveFeed) throw new Error('TVN cannot read this feed further')
    const found = await deps.resolveFeed(source.url, { mode: 'all' })
    add(found.episodes)
    // What a whole read of the feed gives: a later rescan that leaves it holding far fewer can be read again.
    const listed = found.episodes.length
    options.onProgress?.(held.length, listed)
    return done({ listed, complete: true })
  }
  if (source.kind !== 'youtube') return source
  let listed = source.listed
  let cursor = recheck ? undefined : source.more
  let restarted = false
  const restart = async () => {
    restarted = true
    const found = await deps.resolveYouTube(canonicalYouTubeUrl(source), ...(recheck ? [{ fresh: true }] : []))
    add(found.videos)
    listed = found.listed ?? listed
    cursor = found.next
  }
  if (!cursor) await restart()
  options.onProgress?.(held.length, listed)
  while (cursor && held.length < MAX_SOURCE_VIDEOS && !options.signal?.aborted) {
    let batch
    try {
      batch = await deps.resolveBatch(cursor, options.signal)
    } catch (error) {
      if (options.signal?.aborted) break
      // A remembered position YouTube no longer honours is found again from the start of the list, once.
      if (restarted) throw error
      await restart()
      continue
    }
    const added = add(batch.videos)
    listed = batch.listed ?? listed
    cursor = batch.next
    options.onProgress?.(held.length, listed)
    if (!options.all && !recheck && added > 0) break
  }
  const ended = !cursor && held.length < MAX_SOURCE_VIDEOS
  return done({ ...(listed !== undefined ? { listed } : {}), ...(cursor ? { more: cursor } : {}), ...(ended ? { complete: true } : {}) })
}

/**
 * Whether LOAD ALL & EXPORT reads a source to its end: a YouTube channel through its own uploads, a YouTube
 * playlist through that playlist alone, a podcast's whole feed. An imported list or a single video is kept as it
 * is, since reading one further would add its uploader's other programmes.
 */
export function loadsWhole(source: ChannelSource): boolean {
  if (!source.enabled || singleVideoId(source)) return false
  return (source.kind === 'youtube' || source.kind === 'podcast') && canLoadMore(source)
}

/**
 * One User Network channel brought up to date and read in full: rescanned for anything new (keeping all it holds),
 * then every source `loadsWhole` reads is loaded to its end. `onProgress` reports how far through the channel it
 * is, 0 to 1. A source that cannot be read keeps what it had; a stop keeps whatever has arrived.
 */
export async function loadChannelWhole(
  edit: ChannelEdit,
  deps: RescanDeps,
  load: (source: ChannelSource, options: LoadMoreOptions) => Promise<ChannelSource>,
  options: { signal?: AbortSignal; onProgress?(fraction: number): void } = {},
  now = Date.now(),
): Promise<ChannelEdit> {
  const rescanned = await rescanSources(edit.sources, deps, now)
  const wanted = rescanned.filter(loadsWhole)
  const steps = 1 + wanted.length
  options.onProgress?.(1 / steps)
  const read = new Map<string, ChannelSource>()
  for (const [index, source] of wanted.entries()) {
    if (options.signal?.aborted) break
    const found = await load(source, {
      all: true,
      ...(options.signal ? { signal: options.signal } : {}),
      onProgress: (loaded, listed) => options.onProgress?.((1 + index + (listed ? Math.min(1, loaded / listed) : 0)) / steps),
    }).catch(() => null)
    if (found) read.set(source.id, found)
    options.onProgress?.((2 + index) / steps)
  }
  const sources = admitted(rescanned.map((source) => read.get(source.id) ?? source))
  return { ...edit, sources }
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
  // A channel with no name of its own takes its publisher's, as the source names itself.
  const named = sources.find((source) => source.enabled && source.kind !== 'tvn' && source.label && source.status?.state === 'ready')?.label
  const renamed = { ...edit, sources, ...(!edit.name.trim() && named ? { name: named } : {}) }
  const next = { ...renamed, compiled: eligibilityKey(renamed) }
  return { all: applyChannelEdit(all, channelNumber, next, now), edit: next, message: rescanSummary(sources) }
}
