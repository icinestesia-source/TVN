import type { MultiviewMode } from '../types/preferences.ts'
import type { NavDirection } from '../types/input.ts'

/** / steps single → picture in picture → 2 → 4 → 9 → single; \ goes straight back to single. */
export function cycleMultiview(mode: MultiviewMode): MultiviewMode {
  if (mode === '1') return 'pip'
  if (mode === 'pip') return '2'
  if (mode === '2') return '4'
  if (mode === '4') return '9'
  return '1'
}

export function tileCount(mode: MultiviewMode): number {
  if (mode === '2') return 2
  if (mode === '4') return 4
  if (mode === '9') return 9
  if (mode === 'pip') return 2
  return 1
}

/** The inset picture's width, as a share of the screen's: [ and ] step it, OPTIONS sets it. */
export const PIP_SIZE_MIN = 15
export const PIP_SIZE_MAX = 60
export const PIP_SIZE_STEP = 5
export const PIP_SIZE_DEFAULT = 30

export function clampPipSize(value: unknown): number {
  const size = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : PIP_SIZE_DEFAULT
  return Math.min(PIP_SIZE_MAX, Math.max(PIP_SIZE_MIN, size))
}

export const PIP_SIZE_KEY = 'tvn.pip-size.v1'

type Store = Pick<Storage, 'getItem' | 'setItem'>
const browserStore = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadPipSize(store: Store | null = browserStore()): number {
  const saved = store?.getItem(PIP_SIZE_KEY)
  return clampPipSize(saved === null || saved === undefined ? undefined : Number(saved))
}

export function savePipSize(size: number, store: Store | null = browserStore()): void {
  try {
    store?.setItem(PIP_SIZE_KEY, String(clampPipSize(size)))
  } catch {
    // Private browsing may refuse storage; the size then lasts as long as the page.
  }
}

export interface MultiviewLayout {
  columns: number
  pageSize: number
  stacked: boolean
}

/** Narrow phones never show nine simultaneous pictures. */
export function multiviewLayout(mode: MultiviewMode, viewportWidth: number): MultiviewLayout {
  const narrow = viewportWidth < 800
  if (mode === '1') return { columns: 1, pageSize: 1, stacked: false }
  // Left and right move between the main picture and the inset.
  if (mode === 'pip') return { columns: 2, pageSize: 2, stacked: false }
  if (mode === '2') {
    return narrow
      ? { columns: 1, pageSize: 2, stacked: true }
      : { columns: 2, pageSize: 2, stacked: false }
  }
  if (mode === '4' || narrow) return { columns: 2, pageSize: 4, stacked: false }
  return { columns: 3, pageSize: 9, stacked: false }
}

export function pageCount(tileTotal: number, pageSize: number): number {
  if (pageSize <= 0) return 1
  return Math.max(1, Math.ceil(tileTotal / pageSize))
}

export function focusStep(index: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return ((index + delta) % count + count) % count
}

export function gridDelta(direction: NavDirection, columns: number): number {
  const span = Math.max(1, columns)
  if (direction === 'left') return -1
  if (direction === 'right') return 1
  if (direction === 'up') return -span
  return span
}

export function fillTiles(
  current: number,
  ordered: readonly number[],
  count: number,
  previous: readonly number[] = [],
): number[] {
  const allowed = new Set(ordered)
  const tiles: number[] = []
  const push = (value: number) => {
    if (tiles.length >= count || !allowed.has(value) || tiles.includes(value)) return
    tiles.push(value)
  }
  push(current)
  for (const value of previous) push(value)
  const start = Math.max(0, ordered.indexOf(current))
  for (let step = 1; tiles.length < count && ordered.length > 0; step += 1) {
    if (step > ordered.length) break
    push(ordered[(start + step) % ordered.length])
  }
  return tiles
}

/** Swap if the channel is already on another tile, so two tiles never share a number. */
export function replaceFocusedTile(
  tiles: readonly number[],
  focus: number,
  channelNumber: number,
): number[] {
  if (tiles.length === 0) return [channelNumber]
  const index = Math.min(Math.max(focus, 0), tiles.length - 1)
  const next = tiles.slice()
  const existing = next.indexOf(channelNumber)
  if (existing >= 0 && existing !== index) {
    next[existing] = next[index]
  }
  next[index] = channelNumber
  return next
}

/** One Surf hop in Multi View: a random unselected tile takes a channel not already on the wall. */
export function surfTile(
  tiles: readonly number[],
  focus: number,
  candidates: readonly number[],
  random: () => number = Math.random,
): number[] | null {
  const others = tiles.map((_, index) => index).filter((index) => index !== focus)
  const fresh = candidates.filter((number) => !tiles.includes(number))
  if (others.length === 0 || fresh.length === 0) return null
  const next = tiles.slice()
  next[others[Math.floor(random() * others.length)]] = fresh[Math.floor(random() * fresh.length)]
  return next
}

/** YouTube's minimum embedded player size; a smaller tile shows its still instead. */
export const MIN_EMBED_PX = 200

/**
 * How Multi View plays YouTube tiles. 'thumbnails': only the selected tile runs a player and the rest show a
 * still of what they are airing. 'live' is reserved for providers whose terms allow several players at once.
 */
export type MultiPlayback = 'thumbnails' | 'live'
export const MULTI_PLAYBACK: MultiPlayback = 'thumbnails'

export function tileEmbeds(tile: { focused: boolean; width: number; height: number }, playback: MultiPlayback = MULTI_PLAYBACK): boolean {
  const large = tile.width >= MIN_EMBED_PX && tile.height >= MIN_EMBED_PX
  return large && (playback === 'live' || tile.focused)
}

export function gridRows(mode: MultiviewMode, layout: MultiviewLayout): number {
  if (layout.stacked) return 2
  if (mode === '2') return 1
  return layout.columns === 3 ? 3 : 2
}

/**
 * Track sizes that give the selected tile room for a player when the even grid would make it too small;
 * null when every tile already meets the minimum.
 */
export function compactTracks(
  size: { width: number; height: number },
  layout: MultiviewLayout,
  rows: number,
  slot: number,
  gap = 4,
  padding = 4,
): { columns: string; rows: string } | null {
  const track = (span: number, count: number) => (span - padding * 2 - gap * (count - 1)) / count
  if (track(size.width, layout.columns) >= MIN_EMBED_PX && track(size.height, rows) >= MIN_EMBED_PX) return null
  const tracks = (count: number, chosen: number) =>
    Array.from({ length: count }, (_, index) => (index === chosen ? `minmax(${MIN_EMBED_PX}px, 1fr)` : 'minmax(0, 1fr)')).join(' ')
  return { columns: tracks(layout.columns, slot % layout.columns), rows: tracks(rows, Math.floor(slot / layout.columns)) }
}

export function audibleTile(focus: number, count: number): boolean[] {
  return Array.from({ length: count }, (_, index) => index === focus)
}
