import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { channelByNumber } from './data/catalogue.ts'
import { channelMatchesFilter } from './data/network.ts'
import { writeFrozen, scheduleIsCurrent } from './director/cache.ts'
import { getSchedule, resetDirector } from './director/director.ts'
import { liveEndpoint } from './dynamic/providers.ts'
import { setMediaLibrary } from './director/library.ts'
import { setUserLibraryMode, schedulingPool } from './library/mode.ts'
import { getEligibleMedia } from './library/query.ts'
import { isEligible } from './director/eligibility.ts'
import { strandPolicy } from './director/policies.ts'
import type { MediaItem, ScheduleStyle } from './director/types.ts'
import type { ProgrammeType } from './types/programme.ts'
import { SOURCE_EDITORIAL, programmeForDirector } from './library/source-editorial.ts'
import { ingestParsed, resetLibraryForTests } from './library/store.ts'
import type { LibraryMedia } from './library/types.ts'
import { airingReport, firstOnAir, isOnAir } from './network/airing.ts'
import { listChannels } from './data/catalogue.ts'
import { mergeParsedExports, parseChannelsExport, planImport, channelsFromSources } from './services/channels-import.ts'

const CHANNELS = 'public/user-network/channels.txt'
const MORE = 'public/user-network/more-channels.txt'

afterEach(() => {
  resetLibraryForTests()
  resetDirector()
})

