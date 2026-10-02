import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { excludedProgramme } from '../library/exclusions.ts'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { getChannelMedia, getEligibleMedia } from '../library/query.ts'
import type { LibraryMedia } from '../library/types.ts'
import { resetDirector } from './director.ts'
import { DEDICATED, OWNED_SOURCES, PROGRAMME_REUSE } from './fit.ts'
import { setMediaLibrary } from './library.ts'
import type { MediaItem } from './types.ts'

const RECURATED = new Set(Object.keys((JSON.parse(readFileSync('src/data/central-sources.json', 'utf8')) as { channels: object }).channels))

const CURATED = [
  37, 85, 109, 110, 116, 118, 129, 141, 143, 145, 184, 187, 188, 189, 190, 192, 233, 290, 304, 306, 390, 391, 397, 407,
  418, 424, 434, 440, 449, 469, 563, 610, 612, 624, 625, 626, 628, 662, 675, 697, 717, 725, 726, 749, 764, 767, 778,
  819, 837, 838, 882,
]
const DECADES: Record<number, [number, number]> = { 171: [1920, 1929], 172: [1930, 1939], 173: [1940, 1949], 175: [1960, 1969], 176: [1970, 1979], 111: [1930, 1959] }
const HOMES: Record<number, string> = { 654: 'src_icheme', 103: 'src_film_detective' }
const ACTIVATED = [...CURATED.filter((channel) => channel !== 109 && channel !== 110), ...Object.keys(DECADES).map(Number), 654]
const FILM_SOURCES = ['src_popcornflix', 'src_movie_central', 'src_mst3k', 'src_filmrise']
const FORMAT_CHANNELS = [187, 192]
const YEAR_CHANNELS = [544, 547, 588, 589]
const PUBLIC_DOMAIN = [87, 802]
const HORROR_FAMILY = [141, 142, 143, 145, 183, 184, 187]
const CLASSIC_FILM_SLOTS = [109, 110, 141, 145, 188, 189, 190]
const NFB_EXPERIMENTAL = ['src_nfb', 'src_nfb_experimental']
const DISTINCT_TRIOS = [[407, 418, 424], [290, 819, 814], [610, 612, 624, 625, 626, 628]]
const EXCLUDED_CHANNELS = [64, 146, 480, 481, 482, 492, 667, 682, 683, 873, 874]
const EXCLUDED = /\b(space|nasa|rockets?|satellites?|starlink|astronom\w*|astrophysic\w*|cosmos|cosmolog\w*|galax\w*|aircraft|aviation|aviators?|airplanes?|helicopters?|airports?|spaceflight|aerospace|church|christianity|mosque|prayer|bible|theolog\w*|sermon|worship|preach\w*)\b/i

