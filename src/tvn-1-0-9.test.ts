import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AddChannelForm, GuideActions, SessionImportTools, UserNetworkImportTools } from './components/GuideAdd.tsx'
import { NowNextOverlay } from './components/NowNextOverlay.tsx'
import { channelByNumber, listChannels } from './data/catalogue.ts'
import { channelMatchesFilter, USER_NUMBER_START } from './data/network.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { getSchedule, resetDirector } from './director/director.ts'
import { INDIAN_COOKING_TITLE } from './director/fit.ts'
import { setMediaLibrary } from './director/library.ts'
import { broadcastDateFor } from './director/time.ts'
import type { MediaItem } from './director/types.ts'
import { reconcileLibrary } from './library/ingest.ts'
import { schedulingPool } from './library/mode.ts'
import { expandPlayableCatalogue, shippedRecordSupersedes, type PlayableCatalogueV2 } from './library/playable-catalogue.ts'
import { getChannelMedia } from './library/query.ts'
import { commitPlayableCatalogue, hydrateLibrary, librarySnapshot, resetLibraryForTests, setLibraryWriter } from './library/store.ts'
import type { ImportSession, LibraryMedia } from './library/types.ts'
import { broadcast, guideSlots } from './services/broadcast.ts'
import { applyChannelEdit, editOf } from './services/channel-editor.ts'
import { channelsFromSources, emptySlotRecord, type ImportedVideo, type ParsedExport, type StoredSource } from './services/channels-import.ts'
import { addChannelSource, clearUserChannel } from './services/user-network.ts'
import { buildUserNetworkExport, serialiseUserNetworkExport, validateUserNetworkExport } from './services/user-network-export.ts'
import { favouritesAfterRestore, readUserNetworkFile, recordsFromExport, resolveRestored, restoreUserNetwork, type RestoreDeps } from './services/user-network-restore.ts'
import { TvContext, type TvContextValue } from './state/tv-context.ts'
import { universeChannels } from './state/tuning.ts'
import type { Channel } from './types/channel.ts'
import { guideToolTarget } from './view/guide-tool.ts'
import { DEFAULT_SHORTCUTS } from './view/info-shortcuts.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const guide = read('src/components/Guide.tsx')
const provider = read('src/state/TvProvider.tsx')
const addSource = read('src/components/GuideAdd.tsx')
const labelsOf = (html: string) => [...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1].trim())

