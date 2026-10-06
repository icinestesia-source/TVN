import { USER_NUMBER_START } from '../data/network.ts'
import type { StoredSource } from './channels-import.ts'

/**
 * A new viewer's Favourites, in the order the tab lists them. Seeded once, when no preferences have
 * ever been saved; after that the list is the viewer's own and nothing here is restored.
 */
export const DEFAULT_FAVOURITES: readonly number[] = [
  225, // Saturday Cartoons
  125, // 1980s Trailers
  534, // Dance
  289, // Retro Television
  1014, // Argyle Life | Green
  710, // Street Food
  103, // Classic Film
  1072, // Heat Check
  805, // Newsreel Archive
  535, // Drum & Bass
  1188, // World Wanderings: 4K Walking Tours
  412, // World War II
  1033, // CinemaSins
  485, // Wildlife
  1148, // Secret Base
  844, // Theatre Archive
  536, // Trip-Hop
  491, // Ideas
]

/** For each default favourite in the starter User Network, the starter channel a fresh install numbers it to. */
export function starterFavouriteSources(fresh: readonly StoredSource[]): Map<number, string> {
  const ids = new Map(fresh.filter((source) => !source.emptySlot).map((source) => [source.channelNumber, source.id]))
  const expected = new Map<number, string>()
  for (const number of DEFAULT_FAVOURITES) {
    const id = number >= USER_NUMBER_START ? ids.get(number) : undefined
    if (id !== undefined) expected.set(number, id)
  }
  return expected
}

/**
 * Seeded starter favourites follow their starter channel to the number it actually holds, which differs
 * when the viewer's own channels came first; one whose channel is not installed is dropped.
 */
export function placeStarterFavourites(
  favourites: readonly number[],
  expected: ReadonlyMap<number, string>,
  sources: readonly StoredSource[],
): number[] {
  const numberOf = new Map(sources.map((source) => [source.id, source.channelNumber]))
  const placed: number[] = []
  for (const number of favourites) {
    const id = expected.get(number)
    const actual = id === undefined ? number : numberOf.get(id)
    if (typeof actual === 'number' && !placed.includes(actual)) placed.push(actual)
  }
  return placed
}
