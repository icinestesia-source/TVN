import { broadcast } from '../services/broadcast.ts'
import { hasPicture } from '../session/session-channel.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import { STEP_REACH } from './manual.ts'

/**
 * How many programmes in a row one channel may refuse before TVN stops trying it and moves on. TVN has no
 * established constant for this, so it is the smallest that skips a few bad programmes without trapping
 * the viewer on a run of them.
 */
export const PROGRAMME_ATTEMPTS = 3

/**
 * The automatic recovery under way since the viewer's last tune or the last programme that played: the
 * channel being tried, how many of its programmes refused in a row, and every channel already given up on.
 */
export interface Recovery {
  channelNumber: number
  refusals: number
  failedChannels: readonly number[]
}

export type RecoveryStep = { action: 'next-programme'; recovery: Recovery } | { action: 'next-channel'; recovery: Recovery }

/** After an authoritative refusal on this channel: try its next programme, or give the channel up. */
export function afterRefusal(recovery: Recovery | null, channelNumber: number): RecoveryStep {
  const same = recovery?.channelNumber === channelNumber
  const refusals = same ? recovery.refusals + 1 : 1
  const failedChannels = recovery?.failedChannels ?? []
  if (refusals < PROGRAMME_ATTEMPTS) return { action: 'next-programme', recovery: { channelNumber, refusals, failedChannels } }
  return { action: 'next-channel', recovery: giveUp(recovery, channelNumber) }
}

/** The channel has nothing left to try (its programmes refused, or none within reach will play). */
export function giveUp(recovery: Recovery | null, channelNumber: number): Recovery {
  const failed = recovery?.failedChannels ?? []
  return { channelNumber, refusals: 0, failedChannels: failed.includes(channelNumber) ? failed : [...failed, channelNumber] }
}

/** The recovery as it carries on to the channel it falls forward to. */
export function arrive(recovery: Recovery, channelNumber: number): Recovery {
  return { channelNumber, refusals: 0, failedChannels: recovery.failedChannels }
}

/**
 * The next programme on the channel after the one in `slot` that can play: it has a picture and is not
 * known to be refused. A playback fallback over the schedule, which itself is left exactly as it is. Null
 * when nothing within reach will play.
 */
export function fallbackProgramme(
  channel: Channel,
  slot: { startMs: number; endMs: number },
  refused: ReadonlySet<string>,
): { programme: Programme; startMs: number; endMs: number } | null {
  let place = slot
  for (let step = 0; step < STEP_REACH; step += 1) {
    const next = broadcast(channel, place.endMs).current
    if (next.endMs <= place.endMs) return null
    if (hasPicture(next.programme) && !(next.programme.videoId && refused.has(next.programme.videoId))) {
      return { programme: next.programme, startMs: next.startMs, endMs: next.endMs }
    }
    place = next
  }
  return null
}
