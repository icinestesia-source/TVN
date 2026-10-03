import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { channelByNumber, listChannels } from './data/catalogue.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { resetDirector } from './director/director.ts'
import { setMediaLibrary } from './director/library.ts'
import { expandPlayableCatalogue } from './library/playable-catalogue.ts'
import { refreshAiring } from './network/airing.ts'
import { channelsFromSources, mergeParsedExports, parseChannelsExport, planImport, type StoredSource } from './services/channels-import.ts'
import { buildChannelGuide, buildSearchIndex, channelSupply, SEARCH_TARGET, type SearchChannel, type SearchProgramme } from './services/guide-search.ts'
import { searchIndex } from './services/guide-search-pool.ts'
import { remapGuideLibrary } from './services/network-order.ts'
import {
  applyGuideAction,
  checkGuides,
  EMPTY_LIBRARY,
  GUIDE_LIMITS,
  GUIDES_FORMAT,
  GUIDES_KEY,
  loadGuideLibrary,
  sourceChannel,
  type GuideSource,
  type ViewingGuide,
} from './services/viewing-guides.ts'
import type { Channel } from './types/channel.ts'
import { networkRows, networkStatus } from './view/network-rows.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const NOW = Date.UTC(2026, 9, 3, 20)

const memory = (value: unknown) => {
  const map = new Map<string, string>([[GUIDES_KEY, JSON.stringify(value)]])
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, text: string) => void map.set(key, text) }
}

function programmes(prefix: string, count: number, minutes: number): SearchProgramme[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, title: `${prefix} programme ${index}`, durationSeconds: minutes * 60, videoId: `${prefix}${String(index).padStart(8, '0')}` }))
}

const channel = (number: number, name: string, list: SearchProgramme[]): SearchChannel => ({ number, name, programmes: list })

