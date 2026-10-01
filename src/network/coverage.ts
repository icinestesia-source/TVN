import { channelByNumber } from '../data/catalogue.ts'
import { defaultNetworkItems } from '../data/network/catalog.ts'
import { NETWORK_SOURCES } from '../data/network/manifest.ts'
import { policyFor, DIRECTOR_CHANNELS } from '../director/policies.ts'
import { getEligibleMedia } from '../library/query.ts'
import type { MediaItem } from '../director/types.ts'

/** Six hours of distinct eligible media. Below that the channel is thin. */
export const HEALTHY_SECONDS = 6 * 60 * 60

export type CoverageStatus = 'POPULATED' | 'THIN' | 'EMPTY' | 'LIVE' | 'SEED'

export interface ChannelCoverage {
  number: number
  name: string
  policy: string
  eligibleCount: number
  eligibleSeconds: number
  sourceCount: number
  playable: number
  unknown: number
  unavailable: number
  status: CoverageStatus
}

export function coverageStatus(eligibleSeconds: number, liveCount: number): CoverageStatus {
  if (liveCount > 0 && eligibleSeconds === 0) return 'LIVE'
  if (eligibleSeconds >= HEALTHY_SECONDS) return 'POPULATED'
  if (eligibleSeconds > 0) return 'THIN'
  return 'EMPTY'
}

export function channelCoverage(items: readonly MediaItem[], channelNumber: number): ChannelCoverage | null {
  const channel = channelByNumber(channelNumber)
  const policy = policyFor(channelNumber)
  if (!channel) return null
  if (!policy) {
    return {
      number: channelNumber,
      name: channel.name,
      policy: 'demonstration schedule',
      eligibleCount: 0,
      eligibleSeconds: 0,
      sourceCount: 0,
      playable: 0,
      unknown: 0,
      unavailable: 0,
      status: 'SEED',
    }
  }
  const eligible = getEligibleMedia(items, channelNumber)
  const eligibleSeconds = eligible.reduce((sum, item) => sum + item.durationSeconds, 0)
  const liveCount = eligible.filter((item) => item.live).length
  const sources = new Set(eligible.map((item) => item.creator || item.sourceRef || item.id))
  return {
    number: channelNumber,
    name: channel.name,
    policy: policy.scheduleStyle,
    eligibleCount: eligible.length,
    eligibleSeconds,
    sourceCount: sources.size,
    playable: eligible.filter((item) => item.externalId).length,
    unknown: eligible.filter((item) => !item.externalId).length,
    unavailable: 0,
    status: coverageStatus(eligibleSeconds, liveCount),
  }
}

export function networkCoverage(items: readonly MediaItem[] = defaultNetworkItems()): ChannelCoverage[] {
  const numbers = new Set<number>([...DIRECTOR_CHANNELS])
  for (let number = 1; number <= 60; number += 1) numbers.add(number)
  return [...numbers]
    .sort((left, right) => left - right)
    .map((number) => channelCoverage(items, number))
    .filter((row): row is ChannelCoverage => row !== null)
}

export function coverageSummary(rows: readonly ChannelCoverage[]) {
  const count = (status: CoverageStatus) => rows.filter((row) => row.status === status).length
  const items = defaultNetworkItems()
  return {
    configured: rows.filter((row) => row.status !== 'SEED').length,
    populated: count('POPULATED'),
    thin: count('THIN'),
    empty: count('EMPTY'),
    live: count('LIVE'),
    seed: count('SEED'),
    media: items.length,
    seconds: items.reduce((sum, item) => sum + item.durationSeconds, 0),
    sources: NETWORK_SOURCES.filter((source) => source.enabled).length,
    placeholders: NETWORK_SOURCES.filter((source) => !source.enabled).length,
  }
}
