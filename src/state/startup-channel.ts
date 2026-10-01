import { firstOnAir, isOnAir } from '../network/airing.ts'
import type { Channel } from '../types/channel.ts'

export interface StartupRestore {
  noteUserTune(): void
  target(saved: Channel | undefined, channels: readonly Channel[]): Channel | undefined
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
      return saved && isOnAir(saved) ? saved : firstOnAir(channels)
    },
  }
}
