import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { channels } from './data/catalogue.ts'
import {
  addToGuide,
  applyGuideAction,
  DEFAULT_GUIDE_NAME,
  EMPTY_LIBRARY,
  libraryFrom,
  NEW_MAP_NAME,
  newGuide,
  unnamedMap,
  unsaved,
  type GuideLibrary,
} from './services/viewing-guides.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'
import { cornerActions, randomScoped } from './view/info-shortcuts.ts'
import { mapSources, mapSummary } from './view/map-summary.ts'
import { alphabeticalVideos, latestVideos } from './view/programme-order.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const NOW = Date.parse('2026-10-03T12:00:00Z')
const prog = (id: string, title: string, seconds: number): Programme =>
  ({ id, title, videoId: `${id}`.padEnd(11, 'x'), durationSeconds: seconds, channelId: 'c', category: 'x', source: 'youtube', kind: 'programme', playbackMode: 'linear' }) as Programme
const alpha = { ...channels[0], id: 'map-a', number: 21, name: 'Alpha', origin: 'default', enabled: true } as Channel
const bravo = { ...channels[0], id: 'map-b', number: 34, name: 'Bravo', origin: 'default', enabled: true } as Channel

describe('MY GUIDE holds Maps', () => {
  const evening = () => addToGuide(addToGuide(newGuide('Evening', NOW), alpha, prog('a1', 'One', 3600), NOW + 1), bravo, prog('b1', 'Two', 720), NOW + 2)

  it('a Map reads as its length, programme count and the channels it draws on', () => {
    expect(mapSummary(evening())).toBe('1h 12m · 2 programmes')
    expect(mapSummary(newGuide('Empty', NOW))).toBe('Empty · 0 programmes')
    expect(mapSources(evening())).toBe('Alpha · Bravo')
  })

  it('a new or old unnamed Map takes its topic’s name; a named one keeps its own', () => {
    expect(NEW_MAP_NAME).toBe('New Map')
    expect(unnamedMap(newGuide(NEW_MAP_NAME, NOW))).toBe(true)
    expect(unnamedMap(newGuide(DEFAULT_GUIDE_NAME, NOW))).toBe(true)
    expect(unnamedMap(evening())).toBe(false)
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain('library.current ?? newGuide(NEW_MAP_NAME, now)')
    expect(provider).toMatch(/unnamedMap\(library\.current\)/)
  })

  it('create, build, save, a second Map, duplicate and delete another without touching the one being edited', () => {
    let library: GuideLibrary = applyGuideAction(EMPTY_LIBRARY, { type: 'new', name: NEW_MAP_NAME }, NOW)
    library = { ...library, current: evening() }
    expect(unsaved(library)).toBe(true)
    library = applyGuideAction(library, { type: 'save' }, NOW + 3)
    expect(unsaved(library)).toBe(false)
    const first = library.current!
    library = applyGuideAction(library, { type: 'new', name: NEW_MAP_NAME }, NOW + 4)
    library = applyGuideAction(library, { type: 'rename', name: 'Morning' }, NOW + 5)
    library = applyGuideAction(library, { type: 'save' }, NOW + 6)
    expect(library.saved.map((guide) => guide.name)).toEqual(['Evening', 'Morning'])
    const editing = library.current!
    library = applyGuideAction(library, { type: 'duplicate', id: first.id }, NOW + 7)
    expect(library.current).toBe(editing)
    expect(library.saved.map((guide) => guide.name)).toEqual(['Evening', 'Morning', 'Evening copy'])
    library = applyGuideAction(library, { type: 'delete', id: first.id }, NOW + 8)
    expect(library.current).toBe(editing)
    expect(library.saved.map((guide) => guide.name)).toEqual(['Morning', 'Evening copy'])
    library = applyGuideAction(library, { type: 'delete', id: editing.id }, NOW + 9)
    expect(library.current).toBeNull()
    expect(library.saved.map((guide) => guide.name)).toEqual(['Evening copy'])
  })

  it('a Guide saved before Maps existed reads as a Map, unchanged', () => {
    const old = { ...evening(), name: DEFAULT_GUIDE_NAME }
    const library = libraryFrom({ current: old, saved: [old] })
    expect(library.saved[0].items).toHaveLength(2)
    expect(mapSummary(library.saved[0])).toBe('1h 12m · 2 programmes')
  })

  it('the panel lists Maps with PLAY, EDIT, DUPLICATE and DELETE, and builds stay inside the Map editor', () => {
    const panel = read('src/components/GuidePanel.tsx')
    for (const text of ["'+ New Map'", "'‹ All Maps'", 'className="map-list"', "'Edit'", "'Duplicate'", "'Delete'", "'Build from sources'", 'Build from topic', 'IS NOT SAVED · PRESS AGAIN TO LEAVE IT']) {
      expect(panel, text).toContain(text)
    }
    expect(read('src/components/GuideAdd.tsx')).not.toContain('guide-query')
    expect(read('src/components/Guide.tsx')).not.toMatch(/query=\{tv\.guideSearch/)
  })

  it('My Guide uses the Guide’s own type, as OPTIONS and NETWORK do', () => {
    expect(read('src/styles/guide.css')).toMatch(/\.guide-info\.guide-plan \{[^}]*font-family: var\(--font-ui\)/)
  })
})

describe('the green GUIDE while a Map plays', () => {
  const pad = read('src/components/InfoActions.tsx')
  const provider = read('src/state/TvProvider.tsx')

  it('click shows the Map’s schedule; right-click or a long press shows the NOW Guide and the Map plays on', () => {
    expect(pad).toContain("corners.dispatch({ type: 'guide', listings: true })")
    expect(pad).toContain('onContextMenu')
    expect(pad).toContain('guideHold')
    expect(provider).toMatch(/if \(command\.listings\) \{\s*\/\/[^\n]*\n\s*if \(guideModeRef\.current === 'closed'\) openGuide\('expanded'\)\s*else if \(guideToolRef\.current\) closeGuideTool\(\)\s*break/)
  })
})

describe('Random scope', () => {
  it('TVN draws from a User Network while its tab is chosen, and shows it', () => {
    expect(randomScoped('all')).toBe(false)
    expect(randomScoped('favourites')).toBe(false)
    expect(randomScoped('user')).toBe(true)
    expect(randomScoped('user:abc')).toBe(true)
    const dispatch = () => {}
    expect(cornerActions({ dispatch, guideFilter: 'user' } as never).randomScoped).toBe(true)
    expect(cornerActions({ dispatch, guideFilter: 'all' } as never).randomScoped).toBe(false)
    expect(read('src/components/InfoActions.tsx')).toContain(' is-scoped')
    expect(read('src/styles/guide.css')).toContain('.info-pad > .info-corner.is-scoped')
  })

  it('OPTIONS names the scope: Random from All or a named User Network, beside Random Cycle', () => {
    const options = read('src/components/GuideOptions.tsx')
    expect(options).toContain('label="Random from"')
    expect(options).toContain('userNetworkName(undefined, tv.networkUsers)')
    expect(options).not.toMatch(/['"]TVN['"]\s*\)/)
  })
})

describe('Edit Channel running order', () => {
  const videos = [
    { id: 'v1', title: 'zebra crossing', published: '2024-02-01' },
    { id: 'v2', title: 'Apple 10', published: undefined },
    { id: 'v3', title: 'apple 9', published: '2026-01-05' },
    { id: 'v4', title: '“Banana”', published: '2026-01-05' },
    { id: 'v5', title: 'Live: Cherry', published: undefined },
  ]

  it('A–Z ignores case and punctuation and counts numbers as numbers', () => {
    expect(alphabeticalVideos(videos).map((video) => video.id)).toEqual(['v3', 'v2', 'v4', 'v5', 'v1'])
  })

  it('LATEST is newest first, unknown dates last, ties in their own order', () => {
    expect(latestVideos(videos).map((video) => video.id)).toEqual(['v3', 'v4', 'v1', 'v2', 'v5'])
    expect(latestVideos(videos).map((video) => video.id)).toEqual(latestVideos(latestVideos(videos)).map((video) => video.id))
  })

  it('sorting saves as the running order and never starts playback; PLAY LATEST does', () => {
    const editor = read('src/components/ChannelEditor.tsx')
    expect(editor).toContain("sortBy('az')")
    expect(editor).toContain("sortBy('latest')")
    expect(editor).toContain('onPlay(number, latest.id)')
    expect(editor).toMatch(/const sortBy = [\s\S]*?order:/)
    expect(editor).not.toMatch(/const sortBy = [^}]*onPlay/)
    expect(editor).toContain('<span className="editor-live">Live</span>')
  })
})

describe('shortcut hints', () => {
  it('read M Mute, / Multi, comma and full stop, U Add and − = Guide zoom, and no M Multi or K', () => {
    const text = read('src/components/Hints.tsx')
    for (const part of ['M Mute', '/ Multi', 'B N Prev/Next', ', . Programme', 'U Add', '− = Guide zoom']) expect(text).toContain(part)
    expect(text).not.toContain('M Multi')
    expect(text).not.toMatch(/\bK\b/)
  })
})

describe('REMOTE SMART', () => {
  const remote = read('src/components/TouchRemote.tsx')
  const provider = read('src/state/TvProvider.tsx')

  it('the row reads USER · SMART · FAV, SMART a round on/off key named Smart', () => {
    const user = remote.search(/>\s*User\s*</)
    const smart = remote.indexOf('aria-label="Smart"')
    expect(remote.slice(smart, smart + 600)).toContain('className="smart-mark"')
    expect(read('src/styles/stage2.css')).toMatch(/\.remote-row \.smart-key \{[^}]*border-radius: 50%/)
    const fav = remote.search(/>\s*Fav\s*</)
    expect(user).toBeGreaterThan(0)
    expect(smart).toBeGreaterThan(user)
    expect(fav).toBeGreaterThan(smart)
    expect(remote).toContain("tv.smart ? 'smart-key is-on' : 'smart-key'")
    expect(remote).toContain('padRef.current?.focus()')
  })

  it('a channel that tunes closes the remote unless SMART is on, which keeps it up; NO CHANNEL keeps it open for another go', () => {
    const commit = provider.slice(provider.indexOf('commitNumericRef.current = '), provider.indexOf('commitNumericRef.current = ') + 1500)
    expect(commit).toContain('NO CHANNEL')
    const tune = commit.indexOf('requestTune(')
    const close = commit.indexOf('if (!smartRef.current) {')
    expect(close).toBeGreaterThan(tune)
    expect(commit.slice(close, close + 200)).toContain('setRemoteOpen(false)')
    expect(commit).not.toContain('setSmart(false)')
    expect(commit.slice(0, tune)).not.toContain('setRemoteOpen(false)')
    expect(provider).toMatch(/case 'smart':[\s\S]{0,120}setRemoteOpen\(true\)/)
  })
})
