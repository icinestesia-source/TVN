import { describe, expect, it } from 'vitest'
import { setNetworkBase } from './data/user-overlay.ts'
import { channels, shippedProgrammes } from './data/catalogue.ts'
import { applyChannelEdit } from './services/channel-editor.ts'
import type { ChannelSource } from './services/channel-sources.ts'
import type { StoredSource } from './services/channels-import.ts'
import { saveCuratedEdit, tvnSource } from './services/curated-edits.ts'
import { buildRangeExport, rangeExportFilename, readRestoreFile, serialiseTvnExport, validateTvnExport, type TvnExport } from './services/tvn-export.ts'
import {
  favouritesAfterRangeRestore,
  recordsFromExport,
  restoreChannelRange,
  usersAfterRangeRestore,
} from './services/user-network-restore.ts'

const NOW = Date.parse('2026-10-14T12:00:00Z')

const memoryStore = () => {
  const memory = new Map<string, string>()
  return { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) }
}

const shipped = channels.find((channel) => channel.number <= 999 && shippedProgrammes(channel.id).length >= 2)!
const ids = shippedProgrammes(shipped.id).map((programme) => programme.id)

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

const curated = () => saveCuratedEdit(shipped, { name: 'My version', sources: [tvnSource(), source('PLcuratedxxxx')] }, NOW, memoryStore(), ids)!

const build = (from: number, to: number) =>
  buildRangeExport(
    {
      stored: [userChannel(1001, 'One'), userChannel(1002, 'Two'), userChannel(1005, 'Five')],
      users: [{ id: 'u1', name: 'Ann' }],
      favourites: [shipped.number, 1001, 1005],
      now: new Date(NOW),
      curated: [curated()],
      shippedOf: () => shippedProgrammes(shipped.id),
    },
    from,
    to,
  )

describe('channel range export', () => {
  it('holds only the channels, curation and Favourites numbered inside the range, with their sources', () => {
    const file = build(1002, 1000)
    expect(file.range).toEqual({ first: 1000, last: 1002 })
    expect(file.userNetwork.channels.map((channel) => [channel.number, channel.name])).toEqual([
      [1001, 'One'],
      [1002, 'Two'],
    ])
    expect(file.userNetwork.channels[0].sources[0].url).toContain('PL1001xxxxxxxx')
    expect(file.central?.overrides).toEqual([])
    expect(file.favourites).toEqual([1001])
    expect(file.settings).toEqual({})
    expect(file.guides).toBeUndefined()
    expect(file.manifests.map((manifest) => manifest.channel.number)).toEqual([1001, 1002])
  })

  it('carries a curated TVN channel in a low range, such as 950 to 970', () => {
    const file = build(shipped.number, shipped.number)
    expect(file.userNetwork.channels).toEqual([])
    expect(file.central?.overrides.map((override) => [override.number, override.name])).toEqual([[shipped.number, 'My version']])
    expect(file.central?.overrides[0].sources.some((item) => item.url?.includes('PLcuratedxxxx'))).toBe(true)
    expect(file.favourites).toEqual([shipped.number])
  })

  it('reads back as a range file, and refuses one holding a channel outside its range', () => {
    const file = build(1001, 1002)
    const read = readRestoreFile(serialiseTvnExport(file))
    expect(read.kind).toBe('complete')
    expect(read.ok && read.kind === 'complete' && read.value.range).toEqual({ first: 1001, last: 1002 })
    const widened = { ...file, favourites: [1001, 1005] }
    const checked = validateTvnExport(JSON.parse(JSON.stringify(widened)))
    expect(checked.ok).toBe(false)
    expect(!checked.ok && checked.errors[0]).toContain('1005')
    expect(validateTvnExport({ ...file, range: { first: 9, last: 2 } }).ok).toBe(false)
  })

  it('names the file by its range', () => {
    expect(rangeExportFilename(new Date(NOW), { first: 950, last: 970 })).toBe('TVN_Channels_0950-0970_2026-10-14.json')
  })
})

