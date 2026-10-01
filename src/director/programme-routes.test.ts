import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { expandPlayableCatalogue, type PlayableCatalogueV2 } from '../library/playable-catalogue.ts'
import { getChannelMedia } from '../library/query.ts'
import type { LibraryMedia } from '../library/types.ts'
import { resetDirector } from './director.ts'
import { DEDICATED, OWNED_SOURCES, PROGRAMME_REUSE, programmeSuitsChannel } from './fit.ts'
import { setMediaLibrary } from './library.ts'
import type { MediaItem } from './types.ts'

const doc = JSON.parse(readFileSync('public/independent/playable.json', 'utf8')) as PlayableCatalogueV2
const routes = Object.entries(doc.programmeRoutes ?? {}).map(([channel, ids]) => ({ channel: Number(channel), ids }))

describe('programme-level routes', () => {
  let items: LibraryMedia[] = []
  const byVideo = new Map<string, LibraryMedia>()

  beforeAll(() => {
    items = expandPlayableCatalogue(doc)
    for (const item of items) byVideo.set(item.externalId ?? '', item)
    resetDirector()
    setMediaLibrary(items)
  })

  it('names catalogued programmes from broad sources only, each routed once', () => {
    expect(routes.length).toBeGreaterThan(0)
    const seen = new Set<string>()
    for (const { channel, ids } of routes) {
      if (PROGRAMME_REUSE[channel]) continue
      for (const id of ids) {
        const item = byVideo.get(id)
        expect(item, `${channel} ${id}`).toBeDefined()
        const source = item!.sourceId ?? ''
        expect(OWNED_SOURCES.has(source), `${channel} ${source}`).toBe(false)
        if (DEDICATED[source]) expect(DEDICATED[source], `${channel} ${source}`).toContain(channel)
        else expect(doc.sourceClasses?.[source]).toBe('BROAD_PROGRAMME_ROUTED')
        expect(seen.has(id), id).toBe(false)
        seen.add(id)
        expect(item!.curatedChannels).toContain(channel)
      }
    }
  })

  it('gives every routed channel at least three hours of its chosen programmes and its own publishers, unless the routes add to a channel already on air', () => {
    for (const { channel, ids } of routes) {
      const chosen = new Set(ids.map((id) => `yt:${id}`))
      const pool = getChannelMedia(items as MediaItem[], channel) as LibraryMedia[]
      const airing = pool.filter((item) => chosen.has(item.id) || DEDICATED[item.sourceId ?? '']?.includes(channel))
      const hours = airing.reduce((sum, item) => sum + item.durationSeconds, 0) / 3600
      if (airing.length < pool.length) continue
      expect(hours, `${channel}`).toBeGreaterThan(3)
    }
  })

  it('routes the programme, not its publisher', () => {
    const unrouted = expandPlayableCatalogue({ ...doc, programmeRoutes: {} })
    resetDirector()
    setMediaLibrary(unrouted)
    const before = new Map(routes.map(({ channel }) => [channel, new Set(getChannelMedia(unrouted as MediaItem[], channel).map((item) => item.id))]))
    resetDirector()
    setMediaLibrary(items)
    for (const { channel, ids } of routes) {
      const chosen = new Set(ids)
      const sources = new Set(ids.map((id) => byVideo.get(id)!.sourceId))
      const others = new Set(items.filter((item) => sources.has(item.sourceId) && !chosen.has(item.externalId ?? '')).map((item) => item.id))
      const leaked = getChannelMedia(items as MediaItem[], channel).filter((item) => others.has(item.id) && !before.get(channel)!.has(item.id))
      expect(leaked.map((item) => item.title), `${channel}`).toEqual([])
    }
  }, 120_000)

  it('cannot route a dedicated source away from its home', () => {
    const [source, homes] = Object.entries(DEDICATED)[0]
    const elsewhere = homes[0] === 62 ? 63 : 62
    const item: MediaItem = {
      id: 'yt:route-test',
      title: 'A documentary',
      durationSeconds: 3600,
      programmeType: 'unclassified',
      topics: [],
      mediaKind: 'video',
      explicitChannelIncludes: [elsewhere],
      curatedChannels: [elsewhere],
      ...({ sourceId: source } as object),
    }
    expect(programmeSuitsChannel(item, elsewhere)).toBe(false)
  })
})
