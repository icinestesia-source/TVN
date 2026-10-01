import { afterEach, describe, expect, it } from 'vitest'
import { channelByNumber } from '../data/catalogue.ts'
import { defaultNetworkItems } from '../data/network/catalog.ts'
import { NETWORK_SOURCES, NETWORK_VIDEOS } from '../data/network/manifest.ts'
import { directorGuideSlots, getSchedule, invalidateSchedule, resetDirector } from '../director/director.ts'
import { explainEligibility } from '../director/eligibility.ts'
import { setMediaLibrary } from '../director/library.ts'
import { scheduleSeed } from '../director/network.ts'
import { policyFor } from '../director/policies.ts'
import type { MediaItem } from '../director/types.ts'
import { localStartMs } from '../director/time.ts'
import { classifyMedia } from '../library/classify.ts'
import { setUserLibraryMode } from '../library/mode.ts'
import {
  applyBulkEdit,
  correctMedia,
  ingestParsed,
  librarySnapshot,
  resetLibraryForTests,
  setCollectionEditorial,
  undoBulkEdit,
} from '../library/store.ts'
import { mediaSeekSeconds } from '../player/seek.ts'
import { broadcast } from '../services/broadcast.ts'
import type { Programme } from '../types/programme.ts'
import { channelCoverage, coverageStatus, HEALTHY_SECONDS, networkCoverage } from './coverage.ts'

afterEach(() => {
  resetLibraryForTests()
  resetDirector()
})

function channel(number: number) {
  const found = channelByNumber(number)
  if (!found) throw new Error(`missing channel ${number}`)
  return found
}

function item(patch: Partial<MediaItem> & Pick<MediaItem, 'id' | 'title' | 'programmeType'>): MediaItem {
  return {
    durationSeconds: 30 * 60,
    provider: 'youtube',
    externalId: 'abcdefghijk',
    mediaKind: 'video',
    playbackKind: 'seekable-recorded',
    live: false,
    canSeek: true,
    ...patch,
  }
}

