import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { artistOf, eraChannelsFor, FILM_GENRE_CHANNELS, genreChannelsFor, TRAILER_GENRE_SOURCE, viableEraChannels, viableGenreChannels, type OriginalYear } from './metadata-channels.ts'
import { expandPlayableCatalogue, type PlayableCatalogueV2 } from './playable-catalogue.ts'
import { getChannelMedia } from './query.ts'
import type { LibraryMedia } from './types.ts'
import { resetDirector } from '../director/director.ts'
import { DEDICATED, OWNED_SOURCES, programmeSuitsChannel } from '../director/fit.ts'
import { setMediaLibrary } from '../director/library.ts'
import type { MediaItem } from '../director/types.ts'

const original = (year: number, basis: OriginalYear['basis'], confidence: OriginalYear['confidence'] = 'HIGH'): OriginalYear => ({
  year,
  basis,
  source: 'title',
  confidence,
  evidence: 'test',
})

function item(sourceId: string, title: string, eras: number[], durationSeconds = 300): MediaItem {
  return {
    id: `yt:${title}`,
    title,
    durationSeconds,
    programmeType: 'unclassified',
    topics: [],
    mediaKind: 'video',
    explicitChannelIncludes: eras,
    eraChannels: eras,
    ...({ sourceId } as object),
  }
}

