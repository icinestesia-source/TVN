import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import { isShippedEditorial, shippedEditorial } from '../data/central-editorial.ts'
import { cleanEditorial } from './channel-curation.ts'
import { cleanName, curatedSource, keptOrder, keptScheduleSize, type ChannelEdit } from './channel-editor.ts'
import { inOrder, inventoryOf, liveStreamOf, type ChannelSource } from './channel-sources.ts'
import { channelsFromSources } from './channels-import.ts'
import { activeOriginals, cleanOriginals, ORIGINAL_ID_PREFIX, originalChannelSources, type OriginalSource } from './original-sources.ts'

/**
 * A viewer's own curation of 001–999 channels: a local override, one record per channel number, laid over
 * the shipped channel when the catalogue is built. SHIPPED CHANNEL + OVERRIDE = THE VIEWER'S CHANNEL. The
 * shipped manifest and every other visitor's TVN are never touched, and restoring a channel simply drops
 * its record. An override may rename and describe the channel, add, switch off and filter sources, leave
 * out or reorder TVN's programmes, and carry editorial notes, status and related channels.
 */
export const CURATED_EDITS_KEY = 'tvn.channel-edits.v1'

/** The shipped channel an override was made against, so a later TVN can tell when it has changed underneath. */
export interface CuratedBaseline {
  name: string
  programmes: number
  /** FNV-1a over the shipped programme ids, in order. */
  fingerprint: string
}

export interface CuratedEdit extends ChannelEdit {
  channelNumber: number
  savedAt: number
  baseline?: CuratedBaseline
  /** What a restore could not carry over because TVN's channel had changed; shown in Edit Channel. */
  conflicts?: string[]
}

export const DESCRIPTION_LIMIT = 500

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadCuratedEdits(store: Store | null = browserStore()): Record<string, CuratedEdit> {
  if (!store) return {}
  try {
    const parsed = JSON.parse(store.getItem(CURATED_EDITS_KEY) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, CuratedEdit>) : {}
  } catch {
    return {}
  }
}

export function loadCuratedEdit(channelNumber: number, store: Store | null = browserStore()): CuratedEdit | null {
  return loadCuratedEdits(store)[String(channelNumber)] ?? null
}

function writeAll(all: Record<string, CuratedEdit>, store: Store | null) {
  store?.setItem(CURATED_EDITS_KEY, JSON.stringify(all))
}

/** Replace every override at once (a restore). */
export function replaceCuratedEdits(edits: readonly CuratedEdit[], store: Store | null = browserStore()): void {
  writeAll(Object.fromEntries(edits.map((edit) => [String(edit.channelNumber), edit])), store)
}

export const TVN_SOURCE_ID = 'tvn'

/** The curated channel's own programming, as TVN ships and schedules it. */
export function tvnSource(enabled = true): ChannelSource {
  return { id: TVN_SOURCE_ID, kind: 'tvn', url: '', label: 'TVN programming', enabled, status: { state: 'ready', checkedAt: 0 } }
}

export function shippedBaseline(shipped: Pick<Channel, 'name'>, programmeIds: readonly string[]): CuratedBaseline {
  let hash = 0x811c9dc5
  for (const char of programmeIds.join('\n')) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return { name: shipped.name, programmes: programmeIds.length, fingerprint: hash.toString(16).padStart(8, '0') }
}

/** Whether TVN's channel has changed since the override was saved. An override from before baselines has nothing to compare. */
export function baselineChanged(saved: CuratedEdit, current: CuratedBaseline): boolean {
  const was = saved.baseline
  return Boolean(was && (was.name !== current.name || was.fingerprint !== current.fingerprint))
}

/**
 * Whether an override was made for another channel than the one TVN now ships at its number. Numbers are
 * editorial slots, so such an override is never laid over the channel that has taken the slot.
 */
export function madeForAnother(saved: CuratedEdit, shipped: Pick<Channel, 'name'>): boolean {
  return Boolean(saved.baseline && saved.baseline.name !== shipped.name)
}

