import { guideSlots } from '../services/broadcast.ts'
import type { Channel } from '../types/channel.ts'
import { GUIDE_LEAD_MS, ROW_HEIGHT, TITLE_MIN_PX, basePxPerMinute } from './geometry.ts'
import { openingZoom } from './zoom.ts'

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
  // The opening view centres the watched channel, so the rows judged are the ones around it.
  const first = Math.max(0, Math.min(channels.length - rowsShown, at - Math.floor(rowsShown / 2)))
  const span = (viewportWidth / basePx) * 60_000
  const rows = channels.slice(first, first + rowsShown).map((channel) => guideSlots(channel, nowMs - GUIDE_LEAD_MS, nowMs + span))
  const onAir = rows[at - first]?.find((slot) => slot.startMs <= nowMs && nowMs < slot.endMs) ?? null
  return openingZoom(rows, { nowMs, basePx, viewportWidth, leadMs: GUIDE_LEAD_MS, titleMinPx: TITLE_MIN_PX }, onAir)
}
