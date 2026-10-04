/**
 * TVN surf: while it is on, TVN tunes to a random channel after a random wait between the viewer's
 * minimum and maximum, then waits again. The range, and whether surfing was last left on, are kept in
 * this browser; a first visit starts surfing.
 */
export const SURF_KEY = 'tvn.surf.v1'
export const SURF_LIMIT_MIN = 1
export const SURF_LIMIT_MAX = 60

export interface SurfRange {
  minSeconds: number
  maxSeconds: number
}

export const DEFAULT_SURF_RANGE: SurfRange = { minSeconds: 4, maxSeconds: 10 }

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const whole = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(SURF_LIMIT_MAX, Math.max(SURF_LIMIT_MIN, Math.round(value))) : fallback

/** Whole seconds within 1–60, the minimum never above the maximum. `moved` is the end the viewer just set. */
export function asSurfRange(value: unknown, moved: 'min' | 'max' = 'min'): SurfRange {
  const record = value && typeof value === 'object' ? (value as Partial<SurfRange>) : {}
  const min = whole(record.minSeconds, DEFAULT_SURF_RANGE.minSeconds)
  const max = whole(record.maxSeconds, DEFAULT_SURF_RANGE.maxSeconds)
  if (min <= max) return { minSeconds: min, maxSeconds: max }
  return moved === 'min' ? { minSeconds: min, maxSeconds: min } : { minSeconds: max, maxSeconds: max }
}

function readStored(store: Store | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(store?.getItem(SURF_KEY) ?? 'null') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function loadSurfRange(store: Store | null = browserStore()): SurfRange {
  return asSurfRange(readStored(store))
}

export function saveSurfRange(range: SurfRange, store: Store | null = browserStore()): void {
  store?.setItem(SURF_KEY, JSON.stringify({ ...readStored(store), ...asSurfRange(range) }))
}

/** On unless the viewer last switched it off. */
export function loadSurfOn(store: Store | null = browserStore()): boolean {
  return readStored(store).on !== false
}

export function saveSurfOn(on: boolean, store: Store | null = browserStore()): void {
  store?.setItem(SURF_KEY, JSON.stringify({ ...readStored(store), on }))
}

/** Whether surfing waits for the programme on screen to finish before the next hop. Off unless the viewer chose it. */
export function loadSurfUntilEnd(store: Store | null = browserStore()): boolean {
  return readStored(store).untilEnd === true
}

export function saveSurfUntilEnd(untilEnd: boolean, store: Store | null = browserStore()): void {
  store?.setItem(SURF_KEY, JSON.stringify({ ...readStored(store), untilEnd }))
}

/** Beyond this, a programme's end is too far to wait for (a live stream, a long film): the range applies instead. */
export const SURF_END_LIMIT_MS = 3 * 3600_000

/**
 * The wait for a surf that lets the programme finish: until its end, and a moment more so the next channel
 * is chosen once the programme has ended. Null when there is no end within reach.
 */
export function surfUntilEndMs(endMs: number, nowMs: number): number | null {
  const left = endMs - nowMs
  if (!Number.isFinite(left) || left > SURF_END_LIMIT_MS) return null
  return Math.max(1500, Math.round(left) + 800)
}

/** The wait before the next hop, anywhere in the range, to the millisecond. */
export function surfDelayMs(range: SurfRange, random: () => number = Math.random): number {
  const { minSeconds, maxSeconds } = asSurfRange(range)
  return Math.round((minSeconds + random() * (maxSeconds - minSeconds)) * 1000)
}
