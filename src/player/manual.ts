import { broadcast } from '../services/broadcast.ts'
import { hasPicture } from '../session/session-channel.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import type { ScheduleSnapshot } from '../types/schedule.ts'

/**
 * A programme the viewer picked from the Guide, playing from its beginning outside the schedule.
 * It lives in memory only and never touches the schedule: the broadcast carries on underneath, and
 * NOW, a channel change or the programme ending returns the channel to it.
 */
export interface ManualAiring {
  channelNumber: number
  programme: Programme
  startMs: number
  endMs: number
  /** Where the programme sits in the schedule, so Prev and Next step along the running order from it. */
  slot?: { startMs: number; endMs: number }
}

let selected: ManualAiring | null = null

export function selectProgramme(
  channelNumber: number,
  programme: Programme,
  nowMs: number,
  slot?: { startMs: number; endMs: number },
): ManualAiring {
  selected = { channelNumber, programme, startMs: nowMs, endMs: nowMs + programme.durationSeconds * 1000, slot }
  return selected
}

/** How many slots with nothing to show (the schedule's holding cards) Prev and Next look past. */
const STEP_REACH = 24

/**
 * The programme before (-1) or after (1) the one on screen, in the channel's running order. A holding card
 * has nothing to play, so the step goes on past it to the nearest programme on the same channel that does.
 */
export function stepFrom(channel: Channel, nowMs: number, direction: -1 | 1) {
  const manual = manualAiring(channel.number, nowMs)
  let place: { startMs: number; endMs: number } = manual ? (manual.slot ?? manual) : broadcast(channel, nowMs).current
  const adjacent = broadcast(channel, direction === 1 ? place.endMs : place.startMs - 1).current
  let found = adjacent
  for (let skipped = 0; skipped < STEP_REACH && !hasPicture(found.programme); skipped += 1) {
    place = found
    found = broadcast(channel, direction === 1 ? place.endMs : place.startMs - 1).current
  }
  return hasPicture(found.programme) ? found : adjacent
}

/**
 * A pick on the channel being watched plays in place (no channel change, so Previous stays put); one on
 * another channel is an ordinary tune, which records the channel left as Previous.
 */
export function pickTunes(targetNumber: number, watchingNumber: number, tuning: boolean): boolean {
  return targetNumber !== watchingNumber || tuning
}

/** The picked programme still playing on this channel, if any. One that has run its length is forgotten. */
export function manualAiring(channelNumber: number, nowMs: number): ManualAiring | null {
  if (!selected) return null
  if (nowMs >= selected.endMs) {
    selected = null
    return null
  }
  return selected.channelNumber === channelNumber ? selected : null
}

/** Ends any picked programme. True when one was playing. */
export function clearManual(): boolean {
  const had = selected !== null
  selected = null
  return had
}

/** What the single-view screen shows on this channel: the picked programme, else the broadcast. */
export function onScreen(channel: Channel, nowMs: number): ScheduleSnapshot<Programme> {
  const snap = broadcast(channel, nowMs)
  const manual = manualAiring(channel.number, nowMs)
  if (!manual) return snap
  const elapsedSeconds = Math.max(0, (nowMs - manual.startMs) / 1000)
  return {
    ...snap,
    current: {
      programme: manual.programme,
      index: -1,
      startMs: manual.startMs,
      endMs: manual.endMs,
      elapsedSeconds,
      seekSeconds: elapsedSeconds,
    },
    next: stepFrom(channel, nowMs, 1),
  }
}