/** The overrides laid over the network now: those set aside for another channel are left out. */
export function appliedCuratedEdits(
  shippedAt: (channelNumber: number) => Pick<Channel, 'name'> | undefined,
  store: Store | null = browserStore(),
): Record<string, CuratedEdit> {
  return Object.fromEntries(
    Object.entries(loadCuratedEdits(store)).filter(([, edit]) => {
      const shipped = shippedAt(edit.channelNumber)
      return shipped !== undefined && !madeForAnother(edit, shipped)
    }),
  )
}

/**
 * Overrides follow the channel they were made for. When TVN moves a channel to another number, its override
 * moves with it, found again by the one shipped channel that carries the name it was made against. One whose
 * channel cannot be found again, or whose new number already has its own override, stays where it was and
 * is set aside (`madeForAnother`).
 */
export function followMovedChannels<T extends Pick<Channel, 'number' | 'name'>>(
  all: Readonly<Record<string, CuratedEdit>>,
  shipped: readonly T[],
  baselineOf: (channel: T) => CuratedBaseline,
): { edits: Record<string, CuratedEdit>; moved: string[] } {
  const edits = { ...all }
  const moved: string[] = []
  const at = new Map(shipped.map((channel) => [channel.number, channel]))
  for (const edit of Object.values(all)) {
    const was = edit.baseline?.name
    const here = at.get(edit.channelNumber)
    if (!was || (here && here.name === was)) continue
    const found = shipped.filter((channel) => channel.name === was && channel.number >= 1 && channel.number <= 999)
    if (found.length !== 1 || edits[String(found[0].number)]) continue
    const target = found[0]
    const line = `TVN moved ${was} from ${String(edit.channelNumber).padStart(3, '0')} to ${String(target.number).padStart(3, '0')} · your curation moved with it`
    delete edits[String(edit.channelNumber)]
    edits[String(target.number)] = { ...edit, channelNumber: target.number, baseline: baselineOf(target), conflicts: [...(edit.conflicts ?? []), line] }
    moved.push(line)
  }
  return { edits, moved }
}

/** What the editor shows for a curated channel: the viewer's saved change, or the channel as shipped. */
export function curatedEditOf(channel: Pick<Channel, 'number' | 'name'>, saved: CuratedEdit | null): ChannelEdit {
  const shippedNotes = shippedEditorial(channel.number)
  if (!saved) return { name: channel.name, sources: [tvnSource()], ...(shippedNotes ? { editorial: shippedNotes } : {}) }
  const sources = saved.sources.some((source) => source.kind === 'tvn') ? saved.sources : [tvnSource(), ...saved.sources]
  return {
    name: saved.name,
    sources: sources.map(curatedSource),
    ...(saved.order ? { order: [...saved.order] } : {}),
    ...(saved.order && saved.scheduleSize ? { scheduleSize: saved.scheduleSize } : {}),
    ...(saved.excluded?.length ? { excluded: [...saved.excluded] } : {}),
    ...(saved.description ? { description: saved.description } : {}),
    ...(saved.editorial ? { editorial: structuredClone(saved.editorial) } : shippedNotes ? { editorial: shippedNotes } : {}),
    ...(saved.originals?.length ? { originals: structuredClone(saved.originals) } : {}),
  }
}

function cleanDescription(text: string | undefined, shipped: string | undefined): string | undefined {
  const clean = (text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, DESCRIPTION_LIMIT)
  return clean && clean !== (shipped ?? '').trim() ? clean : undefined
}

function pristine(shipped: Pick<Channel, 'name'>, edit: ChannelEdit): boolean {
  return (
    edit.name === shipped.name &&
    edit.sources.length === 1 &&
    edit.sources[0].kind === 'tvn' &&
    edit.sources[0].enabled &&
    !edit.order &&
    !edit.excluded &&
    !edit.description &&
    !edit.editorial &&
    !edit.originals
  )
}

/**
 * An override in its canonical shape: the TVN programming source first if missing, each source's filter
 * and mode cleaned, the running order and left-out programmes kept to what exists. When the viewer's own
 * sources carry programmes the order is over those; otherwise it is over TVN's own programmes: the
 * library programmes of its original sources (`poolIds`, video ids) where it has them, else its listings.
 */
