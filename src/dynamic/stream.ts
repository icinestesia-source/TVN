import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import type { BroadcastPosition, GuideSlot, ScheduleSnapshot } from '../types/schedule.ts'

/**
 * A live-stream channel has no schedule: one airing that began when the stream was configured and has
 * no end. Nothing is given a duration; the Guide draws it across whatever span it is showing.
 */
export function isLiveStreamChannel(channel: Pick<Channel, 'playbackType'>): boolean {
  return channel.playbackType === 'live-stream'
}

export function isLiveStream(programme: Pick<Programme, 'liveStream'>): boolean {
  return programme.liveStream !== undefined
}

export function liveStreamBroadcast(channel: Channel, programme: Programme, nowMs: number): ScheduleSnapshot<Programme> {
  const startMs = Math.min(channel.liveSinceMs ?? 0, nowMs)
  const position: BroadcastPosition<Programme> = {
    programme,
    index: 0,
    startMs,
    endMs: Number.POSITIVE_INFINITY,
    elapsedSeconds: Math.max(0, (nowMs - startMs) / 1000),
    seekSeconds: 0,
  }
  return {
    channelId: channel.id,
    epochMs: startMs,
    nowMs,
    cycleDurationSeconds: 0,
    offsetSeconds: 0,
    current: position,
    previous: position,
    next: position,
  }
}

export function liveStreamGuideSlots(programme: Programme, startMs: number, endMs: number): GuideSlot<Programme>[] {
  return endMs > startMs ? [{ programme, index: 0, startMs, endMs }] : []
}
