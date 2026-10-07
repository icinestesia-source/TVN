import { isLowUserNumber, isOwnNumber, LOW_USER_FIRST, LOW_USER_LAST, USER_NUMBER_LIMIT, USER_NUMBER_START } from '../data/network.ts'
import type { ViewingHistory } from '../state/history.ts'
import type { StoredSource } from './channels-import.ts'
import type { GuideLibrary, ViewingGuide } from './viewing-guides.ts'

/**
 * The User Network's running order. A channel is its stored record, known by its id; its number is only its
 * place in the network. Reordering renumbers every 1001+ channel consecutively from 1001, and everything
 * that names a channel by number (Favourites, the channel watched and the one before, Multi View, viewing
 * history, saved Guides) follows its channel through the same map, so nothing is left pointing at a place.
 */

export const isUserNumber = (number: number | null | undefined): number is number =>
  typeof number === 'number' && number >= USER_NUMBER_START && number < USER_NUMBER_LIMIT

/** A run of numbers the viewer's channels are ordered within: 1001+, or 001–990 in a network of their own. */
export interface NumberBlock {
  first: number
  last: number
}
export const USER_BLOCK: NumberBlock = { first: USER_NUMBER_START, last: USER_NUMBER_LIMIT - 1 }
export const LOW_BLOCK: NumberBlock = { first: LOW_USER_FIRST, last: LOW_USER_LAST }

export function blockFor(number: number): NumberBlock {
  return isLowUserNumber(number) ? LOW_BLOCK : USER_BLOCK
}

const inBlock = (number: number | null | undefined, block: NumberBlock): number is number =>
  typeof number === 'number' && number >= block.first && number <= block.last

/** The User Network's channels in their current order (1001+ unless another block is given). */
export function userOrder(sources: readonly StoredSource[], block: NumberBlock = USER_BLOCK): StoredSource[] {
  return sources.filter((source) => inBlock(source.channelNumber, block)).sort((a, b) => (a.channelNumber as number) - (b.channelNumber as number))
}

/** `ids` with `id` moved to `to` (clamped to the list). */
export function moveTo(ids: readonly string[], id: string, to: number): string[] {
  const from = ids.indexOf(id)
  if (from < 0) return ids.slice()
  const next = ids.slice()
  next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id)
  return next
}

const byName = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/**
 * SORT A–Z: the User Network's ids in human alphabetical order of the names the viewer sees (case and accents
 * aside, numbers by value). Empty slots keep their relative order after the named channels.
 */
export function alphabeticalOrder(
  sources: readonly StoredSource[],
  nameOf: (source: StoredSource) => string = (source) => source.name,
  block: NumberBlock = USER_BLOCK,
): string[] {
  const users = userOrder(sources, block)
  const named = users.filter((source) => !source.emptySlot)
  const empty = users.filter((source) => source.emptySlot)
  const sorted = named
    .map((source, index) => ({ id: source.id, name: nameOf(source).trim(), index }))
    .sort((a, b) => byName.compare(a.name, b.name) || a.index - b.index)
  return [...sorted.map((item) => item.id), ...empty.map((source) => source.id)]
}

/** RANDOMISE: the ids shuffled once (Fisher–Yates), each order equally likely. */
export function shuffledOrder(ids: readonly string[], random: () => number = Math.random): string[] {
  const next = ids.slice()
  for (let index = next.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    ;[next[index], next[other]] = [next[other]!, next[index]!]
  }
  return next
}

/** MOVE TO: where `target` puts a channel in the User Network, or why it cannot. */
export function moveTarget(order: readonly StoredSource[], target: number, block: NumberBlock = USER_BLOCK): { index: number } | { error: string } {
  const last = block.first + order.length - 1
  if (!Number.isInteger(target) || target < block.first || target > last) {
    const run = `${String(block.first).padStart(3, '0')}–${String(last).padStart(3, '0')}`
    return { error: order.length ? `User channels run ${run}` : 'There are no User channels to move' }
  }
  return { index: target - block.first }
}

export interface Renumbered {
  sources: StoredSource[]
  /** Old number → new number, for every channel whose number changed. */
  moves: Map<number, number>
}

/**
 * The User Network in the order `ids` gives, numbered 1001, 1002, … with no gaps. `ids` must name every 1001+
 * channel exactly once; anything else is refused whole, so a stale list can never drop or duplicate a channel.
 */
