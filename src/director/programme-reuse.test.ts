import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { eraChannelsFor, genreChannelsFor, TRAILER_GENRE_CHANNELS, TRAILER_GENRE_LIMIT, TRAILER_GENRE_SOURCE } from '../library/metadata-channels.ts'
import { expandPlayableCatalogue, type PlayableCatalogueV2 } from '../library/playable-catalogue.ts'
import { getChannelMedia } from '../library/query.ts'
import type { LibraryMedia } from '../library/types.ts'
import { resetDirector } from './director.ts'
import { DEDICATED, OWNED_SOURCES, PROGRAMME_REUSE, programmeSuitsChannel } from './fit.ts'
import { setMediaLibrary } from './library.ts'
import type { MediaItem } from './types.ts'

const doc = JSON.parse(readFileSync('public/independent/playable.json', 'utf8')) as PlayableCatalogueV2
const cache = JSON.parse(readFileSync('scripts/data/wikidata-trailer-films.json', 'utf8')) as {
  source: string
  resolution: { ambiguous: [string, string, number, string[]][]; unmatched: [string, string, number][] }
}
const genreOf = new Map(Object.entries(TRAILER_GENRE_CHANNELS).flatMap(([genre, channels]) => channels.map((channel) => [channel, genre] as const)))
const SPACE_OR_AIR = /\b(space|nasa|rockets?|satellites?|planets?|astronom\w*|galax\w*|aircraft|aviation|airplanes?|helicopters?|flights?)\b/i

