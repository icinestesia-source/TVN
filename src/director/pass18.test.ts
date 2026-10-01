import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { getChannelMedia, getEligibleMedia } from '../library/query.ts'
import type { LibraryMedia } from '../library/types.ts'
import { resetDirector } from './director.ts'
import { DEDICATED, OWNED_SOURCES, PROGRAMME_REUSE, programmeSuitsChannel } from './fit.ts'
import { setMediaLibrary } from './library.ts'
import type { MediaItem } from './types.ts'

const HOMES: Record<string, number> = {
  src_intl_criminal_court: 457, src_uksc_constitutional: 458, src_uksc_human_rights: 456,
  src_harvard_law_constitutional: 458, src_harvard_law_international: 457, src_harvard_law_human_rights: 456,
  src_harvard_law_criminal: 454, src_harvard_law_civil: 455, src_oxford_law_international: 457,
  src_oxford_law_human_rights: 456, src_oxford_law_constitutional: 458, src_oxford_law_criminal: 454,
  src_oxford_law_civil: 455, src_un_human_rights: 456, src_huntley_police: 463, src_huntley_radio: 818,
  src_bbc_archive_radio: 818, src_bvws: 818, src_arrl_history: 818, src_ripe_ncc: 636, src_ietf: 636,
  src_realpars: 643, src_ieee_spectrum: 685, src_long_now: 685, src_royal_society_future: 685, src_henry_ford: 686,
  src_nihf: 686, src_science_museum: 686, src_oii: 690, src_berkman_klein: 690, src_internet_historian: 690,
  src_folding_ideas: 690, src_chm_interviews: 691, src_chm_internet: 815, src_dwarkesh: 691, src_cch: 691,
  src_christies: 795, src_sothebys: 795, src_strong_museum: 795, src_ifixit: 798, src_british_red_cross: 798,
  src_chrisfix: 798, src_lannan: 843, src_american_theatre_wing: 844, src_va_design: 849, src_cooper_hewitt: 849,
  src_vitra: 849, src_eames_office: 849, src_trailers_from_hell: 891, src_gbh_archives: 892,
}
const ACTIVATED = [454, 455, 456, 457, 458, 463, 636, 643, 685, 686, 690, 691, 795, 798, 815, 818, 843, 844, 849, 891, 892]
const REUSE_CHANNELS = [454, 455, 456, 457, 458, 463, 815, 818, 843, 844]
const REJECTED = ['src_yale_law', 'src_ihof', 'src_nz_on_screen', 'src_mace']
const EXCLUDED_CHANNELS = [64, 146, 480, 481, 482, 492, 667, 682, 683, 873, 874]
const ARCHIVE_PAIRS: [number, number][] = [[843, 497], [844, 49], [891, 120], [891, 121], [891, 136]]
const EXCLUDED = /\b(space|nasa|rockets?|satellites?|starlink|astronom\w*|astrophysic\w*|cosmos|cosmolog\w*|galax\w*|universe|aircraft|aviation|aviators?|airplanes?|helicopters?|airports?|spaceflight|aerospace|church|christianity|mosque|prayer|bible|theolog\w*|protestant|papal|sermon|worship|faith)\b/i

