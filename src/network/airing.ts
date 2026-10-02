import { channelIsDefined, channelMayAir } from '../data/independent/network.ts'
import { getChannelMedia } from '../library/query.ts'
import { schedulingPool } from '../library/mode.ts'
import { policyFor, DIRECTOR_CHANNELS } from '../director/policies.ts'
import { broadcastDateFor } from '../director/time.ts'
import { liveCams, liveEndpoint } from '../dynamic/providers.ts'
import { freshFor } from '../dynamic/runtime.ts'
import { originalFormat, originalSeconds } from '../originals/originals.ts'
import type { MediaItem } from '../director/types.ts'
import type { Channel } from '../types/channel.ts'

/**
 * A curated channel is on air when it has playable catalogue material.
 * Empty prototype channels stay off the viewer lineup. Duration is not a gate.
 */
export type AiringStatus = 'active' | 'thin' | 'dormant'

export interface ChannelAiring {
  number: number
  status: AiringStatus
  count: number
  seconds: number
  sources: string[]
  /** Official continuous stream the channel airs when it plays. */
  live?: string
  /** RetroTV original format the channel airs instead of a publisher pool. */
  original?: 'test-card' | 'night-block' | 'listings'
}

let ready = false
const onAir = new Set<number>()
let report: ChannelAiring[] = []

export function airingReady(): boolean {
  return ready
}

export function isBuiltInUser(item: MediaItem & { provenance?: string; ingestedFrom?: string }): boolean {
  return item.provenance === 'built-in-user' || item.ingestedFrom === 'retrotv-user-network'
}

function sourceName(item: MediaItem & { sourceCollection?: string }): string {
  return item.sourceCollection ?? item.creator ?? ''
}

/** Below one three-hour block of distinct material a channel would loop the same few programmes all day. */
const MIN_AIRING_SECONDS = 3 * 3600

/**
 * Rolling channels are measured on today's in-window programmes. A verified official stream puts a
 * channel on air by itself; if it fails in the player the channel falls back to its rolling pool.
 */
export function measureAiring(items: readonly MediaItem[], nowMs = Date.now()): ChannelAiring[] {
  const pool = schedulingPool(items)
  const today = broadcastDateFor(nowMs)
  return DIRECTOR_CHANNELS.map((number) => {
    if (!channelMayAir(number)) {
      return { number, status: 'dormant', count: 0, seconds: 0, sources: [] }
    }
    const format = originalFormat(number)
    if (format) {
      const seconds = originalSeconds(number, pool)
      const needed = format.kind === 'night-block' ? format.hours * 3600 : 0
      return { number, status: seconds > 0 && seconds >= needed ? 'active' : 'dormant', count: 0, seconds, sources: [], original: format.kind }
    }
    const eligible = freshFor(number, getChannelMedia(pool, number), today)
    const seconds = eligible.reduce((sum, item) => sum + item.durationSeconds, 0)
    const sources = [...new Set(eligible.map((item) => sourceName(item)).filter((name) => name.length > 0))]
    const live = liveEndpoint(number)
    const measured: AiringStatus = eligible.length === 0 || seconds <= 0 ? 'dormant' : seconds < MIN_AIRING_SECONDS ? 'thin' : 'active'
    const status: AiringStatus = live ? 'active' : measured
    return { number, status, count: eligible.length, seconds, sources, ...(live ? { live: live.service } : {}) }
  })
}

export function refreshAiring(items: readonly MediaItem[], nowMs = Date.now()): ChannelAiring[] {
  report = measureAiring(items, nowMs)
  onAir.clear()
  for (const row of report) {
    // A thin channel is short, not empty: it still airs, looping what it has.
    if (row.status !== 'dormant') onAir.add(row.number)
  }
  ready = true
  return report
}

export function airingReport(): readonly ChannelAiring[] {
  return report
}

export function isOnAir(channel: { number: number; enabled: boolean; origin?: string; customLineup?: boolean }): boolean {
  if (!channel.enabled) return false
  if (channel.origin === 'session' || channel.origin === 'tvn' || channel.customLineup) return true
  if (channel.number >= 1001 || channel.origin === 'user-import' || channel.origin === 'user-created') return true
  if (liveCams(channel.number).length > 0) return channelIsDefined(channel.number)
  if (!ready) return true
  return onAir.has(channel.number)
}

/** The network's first channel. Neither 1000 Local Media nor 000 TVN is a starting point. */
export function firstOnAir(channels: readonly Channel[]): Channel | undefined {
  const network = channels.filter((channel) => channel.origin !== 'session' && channel.origin !== 'tvn')
  return network.find((channel) => channel.number < 1001 && isOnAir(channel)) ?? network.find((channel) => isOnAir(channel))
}

export interface ChannelFeed {
  total: number
  builtIn: number
  eligible: number
  rejected: number
  hours: number
  sources: number
  compiled: number | null
}

export function channelFeed(
  items: readonly (MediaItem & { provenance?: string; ingestedFrom?: string; sourceCollection?: string })[],
  channelNumber: number,
): ChannelFeed {
  if (!policyFor(channelNumber)) {
    return { total: items.length, builtIn: 0, eligible: 0, rejected: items.length, hours: 0, sources: 0, compiled: null }
  }
  const pool = channelMayAir(channelNumber) ? schedulingPool(items) : []
  const eligible = freshFor(channelNumber, getChannelMedia(pool, channelNumber), broadcastDateFor(Date.now()))
  const builtIn = items.filter((item) => isBuiltInUser(item)).length
  const seconds = eligible.reduce((sum, item) => sum + item.durationSeconds, 0)
  const sources = new Set(eligible.map((item) => sourceName(item)).filter((name) => name.length > 0))
  return {
    total: items.length,
    builtIn,
    eligible: eligible.length,
    rejected: items.length - eligible.length,
    hours: seconds / 3600,
    sources: sources.size,
    compiled: null,
  }
}
