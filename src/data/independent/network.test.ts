import { describe, expect, it } from 'vitest'
import { channelByNumber } from '../catalogue.ts'
import { getSchedule, resetDirector } from '../../director/director.ts'
import { setMediaLibrary } from '../../director/library.ts'
import { schedulingPool } from '../../library/mode.ts'
import { librarySnapshot, resetLibraryForTests } from '../../library/store.ts'
import type { LibraryMedia } from '../../library/types.ts'
import { isOnAir, refreshAiring } from '../../network/airing.ts'
import {
  CHANNEL_ROUTES,
  INDEPENDENT_SOURCES,
  channelMayAir,
  channelRoute,
  independentSourceRecords,
  strategyCount,
} from './network.ts'

describe('independent default network', () => {
  it('wires the supplied source register and leaves every source without playable items', () => {
    resetLibraryForTests()
    resetDirector()
    const records = independentSourceRecords()
    expect(INDEPENDENT_SOURCES).toHaveLength(59)
    expect(records).toHaveLength(59)
    expect(records.every((source) => source.mediaCount === 0 && source.origin === 'independent-default')).toBe(true)
    expect(CHANNEL_ROUTES).toHaveLength(1000)
    expect(strategyCount('DELIBERATELY_UNAVAILABLE')).toBe(44)
    expect(strategyCount('EXCLUDED')).toBe(11)
    expect(strategyCount('SOURCE_ROUTED')).toBe(795)
    expect(strategyCount('CURATED_AGGREGATE')).toBe(123)
    expect(strategyCount('RETROTV_ORIGINAL_GENERATED')).toBe(18)
    expect(strategyCount('FREE_LIVE_DISCOVERY')).toBe(9)
    const ids = new Set(librarySnapshot().sources.map((source) => source.id))
    expect(INDEPENDENT_SOURCES.every((source) => ids.has(source.id))).toBe(true)
    expect(channelRoute(317)?.strategy).toBe('DELIBERATELY_UNAVAILABLE')
    expect(channelRoute(64)?.strategy).toBe('EXCLUDED')
    expect(channelMayAir(317)).toBe(false)
    expect(channelMayAir(64)).toBe(false)
    expect(channelMayAir(853)).toBe(false)
    expect(channelMayAir(301)).toBe(true)
  })

  it('does not put a user-network item or a blocked station on air', () => {
    resetLibraryForTests()
    resetDirector()
    const item = {
      id: 'yt:nba',
      title: 'Celtics talk',
      durationSeconds: 8 * 60 * 60,
      programmeType: 'analysis',
      topics: ['basketball'],
      subjects: ['basketball'],
      provider: 'youtube',
      externalId: 'nba',
      provenance: 'built-in-user',
      ingestedFrom: 'retrotv-user-network',
    } as LibraryMedia
    expect(schedulingPool([item])).toHaveLength(0)
    setMediaLibrary([item])
    refreshAiring([item])
    expect(isOnAir(channelByNumber(317)!)).toBe(false)
    expect(getSchedule(channelByNumber(317)!, '2026-09-26').blocks.some((block) => block.children.some((child) => child.videoId))).toBe(false)
    const onAir = CHANNEL_ROUTES.filter((route) => channelMayAir(route.number) && route.number > 0)
    expect(onAir.length).toBeGreaterThan(0)
    expect(isOnAir(channelByNumber(301)!)).toBe(false)
  })
})
