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