function videos(prefix: string, count: number, from = 0): ImportedVideo[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${String(from + index).padStart(11 - prefix.length, '0')}`,
    title: `${prefix} ${from + index + 1}`,
    durationSec: 900 + index * 60,
  }))
}

const A = 'UCaaaa000000000000000001'
const B = 'UCbbbb000000000000000002'
const C = 'UCcccc000000000000000003'
const LIST = 'PL490JTer_zRIZbIlQUdavpI-yelTGVBgu'

function added(channelId: string, name: string, number: number, list = videos(channelId.slice(2, 6), 6)): StoredSource {
  return { id: `yt:${channelId}`, name, videos: list, channelNumber: number, inLibrary: false, automatic: true, updatedAt: 1 }
}

function install(sources: readonly StoredSource[]) {
  const built = channelsFromSources(sources)
  installUserCatalogue(built.channels, built.programmes)
  return built
}

afterEach(() => installUserCatalogue([], new Map()))

describe('+ Add channel after the last User Network channel', () => {
  const add = guide.slice(guide.indexOf('{addRow ? (\n                  <div\n                    className="channel-cell is-user add-cell"'), guide.indexOf('<div className="guide-grid"'))

  it('is the row immediately after the last listed channel: the next number and + Add channel', () => {
    expect(add).toContain('top: tv.visibleChannels.length * ROW_HEIGHT')
    expect(add).toContain('<span className="ch-number">{padChannel(nextNumber)}</span>')
    expect(add).toContain('<span className="ch-name">+ Add channel</span>')
    expect(guide).toContain('const rowCount = tv.visibleChannels.length + (addRow ? 1 : 0)')
  })

  it('opens the existing Add Channel row; there is no second Add Channel', () => {
    expect(add).toContain('onClick={openAddRow}')
    const body = guide.slice(guide.indexOf('const openAddRow = () => {'), guide.indexOf('const createUser'))
    for (const write of ['addChannel', 'saveStoredSources', 'favourite', 'claimUserNumber']) expect(body).not.toContain(write)
    expect(guide.match(/<AddChannelForm /g)).toHaveLength(2)
    expect(addSource.match(/export function AddChannelForm/g)).toHaveLength(1)
  })

  it('allocates nothing: ADD only moves the Guide, and the next import fills the lowest empty slot', () => {
    const network = [added(A, 'Alpha', 1001), added(B, 'Bravo', 1002), added(C, 'Charlie', 1003)]
    const cleared = clearUserChannel(network, 1002, 7).sources
    const before = structuredClone(cleared)
    install(cleared)
    const target = guideToolTarget('add', 'user', [], { channelNumber: 1001, timeMs: 5 }, listChannels(), 5)
    expect(Object.keys(target).sort()).toEqual(['cursor', 'filter'])
    expect(cleared).toEqual(before)
    expect(listChannels().filter((channel) => channel.number >= USER_NUMBER_START).map((channel) => channel.number)).toEqual([1001, 1002, 1003])
    expect(guide).toContain('userChannels.find((channel) => channel.emptySlot)?.number ??')
    const filled = addChannelSource(cleared, { channelId: 'UCdddd000000000000000004', title: 'Delta', videos: videos('dd', 3) }, 9)
    expect(filled).toMatchObject({ status: 'added', number: 1002 })
    expect(filled.sources.some((source) => source.channelNumber === 1004)).toBe(false)
  })

  it('ALL lists curated 001–999 and the User Network; TVN lists only 1001+; the + row is no channel in either', () => {
    install([added(A, 'Alpha', 1001), emptySlotRecord(1002, 3), added(C, 'Charlie', 1003)])
    const all = listChannels().filter((channel) => channelMatchesFilter(channel, 'all', []))
    expect(all.some((channel) => channel.number === 769)).toBe(true)
    expect(all.filter((channel) => channel.number >= 1001).map((channel) => channel.number)).toEqual([1001, 1002, 1003])
    expect(universeChannels({ filter: 'all', favourites: [] }).some((channel) => channel.number === 1003)).toBe(true)
    const user = listChannels().filter((channel) => channelMatchesFilter(channel, 'user', []))
    expect(user.map((channel) => channel.number)).toEqual([1001, 1002, 1003])
    expect(listChannels().every((channel) => Number.isInteger(channel.number))).toBe(true)
    expect(guide).toContain("const addRow = !searching && (tv.guideFilter === 'all' || tv.guideFilter === 'user' || owner !== undefined)")
  })

  it('leaves FAVOURITES as it was', () => {
    install([added(A, 'Alpha', 1001)])
    expect(universeChannels({ filter: 'favourites', favourites: [1001, 12] }).map((channel) => channel.number)).toEqual([1001, 12])
    expect(guide).not.toMatch(/addRow[^\n]*favourites/)
  })
})

describe('Guide terminology: NOW · ADD · MEDIA', () => {
  it('reads NOW, ADD, MEDIA in that order, each opening its own tool; IMPORT is not at the top', () => {
    const html = renderToStaticMarkup(createElement(GuideActions, { tool: null, picked: false, onNow: () => {}, onTool: () => {} }))
    expect(labelsOf(html)).toEqual(['Network', 'Guide', 'Options', 'Now', 'Add', 'Media'])
    expect(addSource).not.toContain("action('Import'")
    expect(addSource).toContain("action('Add', tool === 'add', () => onTool('add')")
    expect(addSource).toContain("action('Media', tool === 'media', () => onTool('media')")
  })

  it('MEDIA is the old local-media IMPORT, now 1000 Local Media from Folder or Files', () => {
    expect(guide).toMatch(/tool === 'media' \? \(\s*<SessionImportTools[\s\S]*?onImport=\{tv\.importSession\}/)
    const footer = renderToStaticMarkup(createElement(SessionImportTools, { onImport: async () => '' }))
    expect(footer).toMatch(/aria-label="Media"/)
    expect(footer).toMatch(/<span>1000<\/span><span>Local Media<\/span>/)
    expect(provider).toMatch(/case 'media':\s+openGuideTool\('media'\)/)
  })

  it('IMPORT behind the + row restores a User Network file', () => {
    expect(guide).toMatch(/tool === 'network' \? \(\s*<UserNetworkImportTools [^\n]*onApply=\{tv\.importUserNetwork\} onApplyComplete=\{tv\.importTvn\} \/>/)
    expect(guide).toContain("const restoreNetwork = () => tv.dispatch({ type: 'guide-tool', tool: 'network' })")
    const footer = renderToStaticMarkup(createElement(UserNetworkImportTools, { userChannels: 3, onApply: async () => '', onApplyComplete: async () => '' }))
    expect(footer).toMatch(/aria-label="Import User Network"/)
    expect(footer).not.toContain('Restore a User Network file')
    expect(labelsOf(footer)).toEqual(['Choose file'])
    expect(footer).toContain('accept=".json,application/json"')
  })

  it('the Add Channel row reads [ link ] IMPORT · EXPORT, with no ADD left in it', () => {
    const html = renderToStaticMarkup(createElement(AddChannelForm, { nextNumber: 1004, onAdd: async () => '', onExport: async () => '' }))
    expect(labelsOf(html)).toEqual(['Import', 'Export USER'])
    expect(html.indexOf('<input')).toBeLessThan(html.indexOf('>Import</button>'))
    expect(html).not.toMatch(/>Add</)
    expect(addSource).toContain("{busy ? 'Importing…' : 'Import'}")
  })

  it('Channel 000’s card points to MEDIA', () => {
    expect(read('src/components/SessionCard.tsx')).toContain('SELECT MEDIA IN THE GUIDE')
  })
})

describe('IMPORT: restoring a User Network export', () => {
  const NOW = new Date(2026, 9, 2, 9, 0)
  const playlist = (): StoredSource => {
    const start = addChannelSource([], { channelId: LIST, sourceType: 'youtube-playlist', title: 'Cooking Classics', videos: videos('pl', 4) }, 10).sources[0]
    return { ...start, channelNumber: 1002 }
  }
  const representative = (): StoredSource[] => {
    const renamed = applyChannelEdit([playlist()], 1002, { ...editOf(playlist()), name: 'Sunday Kitchen' }, 11)[0]
    const mixed: StoredSource = {
      ...added(B, 'Mixed', 1004, videos('bb', 3)),
      channelSources: [
        { id: 's1', kind: 'youtube', url: `https://www.youtube.com/channel/${B}`, label: 'Bravo', enabled: true, ref: B, youtube: 'channel', videos: videos('bb', 3) },
        { id: 's2', kind: 'audio', url: 'https://radio.example/stream', label: 'Radio', enabled: false },
      ],
      runningOrder: ['bb000000002', 'bb000000000', 'bb000000001'],
    }
    const list: StoredSource = { id: 'src:retro-gaming', name: 'Retro Gaming', videos: videos('rg', 3), channelNumber: 1005, inLibrary: true, automatic: true, updatedAt: 1 }
    return [added(A, 'Alpha', 1001), renamed, emptySlotRecord(1003, 5), mixed, list]
  }
  const lookups: Record<string, readonly ImportedVideo[]> = {
    [`https://www.youtube.com/channel/${A}`]: videos('aaaa', 6),
    [`https://www.youtube.com/playlist?list=${LIST}`]: videos('pl', 4),
    [`https://www.youtube.com/channel/${B}`]: videos('bb', 3),
  }
  const deps = (asked: string[] = []): RestoreDeps => ({
    async resolveYouTube(url) {
      asked.push(url)
      const found = lookups[url]
      if (!found) throw new Error('offline')
      return { channelId: url.split(/[=/]/).pop()!, title: 'From YouTube', videos: found }
    },
  })

  it('round-trips: export, change the network, import, and the export reads the same again', async () => {
    const exported = serialiseUserNetworkExport(buildUserNetworkExport(representative(), NOW))
    const changed = [added(C, 'Something Else', 1001), added('UCeeee000000000000000005', 'Extra', 1007), { ...added(C, 'Library only', 0), id: 'src:library-only', channelNumber: null }]
    const file = readUserNetworkFile(exported)
    expect(file).toMatchObject({ ok: true, channels: 5, empty: 1 })
    if (!file.ok) return
    const asked: string[] = []
    const resolved = await resolveRestored(recordsFromExport(file.value, 50), deps(asked), 50)
    expect(resolved.failed).toBe(0)
    expect(asked.sort()).toEqual(Object.keys(lookups).sort())
    const restored = restoreUserNetwork(changed, resolved.records)
    const again = buildUserNetworkExport(restored, NOW)
    expect(again.channels).toEqual(file.value.channels)
    expect(restored.find((record) => record.id === 'src:library-only')).toBeDefined()
    expect(restored.some((record) => record.channelNumber === 1007)).toBe(false)

    install(restored)
    expect(channelByNumber(1001)).toMatchObject({ name: 'Alpha' })
    expect(channelByNumber(1002)).toMatchObject({ name: 'Sunday Kitchen' })
    expect(restored.find((record) => record.channelNumber === 1002)!.channelSources![0]).toMatchObject({ kind: 'youtube', youtube: 'playlist', ref: LIST })
    expect(channelByNumber(1003)).toMatchObject({ emptySlot: true })
    const mixed = restored.find((record) => record.channelNumber === 1004)!
    expect(mixed.channelSources!.map((source) => [source.kind, source.enabled])).toEqual([['youtube', true], ['audio', false]])
    expect(mixed.runningOrder).toEqual(['bb000000002', 'bb000000000', 'bb000000001'])
    expect(restored.find((record) => record.channelNumber === 1005)!.videos.map((video) => video.id)).toEqual(videos('rg', 3).map((video) => video.id))
    expect(restored.find((record) => record.channelNumber === 1001)!.videos).toHaveLength(6)
  })

  it('a YouTube source that cannot be read keeps its channel and number, marked to rescan', async () => {
    const file = readUserNetworkFile(serialiseUserNetworkExport(buildUserNetworkExport(representative(), NOW)))
    if (!file.ok) throw new Error('unreadable')
    const offline: RestoreDeps = { resolveYouTube: async () => Promise.reject(new Error('offline')) }
    const resolved = await resolveRestored(recordsFromExport(file.value, 50), offline, 50)
    expect(resolved.failed).toBe(3)
    expect(resolved.records.map((record) => record.channelNumber)).toEqual([1001, 1002, 1003, 1004, 1005])
    expect(resolved.records.find((record) => record.channelNumber === 1004)!.channelSources![0].status?.state).toBe('failed')
  })

  it('never brings in Channel 000, 001–999, watched marks, playback state, history or object URLs', async () => {
    const file = readUserNetworkFile(serialiseUserNetworkExport(buildUserNetworkExport(representative(), NOW)))
    if (!file.ok) throw new Error('unreadable')
    const resolved = await resolveRestored(recordsFromExport(file.value, 50), deps(), 50)
    const text = JSON.stringify(resolved.records)
    for (const banned of ['"watched"', 'blob:', 'lastChannel', 'history', 'playback', 'objectUrl']) expect(text).not.toContain(banned)
    expect(resolved.records.every((record) => record.channelNumber! >= 1001)).toBe(true)
  })

  it('refuses malformed, foreign and dangerous files whole', () => {
    const good = JSON.parse(serialiseUserNetworkExport(buildUserNetworkExport(representative(), NOW))) as Record<string, any>
    const bad = (change: (copy: Record<string, any>) => void) => {
      const copy = structuredClone(good)
      change(copy)
      return readUserNetworkFile(JSON.stringify(copy))
    }
    const refused = [
      readUserNetworkFile('{"format": "tvn-user-network-v1", '),
      readUserNetworkFile('not json at all'),
      bad((copy) => (copy.format = 'retrotv-channels')),
      bad((copy) => (copy.version = 2)),
      bad((copy) => (copy.channels[0].apiKey = 'x')),
      bad((copy) => (copy.channels[0].sources[0].label = ['AI', 'zaSyD-not-a-real-key-0123456789abcdefgh'].join(''))),
      bad((copy) => (copy.channels[0].sources[0].url = 'https://www.youtube.com/channel/UCaaaa000000000000000001?token=abc')),
      bad((copy) => (copy.channels[0].number = 1001.5)),
      bad((copy) => (copy.channels[0].number = 100000)),
      bad((copy) => (copy.channels[1].number = 1001)),
      bad((copy) => (copy.channels[0].number = 769)),
      bad((copy) => (copy.channels[0].number = 1)),
      bad((copy) => (copy.channels[0].number = 0)),
    ]
    for (const result of refused) expect(result.ok).toBe(false)
    expect(validateUserNetworkExport(good).ok).toBe(true)
  })

  it('applies nothing until the file is valid and the viewer confirms the replacement', () => {
    const tool = addSource.slice(addSource.indexOf('export function UserNetworkImportTools'), addSource.indexOf('export function UserNetworkTools'))
    expect(tool).toMatch(/if \(!read\.ok\) \{\s*setNote\([^\n]*NOT A TVN USER NETWORK FILE[^\n]*\n\s*return\s*\}/)
    expect(tool.indexOf("setPending({ kind: 'network', document: read.value")).toBeGreaterThan(tool.indexOf('if (!read.ok)'))
    expect(tool).toContain('Restoring replaces your User Network')
    expect(tool).toContain("key(pending.kind === 'complete' ? 'Restore USER only' : 'Restore USER', () => void apply('user'), 'tab remove-key')")
    expect(tool).toContain("key('Keep mine', () => setPending(null))")
    expect(tool.match(/onApply\(/g)).toHaveLength(1)
    const body = provider.slice(provider.indexOf('const importUserNetwork = useCallback'), provider.indexOf('const restoreCentralCuration = '))
    expect(body.indexOf('saveStoredSources(next)')).toBeGreaterThan(body.indexOf('await resolveRestored('))
    expect(body).toContain('restoreUserNetwork(await loadStoredSources(), resolved.records)')
    for (const untouched of ['saveCuratedEdit', 'installCurated', 'sessionRef', 'importSession', 'placeStarterFavourites', 'requestTune']) expect(body).not.toContain(untouched)
  })

  it('leaves 001–999, Channel 000 and library-only lists out of the replacement', () => {
    const existing: StoredSource[] = [added(A, 'Alpha', 1001), { ...added(B, 'Kept', 1), id: 'src:kept', channelNumber: null }]
    const result = restoreUserNetwork(existing, [added(C, 'Charlie', 1002), { ...added(B, 'Sneaky', 12), id: 'yt:sneaky' }])
    expect(result.map((record) => [record.id, record.channelNumber])).toEqual([
      ['src:kept', null],
      [`yt:${C}`, 1002],
    ])
  })

  it('a User Network file given to ADD’s Channel list is sent to IMPORT, never merged', () => {
    const body = guide.slice(guide.indexOf('const importList = async'), guide.indexOf('const openAddRow'))
    expect(body.indexOf('USER_NETWORK_FORMAT')).toBeLessThan(body.indexOf('channelLinksFrom(text)'))
    expect(body).toContain('throw new Error(')
  })
})

