import { existsSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { channelByNumber, channels, listChannels, programmesFor } from './data/catalogue.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { calculateSchedule } from './scheduler/calculate.ts'
import { mediaSeekSeconds } from './player/seek.ts'
import {
  channelsFromSources,
  parseChannelsExport,
  planImport,
  type StoredSource,
} from './services/channels-import.ts'
import { guideTuneDecision, toggleGuide } from './view/guide-mode.ts'
import { audibleTile, cycleMultiview, fillTiles, focusStep, multiviewLayout, replaceFocusedTile } from './view/multiview.ts'

const suppliedPath = '/Users/admin/Desktop/Channels.txt'

const sample = JSON.stringify({
  v: '2.4',
  channels: [
    {
      name: 'Archive Desk',
      videos: [
        { id: 'aaa111', title: 'Short Note', durationSec: 120 },
        { id: 'bbb222', title: 'The Long Film', durationSec: 14425, watched: true },
      ],
    },
    {
      name: 'Field Tape',
      videos: [
        { id: 'ccc333', title: 'Harbour', durationSec: 900 },
        { id: 'aaa111', title: 'Short Note', durationSec: 120 },
      ],
    },
  ],
})

afterEach(() => {
  installUserCatalogue([], new Map())
})

describe('sparse channel numbers', () => {
  it('names 001–060 from the manifest and fills every canonical default number', () => {
    expect(channelByNumber(60)?.name).toBe('History Mix')
    expect(channelByNumber(1)?.name).toBe('One')
    expect(channelByNumber(101)?.name).toBe('Late Feature')
    expect(channelByNumber(61)?.enabled).toBe(true)
    expect(channelByNumber(900)?.name).toBe('News')
    expect(channelByNumber(900)?.mediaKind).toBe('video')
    expect(channelByNumber(950)?.mediaKind).toBe('audio')
    expect(channelByNumber(999)?.name).toBe('Local Media 8')
    expect(channelByNumber(0)?.origin).toBe('tvn')
    expect(channelByNumber(1000)?.origin).toBe('session')
    const defaults = channels.filter((channel) => channel.number >= 1 && channel.number <= 999)
    expect(defaults).toHaveLength(999)
  })

  it('schedules a film longer than three hours on channel 101', () => {
    const feature = programmesFor('ch-101').find((programme) => programme.durationSeconds >= 3 * 60 * 60)
    expect(feature?.programmeType).toBe('film')
    expect(feature?.durationSeconds).toBe(195 * 60)
  })

  it('schedules radio on 950 with the same clock', () => {
    const channel = channelByNumber(950)
    expect(channel?.categoryId).toBe('radio')
    const programmes = programmesFor('ch-950')
    expect(programmes.every((programme) => programme.mediaKind === 'audio')).toBe(true)
    const now = Date.UTC(2026, 8, 26, 21, 0, 0)
    const snapshot = calculateSchedule({
      channelId: channel!.id,
      phaseOffsetSeconds: channel!.phaseOffsetSeconds,
      programmes,
      epochMs: Date.UTC(2020, 0, 6, 0, 0, 0),
      nowMs: now,
    })
    expect(snapshot.current.programme.durationSeconds).toBeGreaterThan(0)
    expect(snapshot.current.seekSeconds).toBeGreaterThanOrEqual(0)
    expect(snapshot.current.seekSeconds).toBeLessThan(snapshot.current.programme.durationSeconds)
  })
})

describe('channels file import', () => {
  it('parses source channels, videos, and total duration', () => {
    const parsed = parseChannelsExport(sample)
    expect(parsed.sources).toHaveLength(2)
    expect(parsed.videoCount).toBe(4)
    expect(parsed.totalSeconds).toBe(120 + 14425 + 900 + 120)
    expect(parsed.sources[0]?.id).toBe('src:archive-desk')
    expect(parsed.sources[0]?.videos[1]?.watched).toBe(true)
  })

  it('keeps one channel number when the same file is imported twice', () => {
    const parsed = parseChannelsExport(sample)
    const reserved = channels.map((channel) => channel.number)
    const first = planImport([], parsed, { library: true, automatic: true }, reserved, 1)
    const second = planImport(first.sources, parsed, { library: true, automatic: true }, reserved, 2)
    expect(first.created).toBe(2)
    expect(second.created).toBe(0)
    expect(second.updated).toBe(2)
    expect(second.sources.map((source) => source.channelNumber).sort()).toEqual(
      first.sources.map((source) => source.channelNumber).sort(),
    )
    expect(new Set(second.sources.map((source) => source.channelNumber)).size).toBe(2)
  })

  it('can store a library without creating television channels', () => {
    const parsed = parseChannelsExport(sample)
    const plan = planImport([], parsed, { library: true, automatic: false }, [], 1)
    expect(plan.libraryVideos).toBe(3)
    expect(plan.automaticChannels).toBe(0)
    expect(plan.sources.every((source) => source.channelNumber === null)).toBe(true)
    const built = channelsFromSources(plan.sources)
    expect(built.channels).toHaveLength(0)
  })

  it('turns an imported video into one linear programme of its own duration', () => {
    const parsed = parseChannelsExport(sample)
    const plan = planImport([], parsed, { library: false, automatic: true }, [1], 1)
    const built = channelsFromSources(plan.sources)
    const archive = built.channels.find((channel) => channel.name === 'Archive Desk')
    const programmes = built.programmes.get(archive!.id) ?? []
    const film = programmes.find((programme) => programme.videoId === 'bbb222')
    expect(film?.durationSeconds).toBe(14425)
    expect(film?.playbackMode).toBe('linear')
    expect(film?.source).toBe('imported')
    expect(film?.sourceRef).toBe('youtube:bbb222')
    const elapsed = 4000
    const snapshot = calculateSchedule({
      channelId: archive!.id,
      phaseOffsetSeconds: 0,
      programmes: [film!],
      epochMs: 0,
      nowMs: elapsed * 1000,
    })
    expect(snapshot.current.seekSeconds).toBe(elapsed)
    expect(mediaSeekSeconds(snapshot.current.seekSeconds, film!)).toBe(elapsed)
  })

  it('does not replace default channels with imported ones', () => {
    const parsed = parseChannelsExport(sample)
    const plan = planImport([], parsed, { library: true, automatic: true }, channels.map((channel) => channel.number), 1)
    const built = channelsFromSources(plan.sources)
    installUserCatalogue(built.channels, built.programmes)
    expect(channelByNumber(1)?.name).toBe('One')
    expect(channelByNumber(1)?.origin).toBe('default')
    const imported = listChannels().filter((channel) => channel.origin === 'user-import')
    expect(imported.length).toBe(2)
    expect(imported.every((channel) => channel.number >= 1001)).toBe(true)
    expect(programmesFor('ch-001')[0]?.source).not.toBe('imported')
  })

  it.skipIf(!existsSync(suppliedPath))('parses the supplied Channels.txt totals when that file is present', () => {
    const parsed = parseChannelsExport(readFileSync(suppliedPath, 'utf8'))
    expect(parsed.sources).toHaveLength(58)
    expect(parsed.videoCount).toBe(977)
    expect(parsed.totalSeconds / 3600).toBeCloseTo(375.8, 0)
  })
})

describe('guide and multiview state', () => {
  it('opens and closes the guide without the schedule being an input', () => {
    const channel = channelByNumber(1)!
    const programmes = programmesFor(channel.id)
    const nowMs = Date.UTC(2026, 8, 26, 18, 15, 0)
    const before = calculateSchedule({
      channelId: channel.id,
      phaseOffsetSeconds: channel.phaseOffsetSeconds,
      programmes,
      epochMs: Date.UTC(2020, 0, 6, 0, 0, 0),
      nowMs,
    })
    expect(toggleGuide('closed')).toBe('expanded')
    expect(toggleGuide('integrated')).toBe('closed')
    expect(toggleGuide('expanded')).toBe('closed')
    const after = calculateSchedule({
      channelId: channel.id,
      phaseOffsetSeconds: channel.phaseOffsetSeconds,
      programmes,
      epochMs: Date.UTC(2020, 0, 6, 0, 0, 0),
      nowMs,
    })
    expect(after.current.seekSeconds).toBe(before.current.seekSeconds)
    expect(after.current.programme.id).toBe(before.current.programme.id)
  })

  it('does not tune a programme that has not started', () => {
    expect(guideTuneDecision(1_000, 2_000, 500)).toBe('later')
    expect(guideTuneDecision(1_000, 2_000, 1_500)).toBe('tune')
    expect(guideTuneDecision(1_000, 2_000, 2_500)).toBe('ended')
  })

  it('keeps one audible tile and restores the focused channel', () => {
    const ordered = [1, 2, 3, 4, 101, 900]
    expect(cycleMultiview('1')).toBe('2')
    expect(cycleMultiview('9')).toBe('1')
    const dual = fillTiles(3, ordered, 2)
    expect(dual[0]).toBe(3)
    expect(audibleTile(0, dual.length).filter(Boolean)).toHaveLength(1)
    const focus = focusStep(0, 1, dual.length)
    expect(audibleTile(focus, dual.length)).toEqual([false, true])
    const swapped = replaceFocusedTile(dual, focus, 101)
    expect(swapped[focus]).toBe(101)
    expect(new Set(swapped).size).toBe(swapped.length)
    const restored = swapped[focus]
    const single = fillTiles(restored, ordered, 1)
    expect(single).toEqual([restored])
    const nowMs = Date.UTC(2026, 8, 26, 12, 0, 0)
    const channel = channelByNumber(restored)!
    const snap = calculateSchedule({
      channelId: channel.id,
      phaseOffsetSeconds: channel.phaseOffsetSeconds,
      programmes: programmesFor(channel.id),
      epochMs: Date.UTC(2020, 0, 6, 0, 0, 0),
      nowMs,
    })
    const again = calculateSchedule({
      channelId: channel.id,
      phaseOffsetSeconds: channel.phaseOffsetSeconds,
      programmes: programmesFor(channel.id),
      epochMs: Date.UTC(2020, 0, 6, 0, 0, 0),
      nowMs,
    })
    expect(again.current.seekSeconds).toBe(snap.current.seekSeconds)
  })

  it('pages nine channels on a phone and stacks dual view', () => {
    expect(multiviewLayout('2', 390)).toEqual({ columns: 1, pageSize: 2, stacked: true })
    expect(multiviewLayout('2', 1280)).toEqual({ columns: 2, pageSize: 2, stacked: false })
    expect(multiviewLayout('4', 390).columns).toBe(2)
    const phone = multiviewLayout('9', 390)
    expect(phone.columns).toBe(2)
    expect(phone.pageSize).toBeLessThanOrEqual(4)
    expect(multiviewLayout('9', 1440).pageSize).toBe(9)
    const nine = fillTiles(1, listChannels().map((channel) => channel.number), 9)
    expect(nine).toHaveLength(9)
  })
})

describe('stored source shape', () => {
  it('round-trips a source record without touching default ids', () => {
    const stored: StoredSource = {
      id: 'src:archive-desk',
      name: 'Archive Desk',
      videos: [{ id: 'bbb222', title: 'The Long Film', durationSec: 14425 }],
      channelNumber: 701,
      inLibrary: true,
      automatic: true,
      updatedAt: 1,
    }
    const built = channelsFromSources([stored])
    expect(built.channels[0]?.id).toBe('user-src:archive-desk')
    expect(channels.some((channel) => channel.id.startsWith('user-'))).toBe(false)
  })
})
