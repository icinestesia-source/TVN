import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GuideActions } from './components/GuideAdd.tsx'
import { InfoActions } from './components/InfoActions.tsx'
import { ProgrammeInfo } from './components/ProgrammeInfo.tsx'
import { channels } from './data/catalogue.ts'
import { padProps } from './info-pad.fixture.ts'
import { buildTvnExport, readTvnExportFile, serialiseTvnExport, type PortableSettings } from './services/tvn-export.ts'
import {
  addToGuide,
  applyGuideAction,
  cannotAdd,
  DEFAULT_GUIDE_NAME,
  EMPTY_LIBRARY,
  GUIDES_FORMAT,
  GUIDES_KEY,
  libraryFrom,
  loadGuideLibrary,
  newGuide,
  nextPlayable,
  resolveItem,
  saveGuideLibrary,
  unsaved,
  type GuideLibrary,
  type GuideRun,
  type ItemLookup,
  type ViewingGuide,
} from './services/viewing-guides.ts'
import { DEFAULT_TRANSITION_SETTINGS } from './state/transitions.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'
import { DEFAULT_SHORTCUTS } from './view/info-shortcuts.ts'
import { followingInfo } from './view/guide-following.ts'

const NOW = Date.parse('2026-10-02T12:00:00Z')
const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')
const guideView = readFileSync('src/components/Guide.tsx', 'utf8')

const prog = (channelId: string, id: string, videoId: string, title: string): Programme =>
  ({ id, title, videoId, durationSeconds: 1500, channelId, category: 'x', source: 'youtube', kind: 'programme', playbackMode: 'linear' }) as Programme
const first = { ...channels[0], id: 'guide-a', number: 21, name: 'Alpha', origin: 'default', enabled: true } as Channel
const second = { ...channels[0], id: 'guide-b', number: 34, name: 'Bravo', origin: 'default', enabled: true } as Channel
const a1 = prog(first.id, 'a1', 'aaaaaaaaaa1', 'Alpha one')
const a2 = prog(first.id, 'a2', 'aaaaaaaaaa2', 'Alpha two')
const b1 = prog(second.id, 'b1', 'bbbbbbbbbb1', 'Bravo one')
const listed: Record<string, Programme[]> = { [first.id]: [a1, a2], [second.id]: [b1] }

const lookup = (refused: string[] = []): ItemLookup => ({
  channelByNumber: (number) => [first, second].find((channel) => channel.number === number),
  programmesFor: (id) => listed[id] ?? [],
  refused: new Set(refused),
})
const threeItems = (): ViewingGuide => {
  let guide = newGuide('Evening', NOW)
  guide = addToGuide(guide, first, a1, NOW + 1)
  guide = addToGuide(guide, second, b1, NOW + 2)
  return addToGuide(guide, first, a2, NOW + 3)
}
const memoryStore = () => {
  const memory = new Map<string, string>()
  return { memory, store: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) } }
}
const run = (guide: ViewingGuide, patch: Partial<GuideRun> = {}): GuideRun => ({ guide, index: 0, state: 'active', programmeId: null, endsAt: null, skipped: [], ...patch })

const settings: PortableSettings = {
  volume: 40,
  muted: false,
  subtitles: false,
  sleepMinutes: 0,
  guideSplit: 0.5,
  infoShortcuts: { ...DEFAULT_SHORTCUTS },
  surfRange: { minSeconds: 5, maxSeconds: 20 },
  transition: 'tv-tune',
  transitionStyle: { ...DEFAULT_TRANSITION_SETTINGS },
}

