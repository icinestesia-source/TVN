import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { getChannelMedia } from '../library/query.ts'
import type { LibraryMedia } from '../library/types.ts'
import { resetDirector } from './director.ts'
import { DEDICATED, OWNED_SOURCES, PROGRAMME_REUSE, programmeSuitsChannel } from './fit.ts'
import { setMediaLibrary } from './library.ts'
import type { MediaItem } from './types.ts'

const HOMES: Record<string, number> = {
  src_dick_cavett: 76, src_hot_ones: 76, src_gerry_anderson: 219, src_degrassi: 238, src_pemberley: 239,
  src_lizzie_bennet: 239, src_kindatv: 239, src_wheel_of_fortune: 275, src_rsc: 49, src_stratford: 49,
  src_royal_court: 49, src_lincoln_center: 49, src_vanguard: 228, src_beyblade: 228, src_crunchyroll_action: 228,
  src_crunchyroll_fantasy: 230, src_crunchyroll_drama: 231, src_crunchyroll_comedy: 232, src_viz_manga: 234,
  src_rsl: 497, src_british_library_lit: 497, src_atlas_obscura: 96,
}
const REJECTED = [
  'src_merv_griffin', 'src_sullivan', 'src_the_bill', 'src_miami_vice', 'src_columbo', 'src_kojak', 'src_midsomer',
  'src_murder_she_wrote', 'src_knight_rider', 'src_baywatch', 'src_next_step', 'src_saved_by_the_bell', 'src_gsn',
  'src_riverdance', 'src_retrocrush', 'src_muse_asia', 'src_ani_one', 'src_crunchyroll', 'src_da_vincis_inquest',
  'src_wolfblood', 'src_being_erica', 'src_biography',
]
const REUSE_CHANNELS = [197, 234, 242, 254]
const CRIME_FAMILY = [212, 213, 214, 215]
const ANIME_GENRES = [228, 230, 231, 232]
const EXCLUDED = /\b(space|nasa|rockets?|satellites?|astronom\w*|astrophysic\w*|aircraft|aviation|airplanes?|helicopters?|airports?|spaceflight|church|christianity|mosque|prayer|bible|theolog\w*|protestant|papal|sermon|worship)\b/i

describe('Pass 17 entertainment, television and culture', () => {
  let items: LibraryMedia[] = []
  let routes: Record<string, string[]> = {}
  let sources: Record<string, string> = {}
  const airing = (channel: number) => getChannelMedia(items as MediaItem[], channel) as LibraryMedia[]

  beforeAll(() => {
    const doc = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))
    routes = doc.programmeRoutes
    sources = doc.sources
    items = expandPlayableCatalogue(doc)
    resetDirector()
    setMediaLibrary(items)
  })

  it('keeps every new publisher dedicated to its one home, with at least three hours there', () => {
    for (const [source, home] of Object.entries(HOMES)) {
      expect(DEDICATED[source], source).toEqual([home])
      const own = items.filter((item) => item.sourceId === source)
      expect(own.length, source).toBeGreaterThan(0)
      for (const item of own) {
        expect(item.title, source).not.toMatch(EXCLUDED)
        for (const channel of [...CRIME_FAMILY, ...ANIME_GENRES, ...REUSE_CHANNELS, 1, 100, 210, 220, 250, 400, 420])
          if (channel !== home) expect(programmeSuitsChannel(item as MediaItem, channel), `${source} ${channel}`).toBe(false)
      }
    }
    for (const home of new Set(Object.values(HOMES))) {
      const hours = airing(home).reduce((sum, item) => sum + item.durationSeconds, 0) / 3600
      expect(hours, `${home}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('homes each anime series on one genre channel and sprays nothing across the crime family', () => {
    const series = new Map<string, number>()
    for (const channel of ANIME_GENRES) {
      for (const item of airing(channel).filter((row) => row.sourceId?.startsWith('src_crunchyroll'))) {
        const name = (item.title ?? '').split(/\s*\|?\s*episode\b/i)[0].toLowerCase().replace(/[^a-z0-9]/g, '')
        expect(series.get(name) ?? channel, `${item.title}`).toBe(channel)
        series.set(name, channel)
      }
    }
    expect(series.size).toBeGreaterThan(20)
    for (const [source, homes] of Object.entries(DEDICATED)) for (const channel of CRIME_FAMILY) expect(homes.includes(channel), `${source} ${channel}`).toBe(false)
    for (const channel of CRIME_FAMILY) for (const item of airing(channel)) expect(Object.keys(HOMES)).not.toContain(item.sourceId)
  })

  it('keeps the Pass 17 homes to their own publishers and curated programmes, and owned sources home-only', () => {
    const only = (channel: number, allowed: readonly string[]) => {
      const pool = airing(channel)
      expect(pool.length, `${channel}`).toBeGreaterThan(0)
      for (const item of pool) expect(allowed, `${channel} ${item.title}`).toContain(item.sourceId)
    }
    const byHome = new Map<number, string[]>()
    for (const [source, home] of Object.entries(HOMES)) byHome.set(home, [...(byHome.get(home) ?? []), source])
    for (const [home, own] of byHome) only(home, [...own, ...(PROGRAMME_REUSE[home] ?? [])])
    for (const [source, owner] of OWNED_SOURCES) only(owner, [source])
    for (const [source, owner] of OWNED_SOURCES) for (const channel of [197, 242, 254, 234, 76, 219]) {
      if (channel === owner) continue
      expect(airing(channel).some((item) => item.sourceId === source), `${source} ${channel}`).toBe(false)
    }
  })

  it('airs only explicitly routed programmes on 197, 234, 242 and 254, disjoint and on-subject', () => {
    const seen = new Map<string, number>()
    for (const channel of REUSE_CHANNELS) {
      const listed = new Set(routes[String(channel)])
      expect(listed.size, `${channel}`).toBeGreaterThan(0)
      for (const item of airing(channel)) {
        if (item.sourceId === 'src_viz_manga') continue
        expect(PROGRAMME_REUSE[channel], `${channel} ${item.sourceId}`).toContain(item.sourceId)
        expect(listed.has(item.externalId ?? ''), `${channel} ${item.title}`).toBe(true)
        expect(item.title, `${channel}`).not.toMatch(EXCLUDED)
        expect(seen.get(item.externalId ?? '') ?? channel, `${item.title} on ${channel} and ${seen.get(item.externalId ?? '')}`).toBe(channel)
        seen.set(item.externalId ?? '', channel)
      }
    }
    const arcade = airing(242).map((item) => item.title ?? '')
    for (const title of arcade) expect(title, 'arcade').toMatch(/arcade|jamma|neo ?geo|cps2|pcb|supergun|naomi|laserdisc|mame|crane|donkey kong|mortal kombat|splatterhouse|dodonpachi/i)
  })

  it('leaves out the sources rejected after acquisition', () => {
    for (const source of REJECTED) {
      expect(items.some((item) => item.sourceId === source), source).toBe(false)
      expect(sources[source], source).toBeUndefined()
      expect(DEDICATED[source], source).toBeUndefined()
    }
  })
})