export function canonicalEdit(
  shipped: Pick<Channel, 'name'> & { description?: string },
  edit: ChannelEdit,
  programmeIds: readonly string[],
  poolIds: readonly string[] = [],
): ChannelEdit {
  const sources = (edit.sources.some((source) => source.kind === 'tvn') ? edit.sources : [tvnSource(), ...edit.sources]).map(curatedSource)
  const ownProgrammes = inventoryOf(sources).length > 0
  const known = new Set([...programmeIds, ...poolIds])
  const tvnIds = poolIds.length ? poolIds : programmeIds
  const tvnOrder = !ownProgrammes && edit.order?.length && tvnIds.length ? inOrder(tvnIds.map((id) => ({ id })), edit.order).map((item) => item.id) : undefined
  // Mixed with TVN's original sources, the viewer's order may also place TVN's own programmes.
  const mixedIds = poolIds.length && edit.order?.length ? new Set([...inventoryOf(sources).map((video) => video.id), ...poolIds]) : null
  const mixedOrder = mixedIds ? [...new Set(edit.order)].filter((id) => mixedIds.has(id)) : []
  const order = ownProgrammes ? (mixedIds ? (mixedOrder.length ? mixedOrder : undefined) : keptOrder(sources, edit.order)) : tvnOrder?.some((id, index) => id !== tvnIds[index]) ? tvnOrder : undefined
  const excluded = [...new Set(edit.excluded ?? [])].filter((id) => known.has(id))
  const scheduleSize = keptScheduleSize(order, edit.scheduleSize)
  const description = cleanDescription(edit.description, shipped.description)
  const editorial = cleanEditorial(edit.editorial)
  const originals = cleanOriginals(edit.originals)
  return {
    name: cleanName(edit.name, shipped.name),
    sources,
    ...(order ? { order } : {}),
    ...(scheduleSize ? { scheduleSize } : {}),
    ...(excluded.length ? { excluded } : {}),
    ...(description ? { description } : {}),
    ...(editorial ? { editorial } : {}),
    ...(originals ? { originals } : {}),
  }
}

/**
 * Save one curated channel's change; every other channel's record is kept as it was. A change that
 * leaves the channel exactly as shipped removes its record instead.
 */
export function saveCuratedEdit(
  shipped: Pick<Channel, 'number' | 'name'> & { description?: string },
  edit: ChannelEdit,
  now: number,
  store: Store | null = browserStore(),
  programmeIds: readonly string[] = [],
  poolIds: readonly string[] = [],
): CuratedEdit | null {
  const number = shipped.number
  if (number < 1 || number > 999) throw new Error('Only TVN channels 001–999 are kept here')
  const next = canonicalEdit(shipped, isShippedEditorial(number, edit.editorial) ? { ...edit, editorial: undefined } : edit, programmeIds, poolIds)
  const all = loadCuratedEdits(store)
  if (pristine(shipped, next)) {
    delete all[String(number)]
    writeAll(all, store)
    return null
  }
  const saved: CuratedEdit = { channelNumber: number, ...next, savedAt: now, baseline: shippedBaseline(shipped, programmeIds) }
  all[String(number)] = saved
  writeAll(all, store)
  return saved
}

export function clearCuratedEdit(channelNumber: number, store: Store | null = browserStore()): void {
  const all = loadCuratedEdits(store)
  delete all[String(channelNumber)]
  writeAll(all, store)
}

/**
 * The shipped channel with the viewer's change laid over it. While TVN programming is the only enabled
 * source the channel keeps its own schedule, unless the viewer has switched off or filtered one of its
 * original sources (`originals`: the channel's library sources as TVN ships them now), or reordered or
 * left out its programmes, when it plays what remains, in their order. The viewer's own sources with
 * programmes play alongside TVN's enabled originals, each through its own filter; a live stream, or TVN
 * programming switched off, leaves only the viewer's sources.
 */