describe('Pass 19 content map and production wave', () => {
  let items: LibraryMedia[] = []
  let routes: Record<string, string[]> = {}
  let sources: Record<string, string> = {}
  let baseline: Record<string, number> = {}
  let originals: Record<string, [number, string, string, string, string]> = {}
  const airing = (channel: number) => getChannelMedia(items as MediaItem[], channel) as LibraryMedia[]
  const hours = (pool: LibraryMedia[]) => pool.reduce((sum, item) => sum + item.durationSeconds, 0) / 3600

  beforeAll(() => {
    const doc = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))
    routes = doc.programmeRoutes
    sources = doc.sources
    originals = doc.originals
    baseline = JSON.parse(readFileSync('docs/remaining-content-map-v38.json', 'utf8')).baselineProgrammes
    items = expandPlayableCatalogue(doc)
    resetDirector()
    setMediaLibrary(items)
  })

  it('maps every source id to one publisher and every publisher to one unfiltered id', () => {
    for (const item of items) expect(sources[item.sourceId ?? ''], item.sourceId).toBeDefined()
    const byName = new Map<string, string>()
    for (const [id, name] of Object.entries(sources)) {
      const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
      expect(byName.get(key) ?? id, `${name}`).toBe(id)
      byName.set(key, id)
    }
    const script = readFileSync('scripts/add_targeted_sources.py', 'utf8')
    const handles = new Map<string, string>()
    for (const [, id, handle] of script.matchAll(/\{"id": "(src_[a-z0-9_]+)", "handle": "([^"]+)"/g)) {
      expect(handles.get(id) ?? handle, id).toBe(handle)
      handles.set(id, handle)
    }
    expect(handles.size).toBeGreaterThan(500)
    expect(readFileSync('scripts/source_registry.py', 'utf8')).toMatch(/def assert_registry/)
    expect(script).toMatch(/assert_registry\(TARGETS, doc\["sources"\]\)/)
  })

  it('keeps British Pathé on 805, KOFA on 114 and Orbital Bacon on 225 alone', () => {
    expect(OWNED_SOURCES.get('src_british_pathe')).toBe(805)
    expect(OWNED_SOURCES.get('src_kofa')).toBe(114)
    expect(OWNED_SOURCES.get('src_orbital_bacon')).toBe(225)
    for (const [source, owner] of OWNED_SOURCES) {
      for (const item of airing(owner)) expect(item.sourceId, `${owner}`).toBe(source)
      for (const channel of ACTIVATED) expect(airing(channel).some((item) => item.sourceId === source), `${source} ${channel}`).toBe(false)
    }
  })

  it('keeps ICC cricket intact and the International Criminal Court on its own id', () => {
    expect(items.some((item) => item.sourceId === 'src_icc')).toBe(true)
    expect(sources.src_icc).not.toMatch(/criminal/i)
    expect(sources.src_intl_criminal_court).toMatch(/criminal court/i)
    for (const channel of ACTIVATED) expect(airing(channel).some((item) => item.sourceId === 'src_icc'), `${channel}`).toBe(false)
  })

  it('carries no excluded subjects on the Pass 19 channels', () => {
    for (const channel of ACTIVATED) for (const item of airing(channel)) expect(item.title, `${channel}`).not.toMatch(EXCLUDED)
  })

  it('reuses programmes only through explicit programme-level routes, leaving dedicated sources at home', () => {
    for (const channel of CURATED) {
      const listed = new Set(routes[String(channel)])
      expect(listed.size, `${channel}`).toBeGreaterThan(0)
      for (const item of airing(channel)) {
        if (DEDICATED[item.sourceId ?? '']?.includes(channel)) continue
        if (channel === 109 || channel === 110) {
          if (item.sourceId !== 'src_film_detective') continue
        }
        expect(PROGRAMME_REUSE[channel], `${channel} ${item.sourceId}`).toContain(item.sourceId)
        expect(listed.has(item.externalId ?? ''), `${channel} ${item.title}`).toBe(true)
      }
      if (channel === 109 || channel === 110) continue
      for (const [source, homes] of Object.entries(DEDICATED)) {
        if (homes.includes(channel)) continue
        for (const item of airing(channel).filter((entry) => entry.sourceId === source)) expect(listed.has(item.externalId ?? ''), `${channel} ${source}`).toBe(true)
      }
    }
  })

  it('builds the format channels only from eligible existing full-length film programmes', () => {
    for (const channel of FORMAT_CHANNELS) {
      for (const item of airing(channel)) {
        expect(FILM_SOURCES, `${channel}`).toContain(item.sourceId)
        expect(item.durationSeconds, `${channel} ${item.title}`).toBeGreaterThanOrEqual(2 * 3600)
      }
    }
  })

  it('keeps the horror and cult film channels on disjoint films', () => {
    for (const a of HORROR_FAMILY) {
      const own = new Set(airing(a).map((item) => item.id))
      for (const b of HORROR_FAMILY) if (a < b) expect(airing(b).filter((item) => own.has(item.id)).length, `${a} ~ ${b}`).toBe(0)
    }
  })

  it('keeps the history, internet and business channels distinct from each other', () => {
    for (const trio of DISTINCT_TRIOS) {
      for (const a of trio) {
        const own = new Set(airing(a).map((item) => item.id))
        for (const b of trio) {
          if (a >= b) continue
          const shared = airing(b).filter((item) => own.has(item.id)).length
          expect(shared / Math.max(1, Math.min(own.size, airing(b).length)), `${a} ~ ${b}`).toBeLessThan(0.2)
        }
      }
    }
  })

  it('fills the decade channels only with films carrying a verified original year in range', () => {
    for (const [channel, [from, to]] of Object.entries(DECADES)) {
      const pool = airing(Number(channel))
      expect(hours(pool), channel).toBeGreaterThanOrEqual(3)
      for (const item of pool) {
        const original = originals[item.externalId ?? '']
        expect(original?.[1], `${channel} ${item.title}`).toBe('film')
        expect(['VERIFIED', 'HIGH']).toContain(original?.[3])
        expect(original[0], `${channel} ${item.title}`).toBeGreaterThanOrEqual(from)
        expect(original[0], `${channel} ${item.title}`).toBeLessThanOrEqual(to)
        if (item.sourceId === 'src_film_detective') expect(original[2], item.title).toBe('wikidata')
      }
    }
    for (const channel of [141, 145]) {
      for (const item of airing(channel)) expect(originals[item.externalId ?? '']?.[0], item.title).toBeLessThan(1980)
    }
  })

  it('gives each classic film at most one genre or presentation slot', () => {
    const seen = new Map<string, number>()
    for (const channel of CLASSIC_FILM_SLOTS) {
      for (const item of airing(channel).filter((entry) => entry.sourceId === 'src_film_detective')) {
        expect(seen.get(item.id) ?? channel, `${item.title}`).toBe(channel)
        seen.set(item.id, channel)
      }
    }
  })

  it('builds Experimental Film from the NFB director playlists and homes the new publishers once', () => {
    for (const item of airing(116)) expect(NFB_EXPERIMENTAL, item.title).toContain(item.sourceId)
    expect(DEDICATED.src_nfb_experimental).toEqual([116])
    for (const [channel, source] of Object.entries(HOMES)) {
      expect(DEDICATED[source], source).toEqual([Number(channel)])
      expect(airing(Number(channel)).some((item) => item.sourceId === source), source).toBe(true)
    }
    expect(sources.src_lux).toBeUndefined()
  })

  it('activates no music year channel without verified years and no public-domain channel without provenance', () => {
    for (const channel of YEAR_CHANNELS) {
      for (const item of airing(channel)) expect(['VERIFIED', 'HIGH'], `${channel} ${item.title}`).toContain(originals[item.externalId ?? '']?.[3])
    }
    for (const channel of PUBLIC_DOMAIN) expect(airing(channel), `${channel}`).toEqual([])
  })

  it('keeps the excluded channels empty and the independent catalogue out of 1001+', () => {
    for (const channel of [...EXCLUDED_CHANNELS, 1001, 1500]) {
      expect(getEligibleMedia(items as MediaItem[], channel), `${channel}`).toEqual([])
      expect(airing(channel), `${channel}`).toEqual([])
    }
  })

  it('loses no programming on any channel against the Pass 19 baseline, apart from the mandatory Pass 23 exclusions', () => {
    const removals = JSON.parse(readFileSync('docs/exclusion-removals-v43.json', 'utf8')).removed as Record<string, string[]>
    const byId = new Map(items.map((item) => [item.id, item]))
    for (const [channel, count] of Object.entries(baseline)) {
      // A channel re-defined centrally (src/data/central-sources.json) is held to its own definition, not the old baseline.
      if (RECURATED.has(channel)) continue
      const removed = (removals[channel] ?? []).map((id) => byId.get(id)!)
      for (const item of removed) expect(excludedProgramme(item), `${channel}`).toBe(true)
      expect(airing(Number(channel)).length + removed.length, channel).toBeGreaterThanOrEqual(count)
    }
  }, 120_000)

  it('activates every Pass 19 channel with at least three hours', () => {
    for (const channel of ACTIVATED) expect(hours(airing(channel)), `${channel}`).toBeGreaterThanOrEqual(3)
  })
})
