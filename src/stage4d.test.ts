import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { channelByNumber, programmesFor } from './data/catalogue.ts'
import { channelMatchesFilter } from './data/network.ts'
import { DEMO_FILMS } from './data/media.ts'
import { NETWORK_SOURCES, NETWORK_VIDEOS } from './data/network/manifest.ts'
import { defaultNetworkItems } from './data/network/catalog.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { applyBuiltInCatalogues, catalogueFingerprint } from './data/user-network/bootstrap.ts'
import { visibleRowRange, GUIDE_MAX_WINDOW_MS } from './epg/geometry.ts'
import { decideEligibility, explainEligibility } from './director/eligibility.ts'
import { strandPolicy } from './director/policies.ts'
import { resetDirector } from './director/director.ts'
import { tunerStep, formatChannelNumber } from './input/tuner.ts'
import { classifyMedia } from './library/classify.ts'
import { correctMedia, ingestParsed, librarySnapshot, resetLibraryForTests } from './library/store.ts'
import { networkRepetition } from './network/repetition.ts'
import { playbackCommand } from './player/command.ts'
import { contentIntegrity } from './player/integrity.ts'
import { broadcast } from './services/broadcast.ts'
import { channelsFromSources, mergeParsedExports, parseChannelsExport, planImport } from './services/channels-import.ts'
import type { Programme } from './types/programme.ts'

const CHANNELS = 'public/user-network/channels.txt'
const MORE = 'public/user-network/more-channels.txt'

afterEach(() => {
  resetLibraryForTests()
  resetDirector()
  installUserCatalogue([], new Map())
})

function texts(): string[] {
  return [readFileSync(CHANNELS, 'utf8'), readFileSync(MORE, 'utf8')]
}

describe('stage 4D content reset', () => {
  it('does not ship NASA in the default network', () => {
    const haystack = [
      ...NETWORK_SOURCES.map((source) => `${source.id} ${source.displayName} ${source.publisher}`),
      ...NETWORK_VIDEOS.map((video) => `${video.videoId} ${video.title} ${video.author} ${video.sourceId}`),
      ...defaultNetworkItems().map((item) => `${item.id} ${item.title} ${item.creator ?? ''}`),
    ].join('\n')
    expect(haystack).not.toMatch(/nasa/i)
    expect(haystack).not.toMatch(/Cosmic Dawn|Crew-12|Roman launch|Roman prelaunch/i)
    const space = channelByNumber(9)
    expect(space?.name).toBeTruthy()
    const picture = broadcast(space!, Date.UTC(2026, 8, 26, 12, 0, 0))
    expect(picture.current.programme.videoId).toBeNull()
    expect(picture.current.programme.title).toBe('Programming resumes soon')
  })

  it('does not play a demonstration film under an unrelated seed title', () => {
    const engineering = programmesFor('ch-011')
    const demoIds = new Set(DEMO_FILMS.map((film) => film.videoId))
    expect(engineering.length).toBeGreaterThan(0)
    expect(engineering.every((programme) => programme.title === 'No programming available')).toBe(true)
    expect(engineering.every((programme) => programme.videoId === null)).toBe(true)
    expect(engineering.some((programme) => programme.videoId !== null && demoIds.has(programme.videoId))).toBe(false)
    const card = programmesFor('ch-060')
    expect(card.some((programme) => programme.videoId && demoIds.has(programme.videoId))).toBe(true)
    const holding = engineering[0] as Programme
    const command = playbackCommand(holding, 40, null)
    expect(command.kind).toBe('holding')
    expect(command.videoId).toBeNull()
    expect(
      contentIntegrity({
        displayedTitle: command.programmeTitle,
        scheduleTitle: holding.title,
        mediaId: command.mediaId,
        scheduleMediaId: holding.sourceRef ?? null,
        expectedVideoId: command.videoId,
        actualVideoId: null,
        contentKind: command.kind,
      }).ok,
    ).toBe(true)
  })

  it('keeps a real programme and a holding card on the same identity', () => {
    const real: Programme = {
      id: 'real-1',
      title: 'Argyle Life',
      description: '',
      videoId: 'abcdefghijk',
      durationSeconds: 600,
      channelId: 'user-src-argyle',
      category: 'User',
      source: 'imported',
      kind: 'programme',
      playbackMode: 'linear',
      sourceRef: 'youtube:abcdefghijk',
    }
    const command = playbackCommand(real, 12, null)
    expect(command.kind).toBe('real')
    expect(command.videoId).toBe('abcdefghijk')
    expect(
      contentIntegrity({
        displayedTitle: 'Argyle Life',
        scheduleTitle: real.title,
        mediaId: 'youtube:abcdefghijk',
        scheduleMediaId: real.sourceRef ?? null,
        expectedVideoId: 'abcdefghijk',
        actualVideoId: 'abcdefghijk',
        contentKind: 'real',
      }).ok,
    ).toBe(true)
    expect(
      contentIntegrity({
        displayedTitle: 'Argyle Life',
        scheduleTitle: real.title,
        mediaId: 'youtube:abcdefghijk',
        scheduleMediaId: real.sourceRef ?? null,
        expectedVideoId: 'abcdefghijk',
        actualVideoId: 'aqz-KE-bpKQ',
        contentKind: 'real',
      }).ok,
    ).toBe(false)
    expect(
      contentIntegrity({
        displayedTitle: 'No programming available',
        scheduleTitle: 'No programming available',
        mediaId: null,
        scheduleMediaId: null,
        expectedVideoId: null,
        actualVideoId: 'aqz-KE-bpKQ',
        contentKind: 'holding',
      }).ok,
    ).toBe(false)
  })
})