describe('Pass 18 law, technology, archive and culture', () => {
  let items: LibraryMedia[] = []
  let routes: Record<string, string[]> = {}
  let sources: Record<string, string> = {}
  const airing = (channel: number) => getChannelMedia(items as MediaItem[], channel) as LibraryMedia[]
  const hours = (pool: LibraryMedia[]) => pool.reduce((sum, item) => sum + item.durationSeconds, 0) / 3600

  beforeAll(() => {
    const doc = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))
    routes = doc.programmeRoutes
    sources = doc.sources
    items = expandPlayableCatalogue(doc)
    resetDirector()
    setMediaLibrary(items)
  })

  it('keeps every new publisher on its one home unless a programme is explicitly routed', () => {
    for (const [source, home] of Object.entries(HOMES)) {
      expect(DEDICATED[source], source).toEqual([home])
      const own = items.filter((item) => item.sourceId === source)
      expect(own.length, source).toBeGreaterThan(0)
      for (const item of own) {
        for (const channel of [...ACTIVATED, 1, 49, 100, 250, 400, 497, 610, 805, 114, 225]) {
          if (channel === home) continue
          const routed = routes[String(channel)]?.includes(item.externalId ?? '') ?? false
          expect(programmeSuitsChannel(item as MediaItem, channel), `${source} ${channel}`).toBe(routed)
        }
      }
    }
  })

  it('carries no space, aviation or religious programming on the activated channels', () => {
    for (const channel of ACTIVATED) for (const item of airing(channel)) expect(item.title, `${channel}`).not.toMatch(EXCLUDED)
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

  it('keeps the excluded channels empty and the independent catalogue out of 1001+', () => {
    for (const channel of [...EXCLUDED_CHANNELS, 1001, 1500]) {
      expect(getEligibleMedia(items as MediaItem[], channel), `${channel}`).toEqual([])
      expect(airing(channel), `${channel}`).toEqual([])
    }
  })

  it('activates every Pass 18 channel with at least three hours of its own programming', () => {
    for (const channel of ACTIVATED) expect(hours(airing(channel)), `${channel}`).toBeGreaterThanOrEqual(3)
  })

  it('keeps the archive channels distinct from their general counterparts', () => {
    for (const [archive, general] of ARCHIVE_PAIRS) {
      const own = new Set(airing(archive).map((item) => item.id))
      const shared = airing(general).filter((item) => own.has(item.id)).length
      expect(shared, `${archive} ~ ${general}`).toBe(0)
    }
    for (const item of airing(891)) expect(item.sourceId, 'trailers').toBe('src_trailers_from_hell')
    for (const item of airing(844)) expect(['src_national_theatre', 'src_shakespeares_globe', 'src_rsc']).not.toContain(item.sourceId)
    for (const item of airing(849)) expect(item.title, 'design archive').not.toMatch(/\b20(1[5-9]|2\d) (collection|runway|fashion week)\b/i)
  })

  it('reuses catalogue programmes only through explicit routes on approved sources', () => {
    for (const channel of REUSE_CHANNELS) {
      const listed = new Set(routes[String(channel)])
      expect(listed.size, `${channel}`).toBeGreaterThan(0)
      for (const item of airing(channel)) {
        if (HOMES[item.sourceId ?? ''] === channel) continue
        expect(PROGRAMME_REUSE[channel], `${channel} ${item.sourceId}`).toContain(item.sourceId)
        expect(listed.has(item.externalId ?? ''), `${channel} ${item.title}`).toBe(true)
      }
    }
    for (const channel of ACTIVATED.filter((number) => !REUSE_CHANNELS.includes(number))) {
      for (const item of airing(channel)) expect(HOMES[item.sourceId ?? ''], `${channel} ${item.sourceId}`).toBe(channel)
    }
  })

  it('keeps the cricket ICC catalogue separate from the International Criminal Court', () => {
    const cricket = items.filter((item) => item.sourceId === 'src_icc')
    expect(cricket.length).toBeGreaterThan(0)
    for (const channel of ACTIVATED) expect(airing(channel).some((item) => item.sourceId === 'src_icc'), `${channel}`).toBe(false)
    expect(sources.src_intl_criminal_court).toMatch(/criminal court/i)
    expect(sources.src_icc).not.toMatch(/criminal/i)
  })

  it('leaves out the sources rejected after acquisition', () => {
    for (const source of REJECTED) {
      expect(items.some((item) => item.sourceId === source), source).toBe(false)
      expect(sources[source], source).toBeUndefined()
      expect(DEDICATED[source], source).toBeUndefined()
    }
  })
})
