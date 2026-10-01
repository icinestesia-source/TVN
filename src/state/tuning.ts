import { adjacentChannel } from '../data/catalogue.ts'

/** The channel being watched and the one watched before it. Every tune, whatever started it, commits here. */
export interface Tuned {
  channelNumber: number
  previousNumber: number | null
}

/** Where CH+ or CH- lands: stepped from the channel being watched, or from a tune that is still settling. */
export function stepTarget(tuned: Tuned, pending: number | null, delta: 1 | -1): number {
  return adjacentChannel(pending ?? tuned.channelNumber, delta).number
}

/** A committed tune. The channel left becomes Previous; landing back on the origin leaves history alone. */
export function commitTuned(tuned: Tuned, target: number, origin = tuned.channelNumber): Tuned {
  return target === origin ? tuned : { channelNumber: target, previousNumber: origin }
}