describe('era routing rules', () => {
  it('routes an individual trailer by its original film year, never by upload', () => {
    const trailer = { sourceId: 'src_rt_classic_trailers', title: 'Jaws (1975) Official Trailer', durationSeconds: 150 }
    expect(eraChannelsFor(trailer)).toEqual([])
    expect(eraChannelsFor({ ...trailer, original: original(1975, 'trailer') })).toContain(124)
    expect(eraChannelsFor({ ...trailer, original: original(1975, 'trailer') })).not.toContain(128)
    expect(eraChannelsFor({ ...trailer, original: original(1975, 'film') })).not.toContain(124)
  })

  it('counts each performer separately on multi-artist archives', () => {
    const sullivan = (title: string) => artistOf({ sourceId: 'src_ed_sullivan', title })
    expect(sullivan('The Supremes "Stop! In The Name Of Love" on The Ed Sullivan Show')).not.toBe(sullivan('The Kinks "You Really Got Me" on The Ed Sullivan Show'))
    expect(artistOf({ sourceId: 'src_the_beatles', title: 'The Beatles - Help!' })).toBe('src_the_beatles')
    const oneAct = Array.from({ length: 6 }, (_, index) => ({ sourceId: 'src_ed_sullivan', title: `The Supremes "Song ${index}"`, durationSeconds: 3600, eras: [540] }))
    expect(viableEraChannels(oneAct).has(540)).toBe(false)
  })

  it('keeps era-only sources off every dedicated home', () => {
    for (const source of ['src_rt_classic_trailers', 'src_ed_sullivan', 'src_vevo_classics', 'src_vevo_abba']) expect(DEDICATED[source], source).toEqual([])
  })

  it('ignores upload year: with no original year a programme joins no era channel', () => {
    expect(eraChannelsFor({ sourceId: 'src_acdc', title: 'AC/DC - Thunderstruck (Official Video) uploaded 2019', durationSeconds: 300 })).toEqual([])
    expect(eraChannelsFor({ sourceId: 'src_acdc', title: 'AC/DC - Thunderstruck', durationSeconds: 300, original: null })).toEqual([])
  })

  it('routes a 1980s recording uploaded recently to the 1980s', () => {
    const channels = eraChannelsFor({ sourceId: 'src_def_leppard', title: 'Def Leppard - Photograph', durationSeconds: 250, original: original(1983, 'recording', 'VERIFIED') })
    expect(channels).toContain(583)
    expect(channels.length).toBeGreaterThan(0)
    for (const nineties of [544, 584, 581, 596]) expect(channels).not.toContain(nineties)
    const performance = eraChannelsFor({ sourceId: 'src_gloria_gaynor', title: 'Live 1984', durationSeconds: 250, original: original(1984, 'performance') })
    expect(performance).toContain(543)
  })

  it('respects decade boundaries', () => {
    const at = (year: number) => eraChannelsFor({ sourceId: 'src_popcornflix', title: 'X | FULL MOVIE', durationSeconds: 5400, original: original(year, 'film') })
    expect(at(1989)).toEqual([177])
    expect(at(1990)).toEqual([178])
    expect(at(1999)).toEqual([178])
    expect(at(2000)).toEqual([179])
    expect(at(2019)).toEqual([180])
    expect(at(2020)).toEqual([])
  })

  it('routes films by film year, full films only, never music years', () => {
    expect(eraChannelsFor({ sourceId: 'src_popcornflix', title: 'Knightriders | FULL MOVIE | 1981', durationSeconds: 8400, original: original(1981, 'film') })).toEqual([177])
    expect(eraChannelsFor({ sourceId: 'src_popcornflix', title: 'Short', durationSeconds: 1200, original: original(1981, 'film') })).toEqual([])
    expect(eraChannelsFor({ sourceId: 'src_popcornflix', title: 'X', durationSeconds: 5400, original: original(1981, 'recording') })).toEqual([])
  })

  it('needs the recording year for 1990s and later plain decades; a performance date is not enough', () => {
    expect(eraChannelsFor({ sourceId: 'src_acdc', title: 'Live 2009', durationSeconds: 300, original: original(2009, 'performance') })).toEqual([])
    expect(eraChannelsFor({ sourceId: 'src_acdc', title: 'Live 1983', durationSeconds: 300, original: original(1983, 'performance') })).toEqual([583, 543])
    expect(eraChannelsFor({ sourceId: 'src_usher', title: 'Usher - Yeah!', durationSeconds: 250, original: original(2004, 'recording') })).toEqual([545])
  })

  it('keeps unlisted and owned sources out of every era channel', () => {
    expect(eraChannelsFor({ sourceId: 'src_british_pathe', title: 'Newsreel (1954)', durationSeconds: 5400, original: original(1954, 'film') })).toEqual([])
    expect(eraChannelsFor({ sourceId: 'src_kofa', title: '(1960)', durationSeconds: 5400, original: original(1960, 'film') })).toEqual([])
  })

  it('opens an era channel only with three hours from several artists', () => {
    const hour = 3600
    expect(viableEraChannels([{ sourceId: 'a', durationSeconds: 2 * hour, eras: [542] }]).has(542)).toBe(false)
    expect(viableEraChannels([{ sourceId: 'a', durationSeconds: 4 * hour, eras: [542] }]).has(542)).toBe(false)
    const mixed = ['a', 'b', 'c'].map((sourceId) => ({ sourceId, durationSeconds: 1.2 * hour, eras: [542] }))
    expect(viableEraChannels(mixed).has(542)).toBe(true)
    expect(viableEraChannels([{ sourceId: 'src_popcornflix', durationSeconds: 4 * hour, eras: [178] }]).has(178)).toBe(true)
  })

  it('lets owned sources and exclusions win over an era route', () => {
    const [owned, home] = [...OWNED_SOURCES.entries()][0]
    expect(programmeSuitsChannel(item(owned, 'Archive film', [home === 178 ? 179 : 178], 5400), home === 178 ? 179 : 178)).toBe(false)
    expect(programmeSuitsChannel(item('src_popcornflix', 'Space Shuttle Astronauts | FULL MOVIE', [178], 5400), 178)).toBe(false)
  })
})

describe('film-genre reuse', () => {
  it('routes only Popcornflix full films by their structured genres', () => {
    expect(genreChannelsFor({ sourceId: 'src_popcornflix', durationSeconds: 5400, genres: ['Crime', 'Thriller'] })).toEqual([151, 150])
    expect(genreChannelsFor({ sourceId: 'src_movie_central', durationSeconds: 5400, genres: ['Crime'] })).toEqual([])
    expect(genreChannelsFor({ sourceId: 'src_popcornflix', durationSeconds: 1200, genres: ['Crime'] })).toEqual([])
    expect(genreChannelsFor({ sourceId: 'src_popcornflix', durationSeconds: 5400, genres: ['Horror', 'Disaster'] })).toEqual([])
    expect(genreChannelsFor({ sourceId: 'src_popcornflix', durationSeconds: 5400 })).toEqual([])
  })

  it('opens a genre channel only with three hours of films', () => {
    expect(viableGenreChannels([{ durationSeconds: 2 * 3600, genreChannels: [157] }]).has(157)).toBe(false)
    expect(viableGenreChannels([{ durationSeconds: 5400, genreChannels: [157] }, { durationSeconds: 5400, genreChannels: [157] }]).has(157)).toBe(true)
  })

  it('does not extend the reuse to any other dedicated source', () => {
    const kofa = { ...item('src_kofa', 'Film', [], 5400), genreChannels: [151], explicitChannelIncludes: [151] }
    expect(programmeSuitsChannel(kofa, 151)).toBe(false)
    const popcornflix = { ...item('src_popcornflix', 'Grand Larceny | FULL MOVIE | Crime, Thriller', [], 5400), genreChannels: [151], explicitChannelIncludes: [151] }
    expect(programmeSuitsChannel(popcornflix, 151)).toBe(true)
    expect(programmeSuitsChannel(popcornflix, 153)).toBe(false)
  })
})