describe('default network', () => {
  it('registers stable verified sources and does not invent ids', () => {
    expect(NETWORK_SOURCES.map((source) => source.id)).toEqual([
      'network:blender',
      'network:public-domain',
      'network:football',
      'network:nineties',
      'network:gaming',
    ])
    expect(NETWORK_SOURCES.filter((source) => !source.enabled).every((source) => source.notes.length > 0)).toBe(true)
    const ids = NETWORK_VIDEOS.map((entry) => entry.videoId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(NETWORK_VIDEOS.every((entry) => entry.verified && entry.durationSeconds > 0)).toBe(true)
    expect(defaultNetworkItems().every((entry) => entry.id === `net:${entry.externalId}`)).toBe(true)
  })

  it('keeps an empty library on the catalogue-v43 seed', () => {
    const schedule = getSchedule(channel(301), '2026-09-26')
    expect(schedule.seed).toBe('RETROTV|301|2026-09-26|policy-v1|catalogue-v43')
    expect(schedule.seed).toBe(scheduleSeed(301, '2026-09-26'))
  })

  it('gives every configured strand a policy and leaves protected channels alone', () => {
    for (const number of [3, 4, 5, 8, 9, 21, 22, 31, 47, 103, 140, 300, 301, 400, 544]) {
      expect(policyFor(number)?.channelNumber).toBe(number)
    }
    for (const number of [1, 60, 101, 950, 863]) {
      expect(policyFor(number)?.eligibility.routedOnly).toBe(true)
    }
    for (const number of [64, 146, 480, 481, 482, 492, 667, 682, 683, 873, 874, 920, 1001, 1500]) {
      expect(policyFor(number)).toBeUndefined()
    }
  })

  it('separates a wrestling interview from history', () => {
    const classified = classifyMedia({ title: 'History of WrestleMania — Interview', durationSeconds: 1800 })
    expect(classified.programmeType).toBe('interview')
    expect(classified.subjects).toContain('wrestling')
    expect(classified.topics).not.toContain('history')
    const media = item({
      id: 'wrestle',
      title: 'History of WrestleMania — Interview',
      programmeType: 'interview',
      subjects: ['wrestling'],
      sport: 'wrestling',
      topics: [],
    })
    const decision = explainEligibility(media, 400)
    expect(decision.eligible).toBe(false)
    expect(decision.reasons.join(' ')).toMatch(/interview allowed/)
    expect(decision.reasons.join(' ')).toMatch(/wrestling/)
  })

  it('reads a football full match as a match, not as a history programme', () => {
    const classified = classifyMedia({ title: 'Manchester United v Arsenal — Full Match', durationSeconds: 5400 })
    expect(classified.programmeType).toBe('classic-match')
    expect(classified.sport).toBe('football')
    expect(classified.teams).toEqual(['Manchester United', 'Arsenal'])
    expect(classified.topics).not.toContain('history')
    const decision = explainEligibility(
      item({
        id: 'match',
        title: 'Manchester United v Arsenal — Full Match',
        programmeType: 'classic-match',
        topics: ['football'],
        subjects: ['football'],
        sport: 'football',
      }),
      301,
    )
    expect(decision.eligible).toBe(true)
    expect(decision.reasons.join(' ')).toMatch(/football/)
  })

  it('treats a collection name as a hint and lets a user correction win', async () => {
    const parsed = {
      version: '2.4',
      videoCount: 1,
      totalSeconds: 600,
      watchedCount: 0,
      warnings: [],
      sources: [
        {
          id: 'src:football-full-matches',
          name: 'Football Full Matches',
          videos: [{ id: 'matchvideo1', title: 'Episode 3', durationSec: 600 }],
        },
      ],
    }
    await ingestParsed(parsed)
    const hinted = classifyMedia({ title: 'Episode 3', durationSeconds: 600, collectionNames: ['Football Full Matches'] })
    expect(hinted.programmeType).toBe('unclassified')
    expect(hinted.candidateSubjects).toContain('football')
    await setCollectionEditorial('src:football-full-matches', {
      subjects: ['football'],
      topics: ['football'],
      programmeType: 'classic-match',
      confidence: 'medium',
    })
    await ingestParsed(parsed)
    expect(librarySnapshot().media[0]?.programmeType).toBe('classic-match')
    await correctMedia('yt:matchvideo1', { programmeType: 'interview' })
    await ingestParsed(parsed)
    expect(librarySnapshot().media.find((entry) => entry.id === 'yt:matchvideo1')?.programmeType).toBe('interview')
  })

  it('keeps a bulk subject correction after reimport and can undo it', async () => {
    const parsed = {
      version: '2.4',
      videoCount: 1,
      totalSeconds: 600,
      watchedCount: 0,
      warnings: [],
      sources: [
        {
          id: 'src:notes',
          name: 'Notes',
          videos: [{ id: 'notevideo01', title: 'Episode 3', durationSec: 600 }],
        },
      ],
    }
    await ingestParsed(parsed)
    const changed = await applyBulkEdit(['yt:notevideo01'], { subjects: ['football'], topics: ['football'] })
    expect(changed).toBe(1)
    await ingestParsed(parsed)
    expect(librarySnapshot().media.find((entry) => entry.id === 'yt:notevideo01')?.topics).toContain('football')
    expect(await undoBulkEdit()).toBe(true)
    expect(librarySnapshot().media.find((entry) => entry.id === 'yt:notevideo01')?.topics ?? []).not.toContain('football')
  })

  it('reports empty, thin, and healthy channels from real durations', () => {
    const rows = networkCoverage()
    const football = channelCoverage(defaultNetworkItems(), 301)
    const space = channelCoverage(defaultNetworkItems(), 9)
    const films = channelCoverage(defaultNetworkItems(), 21)
    expect(coverageStatus(0, 0)).toBe('EMPTY')
    expect(coverageStatus(HEALTHY_SECONDS - 1, 0)).toBe('THIN')
    expect(coverageStatus(HEALTHY_SECONDS, 0)).toBe('POPULATED')
    expect(football?.status).toBe('EMPTY')
    expect(football?.eligibleSeconds).toBe(0)
    // Stage 4D: channel 009 stays configured and has no supplied media.
    expect(space?.status).toBe('EMPTY')
    expect(space?.eligibleSeconds).toBe(0)
    expect(films?.status).toBe('EMPTY')
    expect(defaultNetworkItems()).toEqual([])
    const removed = new Set(NETWORK_VIDEOS.map((video) => video.videoId))
    expect(rows.some((row) => row.playable > 0 && removed.has(String(row.number)))).toBe(false)
  })

  it('does not schedule the removed open-movie inventory', () => {
    setMediaLibrary(defaultNetworkItems())
    const when = localStartMs('2026-11-04', '06:00') + 30_000
    const picture = broadcast(channel(21), when)
    expect(picture.current.programme.videoId).toBeNull()
    expect(NETWORK_VIDEOS.some((video) => video.videoId === picture.current.programme.videoId)).toBe(false)
    const guide = directorGuideSlots(channel(21), when, when + 60 * 60 * 1000)
    expect(guide.some((slot) => slot.programme.videoId && NETWORK_VIDEOS.some((video) => video.videoId === slot.programme.videoId))).toBe(false)
  })

  it('does not seek a live source', () => {
    const live = { playback: 'live', playbackMode: 'linear', durationSeconds: 3600, videoId: 'abcdefghijk' } as Programme
    expect(mediaSeekSeconds(400, live)).toBe(0)
    const recorded = {
      playback: 'seekable-recorded',
      playbackMode: 'linear',
      durationSeconds: 3600,
      mediaDurationSeconds: 3600,
      videoId: 'aqz-KE-bpKQ',
    } as Programme
    expect(mediaSeekSeconds(400, recorded)).toBe(400)
  })

  it('leaves today frozen and lets a later day use newly eligible media', () => {
    const earlier = item({
      id: 'net:fixture-earlier',
      explicitChannelIncludes: [21],
      title: 'Fixture earlier film',
      programmeType: 'film',
      externalId: 'fixtureear1',
      durationSeconds: 40 * 60,
    })
    setMediaLibrary([earlier])
    const today = getSchedule(channel(21), '2026-11-05')
    expect(today.blocks.some((block) => block.children.some((child) => child.videoId === 'fixtureear1'))).toBe(true)
    setMediaLibrary([
      earlier,
      item({
        id: 'net:fixture-film',
        explicitChannelIncludes: [21],
        title: 'Fixture film',
        programmeType: 'film',
        externalId: 'fixturefilm1',
        durationSeconds: 40 * 60,
      }),
    ])
    expect(getSchedule(channel(21), '2026-11-05')).toBe(today)
    const tomorrow = getSchedule(channel(21), '2026-11-06')
    expect(tomorrow.blocks.some((block) => block.children.some((child) => child.videoId === 'fixturefilm1'))).toBe(true)
    invalidateSchedule(21, '2026-11-05')
    invalidateSchedule(21, '2026-11-06')
  })

  it('replaces a day compiled before the channel had any programmes', () => {
    setMediaLibrary([])
    const empty = getSchedule(channel(21), '2026-11-07')
    expect(empty.poolSize).toBe(0)
    setMediaLibrary([
      item({
        id: 'net:fixture-film',
        explicitChannelIncludes: [21],
        title: 'Fixture film',
        programmeType: 'film',
        externalId: 'fixturefilm1',
        durationSeconds: 40 * 60,
      }),
    ])
    const refreshed = getSchedule(channel(21), '2026-11-07')
    expect(refreshed).not.toBe(empty)
    expect(refreshed.blocks.some((block) => block.children.some((child) => child.videoId === 'fixturefilm1'))).toBe(true)
    invalidateSchedule(21, '2026-11-07')
  })

  it('schedules the default network when the user library is off', () => {
    setUserLibraryMode('off')
    setMediaLibrary([
      item({
        id: 'user-match',
        title: 'Manchester United v Arsenal — Full Match',
        programmeType: 'classic-match',
        topics: ['football'],
        subjects: ['football'],
        externalId: 'usermatch01',
      }),
      item({
        id: 'net:fixture-film',
        explicitChannelIncludes: [21],
        title: 'Fixture film',
        programmeType: 'film',
        externalId: 'fixturefilm1',
        durationSeconds: 40 * 60,
      }),
    ])
    const picture = broadcast(channel(21), localStartMs('2026-11-08', '06:10'))
    expect(picture.current.programme.videoId).toBe('fixturefilm1')
    const football = getSchedule(channel(301), '2026-11-08')
    expect(football.blocks.some((block) => block.children.some((child) => child.videoId === 'usermatch01'))).toBe(false)
  })

  it('lets an allowed user library supplement a future day', () => {
    setUserLibraryMode('allow-eligible')
    setMediaLibrary([
      item({
        id: 'user-match',
        title: 'Manchester United v Arsenal — Full Match',
        programmeType: 'classic-match',
        topics: ['football'],
        subjects: ['football'],
        sport: 'football',
        externalId: 'usermatch01',
        durationSeconds: 50 * 60,
      }),
    ])
    const day = getSchedule(channel(301), '2026-11-07')
    expect(day.blocks.some((block) => block.children.some((child) => child.videoId === 'usermatch01'))).toBe(true)
  })

  it('loops one film through the day and balances two sources', () => {
    const film = item({
      id: 'net:once',
      explicitChannelIncludes: [21],
      title: 'One Feature',
      programmeType: 'film',
      externalId: 'oncefilm111',
      durationSeconds: 40 * 60,
      creator: 'Archive',
    })
    setMediaLibrary([film])
    const day = getSchedule(channel(21), '2026-11-09')
    const plays = day.blocks.flatMap((block) => block.children).filter((child) => child.videoId === 'oncefilm111')
    expect(plays.length).toBeGreaterThan(1)

    setMediaLibrary([
      item({
        id: 'net:alpha',
        explicitChannelIncludes: [21],
        title: 'Alpha Study',
        programmeType: 'documentary',
        topics: ['science'],
        subjects: ['science'],
        externalId: 'alphadoc111',
        durationSeconds: 20 * 60,
        creator: 'Alpha',
        sourceRef: 'network:alpha',
      }),
      item({
        id: 'net:beta',
        explicitChannelIncludes: [21],
        title: 'Beta Study',
        programmeType: 'documentary',
        topics: ['science'],
        subjects: ['science'],
        externalId: 'betadoc1111',
        durationSeconds: 20 * 60,
        creator: 'Beta',
        sourceRef: 'network:beta',
      }),
    ])
    invalidateSchedule(8, '2026-11-09')
    const science = getSchedule(channel(8), '2026-11-09')
    const used = science.blocks.flatMap((block) => block.children).map((child) => child.videoId)
    expect(used).toContain('alphadoc111')
    expect(used).toContain('betadoc1111')
  })
})
