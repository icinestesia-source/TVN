import { listChannels } from '../../data/catalogue.ts'
import type { EntertainmentTitle } from './types.ts'

export interface TvnMatch {
  channelNumber: number
  channelName: string
}

/**
 * Exact-ish name match against enabled TVN channels only.
 * Uncertain / partial matches are rejected — never offer WATCH ON TVN for weak hits.
 */
export function matchTitleToTvn(title: EntertainmentTitle): TvnMatch | null {
  const needle = normalise(title.title)
  if (needle.length < 3) return null
  for (const channel of listChannels()) {
    if (!channel.enabled || channel.emptySlot) continue
    const name = normalise(channel.name)
    if (name === needle || name === `${needle} ${title.year ?? ''}`.trim()) {
      return { channelNumber: channel.number, channelName: channel.name }
    }
  }
  return null
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
