import { isOwnNumber, USER_NUMBER_START } from '../data/network.ts'
import { cleanEditorial, cleanFilter, rescanned, SOURCE_MODES, sourceModeOf, type SourceMode } from './channel-curation.ts'
import { cleanName, keptOrder, widenSources, withPlaylistVideos } from './channel-editor.ts'
import { canonicalYouTubeUrl, inventoryOf, singleVideoId, type ChannelSource } from './channel-sources.ts'
import { EMPTY_SLOT_NAME, emptySlotRecord, sourceIdFor, videoCreator, type ImportedVideo, type StoredSource } from './channels-import.ts'
import { ADDED_PREFIX } from './user-network.ts'
import { TVN_OWNER, type NetworkUser } from '../data/user-network/users.ts'
import { CHANNEL_ID, publicMediaAddress, shareableUrl, storedKindOf, validateUserNetworkExport, type ExportChannel, type ExportSource, type UserNetworkExport } from './user-network-export.ts'

/**
 * RESTORE (OPTIONS → User Network file, or ADD's footer): a tvn-user-network-v1 file restores the viewer's
 * User Network (1001+), its named users and which of them owns each channel. Not IMPORT CHANNEL LIST under +,
 * which merges a channel list into one new user and leaves everything else alone.
 * It is a restore, not a merge: the file's channels replace every 1001+ channel in this browser, on the
 * file's own numbers. TVN channels 001–999, 000 TVN, 1000 Local Media and anything kept outside the User Network are
 * left exactly as they are. Nothing is changed until the file has passed validation and the viewer has
 * confirmed; a file that fails is refused whole.
 */

export type ReadResult =
  | { ok: true; value: UserNetworkExport; channels: number; empty: number; users: number; favourites: number | null }
  | { ok: false; errors: string[] }

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
  return { ok: true, value: checked.value, channels: checked.value.channels.length, empty, users: checked.value.users?.length ?? 0, favourites: checked.value.favourites?.length ?? null }
}

const cleanVideos = (videos: readonly ImportedVideo[] = []): ImportedVideo[] =>
  videos
    .filter((video) => video.id.trim() && video.durationSec >= 0)
    .map(({ id, title, durationSec, published, creator, year, lists, media, mediaKind, summary, image, page, web, pending, live }) => ({
      id,
      title,
      durationSec,
      ...(typeof published === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(published) ? { published } : {}),
      ...(videoCreator(creator) ? { creator: videoCreator(creator) } : {}),
      ...(typeof year === 'number' && Number.isInteger(year) ? { year } : {}),
      ...(Array.isArray(lists) && lists.length ? { lists: lists.filter((list) => typeof list === 'string') } : {}),
      ...((web === 'website' || web === 'post') && typeof media === 'string' && shareableUrl(media) ? { media: shareableUrl(media) } : {}),
      ...(web === undefined && publicMediaAddress(media) ? { media: publicMediaAddress(media), ...(mediaKind === 'video' ? { mediaKind } : {}) } : {}),
      ...(typeof summary === 'string' && summary ? { summary } : {}),
      ...(typeof image === 'string' && shareableUrl(image) ? { image: shareableUrl(image) } : {}),
      ...(typeof page === 'string' && shareableUrl(page) ? { page: shareableUrl(page) } : {}),
      ...(web === 'website' || web === 'post' ? { web } : {}),
      ...(pending === true ? { pending } : {}),
      ...(live === true ? { live } : {}),
    }))

/** How far a source has been read, as the file kept it. */
const readState = (source: ExportSource) => ({
  ...(typeof source.listed === 'number' ? { listed: source.listed } : {}),
  ...(source.complete === true ? { complete: true } : {}),
  ...(source.deep === true ? { deep: true } : {}),
})

/** A YouTube channel or playlist id from its canonical address, when the file does not name it. */
function youTubeRef(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get('list') ?? parsed.pathname.match(/\/channel\/(UC[0-9A-Za-z_-]{22})/)?.[1] ?? undefined
  } catch {
    return undefined
  }
}

