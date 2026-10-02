import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import { cleanEditorial } from './channel-curation.ts'
import { cleanName, curatedSource, keptOrder, type ChannelEdit } from './channel-editor.ts'
import { inOrder, inventoryOf, liveStreamOf, type ChannelSource } from './channel-sources.ts'
import { channelsFromSources } from './channels-import.ts'

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

/** What the editor shows for a curated channel: the viewer's saved change, or the channel as shipped. */
export function curatedEditOf(channel: Pick<Channel, 'number' | 'name'>, saved: CuratedEdit | null): ChannelEdit {
  if (!saved) return { name: channel.name, sources: [tvnSource()] }
  const sources = saved.sources.some((source) => source.kind === 'tvn') ? saved.sources : [tvnSource(), ...saved.sources]
  return {
    name: saved.name,
    sources: sources.map(curatedSource),
    ...(saved.order ? { order: [...saved.order] } : {}),
    ...(saved.excluded?.length ? { excluded: [...saved.excluded] } : {}),
    ...(saved.description ? { description: saved.description } : {}),
    ...(saved.editorial ? { editorial: structuredClone(saved.editorial) } : {}),
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
    !edit.editorial
  )
}

/**
 * An override in its canonical shape: the TVN programming source first if missing, each source's filter
 * and mode cleaned, the running order and left-out programmes kept to what exists. When the viewer's own
 * sources carry programmes the order is over those; otherwise it is over TVN's own programmes.
 */
export function canonicalEdit(shipped: Pick<Channel, 'name'> & { description?: string }, edit: ChannelEdit, programmeIds: readonly string[]): ChannelEdit {
  const sources = (edit.sources.some((source) => source.kind === 'tvn') ? edit.sources : [tvnSource(), ...edit.sources]).map(curatedSource)
  const ownProgrammes = inventoryOf(sources).length > 0
  const known = new Set(programmeIds)
  const tvnOrder = !ownProgrammes && edit.order?.length && programmeIds.length ? inOrder(programmeIds.map((id) => ({ id })), edit.order).map((item) => item.id) : undefined
  const order = ownProgrammes ? keptOrder(sources, edit.order) : tvnOrder?.some((id, index) => id !== programmeIds[index]) ? tvnOrder : undefined
  const excluded = [...new Set(edit.excluded ?? [])].filter((id) => known.has(id))
  const description = cleanDescription(edit.description, shipped.description)
  const editorial = cleanEditorial(edit.editorial)
  return {
    name: cleanName(edit.name, shipped.name),
    sources,
    ...(order ? { order } : {}),
    ...(excluded.length ? { excluded } : {}),
    ...(description ? { description } : {}),
    ...(editorial ? { editorial } : {}),
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
): CuratedEdit | null {
  const number = shipped.number
  if (number < 1 || number > 999) throw new Error('Only TVN channels 001–999 are kept here')
  const next = canonicalEdit(shipped, edit, programmeIds)
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
 * source the channel keeps its own schedule, unless the viewer has reordered or left out its programmes,
 * when it plays what remains in their order. Once the viewer's own sources carry programmes (or a live
 * stream), or TVN programming is switched off, those sources take over.
 */
export function buildCuratedEdit(
  shipped: Channel,
  edit: CuratedEdit,
  refused: ReadonlySet<string> = new Set(),
  shippedList: readonly Programme[] = [],
): { channel: Channel; programmes: Programme[] | null } {
  const name = cleanName(edit.name, shipped.name)
  const description = edit.description?.trim() ? edit.description.trim() : shipped.description
  const own = edit.sources.filter((source) => source.kind !== 'tvn')
  const tvnOn = edit.sources.some((source) => source.kind === 'tvn' && source.enabled)
  if (tvnOn && !liveStreamOf(own) && inventoryOf(own).length === 0) {
    const left = new Set(edit.excluded ?? [])
    if ((edit.order?.length || left.size) && shippedList.length) {
      const kept = inOrder(shippedList, edit.order).filter((programme) => !left.has(programme.id))
      if (kept.length) return { channel: { ...shipped, name, description, customLineup: true }, programmes: kept.map((programme) => ({ ...programme })) }
    }
    return { channel: { ...shipped, name, description }, programmes: null }
  }
  const built = channelsFromSources(
    [{ id: `tvn-${shipped.number}`, name, videos: inventoryOf(own), channelNumber: shipped.number, inLibrary: false, automatic: true, updatedAt: edit.savedAt, channelSources: own, runningOrder: edit.order }],
    { refused },
  )
  const made = built.channels[0]
  const programmes = (built.programmes.get(made.id) ?? []).map((programme) => ({ ...programme, channelId: shipped.id, category: shipped.category }))
  return {
    channel: {
      ...shipped,
      name,
      description: edit.description?.trim() ? description : made.description,
      mediaKind: made.mediaKind,
      playbackType: made.playbackType,
      liveSinceMs: made.liveSinceMs,
      customLineup: true,
    },
    programmes,
  }
}