export function buildCuratedEdit(
  shipped: Channel,
  edit: CuratedEdit,
  refused: ReadonlySet<string> = new Set(),
  shippedList: readonly Programme[] = [],
  originals: readonly OriginalSource[] = [],
): { channel: Channel; programmes: Programme[] | null } {
  const name = cleanName(edit.name, shipped.name)
  const description = edit.description?.trim() ? edit.description.trim() : shipped.description
  const own = edit.sources.filter((source) => source.kind !== 'tvn')
  const tvnOn = edit.sources.some((source) => source.kind === 'tvn' && source.enabled)
  if (tvnOn && !liveStreamOf(own) && inventoryOf(own).length === 0) {
    const poolIds = new Set(originals.flatMap((source) => source.videos.map((video) => video.id)))
    const arranged = (edit.order ?? []).some((id) => poolIds.has(id)) || (edit.excluded ?? []).some((id) => poolIds.has(id))
    if (activeOriginals(edit.originals, originals).length > 0 || arranged) {
      const left = new Set(edit.excluded ?? [])
      const sources = originalChannelSources(originals, edit.originals).map((source) => ({ ...source, videos: (source.videos ?? []).filter((video) => !left.has(video.id)) }))
      return fromSources(shipped, edit, name, description, sources, refused, true)
    }
    const left = new Set(edit.excluded ?? [])
    if ((edit.order?.length || left.size) && shippedList.length) {
      const ordered = inOrder(shippedList, edit.order).filter((programme) => !left.has(programme.id))
      const kept = edit.order?.length && edit.scheduleSize ? ordered.slice(0, edit.scheduleSize) : ordered
      if (kept.length) return { channel: { ...shipped, name, description, customLineup: true }, programmes: kept.map((programme) => ({ ...programme })) }
    }
    return { channel: { ...shipped, name, description }, programmes: null }
  }
  if (tvnOn && !liveStreamOf(own)) {
    // TVN's own programming and the viewer's added sources together: each source keeps its identity and filter.
    const left = new Set(edit.excluded ?? [])
    const shippedOwn: ChannelSource[] = originals.length
      ? originalChannelSources(originals, edit.originals).map((source) => ({ ...source, videos: (source.videos ?? []).filter((video) => !left.has(video.id)) }))
      : [shippedAsSource(shippedList, left)].filter((source) => (source.videos?.length ?? 0) > 0)
    // TVN's own programmes are a back catalogue, not recent uploads: spread through, never repeated as newest.
    const spread = shippedOwn.map((source): ChannelSource => ({ ...source, mode: 'all' }))
    return fromSources(shipped, edit, name, description, [...spread, ...own], refused, true)
  }
  return fromSources(shipped, edit, name, description, own, refused)
}

/** A channel's fixed shipped programmes as one source, for mixing with added ones. */
function shippedAsSource(shippedList: readonly Programme[], left: ReadonlySet<string>): ChannelSource {
  const videos = shippedList
    .filter((programme) => programme.videoId && !left.has(programme.id))
    .map((programme) => ({ id: programme.videoId as string, title: programme.title, durationSec: programme.durationSeconds }))
  return { id: `${ORIGINAL_ID_PREFIX}shipped`, kind: 'collection', url: '', label: 'TVN catalogue', enabled: true, videos }
}

/** The channel as its sources make it, under its TVN number and category. */
function fromSources(
  shipped: Channel,
  edit: CuratedEdit,
  name: string,
  description: string,
  own: readonly ChannelSource[],
  refused: ReadonlySet<string>,
  /** TVN's own sources still carry the channel, so it keeps its own description. */
  original = false,
): { channel: Channel; programmes: Programme[] } {
  const built = channelsFromSources(
    [{ id: `tvn-${shipped.number}`, name, videos: inventoryOf(own), channelNumber: shipped.number, inLibrary: false, automatic: true, updatedAt: edit.savedAt, channelSources: [...own], runningOrder: edit.order, ...(edit.order?.length && edit.scheduleSize ? { scheduleSize: edit.scheduleSize } : {}) }],
    { refused },
  )
  const made = built.channels[0]
  const programmes = (built.programmes.get(made.id) ?? []).map((programme) => ({ ...programme, channelId: shipped.id, category: shipped.category }))
  return {
    channel: {
      ...shipped,
      name,
      description: original || edit.description?.trim() ? description : made.description,
      mediaKind: made.mediaKind,
      playbackType: made.playbackType,
      liveSinceMs: made.liveSinceMs,
      customLineup: true,
    },
    programmes,
  }
}
