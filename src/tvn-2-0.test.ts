import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProgrammeInfo } from './components/ProgrammeInfo.tsx'
import { playbackLabel } from './view/playback-label.ts'
import { UserNetworkImportTools } from './components/GuideAdd.tsx'
import { basePxPerMinute, TITLE_MIN_PX } from './epg/geometry.ts'
import { guideOpeningZoom } from './epg/opening-zoom.ts'
import { OPENING_ZOOMS, openingZoom, readableShare, titleShows, type OpeningFrame } from './epg/zoom.ts'
import { withSourceDrafts, type SourceFilter } from './services/channel-curation.ts'
import type { ChannelSource } from './services/channel-sources.ts'
import type { StoredSource } from './services/channels-import.ts'
import { EDITORIAL_MANIFEST_FORMAT } from './services/editorial-manifest.ts'
import {
  buildTvnExport,
  readRestoreFile,
  readTvnExportFile,
  serialiseTvnExport,
  TVN_EXPORT_FORMAT,
  validateTvnExport,
  type PortableSettings,
} from './services/tvn-export.ts'
import { USER_NETWORK_FORMAT } from './services/user-network-export.ts'
import { recordsFromExport } from './services/user-network-restore.ts'
import { DEFAULT_TRANSITION_SETTINGS } from './state/transitions.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'
import { DEFAULT_SHORTCUTS, SHORTCUTS } from './view/info-shortcuts.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const provider = read('src/state/TvProvider.tsx')
const NOW = Date.parse('2026-10-02T20:00:00Z')
const MIN = 60_000

const frame: OpeningFrame = { nowMs: NOW, basePx: basePxPerMinute(1400), viewportWidth: 1080, leadMs: 30 * MIN, titleMinPx: TITLE_MIN_PX }

/** A row of back-to-back programmes of these lengths in minutes, starting an hour before NOW. */
function row(...minutes: number[]) {
  let at = NOW - 60 * MIN
  return minutes.map((length) => {
    const slot = { startMs: at, endMs: at + length * MIN }
    at = slot.endMs
    return slot
  })
}
const repeat = (length: number, times: number) => Array.from({ length: times }, () => length)

