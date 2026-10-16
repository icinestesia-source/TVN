import { describe, expect, it } from 'vitest'
import { applyChannelEdit } from './services/channel-editor.ts'
import type { ChannelSource } from './services/channel-sources.ts'
import type { StoredSource } from './services/channels-import.ts'
import { buildPickedExport, pickedExportFilename, serialiseTvnExport, validateTvnExport } from './services/tvn-export.ts'
import { appendPackedChannels, favouritesAfterAppend, recordsFromExport } from './services/user-network-restore.ts'

const NOW = Date.parse('2026-10-16T12:00:00Z')

const source = (ref: string): ChannelSource => ({
  id: `s-${ref}`,
  kind: 'youtube',
  url: `https://www.youtube.com/playlist?list=${ref}`,
  ref,
  youtube: 'playlist',
  label: `List ${ref}`,
  enabled: true,
  videos: [{ id: `${ref.slice(-3)}aaaaaaaa`, title: `From ${ref}`, durationSec: 1200 }],
})

const userChannel = (number: number, name: string): StoredSource =>
  applyChannelEdit(
    [{ id: `slot:${number}`, name: 'Empty channel', videos: [], channelNumber: number, inLibrary: false, automatic: true, updatedAt: 1, channelSources: [], emptySlot: true }],
    number,
    { name, sources: [source(`PL${number}xxxxxxxx`)] },
    NOW,
  )[0]

const stored = [userChannel(1001, 'One'), userChannel(1002, 'Two'), userChannel(1005, 'Five')]

describe('NETWORK export of the channels ticked', () => {
  it('packs them into a new list with no gaps, and refuses a file that names a channel it did not pack', () => {
    const file = buildPickedExport({ stored, users: [], favourites: [1001, 1002, 7], now: new Date(NOW) }, [1005, 1001, 1001])
    expect(file.picked).toEqual([1001, 1002])
    expect(file.userNetwork.channels.map((channel) => [channel.number, channel.name])).toEqual([
      [1001, 'One'],
      [1002, 'Five'],
    ])
    expect(file.favourites).toEqual([1001])
    expect(file.range).toEqual({ first: 1001, last: 1002 })
    expect(validateTvnExport(JSON.parse(serialiseTvnExport(file))).ok).toBe(true)
    expect(pickedExportFilename(new Date(NOW), file.picked ?? [])).toBe('TVN_Selection_2_2026-10-16.json')
    const extra = { ...file, userNetwork: { ...file.userNetwork, channels: [...file.userNetwork.channels, { ...file.userNetwork.channels[0], number: 1003 }] } }
    expect(validateTvnExport(extra).ok).toBe(false)
    expect(() => buildPickedExport({ stored, users: [], favourites: [], now: new Date(NOW) }, [])).toThrow(/Choose a channel/)
  })

  it('restoring adds that list after the channels already there, and leaves the ones that were not ticked', () => {
    const file = buildPickedExport({ stored, users: [], favourites: [1001], now: new Date(NOW) }, [1001, 1005])
    const restored = recordsFromExport(file.userNetwork, NOW)
    const { sources, placed } = appendPackedChannels([userChannel(1001, 'Old'), userChannel(1002, 'Stays'), userChannel(1005, 'Old five')], restored)
    expect(sources.map((record) => [record.channelNumber, record.name])).toEqual([
      [1001, 'Old'],
      [1002, 'Stays'],
      [1005, 'Old five'],
      [1006, 'One'],
      [1007, 'Five'],
    ])
    expect(placed.map((record) => record.channelNumber)).toEqual([1006, 1007])
    const fileNumbers = restored.map((record) => record.channelNumber ?? 0)
    expect(favouritesAfterAppend([1002, 7], file.favourites ?? [], fileNumbers, placed.map((record) => record.channelNumber ?? 0)).sort((a, b) => a - b)).toEqual([7, 1002, 1006])
  })
})
