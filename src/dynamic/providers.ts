import config from '../data/dynamic/providers.json'

/**
 * Live and rolling channels (Pass 21). The shipped config is written at release time by
 * scripts/dynamic_refresh.py; the application itself never calls a developer API.
 *
 * LIVE_STREAM:          an official continuous embeddable stream.
 * ROLLING_CURRENT:      recent official programmes, each inside the channel's freshness window.
 * HYBRID_LIVE_ROLLING:  the stream when it plays, otherwise the rolling pool.
 * LIVE_CAMS:            many verified live webcams, taken in turn in clock-aligned slots.
 * UNRESOLVED:           no usable path; the channel stays off air with the recorded reason.
 */
export type DynamicMode = 'LIVE_STREAM' | 'ROLLING_CURRENT' | 'HYBRID_LIVE_ROLLING' | 'LIVE_CAMS' | 'UNRESOLVED'

export interface LiveEndpoint {
  sourceId: string
  videoId: string
  service: string
  verifiedAt: string
  /** The YouTube channel that runs the stream, for a webcam. */
  publisher?: string
}

export interface RollingRule {
  freshnessDays: number
  rule: string
  sources: string[]
  programmes: number
  hours: number
}

export interface DynamicChannel {
  mode: DynamicMode
  identity: string
  family?: string
  reason?: string
  live?: LiveEndpoint
  rolling?: RollingRule
  /** LIVE_CAMS: the channel's verified webcams, in the order they rotate. */
  cams?: LiveEndpoint[]
}

interface DynamicConfig {
  format: 'retrotv-dynamic-v1'
  version: string
  refreshedAt: string
  channels: Record<string, DynamicChannel>
}

const doc = config as DynamicConfig

export const DYNAMIC_VERSION = doc.version
export const DYNAMIC_REFRESHED_AT = doc.refreshedAt

const channels = new Map<number, DynamicChannel>(Object.entries(doc.channels).map(([number, entry]) => [Number(number), entry]))

/** Every channel classified by the live/rolling model, including unresolved ones. */
export const DYNAMIC_CHANNELS: readonly number[] = [...channels.keys()].sort((a, b) => a - b)

export function dynamicChannel(channelNumber: number): DynamicChannel | undefined {
  return channels.get(channelNumber)
}

export function liveEndpoint(channelNumber: number): LiveEndpoint | undefined {
  const entry = channels.get(channelNumber)
  if (!entry || (entry.mode !== 'LIVE_STREAM' && entry.mode !== 'HYBRID_LIVE_ROLLING')) return undefined
  return entry.live
}

/** A webcam channel's verified cams; empty for every other channel. */
export function liveCams(channelNumber: number): readonly LiveEndpoint[] {
  const entry = channels.get(channelNumber)
  return entry?.mode === 'LIVE_CAMS' ? (entry.cams ?? []) : []
}

/** Rolling programmes air only inside this window; a channel without one takes no rolling programmes. */
export function freshnessDays(channelNumber: number): number | undefined {
  const entry = channels.get(channelNumber)
  if (!entry) return undefined
  if (entry.mode === 'ROLLING_CURRENT' || entry.mode === 'HYBRID_LIVE_ROLLING') return entry.rolling?.freshnessDays
  return 0
}
