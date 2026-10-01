import { afterEach, describe, expect, it } from 'vitest'
import { installUserCatalogue, userChannelList, userProgrammesFor } from '../data/user-overlay.ts'
import { getEligibleMedia } from './query.ts'
import { schedulingPool, setUserLibraryMode } from './mode.ts'
import { ingestParsed, librarySnapshot, resetLibraryForTests } from './store.ts'
import { resetDirector } from '../director/director.ts'
import { createYouTubeMetadataProbe, youtubePlayerFailure, type YoutubeMetadataProbe } from '../player/youtube-metadata.ts'
import { resolveDiscoveryRecords, type DiscoveryRecord } from './youtube-resolve.ts'

afterEach(() => {
  installUserCatalogue([], new Map())
  resetLibraryForTests()
  resetDirector()
})

function record(partial: Pick<DiscoveryRecord, 'providerItemId'> & Partial<DiscoveryRecord>): DiscoveryRecord {
  return {
    provider: 'youtube',
    sourceId: 'src_nfb',
    title: 'Archive reel',
    eligibleChannels: [19, 20],
    ...partial,
  }
}

function probe(resolve: YoutubeMetadataProbe['resolve']): YoutubeMetadataProbe {
  return { resolve }
}

describe('youtube discovery resolver', () => {
  it('promotes a resolved YouTube ID into a playable library record', async () => {
    const result = await resolveDiscoveryRecords([record({ providerItemId: 'goodVideo01' })], {
      probes: [probe(async () => ({ ok: true, durationSec: 95.2 }))],
      now: 50,
    })
    const item = librarySnapshot().media.find((entry) => entry.externalId === 'goodVideo01')
    expect(result.added).toBe(1)
    expect(result.errors).toEqual([])
    expect(item?.provider).toBe('youtube')
    expect(item?.providerItemId).toBe('goodVideo01')
    expect(item?.title).toBe('Archive reel')
    expect(item?.durationSec).toBe(95)
    expect(item?.durationSeconds).toBe(95)
    expect(item?.availability).toBe('available')
    expect(item?.id).toBe('yt:goodVideo01')
    expect(schedulingPool(librarySnapshot().media).map((entry) => entry.externalId)).toEqual(['goodVideo01'])
    setUserLibraryMode('off')
    expect(schedulingPool(librarySnapshot().media).map((entry) => entry.externalId)).toEqual(['goodVideo01'])
    expect(getEligibleMedia(schedulingPool(librarySnapshot().media), 20).map((entry) => entry.externalId)).toEqual(['goodVideo01'])
    expect(getEligibleMedia(schedulingPool(librarySnapshot().media), 21)).toHaveLength(0)
  })

  it('does not promote an unavailable or rejected video', async () => {
    expect(youtubePlayerFailure(100)).toBe('video unavailable')
    expect(youtubePlayerFailure(101)).toBe('embedding disabled')
    expect(youtubePlayerFailure(150)).toBe('embedding disabled')
    expect(youtubePlayerFailure(2)).toBe('invalid video id')
    expect(youtubePlayerFailure(5)).toBe('player error')
    const result = await resolveDiscoveryRecords(
      [record({ providerItemId: 'badVideo001' }), record({ providerItemId: 'embedVideo1' })],
      {
        probes: [
          probe(async (id) => ({ ok: false, reason: id === 'embedVideo1' ? 'embedding disabled' : 'video unavailable' })),
        ],
        now: 51,
      },
    )
    expect(librarySnapshot().media).toHaveLength(0)
    expect(result.added).toBe(0)
    expect(result.errors).toEqual(['badVideo001: video unavailable', 'embedVideo1: embedding disabled'])
  })

  it('does not promote a zero or invalid duration', async () => {
    const result = await resolveDiscoveryRecords(
      [record({ providerItemId: 'zeroVideo01' }), record({ providerItemId: 'nanVideo001' }), record({ providerItemId: 'infVideo001' })],
      {
        probes: [
          probe(async (id) => {
            if (id === 'nanVideo001') return { ok: true, durationSec: Number.NaN }
            if (id === 'infVideo001') return { ok: true, durationSec: Number.POSITIVE_INFINITY }
            return { ok: true, durationSec: 0 }
          }),
        ],
        now: 52,
      },
    )
    expect(librarySnapshot().media).toHaveLength(0)
    expect(result.errors).toEqual([
      'zeroVideo01: duration unavailable',
      'nanVideo001: duration unavailable',
      'infVideo001: duration unavailable',
    ])
  })

  it('preserves the supplied source id', async () => {
    await resolveDiscoveryRecords([record({ providerItemId: 'goodVideo01', sourceId: 'src_british_pathe' })], {
      probes: [probe(async () => ({ ok: true, durationSec: 40 }))],
      now: 53,
    })
    const item = librarySnapshot().media[0]
    expect(item?.sourceId).toBe('src_british_pathe')
    expect(item?.memberships).toEqual([{ sourceId: 'src_british_pathe', sourceName: 'British Pathé', present: true }])
    expect(librarySnapshot().sources.find((source) => source.id === 'src_british_pathe')?.mediaCount).toBe(1)
  })

  it('preserves the supplied channel eligibility', async () => {
    await resolveDiscoveryRecords([record({ providerItemId: 'goodVideo01', eligibleChannels: [19, 20, 19] })], {
      probes: [probe(async () => ({ ok: true, durationSec: 40 }))],
      now: 54,
    })
    const item = librarySnapshot().media[0]
    expect(item?.eligibleChannels).toEqual([19, 20])
    expect(item?.explicitChannelIncludes).toEqual([19, 20])
    expect(getEligibleMedia([item!], 64)).toHaveLength(0)
  })

  it('keeps one library record for a duplicate YouTube ID', async () => {
    const result = await resolveDiscoveryRecords(
      [record({ providerItemId: 'dupVideo001', title: 'First title' }), record({ providerItemId: 'dupVideo001', title: 'Second title' })],
      {
        probes: [probe(async () => ({ ok: true, durationSec: 80 }))],
        now: 55,
      },
    )
    expect(librarySnapshot().media).toHaveLength(1)
    expect(result.added).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.duplicatesMerged).toBe(1)
    expect(librarySnapshot().media[0]?.title).toBe('Second title')
    expect(librarySnapshot().media[0]?.externalId).toBe('dupVideo001')
  })

  it('continues a batch after one item fails and saves the successes already resolved', async () => {
    const seen: string[][] = []
    const result = await resolveDiscoveryRecords(
      [record({ providerItemId: 'goodVideo01' }), record({ providerItemId: 'badVideo001' }), record({ providerItemId: 'nextVideo01', title: 'Second reel' })],
      {
        probes: [
          probe(async (id) => {
            seen.push(librarySnapshot().media.map((entry) => entry.externalId))
            if (id === 'badVideo001') return { ok: false, reason: 'video unavailable' }
            return { ok: true, durationSec: id === 'nextVideo01' ? 70 : 40 }
          }),
        ],
        now: 56,
      },
    )
    expect(seen[2]).toEqual(['goodVideo01'])
    expect(result.errors).toEqual(['badVideo001: video unavailable'])
    expect(result.added).toBe(2)
    expect(librarySnapshot().media.map((entry) => entry.externalId)).toEqual(['goodVideo01', 'nextVideo01'])
  })

  it('leaves user channels and user-network media unchanged', async () => {
    installUserCatalogue(
      [
        {
          id: 'user-1001',
          number: 1001,
          name: 'Argyle',
          shortName: 'ARG',
          description: 'User channel',
          logo: 'AR',
          color: '#234',
          category: 'Sport',
          enabled: true,
          sources: [],
          scheduleMode: 'loop',
          phaseOffsetSeconds: 0,
          origin: 'user-import',
        },
      ],
      new Map([
        [
          'user-1001',
          [
            {
              id: 'user-programme',
              title: 'User programme',
              description: '',
              videoId: 'userVideo01',
              durationSeconds: 600,
              channelId: 'user-1001',
              category: 'Sport',
              source: 'imported',
              kind: 'programme',
              playbackMode: 'linear',
            },
          ],
        ],
      ]),
    )
    await ingestParsed(
      {
        version: '2.4',
        videoCount: 1,
        totalSeconds: 600,
        watchedCount: 0,
        warnings: [],
        sources: [{ id: 'src:user', name: 'Argyle', videos: [{ id: 'userVideo01', title: 'User programme', durationSec: 600 }] }],
      },
      { filename: 'Channels.txt', now: 60 },
    )
    const beforeChannels = userChannelList().map((channel) => channel.number)
    const beforeProgrammes = userProgrammesFor('user-1001')?.map((programme) => programme.videoId)
    const result = await resolveDiscoveryRecords(
      [
        record({ providerItemId: 'userVideo01', title: 'Should not replace', eligibleChannels: [19] }),
        record({ providerItemId: 'goodVideo01', title: 'Independent reel', eligibleChannels: [19] }),
      ],
      {
        probes: [probe(async () => ({ ok: true, durationSec: 33 }))],
        now: 61,
      },
    )
    const user = librarySnapshot().media.find((entry) => entry.externalId === 'userVideo01')
    const independent = librarySnapshot().media.find((entry) => entry.externalId === 'goodVideo01')
    expect(beforeChannels).toEqual([1001])
    expect(userChannelList().map((channel) => channel.number)).toEqual(beforeChannels)
    expect(userProgrammesFor('user-1001')?.map((programme) => programme.videoId)).toEqual(beforeProgrammes)
    expect(user?.title).toBe('User programme')
    expect(user?.provenance).toBe('user-imported')
    expect(user?.durationSeconds).toBe(600)
    expect(independent?.sourceId).toBe('src_nfb')
    expect(independent?.eligibleChannels).toEqual([19])
    expect(result.unchanged).toBe(1)
    expect(result.added).toBe(1)
    expect(schedulingPool(librarySnapshot().media).map((entry) => entry.externalId)).toEqual(['goodVideo01'])
    expect(librarySnapshot().media.filter((entry) => entry.externalId === 'userVideo01')).toHaveLength(1)
  })

  it('uses a player title only when the discovery record has none', async () => {
    const titled = await resolveDiscoveryRecords([record({ providerItemId: 'goodVideo01', title: undefined })], {
      probes: [probe(async () => ({ ok: true, durationSec: 12, title: 'Player title' }))],
      now: 62,
    })
    expect(titled.added).toBe(1)
    expect(librarySnapshot().media[0]?.title).toBe('Player title')
    resetLibraryForTests()
    const blank = await resolveDiscoveryRecords([record({ providerItemId: 'goodVideo01', title: '   ' })], {
      probes: [probe(async () => ({ ok: true, durationSec: 12 }))],
      now: 63,
    })
    expect(blank.added).toBe(0)
    expect(blank.errors).toEqual(['goodVideo01: title unavailable'])
    expect(librarySnapshot().media).toHaveLength(0)
  })

  it('does not promote when the official player cannot be created', async () => {
    const metadata = createYouTubeMetadataProbe()
    const result = await resolveDiscoveryRecords([record({ providerItemId: 'goodVideo01' })], {
      probes: [metadata],
      now: 64,
    })
    metadata.close?.()
    expect(result.added).toBe(0)
    expect(result.errors).toEqual(['goodVideo01: player unavailable'])
    expect(librarySnapshot().media).toHaveLength(0)
  })
})
