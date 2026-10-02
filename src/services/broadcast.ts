import { channelByNumber, listChannels, programmesFor } from '../data/catalogue.ts'
import { directorBroadcast, directorGuideSlots } from '../director/director.ts'
import { policyFor } from '../director/policies.ts'
import { dynamicBroadcast, dynamicGuideSlots } from '../dynamic/broadcast.ts'
import { camBroadcast, camGuideSlots } from '../dynamic/cams.ts'
import { isLiveStreamChannel, liveStreamBroadcast, liveStreamGuideSlots } from '../dynamic/stream.ts'
import { originalBroadcast, withCard, originalGuideSlots, setListingLookup } from '../originals/originals.ts'
import { SCHEDULE_EPOCH_MS } from '../scheduler/epoch.ts'
import { calculateSchedule, type ScheduleRequest } from '../scheduler/calculate.ts'
import { slotsOverlapping } from '../scheduler/window.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import type { GuideSlot, ScheduleSnapshot } from '../types/schedule.ts'
import { SESSION_CHANNEL_NUMBER, sessionBroadcast, sessionGuideSlots } from '../session/session-channel.ts'
import { refusedVideos } from './embed-refusals.ts'
import { isOnAir } from '../network/airing.ts'
import { setTvnLookup, TVN_CHANNEL_NUMBER, tvnBroadcast, tvnGuideSlots } from '../tvn/tvn-channel.ts'

export function scheduleRequest(channel: Channel, nowMs: number): ScheduleRequest<Programme> {
  return {
    channelId: channel.id,
    phaseOffsetSeconds: channel.phaseOffsetSeconds,
    programmes: withCard(channel.number, programmesFor(channel.id)),
    epochMs: SCHEDULE_EPOCH_MS,
    nowMs,
  }
}

/** A re-sourced curated channel schedules its own list plainly, with no TVN card over it. */
function ownLineup(channel: Channel, nowMs: number): ScheduleRequest<Programme> {
  return { ...scheduleRequest(channel, nowMs), programmes: programmesFor(channel.id) }
}

setListingLookup((number, nowMs) => {
  const listed = channelByNumber(number)
  if (!listed || number < 1 || number > 999) return null
  const snap = broadcast(listed, nowMs)
  return { name: listed.name, title: snap.current.programme.title, endMs: snap.current.endMs, nextTitle: snap.next.programme.title, nextStartMs: snap.next.startMs }
})

setTvnLookup({ channels: listChannels, broadcastOf: (channel, nowMs) => broadcast(channel, nowMs), onAir: isOnAir, refused: refusedVideos })

function liveListing(channel: Channel): Programme | null {
  if (!isLiveStreamChannel(channel)) return null
  return programmesFor(channel.id).find((programme) => programme.liveStream) ?? null
}

export function broadcast(channel: Channel, nowMs = Date.now()): ScheduleSnapshot<Programme> {
  if (channel.origin === 'tvn' && channel.number === TVN_CHANNEL_NUMBER) return tvnBroadcast(nowMs)
  if (channel.number === SESSION_CHANNEL_NUMBER) return sessionBroadcast(nowMs)
  const live = liveListing(channel)
  if (live) return liveStreamBroadcast(channel, live, nowMs)
  if (channel.customLineup) return calculateSchedule(ownLineup(channel, nowMs))
  const cams = camBroadcast(channel, nowMs)
  if (cams) return cams
  if (channel.number <= 999) {
    const original = originalBroadcast(channel, nowMs)
    if (original) return original
  }
  if (policyFor(channel.number)) return dynamicBroadcast(channel, nowMs) ?? directorBroadcast(channel, nowMs)
  return calculateSchedule(scheduleRequest(channel, nowMs))
}

export function guideSlots(channel: Channel, startMs: number, endMs: number): GuideSlot<Programme>[] {
  if (channel.origin === 'tvn' && channel.number === TVN_CHANNEL_NUMBER) return tvnGuideSlots(startMs, endMs)
  if (channel.number === SESSION_CHANNEL_NUMBER) return sessionGuideSlots(startMs, endMs)
  const live = liveListing(channel)
  if (live) return liveStreamGuideSlots(live, startMs, endMs)
  if (channel.customLineup) return slotsOverlapping(ownLineup(channel, startMs), startMs, endMs)
  const cams = camGuideSlots(channel, startMs, endMs)
  if (cams) return cams
  if (channel.number <= 999) {
    const original = originalGuideSlots(channel, startMs, endMs)
    if (original) return original
  }
  if (policyFor(channel.number)) return dynamicGuideSlots(channel, startMs, endMs) ?? directorGuideSlots(channel, startMs, endMs)
  return slotsOverlapping(scheduleRequest(channel, startMs), startMs, endMs)
}
