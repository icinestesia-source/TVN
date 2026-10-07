import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { GuideActions } from './components/GuideAdd.tsx'
import { installUserCatalogue } from './data/user-overlay.ts'
import { lookUpChannel } from './services/add-channel.ts'
import { keepingDates, rescanned } from './services/channel-curation.ts'
import { calendarDate, channelsFromSources, emptySlotRecord, parseChannelsExport, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import {
  alphabeticalOrder,
  moveTarget,
  moveTo,
  remapGuideLibrary,
  remapNumbers,
  renumberUserNetwork,
  shuffledOrder,
  userOrder,
} from './services/network-order.ts'
import { buildUserNetworkExport, serialiseUserNetworkExport } from './services/user-network-export.ts'
import { readUserNetworkFile, recordsFromExport } from './services/user-network-restore.ts'
import { addToGuide, checkGuides, guideProgramme, loadGuideLibrary, newGuide, GUIDES_FORMAT, GUIDES_KEY } from './services/viewing-guides.ts'
import { universeChannels } from './state/tuning.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'
import { programmeDate, UNKNOWN_DATE } from './view/programme-date.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const editor = read('src/components/NetworkEditor.tsx')
const provider = read('src/state/TvProvider.tsx')

const videos = (prefix: string, count: number): ImportedVideo[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${String(index).padStart(11 - prefix.length, '0')}`, title: `${prefix} ${index + 1}`, durationSec: 900 }))
const channelId = (n: number) => `UC${String(n).padStart(22, '0')}`
const added = (n: number, name: string, extra: Partial<StoredSource> = {}): StoredSource => ({
  id: `yt:${channelId(n)}`,
  name,
  videos: videos(`c${n}`, 4),
  channelNumber: n,
  inLibrary: false,
  automatic: true,
  updatedAt: 1,
  ...extra,
})
const ids = (sources: readonly StoredSource[]) => userOrder(sources).map((source) => source.id)
const named = (sources: readonly StoredSource[]) => userOrder(sources).map((source) => `${source.channelNumber} ${source.name}`)
const install = (sources: readonly StoredSource[]) => {
  const built = channelsFromSources(sources)
  installUserCatalogue(built.channels, built.programmes)
  return built
}
const listed = (filter: 'all' | 'user' | 'favourites', favourites: number[] = []) =>
  universeChannels({ filter, favourites }).filter((channel) => channel.number >= 1001).map((channel) => `${channel.number} ${channel.name}`)

afterEach(() => installUserCatalogue([], new Map()))

describe('USER QUICK ORDERING: SORT A–Z', () => {
  it('sorts by name in human order, ignoring case, and renumbers 1001… with no gaps', () => {
    const sources = [added(1001, 'Zebra'), added(1002, 'alpha'), added(1003, 'Cinema'), added(1004, 'Channel 10'), added(1005, 'Channel 9'), added(1006, 'Bravo')]
    const { sources: next } = renumberUserNetwork(sources, alphabeticalOrder(sources))
    expect(named(next)).toEqual(['1001 alpha', '1002 Bravo', '1003 Channel 9', '1004 Channel 10', '1005 Cinema', '1006 Zebra'])
  })

  it('includes unloaded, empty and disabled channels: empty slots go last, nothing is dropped', () => {
    const sources = [added(1001, 'Zebra'), emptySlotRecord(1002, 1), added(1003, 'Mango', { enabled: false } as Partial<StoredSource>), added(1004, 'Apple', { videos: [] })]
    const order = alphabeticalOrder(sources)
    expect(order).toHaveLength(4)
    const { sources: next } = renumberUserNetwork(sources, order)
    expect(userOrder(next).map((source) => source.channelNumber)).toEqual([1001, 1002, 1003, 1004])
    expect(userOrder(next).map((source) => source.name).slice(0, 3)).toEqual(['Apple', 'Mango', 'Zebra'])
    expect(userOrder(next).at(-1)?.emptySlot).toBe(true)
  })

  it('sorts by the name the viewer sees, and an already sorted network reports no change', () => {
    const sources = [added(1001, 'b'), added(1002, 'a')]
    expect(alphabeticalOrder(sources, (source) => (source.name === 'a' ? 'Zulu' : 'Alpha'))).toEqual(ids(sources))
    expect(provider).toContain("'THE USER NETWORK IS ALREADY A–Z'")
  })
})

describe('USER QUICK ORDERING: RANDOMISE', () => {
  it('keeps every channel exactly once and renumbers 1001…', () => {
    const sources = Array.from({ length: 12 }, (_, index) => added(1001 + index, `C${index}`))
    const order = shuffledOrder(ids(sources))
    expect([...order].sort()).toEqual([...ids(sources)].sort())
    const { sources: next } = renumberUserNetwork(sources, order)
    expect(userOrder(next).map((source) => source.channelNumber)).toEqual(sources.map((_, index) => 1001 + index))
  })

  it('is an unbiased Fisher–Yates shuffle: each channel lands in each place about equally often', () => {
    const runs = 30_000
    const counts = [0, 0, 0, 0].map(() => [0, 0, 0, 0])
    for (let run = 0; run < runs; run += 1) shuffledOrder(['a', 'b', 'c', 'd']).forEach((id, place) => (counts['abcd'.indexOf(id)][place] += 1))
    for (const row of counts) for (const count of row) expect(Math.abs(count / runs - 0.25)).toBeLessThan(0.02)
    expect(shuffledOrder(['a', 'b', 'c'], () => 0)).toEqual(['b', 'c', 'a'])
  })
})

describe('MOVE TO: insert, then renumber', () => {
  const network = () => [added(1001, 'Alpha'), added(1002, 'Bravo'), added(1003, 'Charlie'), added(1004, 'Delta')]

  it('moving 1004 to 1002 gives Alpha, Delta, Bravo, Charlie; nothing is lost', () => {
    const sources = network()
    const target = moveTarget(userOrder(sources), 1002)
    expect(target).toEqual({ index: 1 })
    if (!('index' in target)) return
    const { sources: next, moves } = renumberUserNetwork(sources, moveTo(ids(sources), `yt:${channelId(1004)}`, target.index))
    expect(named(next)).toEqual(['1001 Alpha', '1002 Delta', '1003 Bravo', '1004 Charlie'])
    expect([...moves]).toEqual([[1002, 1003], [1003, 1004], [1004, 1002]])
  })

  it('refuses a number outside the User Network, and the editor offers MOVE TO on ALL and USER rows', () => {
    expect(moveTarget(userOrder(network()), 1000)).toEqual({ error: 'User channels run 1001–1004' })
    expect(moveTarget(userOrder(network()), 1005)).toEqual({ error: 'User channels run 1001–1004' })
    expect(moveTarget([], 1001)).toEqual({ error: 'There are no User channels to move' })
    expect(editor).toContain("const canMove = list !== 'favourites'")
    expect(editor).toContain('className="network-target"')
    expect(editor).toContain('Move to')
  })
})

describe('STABLE IDENTITY after a renumber', () => {
  it('channel ids, favourites, ALL / USER / FAV and saved Guide items and sources all follow the channel', () => {
    const sources = [added(1001, 'Zebra'), added(1002, 'Alpha'), added(1003, 'Mango')]
    const before = new Map(install(sources).channels.map((channel) => [channel.name, channel.id]))
    const { sources: next, moves } = renumberUserNetwork(sources, alphabeticalOrder(sources))
    const built = install(next)
    for (const channel of built.channels) expect(channel.id).toBe(before.get(channel.name))
    expect(listed('all')).toEqual(['1001 Alpha', '1002 Mango', '1003 Zebra'])
    expect(listed('user')).toEqual(['1001 Alpha', '1002 Mango', '1003 Zebra'])
    const favourites = remapNumbers([1001, 42], moves)
    expect(listed('favourites', favourites)).toEqual(['1003 Zebra'])
    const zebra = { number: 1001, name: 'Zebra', id: before.get('Zebra'), origin: 'user-import' } as Channel
    const programme = { id: 'p', title: 'Show', description: '', durationSeconds: 900, videoId: 'c1001000000' } as Programme
    const guide = { ...addToGuide(newGuide('Mine', 1), zebra, programme, 2), sources: [{ channelId: zebra.id, channelNumber: 1001, channelName: 'Zebra' }] }
    const moved = remapGuideLibrary({ current: guide, saved: [guide] }, moves)
    expect(moved.current?.items[0]?.channelNumber).toBe(1003)
    expect(moved.saved[0]?.sources?.[0]).toEqual({ channelId: zebra.id, channelNumber: 1003, channelName: 'Zebra' })
  })

  it('A–Z and RANDOMISE go through the same atomic reorder as a single move, after a confirmation', () => {
    const body = provider.slice(provider.indexOf('const arrangeUserNetwork'), provider.indexOf('const arrangeUserNetwork') + 1400)
    expect(body).toContain('await reorderUserNetwork(orderOf(USER_BLOCK))')
    expect(body).toContain('await reorderUserNetwork(orderOf(LOW_BLOCK), LOW_BLOCK)')
    expect(editor).toContain("'Sort User Network A–Z?'")
    expect(editor).toContain("'Randomise User Network?'")
  })

  it('export then restore keeps the sorted order and every id', () => {
    const sources = [added(1001, 'Zebra'), added(1002, 'Alpha'), emptySlotRecord(1003, 1)]
    const { sources: next } = renumberUserNetwork(sources, alphabeticalOrder(sources))
    const file = readUserNetworkFile(serialiseUserNetworkExport(buildUserNetworkExport(next, new Date('2026-10-03T12:00:00Z'))))
    expect(file.ok).toBe(true)
    if (!file.ok) return
    const restored = recordsFromExport(file.value, 5).filter((record) => !record.emptySlot)
    expect(restored.map((record) => [record.channelNumber, record.name, record.id])).toEqual([[1001, 'Alpha', `yt:${channelId(1002)}`], [1002, 'Zebra', `yt:${channelId(1001)}`]])
  })

  it('an old saved Guide (no sources) still loads', () => {
    const programme = { id: 'p', title: 'Show', description: '', durationSeconds: 900, videoId: 'abcdefghijk', source: 'imported' } as Programme
    const guide = addToGuide(newGuide('Old', 1), { number: 5, name: 'Five', origin: 'central' } as unknown as Channel, programme, 2)
    const store = new Map([[GUIDES_KEY, JSON.stringify({ current: guide, saved: [guide] })]])
    const errors: string[] = []
    checkGuides({ format: GUIDES_FORMAT, current: guide, saved: [guide] }, 'guides', errors)
    expect(errors).toEqual([])
    const library = loadGuideLibrary({ getItem: (key) => store.get(key) ?? null, setItem: () => {} })
    expect(library.saved[0]?.name).toBe('Old')
    expect(library.current?.items).toHaveLength(1)
  })
})

describe('EDITOR TABS and TERMINOLOGY', () => {
  it('the Network Editor lists ALL, the named User Network and FAV; the 0–999 tab is gone', () => {
    expect(editor).toContain("['all', 'All']")
    expect(editor).toContain("['user', userNetworkName(undefined, tv.networkUsers)]")
    expect(editor).toContain("['favourites', 'Fav']")
    const tabs = editor.slice(editor.indexOf("['all', 'All']"), editor.indexOf("['favourites', 'Fav']"))
    expect(tabs).not.toMatch(/'TVN'|'User'|001–999|0–999|'tvn'/)
  })

  it('the header reads NETWORK · GUIDE · OPTIONS · NOW · ADD · MEDIA: no MY GUIDE and no CH GUIDE', () => {
    const html = renderToStaticMarkup(createElement(GuideActions, { tool: null, picked: false, onNow: () => {}, onTool: () => {} }))
    expect([...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1])).toEqual(['Network', 'Guide', 'Options', 'Now', 'Add', 'Media'])
    const editorOpen = renderToStaticMarkup(createElement(GuideActions, { tool: 'editor', picked: false, onNow: () => {}, onTool: () => {} }))
    expect(editorOpen).toMatch(/class="tab is-on"[^>]*>Network</)
    const following = renderToStaticMarkup(createElement(GuideActions, { tool: null, picked: false, following: true, onNow: () => {}, onTool: () => {} }))
    expect(following).toMatch(/is-following[^>]*>Guide</)
    expect(html).not.toMatch(/>My Guide</)
    expect(following).toMatch(/aria-current="page"[^>]*>Guide</)
    for (const path of ['src/components/GuideAdd.tsx', 'src/components/GuidePanel.tsx', 'src/components/Guide.tsx', 'src/components/InfoActions.tsx', 'src/state/TvProvider.tsx']) {
      expect(read(path), path).not.toMatch(/\bch guide\b|channel guide/i)
    }
    const panel = read('src/components/GuidePanel.tsx')
    for (const label of ['>My Guide</h3>', '>Channel sources</span>', "'Build from sources'", "'+ New Map'"]) expect(panel).toContain(label)
    expect(read('src/components/Guide.tsx')).toContain("Add to {guideName ?? 'My Guide'}")
  })

  it('the Information Overlay keeps GUIDE: it opens the listings and reads green while My Guide plays', () => {
    const pad = read('src/components/InfoActions.tsx')
    expect(pad).toContain("className={following ? 'tune-key info-pad-guide is-following' : 'tune-key info-pad-guide'}")
    expect(pad).toContain("corners.dispatch({ type: 'guide' })")
    expect(pad).toContain("corners.dispatch({ type: 'guide', listings: true })")
    expect(pad).toMatch(/>\s*Guide\s*<\/button>/)
  })
})

describe('GUIDE and NOW in the header', () => {
  it('GUIDE over the listings closes the Guide as CLOSE does; from a panel it brings the listings back', () => {
    const actions = read('src/components/GuideAdd.tsx')
    expect(actions).toContain("if (tool && tool !== 'edit') onTool(tool)\n    else onClose?.()")
    expect(read('src/components/Guide.tsx')).toContain("onClose={() => tv.dispatch({ type: 'cancel' })}")
  })

  it('NOW centres the channel playing at the current time; a second NOW, cursor untouched, returns to the picture', () => {
    const now = provider.slice(provider.indexOf("case 'guide-now': {"), provider.indexOf("case 'guide-now': {") + 2200)
    expect(now).toContain('cursorRef.current === nowCursorRef.current')
    expect(now.indexOf('closeGuide()')).toBeLessThan(now.indexOf('guideEngine.current.suspend()'))
    expect(now).toContain("showOverlay('info', INFO_MS)")
    expect(now).toContain('const nextCursor = { channelNumber: channelRef.current, timeMs: now }')
    expect(now).toContain('setGuideNowAsk((asked) => asked + 1)')
    const guide = read('src/components/Guide.tsx')
    const centre = guide.slice(guide.indexOf('const nowAsked'), guide.indexOf('const nowAsked') + 900)
    expect(centre).toContain('centredScrollTop(index, ROW_HEIGHT, grid.clientHeight, tv.visibleChannels.length)')
    expect(centre).toContain('openScrollLeft(Date.now(), startMs, pxPerMinute, grid.clientWidth)')
  })
})

describe('LOADING RING in Firefox', () => {
  it('fills the whole rim without textLength: the spare length is shared between the letters as dx', () => {
    const ring = read('src/components/StartupScreen.tsx')
    expect(ring).toContain('getComputedTextLength')
    expect(ring).toContain('(RING_LENGTH - 0.5 - natural) / letters.length')
    expect(ring).toContain('dx={gap && index > 0 ? gap.toFixed(3) : undefined}')
    expect(ring).toContain('textLength={RING_LENGTH - 0.5} lengthAdjust="spacing"')
  })
})

describe('DATES: canonical YYYY-MM-DD, shown DD/MM/YY or (--/--/--)', () => {
  const at = (publishedAt?: string) => programmeDate({ publishedAt } as Programme)

  it('validates the canonical day and never guesses', () => {
    expect(calendarDate('2024-09-03T23:30:00+00:00')).toBe('2024-09-03')
    expect(calendarDate('2024-02-29')).toBe('2024-02-29')
    for (const bad of ['2023-02-29', '2024-13-01', 'Episode 2019-05-03', '03/09/2024', '', undefined, 20240903]) expect(calendarDate(bad), String(bad)).toBeUndefined()
    expect(at('2026-09-03')).toBe('(03/09/26)')
    expect(at(undefined)).toBe(UNKNOWN_DATE)
    expect(at('not a date')).toBe(UNKNOWN_DATE)
  })

  it('the lookup keeps a valid date and drops a malformed one', async () => {
    const body = { channelId: channelId(1), title: 'T', videos: [{ id: 'aaaaaaaaaa1', title: 'A', durationSec: 600, published: '2026-09-03' }, { id: 'aaaaaaaaaa2', title: 'B', durationSec: 600, published: 'last week' }] }
    const found = await lookUpChannel('@x', (async () => new Response(JSON.stringify(body))) as typeof fetch)
    expect(found.videos).toEqual([{ id: 'aaaaaaaaaa1', title: 'A', durationSec: 600, published: '2026-09-03' }, { id: 'aaaaaaaaaa2', title: 'B', durationSec: 600 }])
  })

  it('a rescan keeps dates an earlier read found; the programme, Guide and export all carry it', () => {
    const held: ImportedVideo[] = [{ id: 'aaaaaaaaaa1', title: 'A', durationSec: 600, published: '2026-09-03' }]
    expect(rescanned([{ id: 'aaaaaaaaaa1', title: 'A (new title)', durationSec: 600 }], held)[0]?.published).toBe('2026-09-03')
    expect(keepingDates([{ id: 'aaaaaaaaaa1', title: 'A', durationSec: 600, published: '2026-09-04' }], held)[0]?.published).toBe('2026-09-04')
    const source = added(1001, 'Dated', { videos: [...held, { id: 'aaaaaaaaaa2', title: 'B', durationSec: 600 }] })
    const list = channelsFromSources([source]).programmes.get(`user-${source.id}`) ?? []
    const first = list.find((programme) => programme.videoId === 'aaaaaaaaaa1')
    expect(first?.publishedAt).toBe('2026-09-03')
    expect(programmeDate(first!)).toBe('(03/09/26)')
    expect(programmeDate(list.find((programme) => programme.videoId === 'aaaaaaaaaa2')!)).toBe(UNKNOWN_DATE)
    expect(guideProgramme(first!).publishedAt).toBe('2026-09-03')
    const collection = { ...source, channelSources: [{ id: 's1', kind: 'collection', label: 'Dated', enabled: true, url: '', ref: 'Dated', videos: source.videos }] } as StoredSource
    const file = readUserNetworkFile(serialiseUserNetworkExport(buildUserNetworkExport([collection], new Date('2026-10-03T12:00:00Z'))))
    expect(file.ok).toBe(true)
    if (file.ok) expect(recordsFromExport(file.value, 5)[0]?.channelSources?.[0]?.videos?.[0]?.published).toBe('2026-09-03')
    const parsed = parseChannelsExport(JSON.stringify({ channels: [{ name: 'X', videos: [{ id: 'aaaaaaaaaa1', title: 'A', durationSec: 600, published: '2026-09-03' }] }] }))
    expect(parsed.sources[0]?.videos[0]?.published).toBe('2026-09-03')
  })

  it('the shipped archive dates the channel’s own copy of a video, with nothing fetched', () => {
    const source = added(1001, 'Archive')
    const archive = () => ({ uploader: channelId(1001), title: 'Archive', videos: [{ ...source.videos[0], published: '2015-06-01' }] })
    const list = channelsFromSources([source], { archive }).programmes.get(`user-${source.id}`) ?? []
    expect(list.find((programme) => programme.videoId === source.videos[0].id)?.publishedAt).toBe('2015-06-01')
  })
})
