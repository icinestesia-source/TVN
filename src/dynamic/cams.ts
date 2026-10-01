import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import type { BroadcastPosition, GuideSlot, ScheduleSnapshot } from '../types/schedule.ts'
import { liveCams, type LiveEndpoint } from './providers.ts'
import { camAvailable } from './runtime.ts'

/** Each webcam holds the channel this long, on the clock, before the next takes over. */
export const CAM_SLOT_MS = 10 * 60_000

/**
 * The cam in a slot: the channel's cams in turn, one per slot, the same for every viewer. A cam that
 * failed in this browser gives its slot to the next one that has not; with every cam failed, none.
 */
export function camFor(cams: readonly LiveEndpoint[], slot: number, nowMs: number): LiveEndpoint | null {
  for (let step = 0; step < cams.length; step += 1) {
    const cam = cams[(((slot + step) % cams.length) + cams.length) % cams.length]
    if (camAvailable(cam.videoId, nowMs)) return cam
  }
  return null
}

function camProgramme(channel: Channel, cam: LiveEndpoint, slot: number): Programme {
  return {
    id: `${channel.id}:cam:${cam.videoId}:${slot}`,
    title: cam.service,
    description: cam.publisher ? `${cam.service}, live from ${cam.publisher}.` : `${cam.service}, live.`,
    videoId: cam.videoId,
    thumbnail: `https://i.ytimg.com/vi/${cam.videoId}/hqdefault.jpg`,
    durationSeconds: CAM_SLOT_MS / 1000,
    channelId: channel.id,
    category: channel.category,
    source: 'youtube',
    kind: 'programme',
    playbackMode: 'linear',
    playback: 'live',
    programmeType: 'live',
    mediaKind: 'video',
    sourceRef: `youtube:${cam.videoId}`,
    creator: cam.publisher ?? cam.service,
  }
}

function position(channel: Channel, cams: readonly LiveEndpoint[], slot: number, nowMs: number): BroadcastPosition<Programme> | null {
  const cam = camFor(cams, slot, nowMs)
  if (!cam) return null
  const startMs = slot * CAM_SLOT_MS
  return {
    programme: camProgramme(channel, cam, slot),
    index: slot,
    startMs,
    endMs: startMs + CAM_SLOT_MS,
    elapsedSeconds: Math.max(0, (nowMs - startMs) / 1000),
    seekSeconds: 0,
  }
}

/** The webcam on now; null when the channel has no cams, or none that plays here. */
export function camBroadcast(channel: Channel, nowMs: number): ScheduleSnapshot<Programme> | null {
  const cams = liveCams(channel.number)
  if (cams.length === 0) return null
  const slot = Math.floor(nowMs / CAM_SLOT_MS)
  const current = position(channel, cams, slot, nowMs)
  if (!current) return null
  return {
    channelId: channel.id,
    epochMs: 0,
    nowMs,
    cycleDurationSeconds: (cams.length * CAM_SLOT_MS) / 1000,
    offsetSeconds: 0,
    current,
    previous: position(channel, cams, slot - 1, nowMs) ?? current,
    next: position(channel, cams, slot + 1, nowMs) ?? current,
  }
}

export function camGuideSlots(channel: Channel, startMs: number, endMs: number, nowMs = Date.now()): GuideSlot<Programme>[] | null {
  const cams = liveCams(channel.number)
  if (cams.length === 0) return null
  const slots: GuideSlot<Programme>[] = []
  for (let slot = Math.floor(startMs / CAM_SLOT_MS); slot * CAM_SLOT_MS < endMs; slot += 1) {
    const at = position(channel, cams, slot, nowMs)
    if (at) slots.push({ programme: at.programme, index: at.index, startMs: at.startMs, endMs: at.endMs })
  }
  return slots
}
