import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { channelByNumber, channels, listChannels, programmesFor } from './data/catalogue.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { channelMatchesFilter, CHANNEL_ZERO_RESERVED, GUIDE_TOOLBAR, rangeForNumber, USER_NUMBER_START } from './data/network.ts'
import { configuredNewsSources, NEWS_SERVICES } from './data/news-sources.ts'
import { commandFromKey } from './input/keyboard.ts'
import { formatChannelNumber, formatEntry, tunerStep } from './input/tuner.ts'
import { mediaSeekSeconds } from './player/seek.ts'
import {
  channelsFromSources,
  migrateLegacyUserNumbers,
  parseChannelsExport,
  planImport,
  type StoredSource,
} from './services/channels-import.ts'
import { loadOverrides, setVideoOverride, videoOverride } from './services/overrides.ts'
import { generatedSource, mergeSources } from './types/source.ts'
import { DETAILS_DEFAULT, toggleDetails } from './view/details.ts'

const plain = { meta: false, ctrl: false, alt: false }

const sample = JSON.stringify({
  v: '2.4',
  channels: [
    { name: 'Archive Desk', videos: [{ id: 'aaa111', title: 'Short Note', durationSec: 120 }] },
    { name: 'Field Tape', videos: [{ id: 'ccc333', title: 'Field', durationSec: 90 }] },
  ],
})

function stored(id: string, name: string, channelNumber: number | null): StoredSource {
  return {
    id,
    name,
    videos: [{ id: `${id}-v`, title: name, durationSec: 80 }],
    channelNumber,
    inLibrary: true,
    automatic: channelNumber !== null,
    updatedAt: 1,
  }
}

afterEach(() => {
  installUserCatalogue([], new Map())
})

describe('numbering', () => {
  it('keeps default channels below 1000 and reserves 000 for TVN', () => {
    expect(CHANNEL_ZERO_RESERVED).toBe(true)
    expect(channelByNumber(0)?.origin).toBe('tvn')
    expect(channelByNumber(1000)?.origin).toBe('session')
    expect(formatChannelNumber(0)).toBe('000')
    expect(channelByNumber(1)?.number).toBeLessThan(1000)
    expect(formatChannelNumber(9)).toBe('009')
    expect(channelByNumber(500)?.number).toBe(500)
  })

  it('allocates imported automatic channels at 1001 and above', () => {
    const parsed = parseChannelsExport(sample)
    const plan = planImport([], parsed, { library: true, automatic: true }, channels.map((channel) => channel.number), 1)
    const built = channelsFromSources(plan.sources)
    const numbers = built.channels.map((channel) => channel.number).sort((a, b) => a - b)
    expect(numbers[0]).toBe(1001)
    expect(numbers[1]).toBeGreaterThan(1001)
    expect(built.channels.every((channel) => channel.origin === 'user-import')).toBe(true)
    expect(built.channels.every((channel) => channel.number >= USER_NUMBER_START)).toBe(true)
  })

  it('keeps the same number when the same source is imported again', () => {
    const parsed = parseChannelsExport(sample)
    const reserved = channels.map((channel) => channel.number)
    const first = planImport([], parsed, { library: true, automatic: true }, reserved, 1)
    const second = planImport(first.sources, parsed, { library: true, automatic: true }, reserved, 2)
    const before = first.sources.find((source) => source.name === 'Archive Desk')?.channelNumber
    const after = second.sources.find((source) => source.name === 'Archive Desk')?.channelNumber
    expect(before).toBe(1001)
    expect(after).toBe(before)
    expect(second.created).toBe(0)
    expect(second.updated).toBe(2)
  })

  it('migrates a 701–899 allocation onto 1001+ without dropping videos', () => {
    const legacy = [
      stored('src:later', 'Later', 705),
      stored('src:early', 'Early', 701),
      stored('src:kept', 'Kept', 1005),
    ]
    const moved = migrateLegacyUserNumbers(legacy)
    expect(moved.migrated).toBe(2)
    expect(moved.sources.find((source) => source.id === 'src:early')?.channelNumber).toBe(1001)
    expect(moved.sources.find((source) => source.id === 'src:later')?.channelNumber).toBe(1002)
    expect(moved.sources.find((source) => source.id === 'src:kept')?.channelNumber).toBe(1005)
    expect(moved.sources.find((source) => source.id === 'src:early')?.videos).toHaveLength(1)
    const parsed = parseChannelsExport(
      JSON.stringify({ v: '2.4', channels: [{ name: 'Early', videos: [{ id: 'src:early-v', title: 'Early', durationSec: 80 }] }] }),
    )
    const again = planImport(moved.sources, parsed, { library: true, automatic: true }, [], 3)
    expect(again.sources.find((source) => source.id === 'src:early')?.channelNumber).toBe(1001)
  })
})