describe('stage 4D built-in user network', () => {
  it('bootstraps both catalogues once, dedupes media, and keeps channel numbers', async () => {
    const raw = texts()
    const parsed = raw.map((text) => parseChannelsExport(text))
    const namesA = new Set(parsed[0]?.sources.map((source) => source.name))
    const namesB = new Set(parsed[1]?.sources.map((source) => source.name))
    const overlap = [...namesA].filter((name) => namesB.has(name))
    expect(overlap.sort()).toEqual(
      ['Balludicrous', 'CinemaSins', 'ESPN', 'OSW Review HD', 'PlayersTV', 'RedLetterMedia', 'Screen Junkies', 'Secret Base'].sort(),
    )
    const merged = mergeParsedExports(parsed)
    expect(merged.sources).toHaveLength(new Set([...namesA, ...namesB]).size)
    expect(merged.sources.filter((source) => source.name === 'ESPN')).toHaveLength(1)
    const espn = merged.sources.find((source) => source.name === 'ESPN')
    const espnIds = new Set([
      ...(parsed[0]?.sources.find((source) => source.name === 'ESPN')?.videos.map((video) => video.id) ?? []),
      ...(parsed[1]?.sources.find((source) => source.name === 'ESPN')?.videos.map((video) => video.id) ?? []),
    ])
    expect(new Set(espn?.videos.map((video) => video.id)).size).toBe(espnIds.size)
    expect(espn?.videos).toHaveLength(espnIds.size)

    const idsA = new Set(parsed[0]?.sources.flatMap((source) => source.videos.map((video) => video.id)))
    const idsB = new Set(parsed[1]?.sources.flatMap((source) => source.videos.map((video) => video.id)))
    const unique = new Set([...idsA, ...idsB])
    const reserved: number[] = []
    const first = await applyBuiltInCatalogues({
      texts: raw,
      existing: [],
      storedFingerprint: null,
      now: 1_000,
      reserved,
    })
    expect(first.skipped).toBe(false)
    expect(first.plan?.created).toBe(merged.sources.length)
    const media = librarySnapshot().media
    expect(media).toHaveLength(unique.size)
    expect(new Set(media.map((item) => item.id)).size).toBe(unique.size)
    expect(media.every((item) => item.id === `yt:${item.externalId}`)).toBe(true)
    const numbers = first.sources.map((source) => source.channelNumber).filter((number): number is number => number !== null)
    expect(Math.min(...numbers)).toBe(1001)
    expect(numbers).toHaveLength(merged.sources.length)
    expect(new Set(numbers).size).toBe(numbers.length)

    const second = await applyBuiltInCatalogues({
      texts: raw,
      existing: first.sources,
      storedFingerprint: first.fingerprint,
      now: 2_000,
      reserved,
    })
    expect(second.skipped).toBe(true)
    expect(second.timings.classify).toBe(0)
    expect(librarySnapshot().media).toHaveLength(unique.size)
    expect(second.sources.map((source) => [source.id, source.channelNumber])).toEqual(
      first.sources.map((source) => [source.id, source.channelNumber]),
    )

    const extra = mergeParsedExports(parsed)
    extra.sources.push({
      id: 'src:added-later',
      name: 'Added Later',
      videos: [{ id: 'addedvideo1', title: 'Added', durationSec: 120 }],
    })
    const updated = planImport(first.sources, extra, { library: true, automatic: true }, reserved, 3_000)
    expect(updated.created).toBe(1)
    for (const source of first.sources) {
      expect(updated.sources.find((item) => item.id === source.id)?.channelNumber).toBe(source.channelNumber)
    }
    expect(updated.sources.find((source) => source.id === 'src:added-later')?.channelNumber).toBeGreaterThan(Math.max(...numbers))

    const built = channelsFromSources(first.sources)
    installUserCatalogue(built.channels, built.programmes)
    expect(built.channels[0]?.number).toBeGreaterThanOrEqual(1001)
    expect(built.channels.every((channel) => channel.number >= 1001)).toBe(true)
    const sample = built.channels.find((channel) => channel.name === 'Boiler Room') ?? built.channels[0]
    expect(sample).toBeTruthy()
    const at = Date.UTC(2026, 8, 26, 18, 0, 0)
    const now = broadcast(sample!, at)
    const inside = broadcast(sample!, now.current.startMs + 15_000)
    const later = broadcast(sample!, now.current.startMs + 45_000)
    expect(now.current.programme.videoId).toBeTruthy()
    expect(inside.current.programme.videoId).toBe(now.current.programme.videoId)
    expect(later.current.programme.videoId).toBe(now.current.programme.videoId)
    expect(later.current.seekSeconds).toBeGreaterThan(inside.current.seekSeconds)

    const report = networkRepetition(at)
    expect(report.configured).toBeGreaterThan(built.channels.length)
    expect(report.rows.some((row) => row.channel === sample!.number && row.videoId === now.current.programme.videoId)).toBe(true)
    expect(report.day.some((row) => row.channel === sample!.number && row.uniqueProgrammes > 1)).toBe(true)

    expect(first.timings.parse).toBeGreaterThan(0)
    expect(first.timings.total).toBeGreaterThan(0)
    expect(catalogueFingerprint(raw)).toBe(first.fingerprint)
    const seconds = media.reduce((sum, item) => sum + item.durationSeconds, 0)
    console.log(
      'USER_NETWORK',
      JSON.stringify({
        sources: first.sources.length,
        media: media.length,
        hours: Number((seconds / 3600).toFixed(2)),
        watched: media.filter((item) => item.watched).length,
        firstChannel: Math.min(...numbers),
        lastChannel: Math.max(...numbers),
        first: first.timings,
        second: second.timings,
      }),
    )
  }, 60_000)

  it('keeps a user correction when the catalogue is imported again', async () => {
    const parsed = {
      version: '2.4',
      videoCount: 1,
      totalSeconds: 600,
      watchedCount: 0,
      warnings: [],
      sources: [{ id: 'src:argyle', name: 'Argyle Life | Green', videos: [{ id: 'argylevid01', title: 'Episode 3', durationSec: 600 }] }],
    }
    await ingestParsed(parsed)
    expect(librarySnapshot().media[0]?.topics).toContain('football')
    await correctMedia('yt:argylevid01', { programmeType: 'interview', topics: ['interview'] })
    await ingestParsed(parsed)
    const kept = librarySnapshot().media.find((item) => item.id === 'yt:argylevid01')
    expect(kept?.programmeType).toBe('interview')
    expect(kept?.topics).toEqual(['interview'])
  })
})