describe('TVN 2.0 · adaptive Guide opening zoom', () => {
  it('films and half-hours open at the standard 1×', () => {
    expect(openingZoom([row(120, 120, 120), row(...repeat(30, 12)), row(90, 90, 90, 90)], frame)).toBe(1)
  })

  it('a screen of short clips opens at the lowest zoom that makes most titles readable', () => {
    const clips = [row(...repeat(5, 80)), row(...repeat(6, 70)), row(...repeat(4, 100))]
    const zoom = openingZoom(clips, frame)
    expect(zoom).toBeGreaterThan(1)
    expect(readableShare(clips, zoom, frame)).toBeGreaterThanOrEqual(0.6)
    const lower = [1, 1.5, 2, 3, 4, 5, 6].filter((step) => step < zoom)
    for (const step of lower) expect(readableShare(clips, step, frame)).toBeLessThan(0.6)
  })

  it('one short programme among long ones does not drive the choice', () => {
    expect(openingZoom([row(60, 2, 120, 120), row(120, 120, 120), row(90, 90, 90)], frame)).toBe(1)
  })

  it('the clip on air on the watched channel opens wide enough to show its title, when any zoom can', () => {
    const watched = row(60, 2, 120, 120)
    const onAir = watched[1]
    const zoom = openingZoom([watched, row(120, 120, 120), row(90, 90, 90)], frame, onAir)
    expect(zoom).toBeGreaterThan(1)
    expect(titleShows(onAir, zoom, frame)).toBe(true)
    for (const step of OPENING_ZOOMS.filter((value) => value < zoom)) expect(titleShows(onAir, step, frame)).toBe(false)
    const flash = { startMs: NOW, endMs: NOW + 1000 }
    expect(openingZoom([row(120, 120, 120)], frame, flash)).toBe(1)
  })

  it('never goes beyond the 1–10× range', () => {
    expect(openingZoom([row(...repeat(0.2, 2000))], frame)).toBe(1)
    expect(openingZoom([row(...repeat(1.5, 400))], frame)).toBeLessThanOrEqual(10)
    expect(guideOpeningZoom([], 1, NOW, 1400, 900)).toBe(1)
  })

  it('is an opening decision only: manual zoom wins afterwards, NOW still resets to 1×', () => {
    const open = provider.slice(provider.indexOf('const openGuide = (mode: GuideMode) => {'), provider.indexOf('guideModeRef.current = mode'))
    expect(open).toContain("if (guideModeRef.current === 'closed' && mode !== 'closed') {")
    expect(open).toContain('setGuideZoomState(guideOpeningZoom(')
    expect(provider.match(/guideOpeningZoom\(/g)).toHaveLength(1)
    expect(provider).toContain('const setGuideZoom = useCallback((zoom: number) => setGuideZoomState(clampZoom(zoom)), [])')
    expect(provider).toMatch(/case 'guide-now': \{[\s\S]*?setGuideZoomState\(1\)/)
    expect(read('src/components/Guide.tsx')).toContain('const pxPerMinute = usePxPerMinute() * tv.guideZoom')
  })
})

describe('TVN 2.0 · Information Overlay playback label', () => {
  const channel = { number: 12, name: 'Twelve', origin: 'default' } as Channel
  const video = { id: 'p', title: 'Film', videoId: 'abcdefghijk', durationSeconds: 1800 } as Programme
  const stream = { id: 'l', title: 'News', videoId: null, durationSeconds: 0, liveStream: { url: 'https://example.invalid/a.m3u8' } } as unknown as Programme
  const local = { id: 's', title: 'Home', videoId: null, durationSeconds: 60, sourceRef: 'local:s' } as unknown as Programme
  const render = (props: Partial<Parameters<typeof ProgrammeInfo>[0]>) =>
    renderToStaticMarkup(createElement(ProgrammeInfo, { channel, programme: video, startMs: NOW - MIN, endMs: NOW + 29 * MIN, now: NOW, ...props }))

  it('is LIVE, VIDEO or LOCAL; a Guide pick is VIDEO', () => {
    expect(playbackLabel(channel, video)).toBe('Video')
    expect(playbackLabel(channel, stream)).toBe('Live')
    expect(playbackLabel({ ...channel, origin: 'session' } as Channel, local)).toBe('Local')
    expect(playbackLabel(channel, { ...video, videoId: null, mediaUrl: 'https://cdn.example.net/episode.mp3', mediaKind: 'audio' } as Programme)).toBe('Audio')
    const picked = render({ picked: true, startMs: NOW - 120 * MIN, endMs: NOW - 90 * MIN })
    expect(picked).toContain('<span class="info-kind is-picked">Video</span>')
    expect(picked).not.toMatch(/from guide|returning|already broadcast/i)
    expect(render({ programme: stream })).toContain('<span class="info-kind">Live</span>')
  })

  it('is small and subordinate: uppercase in CSS, muted, gold only for a pick', () => {
    const css = read('src/styles/guide.css')
    expect(css).toMatch(/\.info-kind \{[^}]*text-transform: uppercase;[^}]*font-size: 12px;[^}]*color: var\(--muted\);/)
    expect(css).toContain('.info-kind.is-picked { color: var(--gold); }')
  })
})

describe('TVN 2.0 · R owns Random, Settings owns settings', () => {
  it('the old TVN corner is Settings and opens OPTIONS; touch reaches the Random settings there', () => {
    expect(DEFAULT_SHORTCUTS.bottomLeft).toBe('settings')
    const sent: unknown[] = []
    const context = { captionsAvailable: false, fullscreenAvailable: true, subtitles: false, remoteOpen: false, surfing: false, openRandomSettings: () => {}, dispatch: (command: unknown) => void sent.push(command) }
    SHORTCUTS.settings.run(context)
    expect(sent).toEqual([{ type: 'guide-tool', tool: 'options' }])
    const options = read('src/components/GuideOptions.tsx')
    expect(options).toContain('<Card title="Random Cycle">')
    expect(options).toContain('{toggle(tv.surfing, [\'Stop\', \'Start\'], tv.toggleSurf)}')
  })

  it('one Random implementation: T’s click surfs with the existing command; hold and right-click switch its scope, nothing else', () => {
    const sent: unknown[] = []
    let opened = 0
    let toggled = 0
    const context = {
      captionsAvailable: false,
      fullscreenAvailable: true,
      subtitles: false,
      remoteOpen: false,
      surfing: false,
      openRandomSettings: () => void opened++,
      toggleSurfScope: () => void toggled++,
      dispatch: (command: unknown) => void sent.push(command),
    }
    SHORTCUTS.random.run(context)
    SHORTCUTS.random.hold?.(context)
    SHORTCUTS.random.menu?.(context)
    expect(sent).toEqual([{ type: 'random-channel' }])
    expect(toggled).toBe(2)
    expect(opened).toBe(0)
    expect(provider.match(/case 'random-channel':/g)).toHaveLength(1)
    expect(provider.match(/case 'surf':/g)).toHaveLength(1)
  })
})