describe('CHANNEL GUIDE: channel sources', () => {
  const source = (channelId: string, channelNumber: number, channelName: string): GuideSource => ({ channelId, channelNumber, channelName })

  it('a saved Guide from before channel sources still loads, and one with sources round-trips', () => {
    const old: ViewingGuide = { id: 'g-old', name: 'Saturday', items: [], createdAt: 1, modifiedAt: 2 }
    expect(loadGuideLibrary(memory({ current: old, saved: [old] }))).toEqual({ current: old, saved: [old] })

    let library = applyGuideAction(EMPTY_LIBRARY, { type: 'sources', sources: [source('ch-555', 555, 'Daft Punk'), source('ch-586', 586, 'Live'), source('ch-555', 555, 'Daft Punk')] }, NOW)
    expect(library.current?.sources?.map((item) => item.channelNumber)).toEqual([555, 586])
    library = applyGuideAction(library, { type: 'save' }, NOW + 1)
    const errors: string[] = []
    checkGuides({ format: GUIDES_FORMAT, ...library }, 'guides', errors)
    expect(errors).toEqual([])
    expect(loadGuideLibrary(memory(library)).current?.sources).toEqual(library.current?.sources)

    const bad: string[] = []
    checkGuides({ format: GUIDES_FORMAT, current: { ...old, sources: [{ channelId: 'x', channelNumber: 1, channelName: 'X', extra: 1 }] }, saved: [] }, 'guides', bad)
    expect(bad.length).toBeGreaterThan(0)
    const many = Array.from({ length: GUIDE_LIMITS.sources + 1 }, (_, index) => source(`c${index}`, index + 1, `C${index}`))
    expect(() => applyGuideAction(EMPTY_LIBRARY, { type: 'sources', sources: many }, NOW)).toThrow(/at most/)
  })

  it('a source is followed by its stable id: a renumbered channel is still the same source', () => {
    const library = applyGuideAction(EMPTY_LIBRARY, { type: 'sources', sources: [source('user-abc', 1003, 'Veritas')] }, NOW)
    const moved = remapGuideLibrary(library, new Map([[1003, 1001]]))
    expect(moved.current?.sources).toEqual([source('user-abc', 1001, 'Veritas')])
    const channels = [{ id: 'user-xyz', number: 1003 }, { id: 'user-abc', number: 1001 }]
    expect(sourceChannel(library.current!.sources![0], channels)?.number).toBe(1001)
    expect(sourceChannel(source('user-gone', 1003, 'Gone'), channels)).toBeUndefined()
  })

  it('each source reports what it can give: programmes and running time, without Shorts, overlong items or repeats', () => {
    const list = [...programmes('a', 6, 30), { id: 'short', title: 'Short', durationSeconds: 45, videoId: 'shortshort1' }, { id: 'long', title: 'Long', durationSeconds: 4 * 3600, videoId: 'longlonglon' }]
    const index = buildSearchIndex([channel(555, 'Daft Punk', [...list, list[0]]), channel(586, 'Live', programmes('b', 3, 20))])
    expect(channelSupply(index, 555)).toEqual({ programmes: 6, seconds: 6 * 30 * 60 })
    expect(channelSupply(index, 586)).toEqual({ programmes: 3, seconds: 3 * 20 * 60 })
    expect(channelSupply(index, 999)).toEqual({ programmes: 0, seconds: 0 })
  })

  it('BUILD GUIDE mixes the sources into two to four hours, nothing twice, every source taking turns', () => {
    const index = buildSearchIndex([channel(555, 'Daft Punk', programmes('a', 40, 5)), channel(586, 'Live', programmes('b', 20, 45)), channel(1001, 'Mine', programmes('c', 30, 12))])
    const built = buildChannelGuide(index, [555, 586, 1001], { seed: 1 })
    const keys = built.picks.map((pick) => pick.entry.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(built.seconds).toBeGreaterThanOrEqual(SEARCH_TARGET.min)
    expect(built.seconds).toBeLessThanOrEqual(SEARCH_TARGET.max)
    const counts = new Map<number, number>()
    for (const pick of built.picks) counts.set(pick.entry.channel.number, (counts.get(pick.entry.channel.number) ?? 0) + 1)
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual([555, 586, 1001])
    let longestRun = 0
    for (let at = 0, run = 0; at < built.picks.length; at += 1) {
      run = at > 0 && built.picks[at].entry.channel.number === built.picks[at - 1].entry.channel.number ? run + 1 : 1
      longestRun = Math.max(longestRun, run)
    }
    expect(longestRun).toBeLessThanOrEqual(3)
    expect(buildChannelGuide(index, [555, 586, 1001], { seed: 1 })).toEqual(built)
    const again = buildChannelGuide(index, [555, 586, 1001], { seed: 2, previous: new Set(keys) })
    expect(again.picks.filter((pick) => keys.includes(pick.entry.key)).length / again.picks.length).toBeLessThan(0.5)
    expect(buildChannelGuide(index, [], { seed: 1 }).picks).toEqual([])
  })

  it('the panel reads CHANNEL GUIDE with ADD CHANNEL, BUILD GUIDE and each source as “NNN · Name”', () => {
    const panel = read('src/components/GuidePanel.tsx')
    expect(panel).toContain('>My Guide</h3>')
    expect(panel).toMatch(/Add source/)
    expect(panel).toMatch(/Build from sources/)
    expect(panel).toContain('plan-source-list')
    expect(read('src/components/Guide.tsx')).toContain("Add to {guideName ?? 'My Guide'}")
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain("channel.origin === 'tvn' || channel.origin === 'session'")
    expect(provider).toContain('sourceChannel(source, listChannels())')
  })
})

describe('CHANNEL GUIDE over the real network', () => {
  beforeAll(() => {
    const items = expandPlayableCatalogue(JSON.parse(read('public/independent/playable.json')))
    resetDirector()
    setMediaLibrary(items)
    refreshAiring(items)
  }, 120_000)
  afterAll(() => resetDirector())

  it('555 and 586 resolve to their current channels and report real programming', () => {
    const index = searchIndex(() => undefined, new Set(), 'channel-guide-test')
    for (const number of [555, 586]) {
      const found = channelByNumber(number)!
      expect(found.id).toBeTruthy()
      expect(sourceChannel({ channelId: found.id, channelNumber: number, channelName: found.name }, listChannels())?.number).toBe(number)
      const supply = channelSupply(index, number)
      console.info(`${number} ${found.name}: ${supply.programmes} programmes, ${(supply.seconds / 3600).toFixed(1)} h`)
      expect(supply.programmes).toBeGreaterThan(0)
    }
    const built = buildChannelGuide(index, [555, 586], { seed: 3 })
    expect(new Set(built.picks.map((pick) => pick.entry.key)).size).toBe(built.picks.length)
    expect(new Set(built.picks.map((pick) => pick.entry.channel.number))).toEqual(new Set([555, 586]))
  })
})

describe('NETWORK EDITOR: every stored channel is listed', () => {
  afterAll(() => installUserCatalogue([], new Map()))

  it('lists playable, empty, disabled and not-yet-loaded channels, each with its status', () => {
    const merged = mergeParsedExports([parseChannelsExport(read('public/user-network/channels.txt'))])
    const planned = planImport([], merged, { library: true, automatic: true }, [], 1).sources
    const built = channelsFromSources(planned)
    installUserCatalogue(built.channels, built.programmes)
    const listed = listChannels()
    const stored: StoredSource[] = planned.slice(0, 3)
    const shown = networkRows(listed, stored, new Set())
    for (const record of stored) expect(shown.some((row) => row.number === record.channelNumber)).toBe(true)
    const pending = shown.filter((row) => !listed.includes(row))
    expect(pending.every((row) => networkStatus(row) === 'Source not loaded')).toBe(true)
    expect(shown.map((row) => row.number)).toEqual([...shown.map((row) => row.number)].sort((a, b) => a - b))

    const base = channelByNumber(225)!
    expect(networkStatus(channelByNumber(0)!)).toBe('Surfing')
    expect(networkStatus({ ...base, emptySlot: true } as Channel)).toBe('Empty')
    expect(networkStatus({ ...base, enabled: false })).toBe('Disabled')
    expect(networkStatus(channelByNumber(1000)!)).toBe('This device')
    const unloadedRow = networkRows([], [{ ...stored[0], channelNumber: 1500 }], new Set())[0]
    expect(networkStatus(unloadedRow)).toBe('Source not loaded')
    expect(unloadedRow.id).toBe(`user-${stored[0].id}`)
    const editor = read('src/components/NetworkEditor.tsx')
    expect(editor).toContain('disabled={unloaded(channel)}')
  })
})
