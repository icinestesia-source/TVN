import { USER_NUMBER_LIMIT, USER_NUMBER_START } from '../data/network.ts'
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

/** The User Network's channels in their current order. */
export function userOrder(sources: readonly StoredSource[]): StoredSource[] {
  return sources.filter((source) => isUserNumber(source.channelNumber)).sort((a, b) => (a.channelNumber as number) - (b.channelNumber as number))
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

export interface Renumbered {
  sources: StoredSource[]
  /** Old number → new number, for every channel whose number changed. */
  moves: Map<number, number>
}

/**
 * The User Network in the order `ids` gives, numbered 1001, 1002, … with no gaps. `ids` must name every 1001+
 * channel exactly once; anything else is refused whole, so a stale list can never drop or duplicate a channel.
 */
export function renumberUserNetwork(sources: readonly StoredSource[], ids: readonly string[]): Renumbered {
  const users = userOrder(sources)
  const known = new Set(users.map((source) => source.id))
  if (ids.length !== users.length || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new Error('The User Network changed while it was being reordered')
  }
  if (USER_NUMBER_START + ids.length > USER_NUMBER_LIMIT) throw new Error('The User Network is full')
  const place = new Map(ids.map((id, index) => [id, USER_NUMBER_START + index]))
  const moves = new Map<number, number>()
  const next = sources.map((source) => {
    const number = place.get(source.id)
    if (number === undefined || !isUserNumber(source.channelNumber)) return { ...source, videos: source.videos.slice() }
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
  if (!guide.items.some((item) => moves.has(item.channelNumber))) return guide
  return { ...guide, items: guide.items.map((item) => (moves.has(item.channelNumber) ? { ...item, channelNumber: remapNumber(item.channelNumber, moves) } : item)) }
}

/** Saved Guides follow renumbered channels; the edit stamps are left alone, since nothing the viewer chose changed. */
export function remapGuideLibrary(library: GuideLibrary, moves: ReadonlyMap<number, number>): GuideLibrary {
  if (moves.size === 0) return library
  return { current: library.current ? remapGuide(library.current, moves) : null, saved: library.saved.map((guide) => remapGuide(guide, moves)) }
}

/** The stored records without one user channel: it goes from the network entirely, number and all. */
export function deleteUserChannel(sources: readonly StoredSource[], number: number): { sources: StoredSource[]; status: 'deleted' | 'missing' } {
  if (!isUserNumber(number) || !sources.some((source) => source.channelNumber === number)) {
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