export function channelSource(source: ExportSource, index: number): ChannelSource {
  const filter = cleanFilter(source.filter)
  const mode = source.mode && SOURCE_MODES.includes(source.mode) && source.mode !== 'recent' ? source.mode : undefined
  const curation = source.sourceType === 'youtube-channel' || source.sourceType === 'youtube-playlist' || source.sourceType === 'collection' ? { ...(filter ? { filter } : {}), ...(mode ? { mode } : {}) } : {}
  const removed = Array.isArray(source.removed) ? source.removed.filter((id) => typeof id === 'string') : []
  const base = {
    id: `s${index + 1}`,
    label: source.label,
    enabled: source.enabled,
    ...(source.info ? { info: structuredClone(source.info) } : {}),
    ...curation,
    ...(removed.length ? { removed } : {}),
    ...(typeof source.share === 'number' && Number.isInteger(source.share) && source.share >= 0 && source.share <= 100 ? { share: source.share } : {}),
  }
  if (source.sourceType === 'youtube-channel' || source.sourceType === 'youtube-playlist') {
    const ref = source.providerId || youTubeRef(source.url)
    const youtube = source.sourceType === 'youtube-playlist' ? ('playlist' as const) : ('channel' as const)
    return { ...base, kind: 'youtube', url: ref ? canonicalYouTubeUrl({ ref, url: source.url, youtube }) : source.url, ...(ref ? { ref } : {}), youtube, videos: cleanVideos(source.videos), ...readState(source) }
  }
  if (source.sourceType === 'collection') {
    const single = singleVideoId({ kind: 'collection', url: source.url })
    if (single) return { ...base, kind: 'collection', url: source.url, videos: cleanVideos(source.videos), ...readState(source) }
    return { ...base, kind: 'collection', url: '', ref: source.providerId || source.label, videos: cleanVideos(source.videos), ...readState(source) }
  }
  if (source.sourceType === 'tvn') return { ...base, kind: 'tvn', url: '', ...(source.providerId ? { ref: source.providerId } : {}) }
  // A feed's episodes (a podcast, Odysee, BitChute) come back with the public file addresses the file kept, so
  // the channel airs at once; an episode whose address was not kept waits for the feed to be read again. A
  // website programme's address is its own public page, so it comes back as it was.
  const ref = source.providerId ? { ref: source.providerId } : {}
  if (source.sourceType === 'podcast') {
    const episodes = cleanVideos(source.videos).filter((video) => video.media && !video.web)
    return { ...base, kind: 'podcast', url: source.url, ...ref, ...(episodes.length ? { videos: episodes, ...readState(source) } : {}) }
  }
  if (source.sourceType === 'website') {
    const pages = cleanVideos(source.videos).filter((video) => video.web && video.media)
    return { ...base, kind: 'website', url: source.url, ...ref, ...(source.slotSeconds ? { slotSeconds: source.slotSeconds } : {}), ...(pages.length ? { videos: pages } : {}) }
  }
  return { ...base, kind: storedKindOf(source.sourceType), url: source.url, ...ref }
}

/** The record id TVN would have given this channel: an added YouTube source's id, or an imported list's. */
function recordId(channel: ExportChannel, sources: readonly ChannelSource[], taken: Set<string>, seen: Map<string, number>): string {
  const first = sources[0]
  let id: string
  if (channel.id && CHANNEL_ID.test(channel.id) && !taken.has(channel.id)) id = channel.id
  else if (first?.kind === 'youtube' && first.ref) id = `${ADDED_PREFIX}${first.ref}`
  else if (first?.kind === 'collection') id = sourceIdFor(channel.listName ?? first.ref ?? channel.name, seen)
  else id = `user:${channel.number}`
  if (taken.has(id)) id = `${id}-${channel.number}`
  taken.add(id)
  return id
}

/**
 * The stored records the file describes, before any YouTube source has been read again: YouTube
 * channels and playlists come back as addresses to resolve, imported lists with their own programmes.
 * Never carries watched marks, playback state, 1000 Local Media or object URLs, since the file holds none.
 */