describe('TVN 2.0 · building a viewing Guide', () => {
  it('ADD TO GUIDE makes a Guide when there is none and keeps references only', () => {
    expect(provider).toContain('library.current ?? newGuide(DEFAULT_GUIDE_NAME, now)')
    const guide = addToGuide(newGuide(DEFAULT_GUIDE_NAME, NOW), first, a1, NOW)
    expect(guide.name).toBe('My Guide')
    expect(guide.items).toHaveLength(1)
    const [item] = guide.items
    expect(item).toMatchObject({ channelNumber: first.number, channelName: first.name })
    expect(item.programme).toMatchObject({ id: a1.id, title: a1.title, videoId: a1.videoId, durationSeconds: a1.durationSeconds, source: a1.source })
    expect(Object.keys(item.programme)).not.toContain('channelId')
  })

  it('refuses what cannot be played in sequence', () => {
    expect(cannotAdd({ number: 0, origin: 'session' }, a1)).toMatch(/Local files/)
    expect(cannotAdd({ number: 1004, origin: 'user-import' }, { ...a1, source: 'imported' })).toBeNull()
    expect(cannotAdd(first, { ...a1, liveStream: { kind: 'youtube-live' } as unknown as Programme['liveStream'] })).toMatch(/live stream/)
    expect(cannotAdd(first, { ...a1, videoId: null as unknown as string })).toMatch(/Nothing to play/)
    expect(cannotAdd(first, a1)).toBeNull()
  })

  it('reorders, removes and clears without touching anything else', () => {
    let library: GuideLibrary = { current: threeItems(), saved: [] }
    const [x, y, z] = library.current!.items
    library = applyGuideAction(library, { type: 'move', itemId: z.id, delta: -1 }, NOW)
    expect(library.current!.items.map((item) => item.id)).toEqual([x.id, z.id, y.id])
    library = applyGuideAction(library, { type: 'move', itemId: x.id, delta: -1 }, NOW)
    expect(library.current!.items[0].id).toBe(x.id)
    library = applyGuideAction(library, { type: 'remove', itemId: z.id }, NOW)
    expect(library.current!.items.map((item) => item.id)).toEqual([x.id, y.id])
    library = applyGuideAction(library, { type: 'clear' }, NOW)
    expect(library.current!.items).toEqual([])
  })

  it('saves, renames, duplicates, loads and deletes Guides; nothing is shipped as an example', () => {
    expect(loadGuideLibrary(memoryStore().store)).toEqual(EMPTY_LIBRARY)
    let library: GuideLibrary = { current: threeItems(), saved: [] }
    expect(unsaved(library)).toBe(true)
    library = applyGuideAction(library, { type: 'save' }, NOW)
    expect(unsaved(library)).toBe(false)
    const id = library.current!.id
    library = applyGuideAction(library, { type: 'rename', name: '  Saturday   night ' }, NOW + 5)
    expect(library.saved[0].name).toBe('Saturday night')
    expect(unsaved(library)).toBe(false)
    library = applyGuideAction(library, { type: 'remove', itemId: library.current!.items[0].id }, NOW + 6)
    library = applyGuideAction(library, { type: 'rename', name: 'Sat' }, NOW + 7)
    expect(unsaved(library)).toBe(true)
    library = applyGuideAction(library, { type: 'duplicate' }, NOW + 8)
    expect(library.saved).toHaveLength(2)
    expect(library.current!.id).not.toBe(id)
    expect(library.current!.name).toBe('Sat copy')
    library = applyGuideAction(library, { type: 'load', id }, NOW + 9)
    expect(library.current!.id).toBe(id)
    expect(library.current!.items).toHaveLength(3)
    library = applyGuideAction(library, { type: 'delete' }, NOW + 10)
    expect(library.current).toBeNull()
    expect(library.saved.map((guide) => guide.name)).toEqual(['Sat copy'])

    const { memory, store } = memoryStore()
    saveGuideLibrary(library, store)
    expect(JSON.parse(memory.get(GUIDES_KEY)!).saved).toHaveLength(1)
    expect(loadGuideLibrary(store)).toEqual(library)
  })
})