describe('favourites through a User Network import', () => {
  const restored = [added(A, 'Alpha', 1001), emptySlotRecord(1002, 1), added(C, 'Charlie', 1003)]

  it('keeps curated and 000 favourites and 1001+ favourites on numbers the restored network has; drops the rest', () => {
    expect(favouritesAfterRestore([12, 769, 0, 1003, 1001, 1002, 1009], restored)).toEqual([12, 769, 0, 1003, 1001, 1002])
    expect(favouritesAfterRestore([], restored)).toEqual([])
  })

  it('never reseeds favourites', () => {
    const body = provider.slice(provider.indexOf('const importUserNetwork = useCallback'), provider.indexOf('const openChannelEdit = useCallback'))
    expect(body).toContain('setFavourites((current) => favouritesAfterRestore(current, resolved.records, document.favourites))')
    expect(body).not.toMatch(/starterFavourite|placeStarter|DEFAULT_FAVOURITES/)
  })
})

describe('MULTI: the information bar follows the selected window', () => {
  it('selecting a window by click or arrow commits that channel and shows INFO, staying in Multi View', () => {
    const select = provider.slice(provider.indexOf('const selectTile = (index: number)'), provider.indexOf('const showOverlay = '))
    expect(select).toContain('setAudioFocus(index)')
    expect(select).not.toMatch(/multiviewRef\.current = |setMultiviewMode/)
    const commitThenInfo =
      /const heard = selectTile\([^\n]+\)\s+if \(!heard\) break\s+startup\.noteUserTune\(\)\s+commitChannel\(\{ channelNumber: heard, previousNumber: previousRef\.current \}, false\)\s+showOverlay\('info', INFO_MS\)\s+break/
    const tile = provider.slice(provider.indexOf("case 'focus-tile': {"))
    const move = provider.slice(provider.indexOf("case 'focus-move': {"), provider.indexOf("case 'focus-tile': {"))
    expect(tile).toMatch(new RegExp(String.raw`^case 'focus-tile': \{\s+if \(multiviewRef\.current === '1'\) break\s+` + commitThenInfo.source))
    expect(move).toMatch(commitThenInfo)
    expect(move).not.toMatch(/multiviewRef\.current = |setMultiviewMode/)
    expect(read('src/components/BroadcastTile.tsx')).toContain("onClick={() => tv.dispatch({ type: 'focus-tile', index })}")
    expect(read('src/app/TvScreen.tsx')).toContain('info ? <NowNextOverlay leaving={info === \'closing\'} /> : null')
  })

  const overlayFor = (channel: Channel) => {
    const value = {
      channel,
      multiviewMode: '4',
      canGoBack: false,
      canGoForward: false,
      remoteOpen: false,
      surfing: false,
      subtitles: false,
      infoShortcuts: DEFAULT_SHORTCUTS,
      dispatch: () => {},
      holdInfo: () => {},
      screenStep: () => {},
    } as unknown as TvContextValue
    return renderToStaticMarkup(createElement(TvContext.Provider, { value }, createElement(NowNextOverlay)))
  }
  const kicker = (html: string) => (html.match(/<p class="info-kicker">([\s\S]*?)<\/p>/)?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const decode = (text: string) => text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const title = (html: string) => decode(html.match(/<h2 class="info-title"[^>]*>([^<]*)</)?.[1] ?? '')

  beforeAll(() => {
    resetDirector()
    setMediaLibrary(expandPlayableCatalogue(JSON.parse(read('public/independent/playable.json'))))
  }, 120_000)

  it('A, B, C in turn: one INFO, describing whichever window is selected, curated and User Channels alike', () => {
    install([
      added(A, 'Alpha Kitchen', 1001, [{ id: 'aaaaaaaaaa1', title: 'Alpha Dinner', durationSec: 3600 }]),
      added(B, 'Bravo Garage', 1002, [{ id: 'bbbbbbbbbb1', title: 'Bravo Rebuild', durationSec: 3600 }]),
    ])
    const a = overlayFor(channelByNumber(1001)!)
    const b = overlayFor(channelByNumber(1002)!)
    const c = overlayFor(channelByNumber(769)!)
    expect(kicker(a)).toBe('TVN 1001 Alpha Kitchen')
    expect(title(a)).toBe('Alpha Dinner')
    expect(kicker(b)).toBe('TVN 1002 Bravo Garage')
    expect(title(b)).toBe('Bravo Rebuild')
    expect(kicker(c)).toBe('769 Indian Cooking')
    expect(title(c)).toBe(broadcast(channelByNumber(769)!, Date.now()).current.programme.title)
    for (const html of [a, b, c]) {
      expect(kicker(html)).not.toMatch(/\bUSER\b/i)
      expect(html).toContain('class="info-next"')
      expect(html).toMatch(/class="info-time"/)
    }
  })
})

describe('769 Indian Cooking at runtime', () => {
  const doc = JSON.parse(read('public/independent/playable.json')) as PlayableCatalogueV2
  const routed = new Set(doc.programmeRoutes?.['769'] ?? [])
  let items: LibraryMedia[] = []

  beforeAll(() => {
    items = expandPlayableCatalogue(doc)
    resetDirector()
    setMediaLibrary(items)
  }, 120_000)
  afterAll(() => resetDirector())

  it('is Indian Cooking, Manjula’s Kitchen first, 170 programmes and 24.6 hours recalculated from the catalogue', () => {
    expect(channelByNumber(769)!.name).toBe('Indian Cooking')
    const rows = doc.items.filter((row) => routed.has(row[0]))
    const hours = rows.reduce((sum, row) => sum + row[2], 0) / 3600
    console.info(`769 recalculated: ${rows.length} programmes, ${hours.toFixed(2)} h`)
    expect(rows).toHaveLength(170)
    expect(hours).toBeCloseTo(24.57, 1)
    expect(new Set(rows.map((row) => row[3]))).toEqual(new Set(['src_manjulas_kitchen']))
  })

  it('has a non-empty runtime pool, compiles a day, lists programmes in the Guide and airs one now', () => {
    const pool = getChannelMedia((schedulingPool(items) as unknown as MediaItem[]), 769)
    expect(pool.length).toBe(170)
    const now = Date.now()
    const day = getSchedule(channelByNumber(769)!, broadcastDateFor(now))
    expect(day.poolSize).toBeGreaterThan(0)
    const children = day.blocks.flatMap((block) => block.children).filter((child) => !child.fallback)
    expect(children.length).toBeGreaterThan(0)
    for (const child of children) expect(routed.has(child.videoId ?? ''), child.title).toBe(true)
    const slots = guideSlots(channelByNumber(769)!, now - 3_600_000, now + 6 * 3_600_000)
    expect(slots.length).toBeGreaterThan(1)
    // A day ends with a gap of seconds to a few minutes the director fills with a card; everything else is Indian cooking.
    const programmes = slots.filter((slot) => slot.programme.videoId)
    expect(programmes.length).toBeGreaterThan(1)
    for (const slot of programmes) expect(slot.programme.title).toMatch(INDIAN_COOKING_TITLE)
    for (const slot of slots.filter((item) => !item.programme.videoId)) expect(slot.endMs - slot.startMs).toBeLessThan(10 * 60_000)
    const airing = broadcast(channelByNumber(769)!, now).current.programme
    expect(routed.has(airing.videoId ?? ''), airing.title).toBe(true)
  })

  it('carries no generic food, no 1001+ channel and leaves 714 its 300 Manjula programmes', () => {
    const pool = getChannelMedia((schedulingPool(items) as unknown as MediaItem[]), 769) as LibraryMedia[]
    for (const item of pool) expect(item.title).toMatch(INDIAN_COOKING_TITLE)
    expect(pool.some((item) => item.provenance === 'built-in-user' || item.provenance === 'user-imported')).toBe(false)
    expect(pool.every((item) => (item.explicitChannelIncludes ?? []).every((number) => number <= 999))).toBe(true)
    const vegetarian = getChannelMedia((schedulingPool(items) as unknown as MediaItem[]), 714) as LibraryMedia[]
    expect(vegetarian.filter((item) => item.sourceId === 'src_manjulas_kitchen')).toHaveLength(300)
  })
})

describe('769 for a returning viewer: shipped routes reach a browser that already has the catalogue', () => {
  const doc = JSON.parse(read('public/independent/playable.json')) as PlayableCatalogueV2
  const shipped = () => expandPlayableCatalogue({ ...doc, items: doc.items.filter((row) => row[0] === 'LQsPJupfvH4' || row[0] === 'OnlQRaUZKGQ') })
  const session: ImportSession = {
    id: 'shipped',
    startedAt: 1,
    completedAt: 1,
    sourceFormat: 'youtube-discovery',
    sourceVersion: '1',
    sourceCounts: { collections: 0, videos: 2 },
    added: 0,
    updated: 0,
    unchanged: 0,
    duplicatesMerged: 0,
    userEditsPreserved: 0,
    missingFromImport: 0,
    errors: 0,
    status: 'complete',
  }

  afterEach(() => resetLibraryForTests())

  it('the 1.0.8 root cause: a list import re-stamped every shipped programme, so a new route never replaced it', () => {
    const [indian] = shipped()
    const before108 = { ...indian, curatedChannels: [726], explicitChannelIncludes: [714, 726] }
    const parsed: ParsedExport = { version: '2.4', sources: [{ id: 'src:starter', name: 'Starter', videos: videos('st', 2) }], videoCount: 2, totalSeconds: 0, watchedCount: 0, warnings: [] }
    const after = reconcileLibrary([before108], [], parsed, 1_790_899_614_924).media.find((item) => item.externalId === 'LQsPJupfvH4')!
    expect(after).toBe(before108)
    expect(after.memberships.every((membership) => membership.present)).toBe(true)
    expect(shippedRecordSupersedes({ ...before108, updatedAt: 1_790_899_614_924, memberships: [{ ...before108.memberships[0], present: false }] }, indian)).toBe(true)
    expect(shippedRecordSupersedes(before108, indian)).toBe(true)
    expect(shippedRecordSupersedes(indian, indian)).toBe(false)
  })

  it('a viewer’s own correction is kept', () => {
    const [indian] = shipped()
    const corrected = { ...indian, explicitChannelIncludes: [714], userEditedMetadata: ['explicitChannelIncludes'], updatedAt: indian.updatedAt + 10 }
    expect(shippedRecordSupersedes(corrected, indian)).toBe(false)
  })

  it('the stored library picks up 769 when the shipped catalogue is committed again', async () => {
    const [indian, pizza] = shipped()
    const stale = [
      { ...indian, curatedChannels: [726], explicitChannelIncludes: [714, 726], eligibleChannels: [714, 726], updatedAt: 1_790_899_614_924, memberships: [{ ...indian.memberships[0], present: false }] },
      { ...pizza, updatedAt: 1_790_899_614_924 },
    ]
    let saved: LibraryMedia[] = stale
    setLibraryWriter({ read: async () => ({ media: stale, sources: [] }), write: async (snapshot) => void (saved = snapshot.media) })
    await hydrateLibrary()
    await commitPlayableCatalogue(shipped(), session, true)
    const healed = librarySnapshot().media.find((item) => item.externalId === 'LQsPJupfvH4')!
    expect(healed.explicitChannelIncludes).toContain(769)
    expect(saved.find((item) => item.externalId === 'LQsPJupfvH4')!.curatedChannels).toContain(769)
    expect(librarySnapshot().media.find((item) => item.externalId === 'OnlQRaUZKGQ')!.explicitChannelIncludes).not.toContain(769)
  })
})
