import { isOffAir } from '../data/off-air.ts'
import { firstOnAir, isOnAir } from '../network/airing.ts'
import { TVN_CHANNEL_NUMBER } from '../tvn/tvn-channel.ts'
import type { Channel } from '../types/channel.ts'

export interface StartupRestore {
  noteUserTune(): void
  target(saved: Channel | undefined, channels: readonly Channel[]): Channel | undefined
}

/**
 * Where a start with nothing to resume goes: 001 when it is on air, otherwise the first ordinary channel on air.
 * 000 TVN is only the start for the /tvn entry (see resolveStartupTuning), not a normal first visit.
 */
export function startChannel(channels: readonly Channel[]): Channel | undefined {
  const one = channels.find((channel) => channel.number === 1 && channel.enabled)
  if (one && isOnAir(one) && !isOffAir(1)) return one
  return firstOnAir(channels) ?? channels.find((channel) => channel.number === TVN_CHANNEL_NUMBER && channel.enabled)
}

/** Startup restoration settles the first channel only until the viewer tunes; it never overrides an explicit choice. */
export function createStartupRestore(): StartupRestore {
  let tuned = false
  return {
    noteUserTune() {
      tuned = true
    },
    target(saved, channels) {
      if (tuned) return undefined
      // 1000 Local Media is never a place to start: it is empty in a new session.
      return saved && saved.origin !== 'session' && isOnAir(saved) && !isOffAir(saved.number) ? saved : startChannel(channels)
    },
  }
}
