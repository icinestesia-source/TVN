import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calculateSchedule } from './scheduler/calculate.ts'
import { SCHEDULE_EPOCH_MS } from './scheduler/epoch.ts'
import { channelsFromSources, streamTurnPhase } from './services/channels-import.ts'
import { STREAM_SLOT_DEFAULT, streamRotationOf, streamSlotOf, type ChannelSource } from './services/channel-sources.ts'
import { rescanSummary } from './services/channel-editor.ts'
import { exportSource } from './services/user-network-export.ts'
import { channelSource } from './services/user-network-restore.ts'

const stream = (id: string, url: string, slotSeconds?: number, enabled = true): ChannelSource => ({
  id,
  kind: 'audio',
  url,
  label: `Station ${id}`,
  enabled,
  ...(slotSeconds ? { slotSeconds } : {}),
})

const build = (sources: ChannelSource[]) =>
  channelsFromSources([{ id: 'radio-mix', name: 'Radio Mix', videos: [], channelNumber: 1001, inLibrary: false, automatic: true, updatedAt: 1, channelSources: sources }])

describe('A channel of several radio streams takes turns on the clock', () => {
  it('two or more enabled streams take turns, an hour each unless set; one stream still carries the channel live', () => {
    expect(streamRotationOf([stream('a', 'https://a.example/live')])).toEqual([])
    expect(streamRotationOf([stream('a', 'https://a.example/live'), stream('b', 'https://b.example/live', 1800, false)])).toEqual([])
    const turns = streamRotationOf([stream('a', 'https://a.example/live'), stream('b', 'https://b.example/live', 1800)])
    expect(turns.map((turn) => [turn.source.id, turn.seconds, turn.media])).toEqual([
      ['a', STREAM_SLOT_DEFAULT, 'audio'],
      ['b', 1800, 'audio'],
    ])
    expect(streamSlotOf({ slotSeconds: 30 })).toBe(STREAM_SLOT_DEFAULT)
    expect(streamSlotOf({ slotSeconds: 7 * 3600 })).toBe(STREAM_SLOT_DEFAULT)
  })

  it('builds a scheduled radio channel whose programmes are the streams, each for its turn', () => {
    const built = build([stream('a', 'https://a.example/live'), stream('b', 'https://b.example/live')])
    const channel = built.channels[0]
    expect(channel.playbackType).toBeUndefined()
    expect(channel.mediaKind).toBe('audio')
    expect(channel.phaseOffsetSeconds).toBe(streamTurnPhase())
    const programmes = built.programmes.get(channel.id) ?? []
    expect(programmes.map((programme) => [programme.title, programme.durationSeconds, programme.liveStream?.url])).toEqual([
      ['Station a', 3600, 'https://a.example/live'],
      ['Station b', 3600, 'https://b.example/live'],
    ])
    expect(programmes.every((programme) => programme.playback === 'live' && programme.programmeType === 'radio')).toBe(true)
  })

  it('hour-long turns change on the hour, the first stream from local midnight', () => {
    const built = build([stream('a', 'https://a.example/live'), stream('b', 'https://b.example/live'), stream('c', 'https://c.example/live')])
    const channel = built.channels[0]
    const programmes = built.programmes.get(channel.id) ?? []
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    const at = (hours: number, minutes = 0) =>
      calculateSchedule({ channelId: channel.id, phaseOffsetSeconds: streamTurnPhase(midnight.getTime()), programmes, epochMs: SCHEDULE_EPOCH_MS, nowMs: midnight.getTime() + (hours * 60 + minutes) * 60_000 }).current
    expect(at(0, 1).programme.title).toBe('Station a')
    expect(at(1, 0).programme.title).toBe('Station b')
    expect(at(2, 59).programme.title).toBe('Station c')
    expect(at(3, 0).programme.title).toBe('Station a')
    expect(at(1, 30).startMs).toBe(midnight.getTime() + 3600_000)
  })

  it('one stream alone stays a continuous live channel', () => {
    expect(build([stream('a', 'https://a.example/live')]).channels[0].playbackType).toBe('live-stream')
  })

  it('a stream keeps its turn length through a User Network export and restore', () => {
    const saved = exportSource(stream('b', 'https://b.example/live', 1800), () => null)
    expect(saved.slotSeconds).toBe(1800)
    expect(channelSource(saved, 1).slotSeconds).toBe(1800)
  })

  it('a rescan reports the streams taking turns', () => {
    expect(rescanSummary([{ ...stream('a', 'https://a.example/live'), status: { state: 'online', checkedAt: 1 } }, stream('b', 'https://b.example/live')])).toBe('RESCANNED · 2 STREAMS TAKING TURNS · 1 ONLINE')
  })

  it('EDIT Channel sets each stream’s turn and its place in the round', () => {
    const editor = readFileSync('src/components/ChannelEditor.tsx', 'utf8')
    expect(editor).toContain('<StreamSlot')
    expect(editor).toContain('setSource(source.id, { slotSeconds: seconds })')
    expect(editor).toContain('streamEarlier(edit.sources, source.id)')
  })
})