describe('Pass 15A programme-level reuse', () => {
  let items: LibraryMedia[] = []
  const byVideo = new Map<string, LibraryMedia>()
  const airing = (channel: number) => getChannelMedia(items as MediaItem[], channel) as LibraryMedia[]

  beforeAll(() => {
    items = expandPlayableCatalogue(doc)
    for (const item of items) byVideo.set(item.externalId ?? '', item)
    resetDirector()
    setMediaLibrary(items)
  })

  it('keeps owned sources on their owners and never approves an owned source for reuse', () => {
    for (const sources of Object.values(PROGRAMME_REUSE)) for (const source of sources) expect(OWNED_SOURCES.has(source), source).toBe(false)
    for (const [source, owner] of [['src_british_pathe', 805], ['src_kofa', 114], ['src_orbital_bacon', 225]] as const) {
      expect(OWNED_SOURCES.get(source)).toBe(owner)
      for (const channel of Object.keys(PROGRAMME_REUSE).map(Number)) {
        expect(airing(channel).some((item) => item.sourceId === source), `${source} on ${channel}`).toBe(false)
      }
    }
  })

  it('airs only the chosen programmes of a reused source, never the rest of its catalogue', () => {
    for (const [channel, sources] of Object.entries(PROGRAMME_REUSE)) {
      const chosen = new Set(doc.programmeRoutes?.[channel] ?? [])
      expect(chosen.size, channel).toBeGreaterThan(0)
      for (const item of airing(Number(channel))) {
        if (sources.includes(item.sourceId ?? '')) expect(chosen.has(item.externalId ?? ''), `${item.title} on ${channel}`).toBe(true)
      }
      for (const source of sources) {
        const rest = items.find((item) => item.sourceId === source && !chosen.has(item.externalId ?? ''))
        if (rest) expect(programmeSuitsChannel(rest as MediaItem, Number(channel)), `${source} on ${channel}`).toBe(false)
      }
    }
    const home = items.find((item) => item.sourceId === 'src_jago_hazzard')!
    const unapproved = { ...home, curatedChannels: [437] } as MediaItem
    expect(programmeSuitsChannel(unapproved, 437)).toBe(false)
    expect(DEDICATED.src_jago_hazzard).toEqual([678])
  })

  it('routes trailers to genre channels only from structured film genres, never from title words', () => {
    expect(cache.source).toMatch(/^Wikidata/)
    expect(genreChannelsFor({ sourceId: TRAILER_GENRE_SOURCE, durationSeconds: 150 })).toEqual([])
    expect(genreChannelsFor({ sourceId: TRAILER_GENRE_SOURCE, durationSeconds: 150, genres: ['Horror', 'Drama'] })).toEqual([130, 136])
    expect(genreChannelsFor({ sourceId: 'src_bbc_earth', durationSeconds: 7200, genres: ['Horror'] })).toEqual([])
    const horrorTitled = items.find((item) => item.sourceId === TRAILER_GENRE_SOURCE && /horror/i.test(item.title) && !doc.trailerGenres?.[item.externalId ?? ''])
    if (horrorTitled) expect(horrorTitled.genreChannels ?? []).not.toContain(130)
    let routed = 0
    for (const item of items) {
      if (item.sourceId !== TRAILER_GENRE_SOURCE || !item.genreChannels?.length) continue
      routed += 1
      const entry = doc.trailerGenres?.[item.externalId ?? '']
      expect(entry, item.title).toBeDefined()
      expect(entry![0]).toMatch(/^Q\d+$/)
      expect(item.original?.basis, item.title).toBe('trailer')
      expect(item.genreChannels.length).toBeLessThanOrEqual(TRAILER_GENRE_LIMIT)
      for (const channel of item.genreChannels) expect(entry![1], `${item.title} on ${channel}`).toContain(genreOf.get(channel))
    }
    expect(routed).toBeGreaterThan(1000)
    for (const channel of [130, 131, 132, 136, 137, 138]) {
      const aired = airing(channel)
      expect(aired.length, `${channel}`).toBeGreaterThan(0)
      expect(aired.every((item) => item.sourceId === TRAILER_GENRE_SOURCE && item.genreChannels?.includes(channel)), `${channel}`).toBe(true)
    }
    expect(airing(135)).toEqual([])
  })

  it('leaves ambiguous and unmatched films off every genre channel', () => {
    expect(cache.resolution.ambiguous.length).toBeGreaterThan(0)
    for (const [video, , , candidates] of cache.resolution.ambiguous) {
      expect(candidates.length).toBeGreaterThan(1)
      expect(doc.trailerGenres?.[video], video).toBeUndefined()
      expect(byVideo.get(video)?.genreChannels ?? [], video).toEqual([])
    }
    for (const [video] of cache.resolution.unmatched) expect(doc.trailerGenres?.[video], video).toBeUndefined()
  })

  it('gives Stations only programmes about a station, never journeys or general rail', () => {
    const stations = airing(824)
    expect(stations.reduce((sum, item) => sum + item.durationSeconds, 0) / 3600).toBeGreaterThan(3)
    for (const item of stations) {
      expect(['src_jago_hazzard', 'src_all_the_stations']).toContain(item.sourceId)
      expect(item.title, item.title).toMatch(/\bstations?\b|\bterminus\b/i)
      expect(item.title, item.title).not.toMatch(/episode \d|\bwalk\b|\bsong\b|documentary|adventure|metro line/i)
    }
    const ids = new Set(stations.map((item) => item.externalId))
    for (const rejected of ['uXNym2JgUgY', 'Onvv9bpl--I', 'KhZ3pNHYjb0', 'tMxg7EZPt5M', 'C_FSRUAf7SM', 'QbrTF7fXXKE', 'zQTMBUjM6Ks']) {
      expect(ids.has(rejected), rejected).toBe(false)
    }
    const generic = items.find((item) => item.sourceId === 'src_jago_hazzard' && !/station|terminus/i.test(item.title))!
    expect(programmeSuitsChannel(generic as MediaItem, 824)).toBe(false)
  })

  it('keeps the geography channels to their reviewed programmes', () => {
    for (const channel of [437, 438, 441, 442]) {
      const chosen = new Set(doc.programmeRoutes?.[String(channel)] ?? [])
      const aired = airing(channel)
      expect(aired.reduce((sum, item) => sum + item.durationSeconds, 0) / 3600, `${channel}`).toBeGreaterThan(3)
      for (const item of aired) {
        expect(chosen.has(item.externalId ?? ''), `${item.title} on ${channel}`).toBe(true)
        expect(item.title, `${channel}`).not.toMatch(SPACE_OR_AIR)
      }
      expect(new Set(aired.map((item) => item.sourceId)).size, `${channel}`).toBeGreaterThan(3)
    }
  })

  it('admits Disco 79 only for 1979 disco recordings', () => {
    const song = (year: number, sourceId: string) =>
      eraChannelsFor({ sourceId, title: 'Artist - Song', durationSeconds: 240, original: { year, basis: 'recording', source: 'title', confidence: 'VERIFIED', evidence: 'test' } })
    expect(song(1979, 'src_bee_gees')).toContain(588)
    expect(song(1978, 'src_bee_gees')).not.toContain(588)
    expect(song(1980, 'src_gloria_gaynor')).not.toContain(588)
    expect(song(1979, 'src_acdc')).not.toContain(588)
    for (const item of airing(588)) expect(item.original?.year).toBe(1979)
  })

  it('takes no programme away from any channel it already aired on', () => {
    const plain = new Map(expandPlayableCatalogue({ ...doc, trailerGenres: {}, programmeRoutes: Object.fromEntries(Object.entries(doc.programmeRoutes ?? {}).filter(([channel]) => !PROGRAMME_REUSE[Number(channel)])) }).map((item) => [item.id, item]))
    for (const item of items) {
      const before = plain.get(item.id)?.explicitChannelIncludes ?? []
      expect(before.every((channel) => item.explicitChannelIncludes?.includes(channel)), item.title).toBe(true)
    }
    for (const [source, homes] of Object.entries(DEDICATED)) {
      if (![...Object.values(PROGRAMME_REUSE).flat(), TRAILER_GENRE_SOURCE].includes(source)) continue
      for (const home of homes) expect(airing(home).some((item) => item.sourceId === source), `${source} on ${home}`).toBe(true)
    }
  })
})
