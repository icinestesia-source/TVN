import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mediaLibrary } from '../director/library.ts'
import { DIRECTOR_CHANNELS } from '../director/policies.ts'
import type { MediaItem } from '../director/types.ts'
import { schedulingPool } from './mode.ts'
import { decodePools, encodePools, noteCalculatedPools, offerSavedPools, poolKey, poolsToKeep, resetPoolCacheForTests } from './pool-cache.ts'
import { getChannelMedia } from './query.ts'
import { loadShippedIndependentCatalogue, resetLibraryForTests, setLibraryWriter } from './store.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  resetLibraryForTests()
  resetPoolCacheForTests()
})

async function shippedPool(): Promise<readonly MediaItem[]> {
  resetLibraryForTests()
  resetPoolCacheForTests()
  setLibraryWriter({ async write() {}, async read() { return { media: [], sources: [] } } })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(readFileSync('public/independent/playable.json', 'utf8'), { status: 200 })))
  await loadShippedIndependentCatalogue()
  return schedulingPool(mediaLibrary())
}

const network = DIRECTOR_CHANNELS.filter((number) => number <= 999)

describe('channel pools kept between visits', () => {
  it('a return visit to the same library gets back exactly the pools it would have worked out: the same items, in the same order, on every channel', async () => {
    const pool = await shippedPool()
    const worked = new Map(network.map((number) => [number, getChannelMedia(pool, number)]))
    const saved = poolsToKeep()
    expect(saved).not.toBeNull()
    expect(poolsToKeep()).toBeNull()

    const again = [...pool]
    offerSavedPools(saved)
    let entries = 0
    for (const number of network) {
      const restored = getChannelMedia(again, number)
      const expected = worked.get(number)!
      expect(restored.length).toBe(expected.length)
      for (let index = 0; index < expected.length; index += 1) if (restored[index] !== expected[index]) throw new Error(`channel ${number} differs at ${index}`)
      entries += restored.length
    }
    expect(entries).toBeGreaterThan(100_000)
    expect(poolsToKeep()).toBeNull()
  }, 120_000)

  it('any field the calculation reads changes the key; the count and the build are part of it', async () => {
    const pool = await shippedPool()
    const key = poolKey(pool)
    expect(key).toMatch(/^[^:]+:\d+:[0-9a-f]{16}$/)
    expect(poolKey([...pool])).toBe(key)
    const sample = pool.find((item) => item.topics?.length && item.title) as MediaItem & Record<string, unknown>
    const changes: Partial<MediaItem & Record<string, unknown>>[] = [
      { title: `${sample.title} ` },
      { durationSeconds: sample.durationSeconds + 1 },
      { topics: [...(sample.topics ?? []), 'x'] },
      { sourceId: 'src_other' },
      { programmeType: sample.programmeType === 'film' ? 'documentary' : 'film' } as never,
      { explicitChannelIncludes: [1] },
      { explicitChannelExcludes: [1] },
      { curatedChannels: [1] },
      { eraChannels: [1] },
      { genreChannels: [1] },
      { subjects: ['x'] },
      { sport: 'x' },
      { mediaKind: sample.mediaKind === 'audio' ? 'video' : 'audio' } as never,
      { playbackKind: 'live' } as never,
      { live: !sample.live } as never,
      { userEditedMetadata: ['topics'] },
      { externalId: 'other' },
      { id: `${sample.id}x` },
    ]
    for (const change of changes) {
      const edited = pool.map((item) => (item === sample ? { ...item, ...change } : item))
      expect(poolKey(edited), JSON.stringify(change)).not.toBe(key)
    }
    expect(poolKey(pool.slice(1))).not.toBe(key)
  }, 120_000)

  it('pools kept for another library are not used, and the calculation runs as before', async () => {
    const pool = await shippedPool()
    const worked = getChannelMedia(pool, 101)
    const saved = poolsToKeep()!
    const edited = pool.map((item, index) => (index === 0 ? { ...item, title: `${item.title} (edited)` } : item))
    offerSavedPools(saved)
    const fresh = getChannelMedia(edited, 101)
    expect(poolsToKeep()).not.toBeNull()
    expect(fresh.length).toBeGreaterThan(0)
    expect(worked.length).toBeGreaterThan(0)
  }, 120_000)

  it('pools worked out for an empty library, as before the catalogue loads, are never kept over real ones', () => {
    resetPoolCacheForTests()
    noteCalculatedPools([], new Map())
    expect(poolsToKeep()).toBeNull()
  })

  it('saved positions that do not fit the library are refused rather than guessed', () => {
    const items = [{ id: 'a' }, { id: 'b' }] as unknown as MediaItem[]
    const saved = encodePools(items, new Map([[1, [items[1], items[0]]]]))!
    expect(decodePools(items, saved)!.get(1)).toEqual([items[1], items[0]])
    expect(encodePools(items, new Map([[1, [{ id: 'stranger' } as unknown as MediaItem]]]))).toBeNull()
    expect(decodePools(items.slice(0, 1), saved)).toBeNull()
  })

  it('startup offers the saved pools before the library is first published, and keeps new ones only after the set has painted', () => {
    const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')
    expect(provider).toMatch(/const savedPools = readSavedPools\(\)\.catch\(\(\) => null\)[\s\S]{0,140}offerSavedPools\(await savedPools\)\s+await hydrateLibrary\(\)/)
    expect(provider).toMatch(/afterPaint\(\(\) => void saveDeferredLibrary\(\)\.catch\(\(\) => undefined\)\.then\(keepPools\)\)/)
    expect(readFileSync('vite.config.ts', 'utf8')).toMatch(/const builtAt = Date\.now\(\)[\s\S]*__TVN_BUILD__: JSON\.stringify\(builtAt\.toString\(36\)\)/)
  })
})
