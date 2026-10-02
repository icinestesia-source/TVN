import { adjacentChannel, listChannels, randomChannel } from '../data/catalogue.ts'
import { channelMatchesFilter, inFavouriteOrder } from '../data/network.ts'
import { isOnAir } from '../network/airing.ts'
import type { Channel } from '../types/channel.ts'
import type { GuideFilter } from '../types/preferences.ts'

/** The channel being watched and the one watched before it. Every tune, whatever started it, commits here. */
export interface Tuned {
  channelNumber: number
  previousNumber: number | null
}

/**
 * The Guide tab the viewer last chose (ALL, TVN or FAVOURITES) is also how they are watching: CH+, CH- and
 * R stay inside the channels that tab lists, in the order it lists them, whether or not the Guide is open.
 */
export interface ChannelUniverse {
  filter: GuideFilter
  favourites: readonly number[]
}

export const WHOLE_NETWORK: ChannelUniverse = { filter: 'all', favourites: [] }

/** The tab's channels in the Guide's own order: every listed channel, the viewer's own, or Favourites as arranged. */
export function universeChannels(universe: ChannelUniverse, channels: readonly Channel[] = listChannels()): Channel[] {
  const listed = channels.filter((channel) => channelMatchesFilter(channel, universe.filter, universe.favourites))
  return universe.filter === 'favourites' ? inFavouriteOrder(listed, universe.favourites) : listed
}

/** Channels CH+ and CH- can land on: listed, on air and not an empty User Channel slot. */
function steppable(universe: ChannelUniverse): Channel[] {
  return universeChannels(universe).filter((channel) => channel.enabled && !channel.emptySlot && isOnAir(channel))
}

/**
 * Where CH+ or CH- lands: stepped from the channel being watched, or from a tune that is still settling.
 * ALL is the whole network exactly as before. In TVN or FAVOURITES the step wraps around that tab's list; a
 * channel outside the list enters it at its first channel going up and its last going down. Null when the
 * tab has nothing to tune.
 */
export function stepTarget(tuned: Tuned, pending: number | null, delta: 1 | -1): number
export function stepTarget(tuned: Tuned, pending: number | null, delta: 1 | -1, universe: ChannelUniverse): number | null
export function stepTarget(tuned: Tuned, pending: number | null, delta: 1 | -1, universe: ChannelUniverse = WHOLE_NETWORK): number | null {
  const from = pending ?? tuned.channelNumber
  if (universe.filter === 'all') return adjacentChannel(from, delta).number
  const list = steppable(universe)
  if (list.length === 0) return null
  const index = list.findIndex((channel) => channel.number === from)
  if (index < 0) return (delta > 0 ? list[0] : list[list.length - 1]).number
  return list[(index + delta + list.length) % list.length].number
}

/** R: any other on-air channel of the tab, with the same rules as the whole network; the current one only when it is the sole choice. */
export function randomTarget(current: number, universe: ChannelUniverse = WHOLE_NETWORK, random: () => number = Math.random): Channel | undefined {
  return universe.filter === 'all' ? randomChannel(current, random) : randomChannel(current, random, universeChannels(universe))
}

/** What CH+, CH- or R says when the chosen tab has nothing to tune. */
export function emptyUniverseNote(filter: GuideFilter): string {
  return filter === 'favourites' ? 'NO FAVOURITES TO TUNE' : filter === 'user' ? 'NO TVN CHANNELS TO TUNE' : filter.startsWith('user:') ? 'NO CHANNELS FOR THIS USER YET' : 'NO CHANNELS TO TUNE'
}

/** A committed tune. The channel left becomes Previous; landing back on the origin leaves history alone. */
export function commitTuned(tuned: Tuned, target: number, origin = tuned.channelNumber): Tuned {
  return target === origin ? tuned : { channelNumber: target, previousNumber: origin }
}