function clip(partial: Partial<LibraryMedia> & Pick<LibraryMedia, 'id' | 'title' | 'sourceCollection'>): LibraryMedia {
  const externalId = partial.externalId ?? partial.id.replace(/^yt:/, '')
  return {
    durationSeconds: 3 * 60 * 60,
    programmeType: 'unclassified',
    provider: 'youtube',
    externalId,
    originalExternalId: externalId,
    mediaKind: 'video',
    playbackKind: 'seekable-recorded',
    live: false,
    isLive: false,
    canSeek: true,
    metadataConfidence: 'unknown',
    metadataOrigins: {},
    classification: [],
    candidateTopics: [],
    ingestedAt: 1,
    ingestedFrom: 'retrotv-user-network',
    provenance: 'built-in-user',
    memberships: [{ sourceId: 'source', sourceName: partial.sourceCollection, present: true }],
    watched: false,
    userEditedMetadata: [],
    availability: 'unknown',
    failureCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

describe('stage 4E curated network', () => {
  it('accounts for every built-in source in the editorial map', async () => {
    const merged = mergeParsedExports([
      parseChannelsExport(readFileSync(CHANNELS, 'utf8')),
      parseChannelsExport(readFileSync(MORE, 'utf8')),
    ])
    const names = [...new Set(merged.sources.map((source) => source.name))].sort()
    expect(names).toHaveLength(81)
    expect(Object.keys(SOURCE_EDITORIAL).sort()).toEqual(names)
    expect(names.every((name) => SOURCE_EDITORIAL[name]?.confidence)).toBe(true)
  })

  it('keeps built-in and imported catalogues off the 000-999 schedule', () => {
    setUserLibraryMode('off')
    const argyle = programmeForDirector(
      clip({ id: 'yt:argyle', title: 'Plymouth Argyle reviewed', sourceCollection: 'Argyle Life | Green', externalId: 'argylevid' }),
    )
    const imported = programmeForDirector(
      clip({
        id: 'yt:later',
        title: 'Plymouth Argyle reviewed',
        sourceCollection: 'Argyle Life | Green',
        provenance: 'user-imported',
        ingestedFrom: 'Channels.txt',
        externalId: 'later',
      }),
    )
    const shipped = {
      ...argyle,
      id: 'net:fixture',
      sourceRef: 'network:fixture',
      provenance: undefined,
      ingestedFrom: 'network',
    }
    expect(schedulingPool([argyle, imported])).toHaveLength(0)
    expect(schedulingPool([shipped]).map((item) => item.id)).toEqual(['net:fixture'])
    setUserLibraryMode('allow-eligible')
    expect(schedulingPool([argyle, imported])).toHaveLength(0)
  })

  it('keeps sports games out of basketball and film commentary out of the feature film channel', () => {
    const twoK = programmeForDirector(
      clip({ id: 'yt:2k', title: 'NBA 2K27 MyCAREER', sourceCollection: 'Chris Smoove', externalId: 'twok' }),
    )
    const sins = programmeForDirector(
      clip({ id: 'yt:sins', title: 'Everything Wrong With Jaws', sourceCollection: 'CinemaSins', externalId: 'sins' }),
    )
    const boiler = programmeForDirector(
      clip({ id: 'yt:boiler', title: 'Boiler Room set', sourceCollection: 'Boiler Room', externalId: 'boiler' }),
    )
    const karaoke = programmeForDirector(
      clip({ id: 'yt:karaoke', title: 'Instrumental', sourceCollection: 'CC Karaoke', externalId: 'karaoke' }),
    )
    // Topic strands no longer occupy 001–060; the same rules are exercised directly.
    const strand = (style: ScheduleStyle, types: ProgrammeType[], subjects?: string[]) => (item: MediaItem) =>
      isEligible(item, 900, strandPolicy(900, style, types, subjects).eligibility)
    const gaming = strand('entertainment', ['episode', 'documentary', 'gameplay', 'trailer'], ['gaming'])
    const featureFilm = strand('movies', ['film'])
    const filmEssays = strand('documentary', ['analysis', 'interview', 'episode'], ['cinema'])
    const karaokeStrand = strand('music', ['music', 'music-video'], ['karaoke'])
    const liveMusic = strand('music', ['concert'], ['live-music'])
    expect(getEligibleMedia([twoK], 317)).toHaveLength(0)
    expect([twoK].filter(gaming)).toHaveLength(1)
    expect(twoK.programmeType).toBe('gameplay')
    expect([sins].filter(featureFilm)).toHaveLength(0)
    expect([sins].filter(filmEssays)).toHaveLength(1)
    expect(sins.programmeType).toBe('analysis')
    expect(boiler.programmeType).toBe('concert')
    expect(boiler.isLive).toBe(false)
    expect([boiler].filter(liveMusic)).toHaveLength(1)
    expect([boiler].filter(karaokeStrand)).toHaveLength(0)
    expect(karaoke.programmeType).toBe('music')
    expect(karaoke.topics).toEqual(['karaoke'])
    expect([karaoke].filter(karaokeStrand)).toHaveLength(1)
    expect([karaoke].filter(liveMusic)).toHaveLength(0)
  })

  it('does not schedule a user-network match on the default football channel', () => {
    setUserLibraryMode('off')
    const argyle = programmeForDirector(
      clip({
        id: 'yt:argyle',
        title: 'Wycombe Wanderers 1-1 Plymouth Argyle: Reviewed',
        sourceCollection: 'Argyle Life | Green',
        durationSeconds: 50 * 60,
        externalId: 'I-3pt2DScFU',
      }),
    )
    setMediaLibrary([argyle])
    const channel = channelByNumber(301)
    const schedule = getSchedule(channel!, '2026-09-26')
    const played = schedule.blocks.flatMap((block) => block.children).filter((child) => child.videoId)
    expect(played.some((child) => child.videoId === 'I-3pt2DScFU')).toBe(false)
    expect(isOnAir(channel!)).toBe(false)
  })

  it('skips dormant channels in surfing but lists them in the RetroTV guide', () => {
    const football = programmeForDirector(
      clip({
        id: 'yt:talk',
        title: 'Football preview',
        sourceCollection: 'The Totally Football Show',
        externalId: 'talk',
        durationSeconds: 7 * 60 * 60,
      }),
    )
    const hoops = programmeForDirector(
      clip({
        id: 'yt:nba',
        title: 'Celtics talk',
        sourceCollection: "Gil's Arena",
        externalId: 'nba',
        durationSeconds: 7 * 60 * 60,
      }),
    )
    const thin = programmeForDirector(
      clip({
        id: 'yt:mma',
        title: 'UFC short',
        sourceCollection: 'MMA in SHORT',
        externalId: 'mma',
        durationSeconds: 3 * 60 * 60,
      }),
    )
    setMediaLibrary([football, hoops, thin])
    const mma = channelByNumber(331)!
    expect(airingReport().find((row) => row.number === 331)?.status).toBe('dormant')
    expect(isOnAir(mma)).toBe(false)
    expect(isOnAir(channelByNumber(47)!)).toBe(false)
    expect(isOnAir(channelByNumber(317)!)).toBe(false)
    expect(channelMatchesFilter(mma, 'retrotv', [])).toBe(true)
    expect(channelMatchesFilter(mma, 'dormant', [])).toBe(true)
    expect(channelMatchesFilter(channelByNumber(317)!, 'retrotv', [])).toBe(false)
    const nine = channelByNumber(9)!
    expect(isOnAir(nine)).toBe(false)
    expect(channelMatchesFilter(nine, 'retrotv', [])).toBe(true)
    expect(channelMatchesFilter(nine, 'dormant', [])).toBe(true)
    expect(channelMatchesFilter(nine, 'all', [])).toBe(true)
    // Only an official live stream puts a built-in channel on air without catalogue programmes.
    const first = firstOnAir(listChannels().filter((channel) => channel.number < 1001))
    expect(first && liveEndpoint(first.number)).toBeTruthy()
    expect(airingReport().find((row) => row.number === first!.number)?.count).toBe(0)
  })

  it('keeps a contrary sport episode off the specialist channel', () => {
    const cowboys = programmeForDirector(
      clip({
        id: 'yt:cowboys',
        title: 'The Cowboys DESERVE To Be Favorites In The NFC East',
        sourceCollection: "Gil's Arena",
        externalId: 'cowboys',
      }),
    )
    const lakers = programmeForDirector(
      clip({ id: 'yt:lakers', title: 'Lakers Sold Again', sourceCollection: "Gil's Arena", externalId: 'lakers' }),
    )
    expect(getEligibleMedia([cowboys], 317)).toHaveLength(0)
    expect(getEligibleMedia([cowboys], 318).map((item) => item.id)).toEqual(['yt:cowboys'])
    expect(getEligibleMedia([lakers], 317).map((item) => item.id)).toEqual(['yt:lakers'])
    const wrestler = programmeForDirector(
      clip({
        id: 'yt:green',
        title: "REACTING To Chelsea Green And Matt Cardona's Recent Interview",
        sourceCollection: 'Solomonster Sounds Off',
        externalId: 'green',
      }),
    )
    expect(getEligibleMedia([wrestler], 47)).toHaveLength(0)
    expect(getEligibleMedia([wrestler], 328).map((item) => item.id)).toEqual(['yt:green'])
  })

  it('fills Saturday morning football with a long documentary', () => {
    const items = [1, 2, 3, 4, 5].map((n) =>
      programmeForDirector(
        clip({
          id: `yt:arg${n}`,
          title: `Plymouth Argyle review ${n}`,
          sourceCollection: 'Argyle Life | Green',
          durationSeconds: 90 * 60,
          externalId: `arg${n}`,
        }),
      ),
    )
    setMediaLibrary(items)
    const morning = getSchedule(channelByNumber(301)!, '2026-09-26').blocks.find((block) => block.start === '06:00')!
    const at = morning.startMs + 5 * 60 * 60 * 1000
    const child = morning.children.find((item) => item.startMs <= at && item.endMs > at)
    expect(child?.videoId ?? null).toBeNull()
  })

  it('discards a frozen day from an older catalogue and compiles catalogue-v43', () => {
    expect(scheduleIsCurrent({ catalogueVersion: 'catalogue-v3', seed: 'RETROTV|301|2026-09-26|policy-v1|catalogue-v3' })).toBe(false)
    expect(scheduleIsCurrent({ catalogueVersion: 'catalogue-v4', seed: 'RETROTV|301|2026-09-26|policy-v1|catalogue-v4' })).toBe(false)
    expect(scheduleIsCurrent({ catalogueVersion: 'catalogue-v5', seed: 'RETROTV|301|2026-09-26|policy-v1|catalogue-v5' })).toBe(false)
    expect(scheduleIsCurrent({ catalogueVersion: 'catalogue-v6', seed: 'RETROTV|301|2026-09-26|policy-v1|catalogue-v6' })).toBe(false)
    expect(scheduleIsCurrent({ catalogueVersion: 'catalogue-v7', seed: 'RETROTV|301|2026-09-26|policy-v1|catalogue-v7' })).toBe(false)
    expect(scheduleIsCurrent({ catalogueVersion: 'catalogue-v8', seed: 'RETROTV|301|2026-09-26|policy-v1|catalogue-v8' })).toBe(false)
    expect(scheduleIsCurrent({ catalogueVersion: 'catalogue-v9', seed: 'RETROTV|301|2026-09-26|policy-v1|catalogue-v9' })).toBe(false)
    expect(scheduleIsCurrent({ catalogueVersion: 'catalogue-v11', seed: 'RETROTV|301|2026-09-26|policy-v1|catalogue-v11' })).toBe(false)
    expect(scheduleIsCurrent({ catalogueVersion: 'catalogue-v38', seed: 'RETROTV|301|2026-09-26|policy-v1|catalogue-v38' })).toBe(false)
    expect(scheduleIsCurrent({ catalogueVersion: 'catalogue-v39', seed: 'RETROTV|301|2026-09-26|policy-v1|catalogue-v39' })).toBe(false)
    expect(scheduleIsCurrent({ catalogueVersion: 'catalogue-v40', seed: 'RETROTV|301|2026-09-26|policy-v1|catalogue-v40' })).toBe(false)
    expect(scheduleIsCurrent({ catalogueVersion: 'catalogue-v41', seed: 'RETROTV|301|2026-09-26|policy-v1|catalogue-v41' })).toBe(false)
    expect(scheduleIsCurrent({ catalogueVersion: 'catalogue-v42', seed: 'RETROTV|301|2026-09-26|policy-v1|catalogue-v42' })).toBe(false)
    expect(scheduleIsCurrent({ catalogueVersion: 'catalogue-v43', seed: 'RETROTV|301|2026-09-26|policy-v1|catalogue-v43' })).toBe(true)
    const channel = channelByNumber(47)!
    const item = programmeForDirector(
      clip({ id: 'yt:talk', title: 'Football preview', sourceCollection: 'The Totally Football Show', durationSeconds: 40 * 60, externalId: 'preview' }),
    )
    setMediaLibrary([item])
    const current = getSchedule(channel, '2026-09-26')
    writeFrozen({
      ...current,
      catalogueVersion: 'catalogue-v3',
      seed: 'RETROTV|47|2026-09-26|policy-v1|catalogue-v3',
    })
    const upgraded = getSchedule(channel, '2026-09-26')
    expect(upgraded.catalogueVersion.startsWith('catalogue-v43')).toBe(true)
    expect(upgraded.blocks.some((block) => block.children.some((child) => child.videoId === 'preview'))).toBe(false)
  })

  it('preserves user channel numbers and plays the corpus on active RetroTV channels', async () => {
    const merged = mergeParsedExports([
      parseChannelsExport(readFileSync(CHANNELS, 'utf8')),
      parseChannelsExport(readFileSync(MORE, 'utf8')),
    ])
    const plan = planImport([], merged, { library: true, automatic: true }, [], 1)
    const built = channelsFromSources(plan.sources)
    expect(built.channels.map((channel) => channel.number)).toEqual(
      Array.from({ length: built.channels.length }, (_, index) => 1001 + index),
    )
    const argyle = built.channels.find((channel) => channel.name.includes('Argyle'))
    expect(argyle?.number).toBeGreaterThanOrEqual(1001)
    const loop = built.programmes.get(argyle!.id) ?? []
    expect(loop.some((programme) => programme.videoId)).toBe(true)

    setUserLibraryMode('allow-eligible')
    await ingestParsed(merged, { filename: 'retrotv-user-network', now: 1 })
    expect(airingReport().every((row) => (liveEndpoint(row.number) || row.original === 'test-card' || row.original === 'listings' ? row.count === 0 : row.status === 'dormant'))).toBe(true)
    const football = getSchedule(channelByNumber(47)!, '2026-09-26')
    expect(football.blocks.some((block) => block.children.some((child) => child.videoId && !child.fallback))).toBe(false)
  })
})

