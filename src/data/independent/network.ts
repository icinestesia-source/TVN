import type { SourceRecord } from '../../library/types.ts'
import raw from './manifest.json'

export type IndependentSourceClass =
  | 'CONFIRMED_FREE_YOUTUBE'
  | 'CONFIRMED_FREE_YOUTUBE_LIVE'
  | 'CONFIRMED_FREE_OFFICIAL'
  | 'CONFIRMED_FREE_LIVE'
  | 'FREE_DYNAMIC_CATALOGUE'

export type ChannelStrategy =
  | 'SOURCE_ROUTED'
  | 'CURATED_AGGREGATE'
  | 'EXCLUDED'
  | 'RETROTV_ORIGINAL_GENERATED'
  | 'DELIBERATELY_UNAVAILABLE'
  | 'FREE_LIVE_DISCOVERY'
  | 'FREE_AUDIO_OR_GENERATED'

export interface IndependentSource {
  id: string
  name: string
  class: IndependentSourceClass
  url: string
  targets: number[]
  tags: string[]
  excludeTags: string[]
  notes: string
}

export interface ChannelRoute {
  number: number
  strategy: ChannelStrategy
  sourceIds: string[]
}

interface ManifestFile {
  sources: IndependentSource[]
  routes: ChannelRoute[]
}

const manifest = raw as ManifestFile
const routes = new Map(manifest.routes.map((route) => [route.number, route]))

/** Strategies with no verified playable item, or an editorial bar, stay off air. */
const BLOCKED: ReadonlySet<ChannelStrategy> = new Set([
  'EXCLUDED',
  'DELIBERATELY_UNAVAILABLE',
  'FREE_LIVE_DISCOVERY',
  'FREE_AUDIO_OR_GENERATED',
])

export const INDEPENDENT_SOURCES: readonly IndependentSource[] = manifest.sources
export const CHANNEL_ROUTES: readonly ChannelRoute[] = manifest.routes

export function channelRoute(number: number): ChannelRoute | undefined {
  return routes.get(number)
}

export function strategyCount(strategy: ChannelStrategy): number {
  return manifest.routes.filter((route) => route.strategy === strategy).length
}

/**
 * A routed station can air when it has verified items.
 * Excluded, deliberately unavailable, and unsupported live/audio routes cannot.
 */
export function channelMayAir(number: number): boolean {
  const route = routes.get(number)
  if (!route) return true
  return !BLOCKED.has(route.strategy)
}

/** A defined network channel: anything not excluded or deliberately unavailable, even if it cannot air yet. */
export function channelIsDefined(number: number): boolean {
  const strategy = routes.get(number)?.strategy
  return strategy !== 'EXCLUDED' && strategy !== 'DELIBERATELY_UNAVAILABLE'
}

function providerFor(source: IndependentSource): SourceRecord['provider'] {
  if (source.class.includes('YOUTUBE')) return 'youtube'
  if (source.url.includes('archive.org')) return 'archive'
  return 'web'
}

function sourceKindFor(source: IndependentSource): SourceRecord['sourceKind'] {
  if (source.class.includes('LIVE')) return 'live'
  if (source.url.includes('playlist')) return 'playlist'
  return 'channel'
}

/** Approved free sources. None of them include a provider item, so mediaCount stays 0. */
export function independentSourceRecords(now = 0): SourceRecord[] {
  return manifest.sources.map((source) => {
    const confirmed = source.class.startsWith('CONFIRMED_FREE')
    const live = source.class.includes('LIVE')
    return {
      id: source.id,
      provider: providerFor(source),
      sourceKind: sourceKindFor(source),
      displayName: source.name,
      publisher: source.name,
      externalId: source.url,
      mediaKind: 'video',
      origin: 'independent-default',
      verifiedOfficial: confirmed ? true : 'unknown',
      authorised: confirmed ? true : 'unknown',
      availability: source.class === 'FREE_DYNAMIC_CATALOGUE' ? 'unknown' : 'verified',
      isLive: live,
      canSeek: !live,
      categories: [...source.tags],
      notes: source.notes,
      createdAt: now,
      updatedAt: now,
      mediaCount: 0,
    }
  })
}
