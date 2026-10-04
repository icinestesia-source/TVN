import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { ProgrammeInfo } from './components/ProgrammeInfo.tsx'
import { GuideActions } from './components/GuideAdd.tsx'
import { channelByNumber } from './data/catalogue.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { claimStarterInstall, setStarterState, STARTER_KEY } from './data/user-network/starter.ts'
import { centredScrollTop } from './epg/geometry.ts'
import { channelsFromSources, emptySlotRecord, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import {
  deleteUserChannel,
  historyWithout,
  liveFavourites,
  moveTo,
  remapGuideLibrary,
  remapHistory,
  remapNumber,
  remapNumbers,
  renumberUserNetwork,
  userOrder,
} from './services/network-order.ts'
import { buildUserNetworkExport, serialiseUserNetworkExport } from './services/user-network-export.ts'
import { readUserNetworkFile, recordsFromExport } from './services/user-network-restore.ts'
import { addToGuide, guideProgramme, newGuide } from './services/viewing-guides.ts'
import { universeChannels } from './state/tuning.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'
import { programmeDate, UNKNOWN_DATE } from './view/programme-date.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const provider = read('src/state/TvProvider.tsx')

function videos(prefix: string, count: number): ImportedVideo[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}${String(index).padStart(11 - prefix.length, '0')}`, title: `${prefix} ${index + 1}`, durationSec: 900 }))
}
const channelId = (n: number) => `UC${String(n).padStart(22, '0')}`
const added = (n: number, name: string): StoredSource => ({ id: `yt:${channelId(n)}`, name, videos: videos(`c${n}`, 4), channelNumber: n, inLibrary: false, automatic: true, updatedAt: 1 })
const network = () => [added(1001, 'Alpha'), added(1002, 'Bravo'), added(1003, 'Charlie'), added(1004, 'Delta')]
const install = (sources: readonly StoredSource[]) => {
  const built = channelsFromSources(sources)
  installUserCatalogue(built.channels, built.programmes)
  return built
}
const names = (filter: 'all' | 'user' | 'favourites', favourites: number[] = []) =>
  universeChannels({ filter, favourites }).filter((channel) => channel.number >= 1001).map((channel) => `${channel.number} ${channel.name}`)

afterEach(() => installUserCatalogue([], new Map()))

describe('DEFAULT USER NETWORK', () => {
  it('the shipped starter is the 3 October file, sorted A–Z and numbered 1001–1122 with no gaps', () => {
    const file = readUserNetworkFile(read('public/user-network/starter-network.json'))
    expect(file.ok).toBe(true)
    if (!file.ok) return
    const channels = file.value.channels
    expect(channels).toHaveLength(122)
    expect(channels.map((channel) => channel.number)).toEqual(channels.map((_, index) => 1001 + index))
    expect(channels[0]?.name).toBe('8K Earth')
    expect(channels.at(-1)?.name).toBe('X Games')
    const ids = channels.map((channel) => channel.id).filter(Boolean)
    expect(new Set(ids).size).toBe(ids.length)
    expect(channels.every((channel) => channel.sources.length > 0)).toBe(true)
  })

  it('a fresh profile gets it; an existing profile is never overwritten', () => {
    const store = new Map<string, string>()
    const fake = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) }
    expect(claimStarterInstall(fake)).toBe(true)
    setStarterState('installed', fake)
    expect(claimStarterInstall(fake)).toBe(false)
    store.set(STARTER_KEY, 'removed')
    expect(claimStarterInstall(fake)).toBe(false)
  })
})

describe('NETWORK EDITOR: reorder renumbers, identity stays', () => {
  it('moving 1003 to the top renumbers 1001… and ALL / TVN / FAV all follow', () => {
    const sources = network()
    install(sources)
    const before = new Map(install(sources).channels.map((channel) => [channel.name, channel.id]))
    const ids = moveTo(userOrder(sources).map((source) => source.id), `yt:${channelId(1003)}`, 0)
    const { sources: next, moves } = renumberUserNetwork(sources, ids)
    expect([...moves]).toEqual([[1001, 1002], [1002, 1003], [1003, 1001]])
    const built = install(next)
    expect(names('all')).toEqual(['1001 Charlie', '1002 Alpha', '1003 Bravo', '1004 Delta'])
    expect(names('user')).toEqual(['1001 Charlie', '1002 Alpha', '1003 Bravo', '1004 Delta'])
    const favourites = remapNumbers([1003, 225, 1002], moves)
    expect(favourites).toEqual([1001, 225, 1003])
    expect(names('favourites', favourites)).toEqual(['1001 Charlie', '1003 Bravo'])
    // Identity is the record's id, never its number.
    for (const channel of built.channels) expect(channel.id).toBe(before.get(channel.name))
  })

  it('history, the channel watched and saved Guides follow the move; a stale order is refused whole', () => {
    const sources = network()
    const { moves } = renumberUserNetwork(sources, moveTo(userOrder(sources).map((s) => s.id), `yt:${channelId(1003)}`, 0))
    expect(remapHistory({ entries: [1001, 225, 1003], index: 2 }, moves)).toEqual({ entries: [1002, 225, 1001], index: 2 })
    expect(remapNumber(1003, moves)).toBe(1001)
    const programme = { id: 'p1', title: 'Show', description: '', durationSeconds: 900, videoId: 'c1003000001' } as Programme
    const guide = addToGuide(newGuide('Mine', 1), { number: 1003, name: 'Charlie', origin: 'user-import' } as Channel, programme, 2)
    const moved = remapGuideLibrary({ current: guide, saved: [guide] }, moves)
    expect(moved.current?.items[0]?.channelNumber).toBe(1001)
    expect(moved.saved[0]?.items[0]?.channelNumber).toBe(1001)
    expect(moved.current?.modifiedAt).toBe(guide.modifiedAt)
    expect(() => renumberUserNetwork(sources, ['yt:nope'])).toThrow()
  })

  it('export then restore keeps the new order and every channel id', () => {
    const sources = network()
    const { sources: next } = renumberUserNetwork(sources, moveTo(userOrder(sources).map((s) => s.id), `yt:${channelId(1003)}`, 0))
    const doc = buildUserNetworkExport(next, new Date('2026-10-03T12:00:00Z'))
    expect(doc.channels.map((channel) => channel.id)).toEqual(userOrder(next).map((source) => source.id))
    const read = readUserNetworkFile(serialiseUserNetworkExport(doc))
    expect(read.ok).toBe(true)
    if (!read.ok) return
    const restored = recordsFromExport(read.value, 5)
    expect(restored.map((record) => [record.channelNumber, record.name, record.id])).toEqual(
      userOrder(next).map((source) => [source.channelNumber, source.name, source.id]),
    )
  })

  it('an older export without ids still restores, by its YouTube reference', () => {
    const doc = buildUserNetworkExport(network(), new Date('2026-10-03T12:00:00Z'))
    const old = { ...doc, channels: doc.channels.map(({ id: _id, ...channel }) => channel) }
    const read = readUserNetworkFile(JSON.stringify(old))
    expect(read.ok).toBe(true)
    if (read.ok) expect(recordsFromExport(read.value, 5).map((record) => record.channelNumber)).toEqual([1001, 1002, 1003, 1004])
  })

  it('TVN opens the Network Editor from the Guide header; 001–999 are never renumbered', () => {
    const html = renderToStaticMarkup(createElement(GuideActions, { tool: null, picked: false, onNow: () => {}, onTool: () => {} }))
    expect([...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1])).toEqual(['Network', 'Guide', 'Options', 'Now', 'Add', 'Media'])
    const central = [{ ...added(1001, 'A') }, { ...added(1002, 'B') }, { ...added(5, 'X'), channelNumber: 5 }]
    const { sources } = renumberUserNetwork(central, ['yt:' + channelId(1002), 'yt:' + channelId(1001)])
    expect(sources.find((source) => source.name === 'X')?.channelNumber).toBe(5)
  })
})

describe('FAV DELETE', () => {
  it('deleting a favourited channel leaves no ghost favourite, history entry or empty slot', () => {
    const sources = network()
    const { sources: next, status } = deleteUserChannel(sources, 1002)
    expect(status).toBe('deleted')
    expect(next.map((source) => source.channelNumber)).toEqual([1001, 1003, 1004])
    install(next)
    expect(channelByNumber(1002)).toBeUndefined()
    const favourites = liveFavourites([1002, 225, 1003], next)
    expect(favourites).toEqual([225, 1003])
    expect(names('favourites', favourites)).toEqual(['1003 Charlie'])
    expect(historyWithout({ entries: [1001, 1002, 1003], index: 1 }, new Set([1002]))).toEqual({ entries: [1001, 1003], index: 0 })
  })

  it('an old ghost favourite (an empty slot) is pruned at start-up; central favourites are never touched', () => {
    const withSlot = [added(1001, 'Alpha'), emptySlotRecord(1002, 1)]
    expect(liveFavourites([1002, 1001, 7, 0], withSlot)).toEqual([1001, 7, 0])
    expect(provider).toContain('if (!starterDue && !favouritesSeeded) setFavourites((current) => liveFavourites(current, migrated.sources))')
  })

  it('the provider cleans favourites, history, tiles and the current channel in one step', () => {
    const body = provider.slice(provider.indexOf('const forgetChannels'), provider.indexOf('const forgetChannels') + 1200)
    for (const part of ['liveFavourites(', 'historyWithout(', 'setTiles']) expect(body).toContain(part)
  })
})

describe('DATE', () => {
  const at = (publishedAt?: string, source?: Programme['source']) => programmeDate({ publishedAt, source } as Programme)

  it('YouTube upload time, podcast dates and plain dates read DD/MM/YY with no timezone shift', () => {
    expect(at('2019-05-03T23:30:00Z')).toBe('(03/05/19)')
    expect(at('2019-05-03T00:10:00+09:00')).toBe('(03/05/19)')
    expect(at('2021-12-31')).toBe('(31/12/21)')
    expect(at('2024-02-29')).toBe('(29/02/24)')
  })

  it('unknown, malformed and demonstration dates read (--/--/--); nothing is guessed', () => {
    expect(UNKNOWN_DATE).toBe('(--/--/--)')
    for (const value of [undefined, '', 'yesterday', '2021-02-30', '2023-02-29', '2021-13-01', '1899-12-31', '03/05/2019', 'Episode 2019-05-03']) {
      expect(at(value), String(value)).toBe(UNKNOWN_DATE)
    }
    expect(at('2019-05-03', 'demo')).toBe(UNKNOWN_DATE)
  })

  it('sits after the clip duration in the overlay, not in the title, and survives saved Guides', () => {
    const channel = { id: 'c', number: 1001, name: 'Alpha', origin: 'user-import', mediaKind: 'video' } as Channel
    const programme = { id: 'p', title: 'A Long Title', description: '', durationSeconds: 600, videoId: 'abcdefghijk', publishedAt: '2020-07-14T10:00:00Z' } as Programme
    const html = renderToStaticMarkup(createElement(ProgrammeInfo, { channel, programme, startMs: 0, endMs: 600_000, now: 0 }))
    expect(html).toContain('<h2 class="info-title">A Long Title</h2>')
    expect(html).toContain('<span>10 min</span><span class="info-date">(14/07/20)</span>')
    expect(guideProgramme(programme).publishedAt).toBe('2020-07-14T10:00:00Z')
    expect(read('src/styles/guide.css')).toMatch(/\.info-date \{[^}]*white-space: nowrap/)
    expect(read('src/components/Guide.tsx')).not.toContain('programmeDate')
  })
})

describe('INSTANT and GUIDE wiring', () => {
  it('INSTANT keeps the old sound at the press; the screen holds the old picture during the handoff', () => {
    expect(provider).toContain("if (settings.id !== 'instant' || multiviewRef.current !== '1') playerRef.current?.setAudible(false, 0, true)")
    const screen = read('src/app/TvScreen.tsx')
    expect(screen).toContain("prebuffer={tv.transition.id === 'instant'} onHold={setHeld}")
    expect(screen).toContain("const owner = holding ? 'picture' :")
  })

  it('the Guide opens centred on the current channel, except near either end', () => {
    expect(centredScrollTop(50, 52, 520, 120)).toBe(50 * 52 + 26 - 260)
    expect(centredScrollTop(1, 52, 520, 120)).toBe(0)
    expect(centredScrollTop(119, 52, 520, 120)).toBe(120 * 52 - 520)
    expect(centredScrollTop(2, 52, 520, 4)).toBe(0)
    const guide = read('src/components/Guide.tsx')
    expect(guide).toContain('grid.scrollTop = centredScrollTop(index, ROW_HEIGHT, grid.clientHeight, tv.visibleChannels.length)')
    expect(provider.match(/guideOpeningZoom\(/g)).toHaveLength(1)
  })
})