describe('TVN 2.0 · Edit Channel: filter before rescan', () => {
  const filter: SourceFilter = { include: { terms: ['live'] }, exclude: { shorts: true } }
  const source = (id: string, patch: Partial<ChannelSource> = {}) =>
    ({ id, kind: 'youtube', url: 'https://www.youtube.com/channel/UC0123456789012345678901', label: id, enabled: true, videos: [], ...patch }) as ChannelSource

  it('a rescan takes each source’s confirmed mode and filter; other sources are left alone', () => {
    const drafts = new Map([['a', { filter, mode: 'archive' as const }], ['b', { filter: undefined, mode: 'recent' as const }]])
    const [a, b, c] = withSourceDrafts([source('a'), source('b', { mode: 'all', filter }), source('c', { mode: 'all' })], drafts)
    expect(a).toMatchObject({ filter, mode: 'archive' })
    expect(b.filter).toBeUndefined()
    expect(b.mode).toBeUndefined()
    expect(c).toMatchObject({ mode: 'all' })
  })

  it('the editor applies pending drafts before the rescan runs, in SOURCE → MODE → FILTER → PREVIEW → RESCAN order', () => {
    const editor = read('src/components/ChannelEditor.tsx')
    expect(editor).toMatch(/sources: withSourceDrafts\(base\.sources, all\)[\s\S]*?run\('rescan',/)
    expect(editor).toContain('Apply filters & rescan')
    expect(editor).toContain('A channel can draw on several sources, each with its own mode and filter.')
    const panel = read('src/components/ChannelCuration.tsx')
    const steps = ['1 · Mode', '2 · Filter', '3 · Preview', '4 · Rescan'].map((step) => panel.indexOf(step))
    expect(steps.every((at) => at > 0)).toBe(true)
    expect([...steps].sort((x, y) => x - y)).toEqual(steps)
    expect(panel).toContain('Apply & rescan')
  })

  it('manifests are reached from Edit Channel as JSON and readable text, no PDF', () => {
    const editor = read('src/components/ChannelEditor.tsx')
    expect(editor).toContain('Export manifest')
    expect(editor).toContain('Readable manifest')
    expect(editor).not.toMatch(/pdf/i)
  })
})

describe('TVN 2.0 · COMPLETE TVN EXPORT (tvn-export-v1)', () => {
  const user = { id: 'ualice', name: 'Alice' }
  const videos = [
    { id: 'aaaaaaaaaaa', title: 'One', durationSec: 600 },
    { id: 'bbbbbbbbbbb', title: 'Two', durationSec: 900 },
  ]
  const filter: SourceFilter = { include: { terms: ['One'] } }
  const stored: StoredSource[] = [
    {
      id: 'src:alice',
      name: 'Alice list',
      videos,
      channelNumber: 1001,
      inLibrary: true,
      automatic: true,
      updatedAt: 1,
      owner: 'ualice',
      editorial: { purpose: 'Testing', gaps: 'More', eras: '1990s', targetProgrammes: 20 },
      runningOrder: ['bbbbbbbbbbb', 'aaaaaaaaaaa'],
      channelSources: [
        { id: 's1', kind: 'youtube', url: 'https://www.youtube.com/playlist?list=PL0123456789', label: 'List', enabled: true, ref: 'PL0123456789', youtube: 'playlist', videos, filter, mode: 'all' },
      ],
    } as StoredSource,
  ]
  const settings: PortableSettings = {
    volume: 55,
    muted: false,
    subtitles: true,
    sleepMinutes: 90,
    guideSplit: 0.4,
    infoShortcuts: { ...DEFAULT_SHORTCUTS },
    surfRange: { minSeconds: 5, maxSeconds: 20 },
    transition: 'instant',
    transitionStyle: { ...DEFAULT_TRANSITION_SETTINGS, id: 'instant' },
  }
  const build = () => buildTvnExport({ stored, users: [user], favourites: [12, 1001], settings, now: new Date(NOW) })

  it('round-trips users, channels, owners, sources, filters, modes, running order, editorial, favourites and settings', () => {
    const text = serialiseTvnExport(build())
    const back = readTvnExportFile(text)
    if (!back.ok) throw new Error(back.errors.join('; '))
    expect(back.value.format).toBe(TVN_EXPORT_FORMAT)
    expect(back.value.version).toBe(1)
    expect(back.value.userNetwork.format).toBe(USER_NETWORK_FORMAT)
    expect(back.value.favourites).toEqual([12, 1001])
    expect(back.value.settings).toEqual(settings)
    expect(back.value.manifests.map((manifest) => manifest.format)).toEqual([EDITORIAL_MANIFEST_FORMAT])
    const [record] = recordsFromExport(back.value.userNetwork, NOW)
    expect(record.owner).toBe('ualice')
    expect(record.editorial).toMatchObject({ purpose: 'Testing', gaps: 'More', eras: '1990s', targetProgrammes: 20 })
    expect(record.channelSources?.[0]).toMatchObject({ filter, mode: 'all' })
    expect(back.value.userNetwork.users).toEqual([user])
    expect(readRestoreFile(text).kind).toBe('complete')
  })

  it('leaves out secrets, caches, player state, history and startup state', () => {
    const text = serialiseTvnExport(build())
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['central', 'exportedAt', 'favourites', 'format', 'guides', 'manifests', 'settings', 'userNetwork', 'version'])
    expect(text).not.toMatch(/lastChannel|previousChannel|history|refus|starter|startup|multiviewChannels|apiKey|"key"|token/i)
  })

  it('refuses a malformed file whole, naming every fault', () => {
    const good = build()
    const bad = (patch: Record<string, unknown>) => validateTvnExport({ ...JSON.parse(JSON.stringify(good)), ...patch })
    expect(bad({ format: 'tvn-export-v9' }).ok).toBe(false)
    expect(bad({ version: 2 }).ok).toBe(false)
    expect(bad({ favourites: [12, 12] }).ok).toBe(false)
    expect(bad({ favourites: ['12'] }).ok).toBe(false)
    expect(bad({ settings: { ...settings, volume: 140 } }).ok).toBe(false)
    expect(bad({ settings: { ...settings, transition: 'wipe' } }).ok).toBe(false)
    expect(bad({ settings: { ...settings, surfRange: { minSeconds: 30, maxSeconds: 5 } } }).ok).toBe(false)
    expect(bad({ settings: { ...settings, infoShortcuts: { ...DEFAULT_SHORTCUTS, topLeft: 'random' } } }).ok).toBe(false)
    expect(bad({ userNetwork: { ...good.userNetwork, channels: [{ number: 5 }] } }).ok).toBe(false)
    expect(bad({ apiKey: 'x' }).ok).toBe(false)
    const several = bad({ version: 2, favourites: 'none', settings: { volume: -1 } })
    expect(several.ok).toBe(false)
    if (!several.ok) expect(several.errors.length).toBeGreaterThanOrEqual(3)
    expect(readTvnExportFile('{ not json').ok).toBe(false)
    const restore = readRestoreFile(JSON.stringify({ ...good, settings: { volume: 'loud' } }))
    expect(restore).toMatchObject({ kind: 'complete', ok: false })
  })

  it('a restore checks the whole file before anything changes, then asks; Favourites and settings follow the network', () => {
    const restore = provider.slice(provider.indexOf('const importTvn = useCallback('), provider.indexOf('const openChannelEdit = useCallback('))
    const order = ['validateTvnExport(document)', 'throw new Error', 'await importUserNetwork(', 'setFavourites(', 'setVolume(']
    const at = order.map((step) => restore.indexOf(step))
    expect(at.every((index) => index >= 0)).toBe(true)
    expect([...at].sort((x, y) => x - y)).toEqual(at)
    const footer = renderToStaticMarkup(createElement(UserNetworkImportTools, { userChannels: 2, onApply: async () => '', onApplyComplete: async () => '' }))
    expect(footer).toContain('Choose file')
    expect(read('src/components/GuideAdd.tsx')).toContain('Restore complete TVN export? This will replace your Favourites')
  })

  it('existing User Network files still restore through the same Restore', () => {
    const legacy = JSON.stringify({ format: USER_NETWORK_FORMAT, version: 1, exportedAt: '2026-09-01T00:00:00.000Z', numbering: { first: 1001, limit: 10000 }, channels: [] })
    expect(readRestoreFile(legacy)).toMatchObject({ kind: 'network', ok: true })
  })
})
