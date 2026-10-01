import { channelMatchesFilter } from '../data/network.ts'
import { formatChannelNumber } from '../input/tuner.ts'
import type { GuideFilter } from '../types/preferences.ts'

/**
 * Narrow the guide's own rows by number or name. Visibility is decided before this. `alsoMatches` lets a
 * channel match on something else, such as the session channel's imported titles.
 */
export function searchGuideChannels<T extends { number: number; name: string }>(
  channels: readonly T[],
  query: string,
  alsoMatches?: (channel: T, needle: string) => boolean,
): readonly T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return channels
  return channels.filter(
    (channel) =>
      String(channel.number).includes(needle) ||
      formatChannelNumber(channel.number).includes(needle) ||
      channel.name.toLowerCase().includes(needle) ||
      Boolean(alsoMatches?.(channel, needle)),
  )
}

export function channelBand(channelNumber: number): number {
  return Math.floor(channelNumber / 100)
}

/**
 * First listed channel of the nearest hundred band before or after the one in
 * view. Bands with no guide rows are skipped; null at either end, or while a
 * search is narrowing the list.
 */
export function guideBandTarget(
  numbers: readonly number[],
  current: number,
  direction: -1 | 1,
  query = '',
): number | null {
  if (query.trim()) return null
  const band = channelBand(current)
  let target: number | null = null
  for (const number of numbers) {
    const other = channelBand(number)
    if (direction > 0 ? other <= band : other >= band) continue
    if (target === null) target = other
    else target = direction > 0 ? Math.min(target, other) : Math.max(target, other)
  }
  if (target === null) return null
  let first: number | null = null
  for (const number of numbers) {
    if (channelBand(number) === target && (first === null || number < first)) first = number
  }
  return first
}

/**
 * The channel the viewer is looking at: the first fully visible row. After a
 * band jump the list may be unable to scroll the target to the top (end of the
 * list), so the jump target stands while the view has not moved since.
 */
export function guideViewedChannel(
  numbers: readonly number[],
  scrollTop: number,
  rowHeight: number,
  anchor: { channelNumber: number; scrollTop: number } | null,
): number | null {
  if (numbers.length === 0) return null
  if (anchor && Math.abs(anchor.scrollTop - scrollTop) < 1 && numbers.includes(anchor.channelNumber)) {
    return anchor.channelNumber
  }
  const index = Math.max(0, Math.min(numbers.length - 1, Math.ceil((scrollTop - 1) / rowHeight)))
  return numbers[index] ?? null
}

export function bandLabel(channelNumber: number): string {
  const start = channelBand(channelNumber) * 100
  const width = start >= 1000 ? 4 : 3
  return `${String(start).padStart(width, '0')}–${String(start + 99).padStart(width, '0')}`
}

/**
 * The guide opens on the tuned channel. If the current mode hides that
 * channel, switch to the network that contains it.
 */
export function guideFilterForChannel(
  channel: { number: number; enabled: boolean; origin?: string },
  filter: GuideFilter,
  favourites: readonly number[],
): GuideFilter {
  if (channelMatchesFilter(channel, filter, favourites)) return filter
  const network: GuideFilter =
    channel.number >= 1001 || channel.origin === 'user-import' || channel.origin === 'user-created'
      ? 'user'
      : 'retrotv'
  if (channelMatchesFilter(channel, network, favourites)) return network
  if (channelMatchesFilter(channel, 'all', favourites)) return 'all'
  return network
}

/** Move up or down the visible channel list without changing the time anchor. */
export function stepGuideChannel(
  numbers: readonly number[],
  cursor: { channelNumber: number; timeMs: number },
  delta: number,
): { channelNumber: number; timeMs: number } {
  if (numbers.length === 0 || delta === 0) return cursor
  const index = numbers.indexOf(cursor.channelNumber)
  const base = index < 0 ? 0 : index
  const span = numbers.length
  const nextIndex = (((base + delta) % span) + span) % span
  return { channelNumber: numbers[nextIndex] ?? cursor.channelNumber, timeMs: cursor.timeMs }
}