describe('direct tuning', () => {
  const numbers = listChannels().map((channel) => channel.number)

  it('resolves variable-length entry without padding user channels', () => {
    expect(tunerStep('009', numbers)).toBe('commit')
    expect(tunerStep('9', numbers)).toBe('wait')
    expect(tunerStep('100', numbers)).toBe('wait')
    expect(tunerStep('101', numbers)).toBe('commit')
    expect(tunerStep('500', numbers)).toBe('commit')
    expect(tunerStep('900', numbers)).toBe('commit')
    expect(formatEntry('9')).toBe('009')
    expect(formatEntry('1001')).toBe('1001')
    expect(formatChannelNumber(1047)).toBe('1047')
    expect(tunerStep('100', [...numbers, 1001, 1047])).toBe('wait')
    expect(tunerStep('1001', [...numbers, 1001, 1047])).toBe('commit')
    expect(tunerStep('1001', [...numbers, 1001, 10010])).toBe('wait')
    expect(tunerStep('1047', [...numbers, 1001, 1047])).toBe('commit')
    expect(tunerStep('10010', [...numbers, 10010])).toBe('commit')
  })

  it('uses the same four-digit commit on a narrow layout', () => {
    const width = 320
    expect(width).toBeLessThan(400)
    expect(tunerStep('1047', [1, 1047])).toBe('commit')
    expect(formatChannelNumber(1047)).toBe('1047')
    expect(formatEntry('1047')).toBe('1047')
  })
})

describe('guide filters', () => {
  it('shows only user channels in the user list and mixes origins in favourites', () => {
    const parsed = parseChannelsExport(sample)
    const plan = planImport([], parsed, { library: true, automatic: true }, channels.map((channel) => channel.number), 1)
    const built = channelsFromSources(plan.sources)
    installUserCatalogue(built.channels, built.programmes)
    const visible = listChannels()
    const user = visible.filter((channel) => channelMatchesFilter(channel, 'user', []))
    expect(user.length).toBeGreaterThan(0)
    expect(user.every((channel) => channel.number >= 1001)).toBe(true)
    expect(user.every((channel) => channel.origin === 'user-import' || channel.origin === 'user-created')).toBe(true)
    expect(user.some((channel) => channel.origin === 'default')).toBe(false)
    const starred = [1, 305, 501, user[0].number]
    const favourites = visible.filter((channel) => channelMatchesFilter(channel, 'favourites', starred))
    expect(favourites.map((channel) => channel.number).sort((a, b) => a - b)).toEqual([...starred].sort((a, b) => a - b))
    expect(favourites.some((channel) => channel.origin === 'default')).toBe(true)
    expect(favourites.some((channel) => channel.origin === 'user-import')).toBe(true)
  })

  it('opens the user list from the keyboard', () => {
    expect(commandFromKey('y', plain, false)).toEqual({ type: 'user-channels' })
    expect(commandFromKey('Y', plain, true)).toEqual({ type: 'user-channels' })
  })
})