export function renumberUserNetwork(sources: readonly StoredSource[], ids: readonly string[], block: NumberBlock = USER_BLOCK): Renumbered {
  const users = userOrder(sources, block)
  const known = new Set(users.map((source) => source.id))
  if (ids.length !== users.length || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new Error('The User Network changed while it was being reordered')
  }
  if (block.first + ids.length - 1 > block.last) throw new Error('The User Network is full')
  const place = new Map(ids.map((id, index) => [id, block.first + index]))
  const moves = new Map<number, number>()
  const next = sources.map((source) => {
    const number = place.get(source.id)
    if (number === undefined || !inBlock(source.channelNumber, block)) return { ...source, videos: source.videos.slice() }
    if (number !== source.channelNumber) moves.set(source.channelNumber, number)
    // An empty slot's id names its number; it takes the new one.
    const id = source.emptySlot ? `slot:${number}` : source.id
    return { ...source, id, channelNumber: number, videos: source.videos.slice() }
  })
  return { sources: next, moves }
}

export const remapNumber = (number: number, moves: ReadonlyMap<number, number>): number => moves.get(number) ?? number

export function remapNumbers(numbers: readonly number[], moves: ReadonlyMap<number, number>): number[] {
  return numbers.map((number) => remapNumber(number, moves))
}

export function remapHistory(history: ViewingHistory, moves: ReadonlyMap<number, number>): ViewingHistory {
  return { ...history, entries: remapNumbers(history.entries, moves) }
}

function remapGuide(guide: ViewingGuide, moves: ReadonlyMap<number, number>): ViewingGuide {
  const sources = guide.sources?.some((source) => moves.has(source.channelNumber))
  if (!sources && !guide.items.some((item) => moves.has(item.channelNumber))) return guide
  return {
    ...guide,
    items: guide.items.map((item) => (moves.has(item.channelNumber) ? { ...item, channelNumber: remapNumber(item.channelNumber, moves) } : item)),
    // A source is known by its channel's id; its number only names it, and follows too.
    ...(sources ? { sources: guide.sources!.map((source) => ({ ...source, channelNumber: remapNumber(source.channelNumber, moves) })) } : {}),
  }
}

/** Saved Guides follow renumbered channels; the edit stamps are left alone, since nothing the viewer chose changed. */
export function remapGuideLibrary(library: GuideLibrary, moves: ReadonlyMap<number, number>): GuideLibrary {
  if (moves.size === 0) return library
  return { current: library.current ? remapGuide(library.current, moves) : null, saved: library.saved.map((guide) => remapGuide(guide, moves)) }
}

/** The stored records without one user channel: it goes from the network entirely, number and all. */
export function deleteUserChannel(sources: readonly StoredSource[], number: number): { sources: StoredSource[]; status: 'deleted' | 'missing' } {
  if (!isOwnNumber(number) || !sources.some((source) => source.channelNumber === number)) {
    return { sources: sources.map((source) => ({ ...source, videos: source.videos.slice() })), status: 'missing' }
  }
  return { sources: sources.filter((source) => source.channelNumber !== number).map((source) => ({ ...source, videos: source.videos.slice() })), status: 'deleted' }
}

/**
 * Favourites that still name a channel: a 1001+ favourite whose channel is gone, or is only an empty slot,
 * is dropped. TVN's own channels (001–999, 000) are never touched here.
 */
export function liveFavourites(favourites: readonly number[], sources: readonly StoredSource[]): number[] {
  const live = new Set(sources.flatMap((source) => (isUserNumber(source.channelNumber) && !source.emptySlot ? [source.channelNumber] : [])))
  return favourites.filter((number) => !isUserNumber(number) || live.has(number))
}

/** Viewing history without the channels that are gone; the place in it stays on the same entry where it can. */
export function historyWithout(history: ViewingHistory, gone: ReadonlySet<number>): ViewingHistory {
  if (!history.entries.some((number) => gone.has(number))) return history
  const before = history.entries.slice(0, history.index + 1).filter((number) => !gone.has(number)).length
  const entries = history.entries.filter((number) => !gone.has(number))
  return { entries, index: Math.min(entries.length - 1, Math.max(before - 1, entries.length ? 0 : -1)) }
}