describe('TVN 2.0 · playing a Guide', () => {
  it('starting plays the first item from its beginning through the manual-pick machinery, never the schedule', () => {
    expect(provider).toContain("playGuideFrom({ guide: structuredClone(current), index: fromIndex, state: 'active', programmeId: null, endsAt: null, skipped: [] }, fromIndex, 1)")
    expect(provider).toMatch(/guideDrivingRef\.current = true\s+try \{\s+playFromGuide\(resolved\.channel, resolved\.programme\)/)
    const engine = provider.slice(provider.indexOf('// ── GUIDES'), provider.indexOf('const activateGuide = useCallback'))
    expect(engine).not.toMatch(/saveCuratedEdit|saveChannelEdit|runningOrder|setSchedule/)
  })

  it('advances when the item finishes, and only while active', () => {
    expect(provider).toMatch(
      /const run = guideRunRef\.current\s+if \(run\?\.state === 'active' && run\.programmeId\) \{\s+const manual = manualAiring\(current\.number, nowMs\)\s+if \(!manual \|\| manual\.programme\.id !== run\.programmeId\) \{\s+guideEngine\.current\.advance\(manual === null\)/,
    )
    const guide = threeItems()
    expect(nextPlayable(guide, 1, 1, () => true)).toBe(1)
    expect(nextPlayable(guide, 3, 1, () => true)).toBeNull()
  })

  it('crosses channels with the viewer transition and stays on a channel with the plain black cut', () => {
    const play = provider.slice(provider.indexOf('const playFromGuide = '), provider.indexOf('// ── GUIDES'))
    expect(play).toMatch(/if \(pickTunes\(target\.number, channelRef\.current, tuningRef\.current\)\) \{\s+requestTune\(target\.number, true\)/)
    expect(play).toContain("loadedKey.current = ''")
    expect(play).not.toContain('presentationRef')
    expect(provider).toContain("const presents = startupSettledRef.current && settings.id !== 'instant'")
  })

  it('reads green only while a Guide is followed: not when suspended, not because the Guide screen is open', () => {
    const guide = threeItems()
    expect(followingInfo(null)).toBeNull()
    expect(followingInfo(run(guide, { state: 'suspended' }))).toBeNull()
    expect(followingInfo(run(guide))).toEqual({ next: { title: b1.title, channelNumber: second.number } })
    expect(followingInfo(run(guide, { index: 2 }))).toEqual({ next: null })
    expect(followingInfo(run({ ...guide, loop: true }, { index: 2 }))?.next?.title).toBe(a1.title)

    const pad = (following: boolean) => renderToStaticMarkup(createElement(InfoActions, { channel: first, programme: a1, onPrev: () => {}, onNext: () => {}, ...padProps(), following, ...(following ? { guideSteps: { onPrev: () => {}, onNext: () => {} } } : {}) }))
    expect(pad(false)).not.toContain('is-following')
    expect(pad(true)).toMatch(/class="tune-key info-pad-guide is-following"[^>]*aria-label="Guide, TVN is following a Guide"/)
    expect(pad(true)).toContain('aria-label="Next item in the Guide"')

    const info = (props: { picked?: boolean; following?: ReturnType<typeof followingInfo> }) =>
      renderToStaticMarkup(createElement(ProgrammeInfo, { channel: first, programme: a1, startMs: NOW, endMs: NOW + 60_000, now: NOW + 1000, ...props }))
    expect(info({ picked: true })).toContain('info-kind is-picked')
    expect(info({ picked: true })).not.toContain('is-following')
    expect(info({ picked: true, following: followingInfo(run(guide)) })).toContain('info-kind is-following')
    expect(info({ picked: true, following: followingInfo(run(guide)) })).toContain('Following Guide')

    const header = (following: boolean, tool: 'guides' | null) => renderToStaticMarkup(createElement(GuideActions, { tool, picked: true, following, onNow: () => {}, onTool: () => {} }))
    expect(header(false, 'guides')).not.toContain('is-following')
    expect(header(true, null)).toContain('guide-follow is-current is-following')
    expect(header(false, null)).toMatch(/class="tab guide-follow is-current"[^>]*aria-current="page"[^>]*aria-expanded="false"/)
    expect(header(false, 'guides')).toContain('class="tab guide-follow is-current is-open"')
    expect(header(false, 'guides')).not.toMatch(/class="[^"]*\bis-on\b[^"]*"[^>]*>Guide</)
    const add = readFileSync('src/components/GuideAdd.tsx', 'utf8')
    expect(add).toMatch(/onContextMenu=\{\(event\) => \{\s+event\.preventDefault\(\)\s+press\.opened\(\)\s+onToggle\(\)/)
    expect(add).toMatch(/if \(press\.swallowClick\(\)\) return\s+if \(open\) onToggle\(\)/)
    expect(header(false, null)).toMatch(/>Guide<\/button><button[^>]*>Options<\/button><button[^>]*>Now<\/button><button[^>]*>Add<\/button><button[^>]*>Media</)
    expect(guideView).toContain("const following = tv.guideRun?.state === 'active'")
  })

  it('a manual tune, NOW, a Guide pick or MULTI suspends the Guide, which stays loaded and resumes', () => {
    expect(provider).toMatch(/if \(!keepPick\) clearManual\(\)\s+if \(!guideDrivingRef\.current\) guideEngine\.current\.suspend\(\)/)
    expect(provider).toMatch(/const playFromGuide = [^\n]+\n\s+if \(!guideDrivingRef\.current\) guideEngine\.current\.suspend\(\)/)
    expect(provider).toMatch(/guideEngine\.current\.suspend\(\)\s+if \(clearManual\(\)\) \{/)
    expect(provider).toMatch(/case 'multiview': \{\s+guideEngine\.current\.suspend\(\)/)
    expect(provider).toContain("if (run?.state === 'active') setGuideRun({ ...run, state: 'suspended' })")
    const resume = provider.slice(provider.indexOf('const resumeGuideAction'), provider.indexOf('const stopGuideAction'))
    expect(resume).toContain('playGuideFrom(run, run.index, 1)')
    expect(readFileSync('src/components/GuidePanel.tsx', 'utf8')).toContain("button('Resume Guide', () => tv.resumeGuide()")
  })

  it('Prev and Next step through the Guide while following; channel history is left alone', () => {
    expect(provider).toMatch(/if \(guideRunRef\.current\?\.state === 'active'\) \{\s+guideEngine\.current\.step\(direction\)\s+return/)
    expect(readFileSync('src/components/NowNextOverlay.tsx', 'utf8')).toContain('guideSteps={following ? { onPrev: () => tv.guideStep(-1), onNext: () => tv.guideStep(1) } : undefined}')
    const sent: number[] = []
    const pad = renderToStaticMarkup(
      createElement(InfoActions, { channel: first, programme: a1, ...padProps(), following: true, guideSteps: { onPrev: () => sent.push(-1), onNext: () => sent.push(1) } }),
    )
    expect(pad).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="(Previous|Next) item in the Guide"/)
    const step = provider.slice(provider.indexOf('const guideStepAction'), provider.indexOf('const activateGuide = useCallback'))
    expect(step).not.toMatch(/historyRef|setHistory/)
  })

  it('an item that cannot play is skipped for this run and shown unavailable, never removed or replaced', () => {
    const guide = threeItems()
    expect(resolveItem(guide.items[0], lookup())).toMatchObject({ ok: true, channel: { number: first.number }, programme: { id: a1.id } })
    expect(resolveItem(guide.items[0], lookup([a1.videoId!]))).toEqual({ ok: false, reason: 'Unavailable' })
    expect(resolveItem({ ...guide.items[0], channelNumber: 99999 }, lookup())).toMatchObject({ ok: false })
    const gone = { ...guide.items[0], programme: { ...guide.items[0].programme, id: 'gone-from-schedule' } }
    const kept = resolveItem(gone, lookup())
    expect(kept.ok && kept.programme.videoId).toBe(a1.videoId)
    expect(kept.ok && kept.programme.title).toBe(a1.title)

    const refused = new Set([b1.videoId])
    const ok = (index: number) => !refused.has(guide.items[index].programme.videoId!)
    expect(nextPlayable(guide, 1, 1, (item) => ok(guide.items.indexOf(item)))).toBe(2)
    expect(guide.items).toHaveLength(3)
    expect(provider).toContain('if (!tuningRef.current && guideEngine.current.skipFailed(channelNumber)) return')
  })

  it('the end of the Guide leaves Guide mode and goes back to NOW; Loop only when asked', () => {
    const end = provider.slice(provider.indexOf('const playGuideFrom'), provider.indexOf('guideEngine.current = {'))
    expect(end).toMatch(/setGuideRun\(null\)\s+if \(clearManual\(\)\) loadedKey\.current = ''/)
    expect(end).toContain('GUIDE FINISHED · BACK TO NOW')
    const guide = threeItems()
    expect(guide.loop).toBeUndefined()
    expect(nextPlayable({ ...guide, loop: true }, 3, 1, () => true)).toBe(0)
  })
})

describe('TVN 2.0 · Guides in the Complete Export', () => {
  const build = (guides?: GuideLibrary) => buildTvnExport({ stored: [], users: [], favourites: [], settings, now: new Date(NOW), guides })

  it('round-trips saved Guides, names, order and references, without any playback position', () => {
    let library: GuideLibrary = { current: threeItems(), saved: [] }
    library = applyGuideAction(library, { type: 'loop', loop: true }, NOW)
    library = applyGuideAction(library, { type: 'save' }, NOW)
    const text = serialiseTvnExport(build(library))
    expect(text).not.toMatch(/"(index|state|endsAt|skipped|programmeId)"/)
    const read = readTvnExportFile(text)
    if (!read.ok) throw new Error(read.errors.join('; '))
    expect(read.guides).toBe(1)
    expect(read.value.guides?.format).toBe(GUIDES_FORMAT)
    const back = libraryFrom(read.value.guides!)
    expect(back).toEqual(library)
    expect(back.saved[0].items.map((item) => item.programme.id)).toEqual([a1.id, b1.id, a2.id])
    expect(back.saved[0].loop).toBe(true)
  })

  it('an export from before Guides still reads, and restores none', () => {
    const legacy = JSON.parse(serialiseTvnExport(build()))
    delete legacy.guides
    const read = readTvnExportFile(JSON.stringify(legacy))
    if (!read.ok) throw new Error(read.errors.join('; '))
    expect(read.guides).toBe(0)
    expect(read.value.guides).toBeUndefined()
    expect(provider).toContain('if (guides) setGuideLibrary(libraryFrom(guides))')
  })

  it('rejects a damaged Guides section', () => {
    const document = JSON.parse(serialiseTvnExport(build({ current: threeItems(), saved: [] })))
    document.guides.current.items[0].programme.videoId = null
    expect(readTvnExportFile(JSON.stringify(document)).ok).toBe(false)
  })
})
