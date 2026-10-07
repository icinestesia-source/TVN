import { isOnAir } from '../network/airing.ts'
import { isClosedChannel } from '../director/fit.ts'
import { channelIsDefined } from './independent/network.ts'
import type { MediaKind, ProgrammeType } from '../types/programme.ts'
import { canonicalByNumber, filterIdForCategory } from './canonical.ts'

/** 000 is reserved for TVN's own channel (src/tvn/tvn-channel.ts), never a curated or user channel. */
export const CHANNEL_ZERO_RESERVED = true

/** 992–1000 are reserved for Local Media (media from this device), between the network and user television; never allocated. */
export const CHANNEL_THOUSAND_RESERVED = true

export interface NetworkArea {
  id: string
  label: string
  from: number
  to: number
  note: string
}

/** Descriptive bands. Guide filtering uses canonical category metadata. */
export const NETWORK_AREAS: readonly NetworkArea[] = [
  { id: 'main', label: 'Main', from: 1, to: 99, note: 'Core package' },
  { id: 'films', label: 'Films', from: 100, to: 199, note: 'Features, documentary, trailers' },
  { id: 'entertainment', label: 'Entertainment', from: 200, to: 299, note: 'Entertainment' },
  { id: 'sport', label: 'Sport', from: 300, to: 399, note: 'Sport' },
  { id: 'history', label: 'History', from: 400, to: 499, note: 'History, geography, knowledge' },
  { id: 'music', label: 'Music', from: 500, to: 599, note: 'Music' },
  { id: 'business', label: 'Business', from: 600, to: 699, note: 'Business and technology' },
  { id: 'lifestyle', label: 'Lifestyle', from: 700, to: 799, note: 'Food, health, home' },
  { id: 'specialist', label: 'Specialist', from: 800, to: 849, note: 'Archive and experiment' },
  { id: 'live-world', label: 'Live World', from: 850, to: 879, note: 'Live world and webcams' },
  { id: 'news', label: 'News', from: 900, to: 949, note: 'News and information' },
  { id: 'radio', label: 'Radio', from: 950, to: 991, note: 'Radio' },
  { id: 'local', label: 'Local Media', from: 992, to: 1000, note: 'Media from this device, for this session' },
]

/** Imported and hand-built television starts here and is not capped at four digits. */
export const USER_NUMBER_START = 1001
export const USER_NUMBER_LIMIT = 100000

export const GUIDE_FILTERS: readonly { id: string; label: string }[] = [
  { id: 'main', label: 'Main' },
  { id: 'films', label: 'Films' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'sport', label: 'Sport' },
  { id: 'history', label: 'History' },
  { id: 'music', label: 'Music' },
  { id: 'business', label: 'Business' },
  { id: 'lifestyle', label: 'Lifestyle' },
  { id: 'specialist', label: 'Specialist' },
  { id: 'live-world', label: 'Live World' },
  { id: 'news', label: 'News' },
  { id: 'radio', label: 'Radio' },
]

export const GUIDE_TOOLBAR = ['expand', 'import', 'close'] as const

const FILTER_ALIASES: Record<string, string> = {
  film: 'films',
  films: 'films',
  knowledge: 'history',
  history: 'history',
  'business-tech': 'business',
  business: 'business',
  webcams: 'live-world',
  'live-world': 'live-world',
}

export function categoryIdFor(category: string): string {
  const key = category.toLowerCase()
  if (FILTER_ALIASES[key]) return FILTER_ALIASES[key]
  if (key === 'documentary') return 'documentary'
  if (key === 'places' || key === 'travel') return 'geography'
  if (key === 'science') return 'science'
  if (key === 'law' || key === 'justice') return 'law'
  return filterIdForCategory(key)
}

/**
 * The Guide is the network directory: every defined curated channel is listed, on air
 * or not, except channels the network excludes or deliberately keeps unavailable.
 */
export function inNetworkDirectory(number: number): boolean {
  return channelIsDefined(number) && !isClosedChannel(number)
}

export function channelMatchesFilter(
  channel: { number: number; enabled: boolean; origin?: string; owner?: string; mediaKind?: MediaKind; categoryId?: string },
  filter: string,
  favourites: readonly number[],
): boolean {
  if (!channel.enabled) return false
  if (channel.origin === 'session' || channel.origin === 'tvn') return filter === 'all' || (filter === 'favourites' && favourites.includes(channel.number))
  const curated = channel.number < USER_NUMBER_START && channel.origin !== 'user-import' && channel.origin !== 'user-created'
  if (filter === 'dormant') return curated && !isOnAir(channel)
  if (curated && !inNetworkDirectory(channel.number)) return false
  if (filter === 'all') return true
  if (filter === 'favourites') return favourites.includes(channel.number)
  const userChannel = channel.origin === 'user-import' || channel.origin === 'user-created'
  if (filter === 'user') return userChannel && !channel.owner
  if (filter.startsWith('user:')) return userChannel && channel.owner === filter.slice('user:'.length)
  if (filter === 'retrotv') return channel.number < USER_NUMBER_START && channel.origin !== 'user-import' && channel.origin !== 'user-created'
  const kind: MediaKind = channel.mediaKind ?? 'video'
  const category = channel.categoryId ?? ''
  const wanted = FILTER_ALIASES[filter] ?? filter
  if (wanted === 'news') return category === 'news'
  if (wanted === 'radio') return category === 'radio' || kind === 'audio'
  return category === wanted
}

/** The Favourites view lists channels in the viewer's order rather than by number. */
export function inFavouriteOrder<T extends { number: number }>(channels: readonly T[], favourites: readonly number[]): T[] {
  const rank = new Map(favourites.map((number, index) => [number, index]))
  const at = (channel: T) => rank.get(channel.number) ?? favourites.length
  return [...channels].sort((a, b) => at(a) - at(b))
}

export function rangeForNumber(number: number): string {
  if (number === 0 || number === 1000) return 'reserved'
  if (number >= USER_NUMBER_START) return 'user'
  const entry = canonicalByNumber(number)
  if (!entry) return 'main'
  return filterIdForCategory(entry.category)
}

export type ListedProgrammeType = ProgrammeType