describe('shipped era metadata', () => {
  const doc = JSON.parse(readFileSync('public/independent/playable.json', 'utf8')) as PlayableCatalogueV2
  let items: LibraryMedia[] = []

  beforeAll(() => {
    items = expandPlayableCatalogue(doc)
    resetDirector()
    setMediaLibrary(items)
  })

  it('records a year, basis, provenance, confidence and evidence for every original', () => {
    const entries = Object.values(doc.originals ?? {})
    expect(entries.length).toBeGreaterThan(0)
    for (const [year, basis, source, confidence, evidence] of entries) {
      expect(year).toBeGreaterThanOrEqual(source === 'wikidata' ? 1900 : 1920)
      expect(year).toBeLessThanOrEqual(2029)
      expect(['film', 'recording', 'performance', 'episode', 'event', 'trailer']).toContain(basis)
      expect(['title', 'description', 'wikidata']).toContain(source)
      if (source === 'wikidata') expect(['film', 'recording']).toContain(basis)
      if (source === 'wikidata' && basis === 'recording') expect(evidence).toMatch(/^Q\d+ .+ P577 \d{4}/)
      expect(['VERIFIED', 'HIGH']).toContain(confidence)
      expect(evidence.length).toBeGreaterThan(0)
    }
  })

  it('airs era programmes only in their own decade', () => {
    for (const programme of items.filter((entry) => entry.eraChannels?.length)) {
      const year = programme.original!.year
      for (const channel of programme.eraChannels!) {
        const decade = { 177: 1980, 178: 1990, 179: 2000, 180: 2010, 542: 1970, 543: 1980, 544: 1990, 545: 2000, 547: 2020, 581: 1990, 583: 1980, 584: 1990 }[channel]
        if (decade) expect(year >= decade && year <= decade + 9, `${programme.title} on ${channel}`).toBe(true)
        if (channel === 580) expect(year >= 1981 && year <= 1995, `${programme.title} on 580`).toBe(true)
      }
    }
  })

  it('routes genre channels only from full films whose own genre field names the genre', () => {
    const byChannel = new Map(Object.entries(FILM_GENRE_CHANNELS).flatMap(([genre, channels]) => channels.map((channel) => [channel, genre] as const)))
    const routed = items.filter((entry) => entry.genreChannels?.length && entry.sourceId !== TRAILER_GENRE_SOURCE)
    expect(routed.length).toBeGreaterThan(0)
    for (const film of routed) {
      expect(film.sourceId).toBe('src_popcornflix')
      expect(film.durationSeconds).toBeGreaterThanOrEqual(3600)
      expect(film.title).not.toMatch(/trailer|review|interview|making of|part \d+ of \d+/i)
      for (const channel of film.genreChannels!) expect(doc.filmGenres?.[film.id.slice(3)], film.title).toContain(byChannel.get(channel))
    }
  })

  it('adds era channels without taking programmes from any other channel', () => {
    const plain = new Map(expandPlayableCatalogue({ ...doc, originals: {} }).map((programme) => [programme.id, programme]))
    for (const programme of items) {
      const before = plain.get(programme.id)?.explicitChannelIncludes ?? []
      expect(before.every((channel) => programme.explicitChannelIncludes?.includes(channel)), programme.title).toBe(true)
    }
    const alternative = getChannelMedia(items as MediaItem[], 581)
    expect(alternative.length).toBeGreaterThan(0)
  })
})
