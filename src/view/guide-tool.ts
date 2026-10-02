import { channelMatchesFilter } from '../data/network.ts'
import { SESSION_CHANNEL_NUMBER } from '../session/session-channel.ts'
import type { Channel } from '../types/channel.ts'
import type { GuideTool } from '../types/input.ts'
import type { GuideFilter } from '../types/preferences.ts'

/**
 * Where the Guide goes for MEDIA, IMPORT or ADD. MEDIA: channel 000 at the current time, under a filter
 * that lists it. IMPORT and ADD: the foot of the User Network, keeping the cursor if its channel is still
 * listed. EDIT: the channel asked for (or the cursor's), where the Guide already is.
 */
export function guideToolTarget(
  kind: GuideTool,
  filter: GuideFilter,
  favourites: readonly number[],
  cursor: { channelNumber: number; timeMs: number },
  channels: readonly Channel[],
  nowMs: number,
  requested?: number,
): { filter: GuideFilter; cursor: { channelNumber: number; timeMs: number } } {
  if (kind === 'edit') return { filter, cursor: { channelNumber: requested ?? cursor.channelNumber, timeMs: cursor.timeMs } }
  if (kind === 'media') {
    const session = channels.find((item) => item.number === SESSION_CHANNEL_NUMBER)
    return {
      filter: session && channelMatchesFilter(session, filter, favourites) ? filter : 'all',
      cursor: { channelNumber: SESSION_CHANNEL_NUMBER, timeMs: nowMs },
    }
  }
  const nextFilter: GuideFilter = filter === 'all' || filter === 'user' ? filter : 'user'
  const listed = channels.filter((item) => channelMatchesFilter(item, nextFilter, favourites))
  const channelNumber = listed.some((item) => item.number === cursor.channelNumber)
    ? cursor.channelNumber
    : (listed[listed.length - 1]?.number ?? cursor.channelNumber)
  return { filter: nextFilter, cursor: { channelNumber, timeMs: cursor.timeMs } }
}
