import { broadcastWindow } from '../director/time.ts'
import type { MediaItem } from '../director/types.ts'
import { DYNAMIC_CHANNELS, dynamicChannel, freshnessDays, liveCams, liveEndpoint, type LiveEndpoint } from './providers.ts'

const DAY_MS = 86_400_000
/** A stream that failed to play is retried after this long; one failure never retires it. */
export const LIVE_RETRY_MS = 15 * 60_000

/**
 * Session-only record of streams that failed in the player. Never persisted and never written into
 * a frozen day, so a dead endpoint cannot poison the schedule cache.
 */
const failedAt = new Map<string, number>()

export function liveAvailable(channelNumber: number, nowMs: number): LiveEndpoint | undefined {
  const live = liveEndpoint(channelNumber)
  if (!live) return undefined
  const failed = failedAt.get(live.videoId)
  if (failed !== undefined && nowMs - failed < LIVE_RETRY_MS) return undefined
  return live
}

/** A webcam that failed in the player sits out until it is retried, like a live stream. */
export function camAvailable(videoId: string, nowMs: number): boolean {
  const failed = failedAt.get(videoId)
  return failed === undefined || nowMs - failed >= LIVE_RETRY_MS
}

/** Returns true when the failing video is a configured live stream or webcam. */
export function markLiveUnavailable(videoId: string, nowMs: number, channelNumber?: number): boolean {
  const live = channelNumber === undefined ? undefined : liveEndpoint(channelNumber)
  const cam = channelNumber !== undefined && liveCams(channelNumber).some((item) => item.videoId === videoId)
  if (!cam && (live ? live.videoId !== videoId : !isLiveVideo(videoId))) return false
  failedAt.set(videoId, nowMs)
  return true
}

export function resetLiveState(): void {
  failedAt.clear()
}

function isLiveVideo(videoId: string): boolean {
  return DYNAMIC_CHANNELS.some((number) => liveEndpoint(number)?.videoId === videoId || liveCams(number).some((cam) => cam.videoId === videoId))
}

export function isDynamicChannel(channelNumber: number): boolean {
  return dynamicChannel(channelNumber) !== undefined
}

/**
 * The rolling programmes a dynamic channel may air on this broadcast date: published inside the
 * channel's freshness window and not after the day. Static channels pass through unchanged.
 */
export function freshFor<T extends MediaItem>(channelNumber: number, items: readonly T[], broadcastDate: string): T[] {
  const days = freshnessDays(channelNumber)
  if (days === undefined) return items as T[]
  if (days <= 0) return []
  const { startMs, endMs } = broadcastWindow(broadcastDate)
  const horizon = startMs - days * DAY_MS
  return items.filter((item) => {
    const published = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN
    return published >= horizon && published < endMs
  })
}
