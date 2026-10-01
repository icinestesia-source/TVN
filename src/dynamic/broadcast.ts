import { policyFor } from '../director/policies.ts'
import { broadcastDateFor, broadcastWindow, datesCovering } from '../director/time.ts'
import { calculateSchedule } from '../scheduler/calculate.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import type { GuideSlot, ScheduleSnapshot } from '../types/schedule.ts'
import type { LiveEndpoint } from './providers.ts'
import { liveAvailable } from './runtime.ts'

/** One listing per broadcast day, titled with the live service itself; no programme titles are invented. */
function liveProgramme(channel: Channel, live: LiveEndpoint, date: string, startMs: number, endMs: number): Programme {
  return {
    id: `${channel.id}:live:${live.videoId}:${date}`,
    title: live.service,
    description: `${live.service}, the publisher's official continuous stream.`,
    videoId: live.videoId,
    thumbnail: `https://i.ytimg.com/vi/${live.videoId}/hqdefault.jpg`,
    durationSeconds: Math.max(1, Math.round((endMs - startMs) / 1000)),
    channelId: channel.id,
    category: channel.category,
    source: 'youtube',
    kind: 'programme',
    playbackMode: 'linear',
    playback: 'live',
    programmeType: 'live',
    mediaKind: 'video',
    sourceRef: `youtube:${live.videoId}`,
    creator: live.service,
  }
}

/**
 * The live stream when it is available; null hands the channel back to the director, which airs the
 * rolling pool or, with none in its window, the intentional off-air presentation.
 */
export function dynamicBroadcast(channel: Channel, nowMs: number): ScheduleSnapshot<Programme> | null {
  const live = liveAvailable(channel.number, nowMs)
  if (!live) return null
  const dayStart = policyFor(channel.number)?.broadcastDayStart
  const date = broadcastDateFor(nowMs, dayStart)
  const { startMs, endMs } = broadcastWindow(date, dayStart)
  return calculateSchedule({
    channelId: channel.id,
    phaseOffsetSeconds: 0,
    programmes: [liveProgramme(channel, live, date, startMs, endMs)],
    epochMs: startMs,
    nowMs,
  })
}

export function dynamicGuideSlots(channel: Channel, startMs: number, endMs: number, nowMs = Date.now()): GuideSlot<Programme>[] | null {
  const live = liveAvailable(channel.number, nowMs)
  if (!live) return null
  const dayStart = policyFor(channel.number)?.broadcastDayStart
  return datesCovering(startMs, endMs, dayStart).flatMap((date) => {
    const day = broadcastWindow(date, dayStart)
    const from = Math.max(startMs, day.startMs)
    const to = Math.min(endMs, day.endMs)
    if (to <= from) return []
    return [{ programme: liveProgramme(channel, live, date, day.startMs, day.endMs), index: 0, startMs: day.startMs, endMs: day.endMs }]
  })
}
