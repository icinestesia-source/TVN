/** How far behind "now" the guide data window opens. About an hour of context, not a catch-up service. */
export const GUIDE_PAST_MS = 60 * 60 * 1000
/** How much of that past stays in view when the guide opens. */
export const GUIDE_LEAD_MS = 45 * 60 * 1000
/** How far ahead the guide opens. */
export const GUIDE_FUTURE_MS = 8 * 60 * 60 * 1000
/** Added when the viewer scrolls or moves onto the edge of the rendered window. */
export const GUIDE_EXTEND_MS = 4 * 60 * 60 * 1000
/** Safety cap so a long session cannot mount days of cells. */
export const GUIDE_MAX_WINDOW_MS = 36 * 60 * 60 * 1000

export const ROW_HEIGHT = 52
export const TIME_HEADER_HEIGHT = 36

export function durationWidthPx(durationSeconds: number, pxPerMinute: number): number {
  return (durationSeconds / 60) * pxPerMinute
}

export function trackWidthPx(startMs: number, endMs: number, pxPerMinute: number): number {
  return ((endMs - startMs) / 60_000) * pxPerMinute
}

export function slotFrame(
  startMs: number,
  endMs: number,
  windowStartMs: number,
  pxPerMinute: number,
): { left: number; width: number } {
  const left = ((startMs - windowStartMs) / 60_000) * pxPerMinute
  const width = durationWidthPx((endMs - startMs) / 1000, pxPerMinute)
  return { left, width: Math.max(width - 3, 2) }
}

export function windowAround(nowMs: number): { startMs: number; endMs: number } {
  return { startMs: nowMs - GUIDE_PAST_MS, endMs: nowMs + GUIDE_FUTURE_MS }
}

/** One time-to-pixel conversion for the ruler, cells, and the NOW line. */
export function timeX(timeMs: number, windowStartMs: number, pxPerMinute: number): number {
  return ((timeMs - windowStartMs) / 60_000) * pxPerMinute
}

/** Place NOW inside the viewport, with about 45 minutes of the previous hour still visible. */
export function openScrollLeft(
  nowMs: number,
  windowStartMs: number,
  pxPerMinute: number,
  viewportWidth: number,
): number {
  const nowX = timeX(nowMs, windowStartMs, pxPerMinute)
  const lead = (GUIDE_LEAD_MS / 60_000) * pxPerMinute
  const inset = Math.min(lead, Math.max(0, viewportWidth) * 0.45)
  return Math.max(0, nowX - inset)
}

export function programmeFlags(
  startMs: number,
  endMs: number,
  nowMs: number,
  cursorTime: number | null,
): { airing: boolean; selected: boolean; past: boolean } {
  return {
    airing: nowMs >= startMs && nowMs < endMs,
    selected: cursorTime !== null && cursorTime >= startMs && cursorTime < endMs,
    past: endMs <= nowMs,
  }
}

/**
 * Vertical window for the channel column and programme rows.
 * V0.1 uses this directly. A later pass can recycle horizontal cells the same way:
 * keep `slotsOverlapping` as the data source and mount only the slice that
 * intersects the visible time range, plus overscan.
 */
export function visibleRowRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  total: number,
  overscan = 5,
): { start: number; end: number } {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0 }
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
  return { start, end }
}