export function recordsFromExport(doc: UserNetworkExport, now: number): StoredSource[] {
  const taken = new Set<string>()
  const seen = new Map<string, number>()
  return doc.channels
    .filter((channel) => isOwnNumber(channel.number))
    .map((channel): StoredSource => {
      const owner = channel.owner && channel.owner !== TVN_OWNER ? { owner: channel.owner } : {}
      const editorial = cleanEditorial(channel.editorial)
      const notes = editorial ? { editorial } : {}
      if (channel.state === 'empty') {
        taken.add(`slot:${channel.number}`)
        return { ...emptySlotRecord(channel.number, now), name: cleanName(channel.name, EMPTY_SLOT_NAME), ...owner, ...notes }
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
        ...(channel.runningOrder?.length && channel.scheduleSize ? { scheduleSize: channel.scheduleSize } : {}),
        ...(channel.runningOrder?.length && channel.orderKind ? { orderKind: channel.orderKind } : {}),
        ...(channel.runningOrder?.length && channel.orderKind === 'latest' && channel.liveFromMs ? { liveFromMs: channel.liveFromMs } : {}),
        ...owner,
        ...notes,
      }
      const curated = Boolean(first?.filter || first?.mode)
      // A list that brings no programmes keeps its source, so the channel stays listed to be rescanned.
      const plain = !channel.edited && !curated && sources.length === 1 && ((first.kind === 'youtube' && Boolean(first.ref)) || (first.kind === 'collection' && record.videos.length > 0))
      if (plain && first.kind === 'youtube') return { ...record, sourceType: first.youtube === 'playlist' ? 'youtube-playlist' : 'youtube-channel' }
      if (plain) return { ...record, ...(channel.listName ? { listName: channel.listName } : {}) }
      return { ...record, channelSources: sources, ...(channel.listName ? { listName: channel.listName } : {}) }
    })
}

/**
 * The named users after a restore: exactly the file's, by their own ids. RESTORE rebuilds the User Network
 * the file describes, so users only in this browser go; a file from before named users leaves none, and
 * every channel it restores is TVN's.
 */
export function usersFromExport(doc: UserNetworkExport): NetworkUser[] {
  return (doc.users ?? []).map(({ id, name }) => ({ id, name: name.replace(/\s+/g, ' ').trim() }))
}

export interface RestoreDeps {
  /** TVN's keyless lookup of a YouTube channel or playlist; ARCHIVE and ALL ask it for everything the page lists. */
  resolveYouTube(url: string, options?: { mode?: SourceMode }): Promise<{ channelId: string; title: string; videos: readonly ImportedVideo[] }>
  /** TVN's shipped back catalogue for a source, which ARCHIVE and ALL add to it. */
  archiveOf?(source: ChannelSource): readonly ImportedVideo[]
  /** TVN's keyless feed reader, for podcast sources, and (as a website) for website and post sources. */
  resolveFeed?(url: string, options?: { mode?: SourceMode; as?: 'website' }): Promise<{ feedUrl: string; episodes: readonly ImportedVideo[] }>
}

/** What one source asks the lookup for: its address, and how far back it reaches. */
const lookupKey = (source: ChannelSource) => `${canonicalYouTubeUrl(source)}|${sourceModeOf(source)}`
const playlistKey = (id: string) => `playlist:${id}`
const feedKey = (source: ChannelSource) => `feed:${source.url}|${sourceModeOf(source)}`
const pageKey = (source: ChannelSource) => `page:${source.url}`

/** The YouTube sources a restored record must read again: its own when plain, its enabled ones when edited. */
function youTubeSourcesOf(record: StoredSource): ChannelSource[] {
  if (record.channelSources) return record.channelSources.filter((source) => source.kind === 'youtube' && source.enabled)
  if (!record.id.startsWith(ADDED_PREFIX)) return []
  const ref = record.id.slice(ADDED_PREFIX.length)
  const youtube = record.sourceType === 'youtube-playlist' ? ('playlist' as const) : ('channel' as const)
  return [{ id: 's1', kind: 'youtube', url: canonicalYouTubeUrl({ ref, url: '', youtube }), label: record.name, enabled: true, ref, youtube }]
}