describe('channel range restore', () => {
  it('makes the numbers inside the range exactly the file’s and leaves every other channel alone', () => {
    const file = build(1001, 1002)
    const restored = recordsFromExport(file.userNetwork, NOW)
    const existing = [userChannel(1002, 'Changed since'), userChannel(1003, 'Only here, cleared'), userChannel(1005, 'Outside')]
    const next = restoreChannelRange(existing, restored, { first: 1001, last: 1003 })
    expect(next.map((record) => [record.channelNumber, record.name]).sort()).toEqual([
      [1001, 'One'],
      [1002, 'Two'],
      [1005, 'Outside'],
    ])
  })

  it('keeps Favourites and users outside the range', () => {
    expect(favouritesAfterRangeRestore([5, 1002, 1005], [1001], { first: 1001, last: 1003 }).sort((a, b) => a - b)).toEqual([5, 1001, 1005])
    const file = build(1001, 1002)
    expect(usersAfterRangeRestore([{ id: 'me', name: 'Me' }], file.userNetwork)).toEqual([
      { id: 'me', name: 'Me' },
      { id: 'u1', name: 'Ann' },
    ])
  })
})

describe('channel range in a NEW USER network (001–990 are the viewer’s own)', () => {
  const lowRange = (): TvnExport =>
    buildRangeExport({ stored: [userChannel(951, 'Low one'), userChannel(970, 'Low two'), userChannel(990, 'Low three'), userChannel(950, 'Outside')], users: [], favourites: [951, 950], now: new Date(NOW) }, 951, 990)

  it('exports and restores 951–990 there', () => {
    setNetworkBase('new', null)
    try {
      const file = lowRange()
      expect(file.userNetwork.channels.map((channel) => channel.number)).toEqual([951, 970, 990])
      expect(file.favourites).toEqual([951])
      const text = serialiseTvnExport(file)
      const read = readRestoreFile(text)
      expect(read.ok).toBe(true)
      const restored = recordsFromExport(file.userNetwork, NOW)
      const next = restoreChannelRange([userChannel(960, 'Cleared'), userChannel(950, 'Kept')], restored, { first: 951, last: 990 })
      expect(next.map((record) => record.channelNumber).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([950, 951, 970, 990])
    } finally {
      setNetworkBase('tvn', null)
    }
  })

  it('says plainly when such a file is restored in a browser on TVN’s network', () => {
    setNetworkBase('new', null)
    const text = serialiseTvnExport(lowRange())
    setNetworkBase('tvn', null)
    const read = readRestoreFile(text)
    expect(read.ok).toBe(false)
    expect(!read.ok && read.errors[0]).toContain('NEW USER network')
  })

  it('exports a blank range too', () => {
    const file = buildRangeExport({ stored: [], users: [], favourites: [], now: new Date(NOW) }, 951, 990)
    expect(file.range).toEqual({ first: 951, last: 990 })
    expect(readRestoreFile(serialiseTvnExport(file)).ok).toBe(true)
  })
})

describe('a range file with channels written by hand', () => {
  it('restores TVN channels whose entries carry no saved date or baseline, dating them by the restore', async () => {
    const { overridesFromExport } = await import('./services/central-curation.ts')
    const doc = {
      format: 'tvn-export-v1',
      version: 1,
      exportedAt: '2026-10-14T05:11:11.022Z',
      userNetwork: { format: 'tvn-user-network-v1', version: 1, exportedAt: '2026-10-14T05:11:11.022Z', numbering: { first: 1001, limit: 100000 }, users: [], channels: [] },
      favourites: [],
      settings: {},
      central: {
        format: 'tvn-central-overrides-v1',
        overrides: [
          { number: 960, name: 'Radio 960 - Dance', sources: [{ url: '', label: 'TVN', sourceType: 'tvn', enabled: true }, { url: 'https://radio.example/stream', label: 'Dance', sourceType: 'audio', enabled: true }] },
        ],
      },
      manifests: [],
      range: { first: 951, last: 990 },
    }
    const read = readRestoreFile(JSON.stringify(doc))
    expect(read.ok).toBe(true)
    if (!read.ok || read.kind !== 'complete') return
    const [edit] = overridesFromExport(read.value.central!, 1234)
    expect(edit).toMatchObject({ channelNumber: 960, name: 'Radio 960 - Dance', savedAt: 1234 })
    // A date that is there must still be a date.
    const bad = structuredClone(doc)
    ;(bad.central.overrides[0] as Record<string, unknown>).savedAt = 'yesterday'
    expect(readRestoreFile(JSON.stringify(bad))).toMatchObject({ ok: false, errors: ['central.overrides[0].savedAt is not a date'] })
  })
})