describe('stage 4D classification and tuning', () => {
  it('separates sports, sports games, and a LIVE title', async () => {
    const nba = classifyMedia({ title: 'NBA Finals Game 7 Highlights', durationSeconds: 600 })
    const twoK = classifyMedia({ title: 'NBA 2K25 MyCAREER', durationSeconds: 600 })
    const nfl = classifyMedia({ title: 'NFL RedZone Week 1', durationSeconds: 600 })
    const madden = classifyMedia({ title: 'Madden NFL 25 Franchise', durationSeconds: 600 })
    const football = classifyMedia({ title: 'Episode 3', durationSeconds: 600, collectionNames: ['Argyle Life | Green'] })
    const recorded = classifyMedia({ title: 'Boiler Room LIVE in London', durationSeconds: 3600, collectionNames: ['Boiler Room'] })
    expect(nba.sport).toBe('basketball')
    expect(nba.programmeType).not.toBe('gameplay')
    expect(nba.topics).not.toContain('gaming')
    expect(twoK.programmeType).toBe('gameplay')
    expect(twoK.topics).toContain('gaming')
    expect(twoK.topics).toContain('basketball')
    expect(twoK.sport).toBeUndefined()
    expect(nfl.sport).toBe('american-football')
    expect(nfl.topics).toContain('american-football')
    expect(nfl.topics).not.toContain('football')
    expect(madden.programmeType).toBe('gameplay')
    expect(madden.sport).toBeUndefined()
    expect(madden.topics).toContain('gaming')
    expect(football.topics).toContain('football')
    expect(football.sport).toBe('football')
    expect(football.notes.some((note) => note.rule === 'collection-argyle')).toBe(true)
    expect(recorded.programmeType).toBe('concert')
    expect(recorded.topics).toContain('music')
    expect(recorded.notes.some((note) => note.rule === 'title-live-is-recorded')).toBe(true)

    const live = {
      version: '2.4',
      videoCount: 1,
      totalSeconds: 3600,
      watchedCount: 0,
      warnings: [],
      sources: [{ id: 'src:boiler', name: 'Boiler Room', videos: [{ id: 'boilervid01', title: 'Boiler Room LIVE in London', durationSec: 3600 }] }],
    }
    await ingestParsed(live)
    const item = librarySnapshot().media[0]
    expect(item?.isLive).toBe(false)
    expect(item?.canSeek).toBe(true)

    const gameplay = {
      id: 'yt:two-k',
      title: twoK.programmeType,
      programmeType: twoK.programmeType,
      topics: twoK.topics,
      subjects: twoK.subjects,
      sport: twoK.sport,
      mediaKind: 'video' as const,
      durationSeconds: 600,
    }
    expect(explainEligibility(gameplay, 317).eligible).toBe(false)
    const gaming = strandPolicy(900, 'entertainment', ['episode', 'documentary', 'gameplay', 'trailer'], ['gaming']).eligibility
    expect(decideEligibility(gameplay, 900, gaming).eligible).toBe(true)
    expect(decideEligibility(gameplay, 900, gaming).reasons.join(' ')).toMatch(/gaming/)
    const match = {
      id: 'yt:argyle-match',
      title: 'Argyle',
      programmeType: 'sport' as const,
      topics: ['football'],
      subjects: ['football'],
      sport: 'football',
      mediaKind: 'video' as const,
      durationSeconds: 600,
    }
    expect(explainEligibility(match, 301).eligible).toBe(true)
    expect(explainEligibility(match, 301).reasons.join(' ')).toMatch(/football/)
    expect(explainEligibility(gameplay, 301).eligible).toBe(false)
  })

  it('tunes four-digit user channels and filters the guide', () => {
    expect(formatChannelNumber(1001)).toBe('1001')
    expect(formatChannelNumber(9)).toBe('009')
    expect(tunerStep('100', [9, 1001, 1002])).toBe('wait')
    expect(tunerStep('1001', [9, 1001, 1002])).toBe('commit')
    expect(tunerStep('009', [9, 1001])).toBe('commit')
    const user = { number: 1001, enabled: true, origin: 'user-import' }
    const curated = { number: 21, enabled: true, origin: 'default' }
    expect(channelMatchesFilter(user, 'user', [])).toBe(true)
    expect(channelMatchesFilter(user, 'retrotv', [])).toBe(false)
    expect(channelMatchesFilter(curated, 'user', [])).toBe(false)
    expect(channelMatchesFilter(curated, 'retrotv', []) || channelMatchesFilter(curated, 'dormant', [])).toBe(true)
    expect(channelMatchesFilter(user, 'all', [])).toBe(true)
    const range = visibleRowRange(0, 600, 48, 81 + 999, 6)
    expect(range.end - range.start).toBeLessThan(40)
    expect(GUIDE_MAX_WINDOW_MS).toBeLessThanOrEqual(36 * 60 * 60 * 1000)
  })
})