export interface RestoreOptions {
  /** False: build the channels from the file alone, reading nothing; each source keeps what the file holds. */
  read?: boolean
  /** Each finished read, out of all of them. */
  onProgress?: (done: number, total: number) => void
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
  options: RestoreOptions = {},
): Promise<{ records: StoredSource[]; failed: number }> {
  const reading = options.read !== false
  // One lookup per address and mode, and one per playlist a filter names, however many channels share them.
  const lookups = new Map<string, { url: string; mode: SourceMode; feed?: boolean; page?: boolean }>()
  for (const record of records) {
    for (const source of youTubeSourcesOf(record)) lookups.set(lookupKey(source), { url: canonicalYouTubeUrl(source), mode: sourceModeOf(source) })
    for (const source of record.channelSources ?? []) {
      if (!source.enabled) continue
      if (source.kind === 'podcast' && deps.resolveFeed) lookups.set(feedKey(source), { url: source.url, mode: sourceModeOf(source), feed: true })
      if (source.kind === 'website' && deps.resolveFeed) lookups.set(pageKey(source), { url: source.url, mode: 'recent', page: true })
      for (const id of source.filter?.include?.playlists ?? []) lookups.set(playlistKey(id), { url: `https://www.youtube.com/playlist?list=${id}`, mode: 'all' })
    }
  }
  const jobs = reading ? [...lookups] : []
  const found = new Map<string, readonly ImportedVideo[] | null>()
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < jobs.length) {
      const [key, { url, mode, feed, page }] = jobs[next++]
      try {
        if (page && deps.resolveFeed) {
          found.set(key, (await deps.resolveFeed(url, { as: 'website' })).episodes.filter((video) => video.web))
          continue
        }
        if (feed && deps.resolveFeed) {
          found.set(key, (await (mode === 'recent' ? deps.resolveFeed(url) : deps.resolveFeed(url, { mode }))).episodes)
          continue
        }
        const read = await (mode === 'recent' ? deps.resolveYouTube(url) : deps.resolveYouTube(url, { mode }))
        found.set(key, read.videos)
      } catch {
        found.set(key, null)
      } finally {
        options.onProgress?.(++done, jobs.length)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker))
  let failed = 0
  const listed = (source: ChannelSource): ImportedVideo[] =>
    (source.filter?.include?.playlists ?? []).flatMap((id) => cleanVideos(found.get(playlistKey(id)) ?? []).map((video) => ({ ...video, lists: [id] })))
  const out = records.map((record) => {
    const wanted = youTubeSourcesOf(record)
    const curated = record.channelSources?.some((source) => source.filter?.include?.playlists?.length || sourceModeOf(source) !== 'recent' || source.kind === 'podcast' || source.kind === 'website') ?? false
    if (wanted.length === 0 && !curated) return record
    if (!reading && !record.channelSources) return record
    const read = (source: ChannelSource) => found.get(lookupKey(source)) ?? null
    if (reading) failed += wanted.filter((source) => read(source) === null).length
    const order = (sources: readonly ChannelSource[]) => keptOrder(sources, record.runningOrder) ?? record.runningOrder
    if (!record.channelSources) {
      // What the file held stays; a fresh read only adds to it and brings its dates.
      const fresh = read(wanted[0])
      const videos = fresh === null ? record.videos : rescanned(cleanVideos(fresh), record.videos, 'recent', record.videos.length > 0)
      // Nothing to air yet: the channel keeps its source and its number, listed for a later rescan.
      if (videos.length === 0) {
        const status = { state: fresh === null ? 'failed' : 'ready', playable: 0, checkedAt: now } as const
        return { ...record, videos: [], channelSources: [{ ...wanted[0], videos: [], status }] }
      }
      const sources: ChannelSource[] = [{ ...wanted[0], videos }]
      const runningOrder = videos.length > 0 ? order(sources) : record.runningOrder
      return { ...record, videos, ...(runningOrder?.length ? { runningOrder } : {}) }
    }
    const readSources = record.channelSources.map((source): ChannelSource => {
      if (!reading) {
        if (source.kind === 'website') {
          const { slotSeconds, ...rest } = source as ChannelSource & { slotSeconds?: number }
          return slotSeconds ? { ...rest, videos: (source.videos ?? []).map((video) => ({ ...video, durationSec: slotSeconds })) } : rest
        }
        return source.kind === 'collection' && source.enabled ? { ...source, videos: withPlaylistVideos(source.videos ?? [], []) } : source
      }
      if (source.enabled && source.kind === 'podcast') {
        const episodes = found.get(feedKey(source)) ?? null
        if (episodes === null) failed += 1
        return episodes === null
          ? { ...source, status: { state: 'failed', playable: 0, checkedAt: now } }
          : (() => {
            // The newest episodes join every episode the file kept: a feed read in full is never cut back to its latest.
            const videos = rescanned(cleanVideos(episodes), source.videos ?? [], 'recent', (source.videos?.length ?? 0) > 0)
            return { ...source, videos, status: { state: 'ready' as const, playable: videos.length, checkedAt: now } }
          })()
      }
      if (source.enabled && source.kind === 'website') {
        const pages = found.get(pageKey(source)) ?? null
        const { slotSeconds, ...rest } = source as ChannelSource & { slotSeconds?: number }
        if (pages === null) failed += 1
        return pages === null
          ? { ...rest, status: { state: 'failed', playable: 0, checkedAt: now } }
          : { ...rest, videos: pages.map((video) => ({ ...video, ...(slotSeconds ? { durationSec: slotSeconds } : {}) })), status: { state: 'ready', playable: pages.length, checkedAt: now } }
      }
      if (!source.enabled || (source.kind !== 'youtube' && source.kind !== 'collection')) return source
      if (source.kind === 'collection') return { ...source, videos: withPlaylistVideos(source.videos ?? [], listed(source)) }
      const videos = read(source)
      return videos === null
        ? { ...source, status: { state: 'failed', playable: 0, checkedAt: now } }
        : {
            ...source,
            videos: withPlaylistVideos(rescanned(cleanVideos(videos), source.videos ?? [], sourceModeOf(source), (source.videos?.length ?? 0) > 0), listed(source)),
            status: { state: 'ready', playable: videos.length, checkedAt: now },
          }
    })
    const channelSources = widenSources(readSources, deps.archiveOf)
    const videos = inventoryOf(channelSources)
    const runningOrder = videos.length > 0 ? order(channelSources) : record.runningOrder
    const { runningOrder: _old, ...rest } = record
    return { ...rest, channelSources, videos, ...(runningOrder?.length ? { runningOrder } : {}) }
  })
  return { records: out, failed }
}

