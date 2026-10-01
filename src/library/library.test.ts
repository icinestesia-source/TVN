import { existsSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { channelByNumber } from '../data/catalogue.ts'
import { explainEligibility, isEligible } from '../director/eligibility.ts'
import { getSchedule, invalidateSchedule, resetDirector } from '../director/director.ts'
import { scheduleSeed } from '../director/network.ts'
import { DIRECTOR_CHANNELS, policyFor } from '../director/policies.ts'
import { resolveSource } from '../player/resolve.ts'
import { broadcast } from '../services/broadcast.ts'
import { parseChannelsExport, planImport, type ParsedExport } from '../services/channels-import.ts'
import { localStartMs } from '../director/time.ts'
import { classifyMedia } from './classify.ts'
import { reconcileLibrary } from './ingest.ts'
import { setUserLibraryMode } from './mode.ts'
import { getEligibleMedia, librarySummary, queryLibrary } from './query.ts'
import {
  correctMedia,
  ingestParsed,
  librarySnapshot,
  recordPlaybackFailure,
  resetLibraryForTests,
  setLibraryWriter,
} from './store.ts'
import type { LibraryMedia } from './types.ts'

const CORPUS = '/Users/admin/Desktop/Channels.txt'

afterEach(() => {
  resetLibraryForTests()
  resetDirector()
})

function channel(number: number) {
  const found = channelByNumber(number)
  if (!found) throw new Error(`missing channel ${number}`)
  return found
}

function exportOf(
  sources: ParsedExport['sources'],
): ParsedExport {
  let videoCount = 0
  let totalSeconds = 0
  let watchedCount = 0
  for (const source of sources) {
    for (const video of source.videos) {
      videoCount += 1
      totalSeconds += video.durationSec
      if (video.watched) watchedCount += 1
    }
  }
  return { version: '2.4', sources, videoCount, totalSeconds, watchedCount, warnings: [] }
}

function oneVideo(overrides: Partial<ParsedExport['sources'][number]['videos'][number]> = {}) {
  return exportOf([
    {
      id: 'src:example',
      name: 'Example',
      videos: [
        {
          id: 'abcdefghijk',
          title: 'Afternoon programme',
          durationSec: 600,
          ...overrides,
        },
      ],
    },
  ])
}

describe('source registry and media library', () => {
  it('keeps a stable source record separate from media, with unknown verification', async () => {
    const first = await ingestParsed(oneVideo(), { now: 10, filename: 'Channels.txt' })
    expect(first.sources).toHaveLength(1)
    expect(first.media).toHaveLength(1)
    const source = first.sources[0]
    const item = first.media[0]
    if (!source || !item) throw new Error('missing records')
    expect(source.id).toBe('src:example')
    expect(item.id).toBe('yt:abcdefghijk')
    expect(source.id).not.toBe(item.id)
    expect(source).not.toHaveProperty('durationSeconds')
    expect(source.verifiedOfficial).toBe('unknown')
    expect(source.authorised).toBe('unknown')
    expect(source.availability).toBe('unknown')
    expect(source.isLive).toBe(false)
    expect(item.isLive).toBe(false)
    expect(item.canSeek).toBe(true)
    expect(item.provider).toBe('youtube')
    expect(item.originalExternalId).toBe('abcdefghijk')
    const second = await ingestParsed(oneVideo({ title: 'Afternoon programme revised' }), { now: 11 })
    expect(second.sources).toHaveLength(1)
    expect(second.media).toHaveLength(1)
    expect(second.added).toBe(0)
    expect(second.updated).toBe(1)
    expect(second.media[0]?.id).toBe(item.id)
    expect(second.media[0]?.title).toBe('Afternoon programme revised')
    expect(second.sources[0]?.createdAt).toBe(source.createdAt)
  })

  it('merges one video from two collections and keeps both memberships', async () => {
    const parsed = exportOf([
      {
        id: 'src:one',
        name: 'One',
        videos: [{ id: 'samevideo01', title: 'Shared documentary', durationSec: 1200 }],
      },
      {
        id: 'src:two',
        name: 'Two',
        videos: [{ id: 'samevideo01', title: 'Shared documentary', durationSec: 1200 }],
      },
    ])
    const report = await ingestParsed(parsed, { now: 20 })
    expect(report.media).toHaveLength(1)
    expect(report.duplicatesMerged).toBe(1)
    expect(report.media[0]?.memberships.map((membership) => membership.sourceId).sort()).toEqual(['src:one', 'src:two'])
    expect(report.media[0]?.memberships.every((membership) => membership.present)).toBe(true)
    const again = await ingestParsed(parsed, { now: 21 })
    expect(again.media).toHaveLength(1)
    expect(again.added).toBe(0)
  })

  it('keeps user corrections, excludes, and watched status across reimport', async () => {
    const watched = oneVideo({ watched: true, title: 'A football documentary' })
    await ingestParsed(watched, { now: 30 })
    const saved = await correctMedia('yt:abcdefghijk', {
      programmeType: 'interview',
      topics: ['cooking'],
      explicitChannelExcludes: [400],
      editorialPriority: 4,
    })
    expect(saved?.programmeType).toBe('interview')
    const again = await ingestParsed(oneVideo({ title: 'A football documentary' }), { now: 31 })
    const item = again.media[0]
    expect(item?.programmeType).toBe('interview')
    expect(item?.topics).toEqual(['cooking'])
    expect(item?.explicitChannelExcludes).toEqual([400])
    expect(item?.editorialPriority).toBe(4)
    expect(item?.watched).toBe(true)
    expect(item?.userEditedMetadata).toEqual(expect.arrayContaining(['programmeType', 'explicitChannelExcludes']))
    expect(again.userEditsPreserved).toBe(1)
    expect(item?.metadataOrigins.programmeType?.origin).toBe('user')
  })

  it('marks media missing from a later import without deleting it', async () => {
    await ingestParsed(
      exportOf([
        {
          id: 'src:example',
          name: 'Example',
          videos: [
            { id: 'keepvideo01', title: 'Kept documentary', durationSec: 600 },
            { id: 'gonevideo01', title: 'Gone documentary', durationSec: 600 },
          ],
        },
      ]),
      { now: 40 },
    )
    const next = await ingestParsed(
      exportOf([
        {
          id: 'src:example',
          name: 'Example',
          videos: [{ id: 'keepvideo01', title: 'Kept documentary', durationSec: 600 }],
        },
      ]),
      { now: 41 },
    )
    expect(next.media).toHaveLength(2)
    const gone = next.media.find((item) => item.externalId === 'gonevideo01')
    expect(gone?.memberships.every((membership) => !membership.present)).toBe(true)
    expect(next.missingFromImport).toBeGreaterThan(0)
  })
})

describe('classification', () => {
  it('classifies clear titles and leaves ambiguous titles unclassified', () => {
    const music = classifyMedia({ title: 'Artist - Official Music Video', durationSeconds: 200 })
    expect(music.programmeType).toBe('music-video')
    expect(music.confidence).toBe('medium')
    expect(music.notes.some((note) => note.reason.includes('official music video'))).toBe(true)

    const match = classifyMedia({ title: 'Premier League Full Match 2019', durationSeconds: 5400 })
    expect(match.programmeType).toBe('classic-match')
    expect(match.topics).toContain('football')
    expect(match.year).toBe(2019)
    expect(match.origins.year?.confidence).toBe('low')

    const documentary = classifyMedia({ title: 'A history documentary', durationSeconds: 3000 })
    expect(documentary.programmeType).toBe('documentary')
    expect(documentary.topics).toContain('history')

    expect(classifyMedia({ title: 'Weekly review live', durationSeconds: 240 }).programmeType).toBe('unclassified')
    expect(classifyMedia({ title: 'Official Video', durationSeconds: 180 }).programmeType).toBe('unclassified')
  })

  it('does not invent a type from duration or a year from every number', () => {
    expect(classifyMedia({ title: 'Afternoon programme', durationSeconds: 240 }).programmeType).toBe('unclassified')
    expect(classifyMedia({ title: 'Afternoon programme', durationSeconds: 7200 }).programmeType).toBe('unclassified')
    const resolution = classifyMedia({ title: '1920x1080 footage', durationSeconds: 600 })
    expect(resolution.year).toBeUndefined()
    expect(classifyMedia({ title: 'Episode 12', durationSeconds: 1800 }).year).toBeUndefined()
    const dated = classifyMedia({ title: 'Cup final (1998)', durationSeconds: 600 })
    expect(dated.year).toBe(1998)
    expect(dated.origins.year?.confidence).toBe('medium')
    expect(dated.era).toBe('1990s')
    expect(dated.topics).not.toContain('1990s')
  })

  it('keeps a collection hint off the scheduling topics', () => {
    const result = classifyMedia({
      title: 'Episode 3',
      durationSeconds: 400,
      collectionNames: ['History Club'],
    })
    expect(result.programmeType).toBe('unclassified')
    expect(result.topics).not.toContain('history')
    expect(result.candidateTopics).toContain('history')
    expect(result.notes.some((note) => note.confidence === 'low' && note.field === 'candidateTopics')).toBe(true)
  })
})

describe('eligibility bridge', () => {
  it('lets one item fit several channels and explains the rule', () => {
    const item: LibraryMedia = {
      id: 'yt:historydoc',
      title: 'A history documentary',
      durationSeconds: 3000,
      programmeType: 'documentary',
      topics: ['history'],
      provider: 'youtube',
      externalId: 'historydoc',
      originalExternalId: 'historydoc',
      mediaKind: 'video',
      playbackKind: 'seekable-recorded',
      isLive: false,
      canSeek: true,
      metadataConfidence: 'medium',
      metadataOrigins: {},
      classification: [],
      candidateTopics: [],
      ingestedAt: 1,
      ingestedFrom: 'test',
      sourceCollection: 'Example',
      memberships: [],
      watched: false,
      userEditedMetadata: [],
      availability: 'unknown',
      failureCount: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    expect(getEligibleMedia([item], 400).map((entry) => entry.id)).toEqual(['yt:historydoc'])
    // Stage 4D: user media does not enter a channel that has no topic or subject rule.
    expect(getEligibleMedia([item], 61)).toHaveLength(0)
    expect(getEligibleMedia([item], 301)).toHaveLength(0)
    expect(getEligibleMedia([item], 544)).toHaveLength(0)
    const history = explainEligibility(item, 400)
    expect(history.eligible).toBe(true)
    expect(history.reasons.some((reason) => reason.includes('topic history'))).toBe(true)
    expect(history.reasons.some((reason) => reason.includes('programmeType documentary'))).toBe(true)
    expect(explainEligibility(item, 544).reasons.some((reason) => reason.includes('topic'))).toBe(true)
    expect(explainEligibility(item, 920).reasons[0]).toContain('no programming policy')
    expect(explainEligibility(item, 101).eligible).toBe(false)
    expect(policyFor(920)).toBeUndefined()
  })

  it('lets an explicit exclude win and an explicit include force a compatible channel', () => {
    const item = {
      id: 'yt:clip',
      title: 'Official Music Video',
      durationSeconds: 200,
      programmeType: 'music-video' as const,
      topics: [] as string[],
      mediaKind: 'video' as const,
      explicitChannelIncludes: [301],
      explicitChannelExcludes: [400],
    }
    expect(isEligible(item, 400, policyFor(400)!.eligibility)).toBe(false)
    expect(explainEligibility({ ...item, explicitChannelExcludes: [400] }, 400).reasons[0]).toContain('explicitChannelExclude')
    expect(isEligible(item, 301, policyFor(301)!.eligibility)).toBe(true)
    expect(explainEligibility(item, 301).reasons[0]).toContain('explicitChannelInclude')
    expect(
      isEligible(
        { ...item, explicitChannelIncludes: [960], mediaKind: 'video' },
        960,
        policyFor(960)!.eligibility,
      ),
    ).toBe(false)
    expect(explainEligibility({ ...item, explicitChannelIncludes: [960], mediaKind: 'video' }, 960).reasons[0]).toContain(
      'playback constraint',
    )
  })
})

describe('frozen schedules', () => {
  it('leaves today frozen and lets a future uncompiled day use new media', async () => {
    const football = channel(301)
    const today = getSchedule(football, '2026-09-26')
    const parsed = exportOf([
      {
        id: 'src:matches',
        name: 'Matches',
        videos: [{ id: 'matchvideo1', title: 'Premier League Full Match', durationSec: 5400 }],
      },
    ])
    await ingestParsed(parsed, { now: 50 })
    expect(getSchedule(football, '2026-09-26')).toBe(today)
    const future = getSchedule(football, '2026-10-03')
    const classic = future.blocks.find((block) => block.start === '20:00')
    expect(classic?.children.some((child) => child.videoId === 'matchvideo1')).toBe(false)
    const compiledEarly = getSchedule(football, '2026-10-10')
    await ingestParsed(
      exportOf([
        {
          id: 'src:matches',
          name: 'Matches',
          videos: [
            { id: 'matchvideo1', title: 'Premier League Full Match', durationSec: 5400 },
            { id: 'matchvideo2', title: 'Another Full Match football', durationSec: 5400 },
          ],
        },
      ]),
      { now: 51 },
    )
    expect(getSchedule(football, '2026-10-10')).toBe(compiledEarly)
    invalidateSchedule(301, '2026-10-10')
    const rebuilt = getSchedule(football, '2026-10-10')
    expect(rebuilt).not.toBe(compiledEarly)
    expect(rebuilt.blocks.some((block) => block.children.some((child) => child.videoId === 'matchvideo2' || child.videoId === 'matchvideo1'))).toBe(false)
    expect(getSchedule(football, '2026-09-26')).toBe(today)
    const picture = broadcast(football, localStartMs('2026-10-03', '20:10'))
    expect(resolveSource(picture.current.programme).videoId).toBeNull()
    expect(scheduleSeed(301, '2026-09-27').startsWith('RETROTV|301|2026-09-27|policy-v1|catalogue-v43@')).toBe(true)
  })

  it('does not offer the library when the local setting is off', async () => {
    setUserLibraryMode('off')
    await ingestParsed(
      exportOf([
        {
          id: 'src:matches',
          name: 'Matches',
          videos: [{ id: 'matchvideo1', title: 'Premier League Full Match', durationSec: 5400 }],
        },
      ]),
      { now: 60 },
    )
    const future = getSchedule(channel(301), '2026-10-03')
    expect(future.blocks.every((block) => block.children.every((child) => !child.videoId))).toBe(true)
    expect(librarySnapshot().media).toHaveLength(1)
  })

  it('still compiles a generated day from an empty library', () => {
    const schedule = getSchedule(channel(544), '2026-09-26')
    expect(schedule.blocks.length).toBeGreaterThan(0)
    expect(schedule.seed).toBe('RETROTV|544|2026-09-26|policy-v1|catalogue-v43')
  })
})

describe('import failure', () => {
  it('skips a bad record, keeps an unavailable item, and retries a failed save', async () => {
    const parsed = exportOf([
      {
        id: 'src:example',
        name: 'Example',
        videos: [
          { id: '', title: '', durationSec: 0 },
          { id: 'goodvideo01', title: 'A documentary', durationSec: 1000 },
        ],
      },
    ])
    const reconciled = reconcileLibrary([], [], parsed, 70)
    expect(reconciled.errors.length).toBe(1)
    expect(reconciled.media).toHaveLength(1)

    await ingestParsed(oneVideo({ title: 'A history documentary' }), { now: 71 })
    const failed = await recordPlaybackFailure('abcdefghijk', 'embed rejected', 72)
    expect(failed?.availability).toBe('temporarily_unavailable')
    expect(failed?.failureCount).toBe(1)
    expect(librarySnapshot().media).toHaveLength(1)
    // Stage 4D: a general channel with no topic rule does not take user media.
    // History still accepts this documentary, and a playback failure does not remove it.
    expect(getEligibleMedia(librarySnapshot().media, 61)).toHaveLength(0)
    expect(getEligibleMedia(librarySnapshot().media, 400)).toHaveLength(1)

    resetLibraryForTests()
    let fail = true
    setLibraryWriter({
      async write() {
        if (fail) throw new Error('disk full')
      },
      async read() {
        return { media: [], sources: [] }
      },
    })
    await expect(ingestParsed(oneVideo(), { now: 73 })).rejects.toThrow('disk full')
    expect(librarySnapshot().media).toHaveLength(0)
    fail = false
    await ingestParsed(oneVideo(), { now: 74 })
    await ingestParsed(oneVideo(), { now: 75 })
    expect(librarySnapshot().media).toHaveLength(1)
  })
})

describe('Channels.txt corpus', () => {
  const available = existsSync(CORPUS)

  it.skipIf(!available)('ingests the supplied file once and again without duplicating media', async () => {
    expect(existsSync('/Users/admin/Documents/GitHub/TVSurf/Channels.txt')).toBe(false)
    expect(existsSync('/Users/admin/Documents/GitHub/TVSurf/src/Channels.txt')).toBe(false)
    const text = readFileSync(CORPUS, 'utf8')
    const parseStarted = performance.now()
    const parsed = parseChannelsExport(text)
    const parseMs = performance.now() - parseStarted

    expect(parsed.version).toBe('2.4')
    expect(parsed.sources).toHaveLength(58)
    expect(parsed.videoCount).toBe(977)
    expect(parsed.totalSeconds).toBe(1_353_057)
    expect(parsed.watchedCount).toBe(29)
    expect(Math.min(...parsed.sources.flatMap((source) => source.videos.map((video) => video.durationSec)))).toBe(92)
    expect(Math.max(...parsed.sources.flatMap((source) => source.videos.map((video) => video.durationSec)))).toBe(14_425)

    const classifyStarted = performance.now()
    for (const source of parsed.sources) {
      for (const video of source.videos) {
        classifyMedia({ title: video.title, durationSeconds: video.durationSec, collectionNames: [source.name] })
      }
    }
    const classifyMs = performance.now() - classifyStarted

    const normalizeStarted = performance.now()
    const normalised = reconcileLibrary([], [], parsed, 80, 'Channels.txt')
    const normalizeMs = performance.now() - normalizeStarted

    const saveStarted = performance.now()
    const saved = await ingestParsed(parsed, { now: 81, filename: 'Channels.txt' })
    const saveMs = performance.now() - saveStarted

    const repeatStarted = performance.now()
    const repeated = await ingestParsed(parsed, { now: 82, filename: 'Channels.txt' })
    const repeatMs = performance.now() - repeatStarted

    expect(saved.media).toHaveLength(977)
    expect(saved.sources).toHaveLength(58)
    expect(new Set(saved.media.map((item) => item.id)).size).toBe(977)
    expect(saved.sources.every((source) => source.verifiedOfficial === 'unknown')).toBe(true)
    expect(saved.session.filename).toBe('Channels.txt')
    expect(JSON.stringify(saved.session)).not.toContain(text.slice(0, 80))
    expect(repeated.added).toBe(0)
    expect(repeated.media).toHaveLength(977)
    expect(repeated.duplicatesMerged).toBe(0)

    const summary = librarySummary(saved.media, saved.sources)
    expect(summary.watchedCount).toBe(29)
    expect(summary.totalSeconds).toBe(1_353_057)
    expect(saved.media.some((item) => item.topics?.includes('1990s'))).toBe(false)

    const queryStarted = performance.now()
    queryLibrary(saved.media, { programmeType: 'documentary', minDuration: 60, maxDuration: 20_000 })
    const queryMs = performance.now() - queryStarted

    const eligibleStarted = performance.now()
    const eligible = Object.fromEntries(
      DIRECTOR_CHANNELS.map((number) => [number, getEligibleMedia(saved.media, number).length]),
    )
    const eligibleMs = performance.now() - eligibleStarted
    expect(eligible[544]).toBe(0)
    expect(Object.values(eligible).some((count) => count > 0)).toBe(true)

    const libraryOnly = planImport([], parsed, { library: true, automatic: false }, [], 90)
    expect(libraryOnly.automaticChannels).toBe(0)
    expect(libraryOnly.sources.every((source) => source.channelNumber === null)).toBe(true)
    const automatic = planImport([], parsed, { library: false, automatic: true }, [], 91)
    expect(automatic.automaticChannels).toBe(58)
    expect(automatic.sources.every((source) => (source.channelNumber ?? 0) >= 1001)).toBe(true)
    const again = planImport(automatic.sources, parsed, { library: false, automatic: true }, [], 92)
    expect(again.sources.map((source) => source.channelNumber)).toEqual(automatic.sources.map((source) => source.channelNumber))
    const both = planImport([], parsed, { library: true, automatic: true }, [], 93)
    expect(both.libraryVideos).toBe(977)
    expect(both.automaticChannels).toBe(58)

    const bytes = new TextEncoder().encode(text).byteLength
    console.info(
      'LIBRARY_BENCH',
      JSON.stringify({
        parseMs: Number(parseMs.toFixed(1)),
        classifyMs: Number(classifyMs.toFixed(1)),
        normalizeMs: Number(normalizeMs.toFixed(1)),
        saveMs: Number(saveMs.toFixed(1)),
        repeatMs: Number(repeatMs.toFixed(1)),
        queryMs: Number(queryMs.toFixed(1)),
        eligibleMs: Number(eligibleMs.toFixed(1)),
        media: saved.media.length,
        sources: saved.sources.length,
        bytes,
        memoryChars: JSON.stringify(saved.media).length,
        programmeTypes: summary.programmeTypes,
        unclassified: summary.unclassifiedCount,
        eligible,
        normalisedMedia: normalised.media.length,
      }),
    )
    expect(parseMs).toBeLessThan(2000)
    expect(classifyMs).toBeLessThan(2000)
    expect(normalizeMs).toBeLessThan(2000)
    expect(saveMs).toBeLessThan(2000)
    expect(repeatMs).toBeLessThan(2000)
    expect(queryMs).toBeLessThan(2000)
    expect(eligibleMs).toBeLessThan(2000)
  })
})
