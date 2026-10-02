import { guideSlots } from '../services/broadcast.ts'
import type { Channel } from '../types/channel.ts'
import { GUIDE_LEAD_MS, ROW_HEIGHT, TITLE_MIN_PX, basePxPerMinute } from './geometry.ts'
import { openingZoom } from './zoom.ts'

/** Rows above and below the Guide cursor that frame the opening view: about one screen of listings. */
const ROWS_ABOVE = 3

/**
 * The zoom the Guide opens at for the listings around the watched channel and NOW. An opening decision only:
 * the viewer's own zooming afterwards is left alone, and NOW still returns to the standard scale.
 */
export function guideOpeningZoom(channels: readonly Channel[], channelNumber: number, nowMs: number, windowWidth: number, windowHeight: number): number {
  if (channels.length === 0) return 1
  const viewportWidth = Math.max(480, windowWidth - 320)
  const basePx = basePxPerMinute(windowWidth)
  const rowsShown = Math.max(4, Math.ceil((windowHeight * 0.6) / ROW_HEIGHT))
  const at = Math.max(0, channels.findIndex((channel) => channel.number === channelNumber))
  const first = Math.max(0, at - ROWS_ABOVE)
  const span = (viewportWidth / basePx) * 60_000
  const rows = channels.slice(first, first + rowsShown).map((channel) => guideSlots(channel, nowMs - GUIDE_LEAD_MS, nowMs + span))
  return openingZoom(rows, { nowMs, basePx, viewportWidth, leadMs: GUIDE_LEAD_MS, titleMinPx: TITLE_MIN_PX })
}
