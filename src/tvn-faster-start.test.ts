import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { MediaItem } from './director/types.ts'
import { asStored, encodePools, noteCalculatedPools, offerSavedPools, poolsToKeep, resetPoolCacheForTests, takeSavedPools } from './library/pool-cache.ts'

const item = (id: string) => ({ id }) as unknown as MediaItem

describe('A faster start', () => {
  it("keeps a first visit's pools in the order the second visit reads the library back", () => {
    resetPoolCacheForTests()
    const built = [item('yt:c'), item('yt:a'), item('yt:b')]
    noteCalculatedPools(built, new Map([[101, [built[2], built[0]]]]))
    const saved = poolsToKeep()!
    const stored = asStored(built)
    expect(stored.map((each) => each.id)).toEqual(['yt:a', 'yt:b', 'yt:c'])
    offerSavedPools(saved)
    expect(takeSavedPools(stored)?.get(101)).toEqual([built[2], built[0]])
  })

  it('leaves a library already in stored order as it is', () => {
    const sorted = [item('a'), item('b')]
    expect(asStored(sorted)).toBe(sorted)
    expect(encodePools(sorted, new Map([[1, [sorted[1]]]]))?.positions).toEqual(new Int32Array([1]))
  })

  it('downloads the shipped catalogue and curated edits while the saved library is read', () => {
    const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')
    const start = provider.indexOf('const shipped = fetchShippedCatalogue()')
    expect(start).toBeGreaterThan(0)
    expect(start).toBeLessThan(provider.indexOf('await hydrateDirector()'))
    expect(provider).toContain('await loadShippedIndependentCatalogue(shipped)')
    expect(provider.indexOf("import('../data/central-edits.json')")).toBeLessThan(provider.indexOf('await hydrateDirector()'))
  })

  it('begins the catalogue and the first picture before any script runs', () => {
    const html = readFileSync('index.html', 'utf8')
    expect(html).toContain('<link rel="preload" href="/independent/playable.json" as="fetch" crossorigin="anonymous" />')
    expect(html).toContain('<link rel="preconnect" href="https://www.youtube.com" />')
    expect(html).toContain('<link rel="preconnect" href="https://i.ytimg.com" />')
  })
})
