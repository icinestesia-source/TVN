import { firstOnAir, isOnAir } from '../network/airing.ts'
import { TVN_CHANNEL_NUMBER } from '../tvn/tvn-channel.ts'
import type { Channel } from '../types/channel.ts'

export interface StartupRestore {
  noteUserTune(): void
  target(saved: Channel | undefined, channels: readonly Channel[]): Channel | undefined
}

/**
 * Where a start with nothing to resume goes: 000 TVN, whose own surfing is the network's random start.
 * The first channel on air stands in only if 000 itself is missing.
 */
export function startChannel(channels: readonly Channel[]): Channel | undefined {
  return channels.find((channel) => channel.number === TVN_CHANNEL_NUMBER && channel.enabled) ?? firstOnAir(channels)
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
      return saved && saved.origin !== 'session' && isOnAir(saved) ? saved : startChannel(channels)
    },
  }
}
