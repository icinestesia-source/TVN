import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import { cleanName, keptOrder, type ChannelEdit } from './channel-editor.ts'
import { inventoryOf, liveStreamOf, type ChannelSource } from './channel-sources.ts'
import { channelsFromSources } from './channels-import.ts'

/**
 * A viewer's own changes to curated 001–999 channels. They live in this browser only, one record per
 * channel number, laid over the shipped channel when the catalogue is built. The shipped manifest and
 * every other visitor's TVN are never touched, and restoring a channel simply drops its record.
 */
export const CURATED_EDITS_KEY = 'tvn.channel-edits.v1'

export interface CuratedEdit extends ChannelEdit {
  channelNumber: number
  savedAt: number
}

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

export const TVN_SOURCE_ID = 'tvn'

/** The curated channel's own programming, as TVN ships and schedules it. */
export function tvnSource(enabled = true): ChannelSource {
  return { id: TVN_SOURCE_ID, kind: 'tvn', url: '', label: 'TVN programming', enabled, status: { state: 'ready', checkedAt: 0 } }
}

/** What the editor shows for a curated channel: the viewer's saved change, or the channel as shipped. */
export function curatedEditOf(channel: Pick<Channel, 'number' | 'name'>, saved: CuratedEdit | null): ChannelEdit {
  if (!saved) return { name: channel.name, sources: [tvnSource()] }
  const sources = saved.sources.some((source) => source.kind === 'tvn') ? saved.sources : [tvnSource(), ...saved.sources]
  return { name: saved.name, sources: sources.map((source) => ({ ...source })), ...(saved.order ? { order: [...saved.order] } : {}) }
}

function pristine(shipped: Pick<Channel, 'name'>, edit: ChannelEdit): boolean {
  return edit.name === shipped.name && edit.sources.length === 1 && edit.sources[0].kind === 'tvn' && edit.sources[0].enabled && !edit.order
}

/**
 * Save one curated channel's change; every other channel's record is kept as it was. A change that
 * leaves the channel exactly as shipped removes its record instead.
 */
export function saveCuratedEdit(
  shipped: Pick<Channel, 'number' | 'name'>,
  edit: ChannelEdit,
  now: number,
  store: Store | null = browserStore(),
): CuratedEdit | null {
  const number = shipped.number
  if (number < 1 || number > 999) throw new Error('Only TVN channels 001–999 are kept here')
  const sources = edit.sources.some((source) => source.kind === 'tvn') ? edit.sources : [tvnSource(), ...edit.sources]
  const order = keptOrder(sources, edit.order)
  const next: ChannelEdit = { name: cleanName(edit.name, shipped.name), sources: sources.map((source) => ({ ...source })), ...(order ? { order } : {}) }
  const all = loadCuratedEdits(store)
  if (pristine(shipped, next)) {
    delete all[String(number)]
    writeAll(all, store)
    return null
  }
  const saved: CuratedEdit = { channelNumber: number, ...next, savedAt: now }
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
 * source the channel keeps its own schedule and only the name changes; once the viewer's own sources
 * carry programmes (or a live stream), or TVN programming is switched off, those sources take over.
 */
export function buildCuratedEdit(
  shipped: Channel,
  edit: CuratedEdit,
  refused: ReadonlySet<string> = new Set(),
): { channel: Channel; programmes: Programme[] | null } {
  const name = cleanName(edit.name, shipped.name)
  const own = edit.sources.filter((source) => source.kind !== 'tvn')
  const tvnOn = edit.sources.some((source) => source.kind === 'tvn' && source.enabled)
  if (tvnOn && !liveStreamOf(own) && inventoryOf(own).length === 0) {
    return { channel: { ...shipped, name }, programmes: null }
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
      description: made.description,
      mediaKind: made.mediaKind,
      playbackType: made.playbackType,
      liveSinceMs: made.liveSinceMs,
      customLineup: true,
    },
    programmes,
  }
}
