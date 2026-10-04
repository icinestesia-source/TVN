/**
 * Guide timeline zoom: a presentation multiplier on the Guide's pixels-per-minute. It widens the
 * time axis only; schedules, programme times and durations, the channel column and row heights
 * are untouched.
 */
export const GUIDE_ZOOM_MIN = 1
export const GUIDE_ZOOM_MAX = 6
/** The slider moves in fine steps; pinch and trackpad zoom are continuous within the same range. */
export const GUIDE_ZOOM_STEP = 0.05

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return GUIDE_ZOOM_MIN
  return Math.min(GUIDE_ZOOM_MAX, Math.max(GUIDE_ZOOM_MIN, zoom))
}

/**
 * A ctrl-wheel event (what browsers send for a trackpad pinch) becomes a zoom factor.
 * deltaY < 0 is a spread (zoom in); pixel, line and page deltas are normalised first.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return Math.exp(-Math.max(-100, Math.min(100, px)) * 0.01)
}

/** The distance between two touch points, for a two-finger pinch. */
export function touchDistance(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

/** The midpoint between two touch points: the anchor of a two-finger pinch. */
export function touchMidpoint(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }): { x: number; y: number } {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
}

/** The broadcast time shown at `offsetPx` from the left edge of the visible timeline. */
export function anchorTime(scrollLeft: number, offsetPx: number, windowStartMs: number, pxPerMinute: number): number {
  return windowStartMs + ((scrollLeft + offsetPx) / pxPerMinute) * 60_000
}

/**
 * The scrollLeft that keeps `timeMs` at `offsetPx` from the left edge of the visible timeline at a
 * new scale: the time under the pointer (or between the fingers) stays where the viewer is looking.
 */
export function anchoredScrollLeft(timeMs: number, offsetPx: number, windowStartMs: number, pxPerMinute: number): number {
  return Math.max(0, ((timeMs - windowStartMs) / 60_000) * pxPerMinute - offsetPx)
}

/**
 * Where a - / = zoom holds the Guide still. A programme the viewer picked stays under its own centre (or the
 * centre of what shows of it); with nothing picked, the NOW line keeps its place, so zooming in never walks it
 * off the left edge. Only with neither on screen does the middle of the timeline hold.
 */
export function keyZoomAnchor(
  view: { scrollLeft: number; clientWidth: number; windowStartMs: number; pxPerMinute: number },
  nowMs: number,
  picked: { startMs: number; endMs: number } | null,
): { timeMs: number; offsetPx: number } {
  const { scrollLeft, clientWidth, windowStartMs, pxPerMinute } = view
  const at = (timeMs: number) => ((timeMs - windowStartMs) / 60_000) * pxPerMinute - scrollLeft
  const shownFrom = anchorTime(scrollLeft, 0, windowStartMs, pxPerMinute)
  const shownTo = anchorTime(scrollLeft, clientWidth, windowStartMs, pxPerMinute)
  if (picked) {
    const middle = (picked.startMs + picked.endMs) / 2
    if (middle >= shownFrom && middle <= shownTo) return { timeMs: middle, offsetPx: at(middle) }
    const from = Math.max(picked.startMs, shownFrom)
    const to = Math.min(picked.endMs, shownTo)
    if (to > from) return { timeMs: (from + to) / 2, offsetPx: at((from + to) / 2) }
    return { timeMs: middle, offsetPx: clientWidth / 2 }
  }
  if (nowMs >= shownFrom && nowMs <= shownTo) return { timeMs: nowMs, offsetPx: at(nowMs) }
  return { timeMs: anchorTime(scrollLeft, clientWidth / 2, windowStartMs, pxPerMinute), offsetPx: clientWidth / 2 }
}

/** The zooms the Guide may open at: the lowest that frames the listings usefully is chosen. */
export const OPENING_ZOOMS = [1, 1.5, 2, 3, 4, 5, 6] as const
/** The share of the listed time whose programmes must show their titles for a zoom to be useful. */
export const OPENING_READABLE_SHARE = 0.6

export interface OpeningFrame {
  nowMs: number
  /** The standard (1x) pixels per minute. */
  basePx: number
  viewportWidth: number
  /** How much of the past stays in view when the Guide opens. */
  leadMs: number
  /** A cell's title shows once the cell is wider than this. */
  titleMinPx: number
}

/**
 * The share of the time on screen, across the given rows, taken by programmes wide enough to show their titles
 * at `zoom`. Rows count by time on screen, so a row of short clips weighs no more than a row holding one film.
 */
export function readableShare(rows: readonly (readonly { startMs: number; endMs: number }[])[], zoom: number, frame: OpeningFrame): number {
  const px = frame.basePx * zoom
  const leadPx = Math.min((frame.leadMs / 60_000) * px, Math.max(0, frame.viewportWidth) * 0.45)
  const fromMs = frame.nowMs - (leadPx / px) * 60_000
  const toMs = fromMs + (frame.viewportWidth / px) * 60_000
  let shown = 0
  let readable = 0
  for (const row of rows) {
    for (const slot of row) {
      const visible = Math.min(slot.endMs, toMs) - Math.max(slot.startMs, fromMs)
      if (visible <= 0) continue
      shown += visible
      if (((slot.endMs - slot.startMs) / 60_000) * px - 3 > frame.titleMinPx) readable += visible
    }
  }
  return shown > 0 ? readable / shown : 1
}

/**
 * The zoom the Guide opens at: the lowest that lets most of the listings around NOW show their titles. One
 * short programme does not raise it; a screen of short clips does. When no zoom gets there, the one that shows
 * the most titles (the lowest of equals).
 */
export function openingZoom(rows: readonly (readonly { startMs: number; endMs: number }[])[], frame: OpeningFrame): number {
  let best: number = GUIDE_ZOOM_MIN
  let bestShare = -1
  for (const zoom of OPENING_ZOOMS) {
    const share = readableShare(rows, zoom, frame)
    if (share >= OPENING_READABLE_SHARE) return zoom
    if (share > bestShare + 1e-9) {
      best = zoom
      bestShare = share
    }
  }
  return best
}