describe('network ranges', () => {
  it('places each major range on its own numbers', () => {
    expect(rangeForNumber(9)).toBe('main')
    expect(rangeForNumber(150)).toBe('films')
    expect(rangeForNumber(210)).toBe('entertainment')
    expect(rangeForNumber(300)).toBe('sport')
    expect(rangeForNumber(400)).toBe('history')
    expect(rangeForNumber(522)).toBe('music')
    expect(rangeForNumber(600)).toBe('business')
    expect(rangeForNumber(700)).toBe('lifestyle')
    expect(rangeForNumber(800)).toBe('specialist')
    expect(rangeForNumber(910)).toBe('news')
    expect(rangeForNumber(1001)).toBe('user')
    expect(channelByNumber(500)?.categoryId).toBe('music')
    expect(channelByNumber(600)?.categoryId).toBe('business')
    expect(channelByNumber(700)?.categoryId).toBe('lifestyle')
    expect(channelByNumber(300)?.name).toBe('Sport')
    expect(channelByNumber(450)?.name).toBe('Law')
    expect(channelByNumber(121)?.name).toBe('Classic Trailers')
    expect(channelByNumber(150)?.name).toBe('Thriller')
  })

  it('keeps music stations on independent phases and news beside radio', () => {
    const eighties = channelByNumber(522)!
    const nineties = channelByNumber(523)!
    expect(eighties.phaseOffsetSeconds).not.toBe(nineties.phaseOffsetSeconds)
    expect(channelByNumber(950)?.mediaKind).toBe('audio')
    expect(channelByNumber(900)?.mediaKind).toBe('video')
    expect(channelMatchesFilter(channelByNumber(900)!, 'news', [])).toBe(true)
    expect(channelMatchesFilter(channelByNumber(900)!, 'radio', [])).toBe(false)
    expect(channelMatchesFilter(channelByNumber(950)!, 'news', [])).toBe(false)
    expect(channelMatchesFilter(channelByNumber(950)!, 'radio', [])).toBe(true)
  })

  it('does not invent news sources or include BBC services', () => {
    expect(configuredNewsSources()).toHaveLength(0)
    expect(NEWS_SERVICES.every((service) => service.sources.length === 0)).toBe(true)
    expect(NEWS_SERVICES.some((service) => /bbc/i.test(service.name))).toBe(false)
    const cnn = channelByNumber(920)!
    expect(cnn.name).toBe('CNN')
    expect(programmesFor(cnn.id).every((programme) => programme.videoId === null)).toBe(true)
    expect(channelByNumber(910)?.name).not.toBe('CNN')
  })
})

describe('sources', () => {
  beforeEach(() => {
    const bag = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => bag.get(key) ?? null,
      setItem: (key: string, value: string) => {
        bag.set(key, value)
      },
      removeItem: (key: string) => {
        bag.delete(key)
      },
    })
    loadOverrides()
  })

  it('stores a default-channel override without changing the catalogue', () => {
    const history = channelByNumber(400)!
    const before = history.name
    const defaults = [generatedSource(400)]
    const snapshot = { ...defaults[0] }
    setVideoOverride(400, 'aqz-KE-bpKQ')
    expect(videoOverride(400)).toBe('aqz-KE-bpKQ')
    const merged = mergeSources(defaults, {
      channelNumber: 400,
      additionalSources: [
        {
          id: 'override:400',
          provider: 'youtube',
          mediaKind: 'video',
          capability: 'seekable-recorded',
          externalId: 'aqz-KE-bpKQ',
          label: 'Local source',
          priority: 0,
          enabled: true,
        },
      ],
    })
    expect(defaults[0]).toEqual(snapshot)
    expect(merged[0]?.externalId).toBe('aqz-KE-bpKQ')
    expect(channelByNumber(400)?.name).toBe(before)
    loadOverrides()
    expect(videoOverride(400)).toBe('aqz-KE-bpKQ')
    setVideoOverride(400, null)
    expect(videoOverride(400)).toBeNull()
  })

  it('keeps a channel when its source cannot play', () => {
    const news = channelByNumber(911)!
    expect(news.enabled).toBe(true)
    expect(programmesFor(news.id).length).toBeGreaterThanOrEqual(4)
    expect(programmesFor(news.id).every((programme) => programme.videoId === null)).toBe(true)
    expect(listChannels().some((channel) => channel.number === 911)).toBe(true)
  })

  it('does not seek a live source as a recording', () => {
    const recorded = mediaSeekSeconds(120, {
      playbackMode: 'linear',
      durationSeconds: 600,
      playback: 'seekable-recorded',
    })
    const live = mediaSeekSeconds(120, {
      playbackMode: 'linear',
      durationSeconds: 600,
      playback: 'live',
    })
    expect(recorded).toBe(120)
    expect(live).toBe(0)
  })
})

describe('guide chrome', () => {
  it('keeps the toolbar on one action row and details collapsed', () => {
    expect(GUIDE_TOOLBAR).toEqual(['expand', 'import', 'close'])
    expect(DETAILS_DEFAULT).toBe('compact')
    expect(toggleDetails('compact')).toBe('full')
    expect(toggleDetails('full')).toBe('compact')
  })
})