/** The whole stored list after a restore: every 1001+ channel replaced by the file's; everything else untouched. */
export function restoreUserNetwork(existing: readonly StoredSource[], restored: readonly StoredSource[]): StoredSource[] {
  const userNumber = (record: StoredSource) => isOwnNumber(record.channelNumber)
  const restoredIds = new Set(restored.map((record) => record.id))
  // A record outside 1001+ with the same id as a restored channel (a list kept in the library only) gives way to it.
  const kept = existing.filter((record) => !userNumber(record) && !restoredIds.has(record.id))
  return [...kept, ...restored.filter(userNumber)]
}

/**
 * Favourites after a restore. Curated, 000 and 1000 favourites stay. When the file lists its own User
 * Network Favourites, those replace this browser's 1001+ ones. Otherwise a 1001+ favourite stays on its
 * number when the restored network has that number (the viewer is restoring stable numbers); one whose
 * number the restored network does not have is dropped, so a channel added there later never inherits it.
 * Nothing is reseeded.
 */
export function favouritesAfterRestore(favourites: readonly number[], restored: readonly StoredSource[], fromFile?: readonly number[]): number[] {
  const numbers = new Set(restored.map((record) => record.channelNumber))
  if (!fromFile) return favourites.filter((number) => number < USER_NUMBER_START || numbers.has(number))
  // A file that lists its Favourites decides the User Network's; every other Favourite stays where it was.
  const filled = new Set(restored.filter((record) => !record.emptySlot).map((record) => record.channelNumber))
  const kept = favourites.filter((number) => number < USER_NUMBER_START)
  return [...kept, ...fromFile.filter((number) => filled.has(number) && !kept.includes(number))]
}
