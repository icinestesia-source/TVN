import { adjacentChannel, listChannels, playingLocal, randomChannel } from '../data/catalogue.ts'
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

/** Channels CH+ and CH- can land on: listed, on air, not an empty User Channel slot and not an empty Local Media channel. */
function steppable(universe: ChannelUniverse): Channel[] {
  return universeChannels(universe).filter((channel) => channel.enabled && playingLocal(channel) && !channel.emptySlot && isOnAir(channel))
}

/**
 * Where CH+ or CH- lands: stepped from the channel being watched, or from a tune that is still settling.
 * ALL is the whole network exactly as before. In any other tab the step wraps around that tab's list. From
 * a channel outside it (a number typed from elsewhere) the step comes back in: in a tab listed by number, at
 * the next listed channel above going up or below going down, wrapping at the ends; in FAVOURITES, which
 * has the viewer's own order, at its first channel going up and its last going down. Null when the tab has
 * nothing to tune.
 */
export function stepTarget(tuned: Tuned, pending: number | null, delta: 1 | -1): number
export function stepTarget(tuned: Tuned, pending: number | null, delta: 1 | -1, universe: ChannelUniverse): number | null
export function stepTarget(tuned: Tuned, pending: number | null, delta: 1 | -1, universe: ChannelUniverse = WHOLE_NETWORK): number | null {
  const from = pending ?? tuned.channelNumber
  if (universe.filter === 'all') return adjacentChannel(from, delta).number
  const list = steppable(universe)
  if (list.length === 0) return null
  const index = list.findIndex((channel) => channel.number === from)
  if (index >= 0) return list[(index + delta + list.length) % list.length].number
  if (universe.filter !== 'favourites') {
    const entry = delta > 0 ? list.find((channel) => channel.number > from) : list.findLast((channel) => channel.number < from)
    if (entry) return entry.number
  }
  return (delta > 0 ? list[0] : list[list.length - 1]).number
}

/**
 * Where an automatic recovery falls forward to from a channel that will not play: the next channel CH+
 * would reach in the selected tab (entering it from outside the same way), passing over every channel
 * this recovery has already given up on. Null once the tab has nothing left to try.
 */
export function fallForwardTarget(from: number, universe: ChannelUniverse, failed: ReadonlySet<number>): number | null {
  const seen = new Set<number>([from])
  let at = from
  for (;;) {
    const next = stepTarget({ channelNumber: at, previousNumber: null }, null, 1, universe)
    if (next === null || seen.has(next)) return null
    if (!failed.has(next)) return next
    seen.add(next)
    at = next
  }
}

/**
 * The Guide's rows for the selected tab. The channel being watched, when the tab does not list it, is shown
 * among them for as long as it is watched (at the top of FAVOURITES, in number order elsewhere): a row on
 * screen only, never a member of the tab, a favourite, or anything saved or exported.
 */
export function guideRows(listed: readonly Channel[], watching: Channel | undefined, filter: GuideFilter): { rows: Channel[]; visiting: number | null } {
  if (!watching || listed.some((channel) => channel.number === watching.number)) return { rows: [...listed], visiting: null }
  if (filter === 'favourites') return { rows: [watching, ...listed], visiting: watching.number }
  const at = listed.findIndex((channel) => channel.number > watching.number)
  const rows = [...listed]
  rows.splice(at < 0 ? rows.length : at, 0, watching)
  return { rows, visiting: watching.number }
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
