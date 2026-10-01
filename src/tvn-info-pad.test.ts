import { readFileSync } from 'node:fs'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InfoActions } from './components/InfoActions.tsx'
import { TouchRemote } from './components/TouchRemote.tsx'
import { creditFor, EMPTY_REGISTER } from './credits/provenance.ts'
import { mediaLibrary } from './director/library.ts'
import { padProps } from './info-pad.fixture.ts'
import { commandFromKey } from './input/keyboard.ts'
import { DEFAULT_PREFERENCES, loadPreferences, PREFERENCES_KEY, savePreferences } from './services/preferences.ts'
import { TvContext, type TvContextValue } from './state/tv-context.ts'
import type { Channel } from './types/channel.ts'
import type { TvCommand } from './types/input.ts'
import type { Programme } from './types/programme.ts'
import {
  asShortcuts,
  assignShortcut,
  captionsAvailable,
  cornerActions,
  CORNERS,
  DEFAULT_SHORTCUTS,
  fullscreenAvailable,
  SHORTCUT_IDS,
  SHORTCUTS,
  type ShortcutAssignment,
  type ShortcutContext,
} from './view/info-shortcuts.ts'
import { closeTvnSettings, openTvnSettings, tvnSettingsOpen } from './view/tvn-settings-store.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const css = read('src/styles/guide.css')
const provider = read('src/state/TvProvider.tsx')
const overlay = read('src/components/NowNextOverlay.tsx')
const guide = read('src/components/Guide.tsx')
const remote = read('src/components/TouchRemote.tsx')
const actionsSource = read('src/components/InfoActions.tsx')
const registrySource = read('src/view/info-shortcuts.ts')

type Control = { label: string; props: Record<string, unknown> }

/** Every button and link in render order, without a DOM. */
function controls(node: ReactNode): Control[] {
  if (Array.isArray(node)) return node.flatMap(controls)
  if (!isValidElement(node)) return []
  const element = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>
  if (element.type === 'button' || element.type === 'a') {
    const children = element.props.children
    const label = Array.isArray(children) ? children.join('') : String(children)
    return [{ label, props: element.props }]
  }
  return controls(element.props.children)
}

/** The nine cells of the pad: the grid's direct children. */
function cells(node: ReactNode): ReactElement<Record<string, unknown> & { children?: ReactNode }>[] {
  const root = node as ReactElement<{ children?: ReactNode }>
  return (root.props.children as ReactNode[]).flat().filter(isValidElement) as ReactElement<Record<string, unknown> & { children?: ReactNode }>[]
}

const channel = { number: 12, name: 'Twelve', origin: 'default' } as Channel
const youtube = { id: 'p', title: 'Film', videoId: 'abcdefghijk', durationSeconds: 1800, playback: 'seekable-recorded' } as Programme
const card = { id: 'card', title: 'Card', videoId: null, durationSeconds: 60 } as unknown as Programme
const session = { id: 's1', title: 'Home video', videoId: null, durationSeconds: 60, sourceRef: 'local:session-1' } as unknown as Programme
const stream = { id: 'live', title: 'Live', videoId: null, durationSeconds: 0, liveStream: { url: 'https://example.invalid/live.m3u8' } } as unknown as Programme

function pad({
  programme = youtube,
  assignment = DEFAULT_SHORTCUTS,
  subtitles = false,
  remoteOpen = false,
  surfing = false,
  multiview = false,
  canBack = true,
  canForward = true,
  prev = true,
  next = true,
}: {
  programme?: Programme
  assignment?: ShortcutAssignment
  subtitles?: boolean
  remoteOpen?: boolean
  surfing?: boolean
  multiview?: boolean
  canBack?: boolean
  canForward?: boolean
  prev?: boolean
  next?: boolean
} = {}) {
  const sent: TvCommand[] = []
  const settings: string[] = []
  const calls: string[] = []
  const tree = InfoActions({
    channel,
    programme,
    onPrev: prev ? () => calls.push('previous programme') : undefined,
    onNext: next ? () => calls.push('next programme') : undefined,
    ...padProps({ canBack, canForward, assignment, subtitles, remoteOpen, surfing, multiview, sent, settings }),
  })
  const list = controls(tree)
  const find = (name: string) => list.find((control) => control.props['aria-label'] === name)!
  const press = (name: string) => (find(name).props.onClick as () => void)()
  return { tree, list, sent, settings, calls, find, press, names: list.map((control) => control.props['aria-label']) }
}

const DEFAULT_NAMES = [
  'Remote control',
  'Previous watched channel',
  'Channel up',
  'Open original source',
  'Previous programme',
  'Guide',
  'Next programme',
  'TVN surf',
  'Next watched channel',
  'Channel down',
  'Random channel',
]

const block = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`)
  return css.slice(start, css.indexOf('}', start) + 1)
}

const context = (overrides: Partial<ShortcutContext> = {}): ShortcutContext => ({
  original: null,
  captionsAvailable: false,
  fullscreenAvailable: true,
  subtitles: false,
  remoteOpen: false,
  surfing: false,
  openSettings: () => {},
  dispatch: () => {},
  ...overrides,
})

describe('information overlay: 3×3 control pad', () => {
  it('1. the default layout is REMOTE ↑|CH+ ↗ / ← GUIDE → / TVN ↓|CH− R, nine cells', () => {
    const { tree, list } = pad()
    expect(list.map((control) => control.label)).toEqual(['Remote', '↑', 'CH+', '↗', '←', 'Guide', '→', 'TVN', '↓', 'CH−', 'R'])
    expect(cells(tree)).toHaveLength(9)
    expect((tree as ReactElement<{ className: string }>).props.className).toBe('info-actions info-pad has-history')
    expect((tree as ReactElement<{ role: string }>).props.role).toBe('group')
  })

  it('2. GUIDE keeps the tune key’s size: 92×36, 72 wide on a phone, centred in its cell, never stretched', () => {
    expect(block('.tune-key')).toContain('min-width: 92px;')
    expect(block('.tune-key')).toContain('height: 36px;')
    expect(block('.tune-key')).toContain('padding: 0 16px;')
    expect(css).toContain('.info-actions.has-history .tune-key { min-width: 72px; padding: 0 10px; }')
    expect(block('.info-pad > .tune-key')).toMatch(/justify-self: center;\s*align-self: center;/)
    expect(pad().find('Guide').props.className).toBe('tune-key info-pad-guide')
  })

  it('3. ↑ and CH+ share one cell exactly as wide as GUIDE (the centre column)', () => {
    const top = cells(pad().tree)[1]
    expect(top.props.className).toBe('info-pad-split')
    expect(controls(top).map((control) => control.label)).toEqual(['↑', 'CH+'])
    expect(block('.info-pad')).toContain('grid-template-columns: var(--pad-side) minmax(var(--watch-min), auto) var(--pad-side);')
    expect(block('.info-pad-split')).toMatch(/grid-template-columns: 1fr 1fr;[\s\S]*justify-self: stretch;[\s\S]*align-self: stretch;/)
  })

  it('4. ↓ and CH− share one cell exactly as wide as GUIDE (the centre column)', () => {
    const bottom = cells(pad().tree)[7]
    expect(bottom.props.className).toBe('info-pad-split')
    expect(controls(bottom).map((control) => control.label)).toEqual(['↓', 'CH−'])
  })

  it('5. ← and → are as tall as GUIDE (the middle row, stretched)', () => {
    const grid = cells(pad().tree)
    expect(grid[3].props['aria-label']).toBe('Previous programme')
    expect(grid[5].props['aria-label']).toBe('Next programme')
    expect(block('.info-pad')).toContain('grid-template-rows: var(--pad-edge) auto var(--pad-edge);')
    expect(block('.info-pad > .info-square')).toMatch(/width: auto;\s*height: auto;\s*justify-self: stretch;\s*align-self: stretch;/)
  })

  it('6. the corners default to Remote, Source, TVN and Random', () => {
    expect(DEFAULT_SHORTCUTS).toEqual({ topLeft: 'remote', topRight: 'source', bottomLeft: 'tvn', bottomRight: 'random' })
    const grid = cells(pad().tree)
    expect([0, 2, 6, 8].map((index) => grid[index].props['aria-label'])).toEqual(['Remote control', 'Open original source', 'TVN surf', 'Random channel'])
  })

  it('7. ↑ goes back through the watched channels; CH+ beside it steps up the channel numbers', () => {
    const { sent, press } = pad()
    press('Previous watched channel')
    press('Channel up')
    expect(sent.map((command) => command.type)).toEqual(['history-back', 'channel-up'])
    expect(pad({ canBack: false }).find('Previous watched channel').props.disabled).toBe(true)
  })

  it('8. ↓ goes forward through the watched channels; CH− beside it steps down the channel numbers', () => {
    const { sent, press } = pad()
    press('Next watched channel')
    press('Channel down')
    expect(sent.map((command) => command.type)).toEqual(['history-forward', 'channel-down'])
  })

  it('8b. until ↑ has been used there is nowhere forward to go, so ↓’s place is MULTI, lit while Multi View shows', () => {
    const fresh = pad({ canForward: false })
    expect(fresh.find('Next watched channel')).toBeUndefined()
    expect(controls(cells(fresh.tree)[7]).map((control) => control.label)).toEqual(['Multi', 'CH−'])
    const multi = fresh.find('Multi View')
    expect(multi.props.className).toBe('info-square info-pad-multi')
    expect(multi.props['aria-pressed']).toBe(false)
    fresh.press('Multi View')
    expect(fresh.sent).toEqual([{ type: 'multiview' }])
    const showing = pad({ canForward: false, multiview: true }).find('Multi View')
    expect(showing.props['aria-pressed']).toBe(true)
    expect(String(showing.props.className)).toContain('is-on')
    // Once there is somewhere forward to go, ↓ returns.
    expect(pad({ canForward: true }).find('Multi View')).toBeUndefined()
    expect(block('.info-pad-split > .info-pad-multi')).toContain('font-size: 10px;')
  })

  it('9. ← and → step along the programmes, and are held in place (disabled) when there is none', () => {
    const { calls, sent, press } = pad()
    press('Previous programme')
    press('Next programme')
    expect(calls).toEqual(['previous programme', 'next programme'])
    expect(sent).toEqual([])
    expect(pad({ prev: false }).find('Previous programme').props.disabled).toBe(true)
    expect(pad({ next: false }).find('Next programme').props.disabled).toBe(true)
    expect(overlay).toContain('() => tv.screenStep(-1)')
    expect(overlay).toContain('() => tv.screenStep(1)')
  })

  it('10. GUIDE opens the Guide, and inside the Guide closes it', () => {
    const { sent, press } = pad()
    press('Guide')
    expect(sent).toEqual([{ type: 'guide' }])
    expect(provider).toMatch(/case 'guide':\s*if \(guideModeRef\.current === 'closed'\) openGuide\('expanded'\)\s*else \{\s*closeGuide\(\)/)
  })

  it('11. REMOTE opens and closes the remote, and lights while it is open', () => {
    const { sent, press, find } = pad()
    expect(find('Remote control').props['aria-pressed']).toBe(false)
    press('Remote control')
    expect(sent).toEqual([{ type: 'remote' }])
    const open = pad({ remoteOpen: true }).find('Remote control')
    expect(open.props['aria-pressed']).toBe(true)
    expect(String(open.props.className)).toContain('is-on')
  })

  it('12. TVN surfs on a click, lights while surfing, and opens the TVN settings on a hold or right-click, never both', () => {
    const { sent, settings, press, find } = pad()
    const tvn = find('TVN surf')
    expect(tvn.props['aria-haspopup']).toBe('dialog')
    expect(tvn.props.title).toBe('Surf random channels · right-click or hold for TVN settings')
    press('TVN surf')
    expect(sent).toEqual([{ type: 'surf' }])
    const opened = { prevented: false, stopped: false }
    ;(tvn.props.onContextMenu as (event: unknown) => void)({
      preventDefault: () => void (opened.prevented = true),
      stopPropagation: () => void (opened.stopped = true),
    })
    expect(settings).toEqual(['open'])
    expect(opened).toEqual({ prevented: true, stopped: true })
    // The click that ends a hold does not also surf.
    expect(actionsSource).toContain('if (hold && cornerHold.swallowClick()) return')
    expect(pad({ surfing: true }).find('TVN surf').props['aria-pressed']).toBe(true)
    expect(provider).toContain("case 'surf':")
  })

  it('13. R is the existing Random channel command', () => {
    const { sent, press, find } = pad()
    press('Random channel')
    expect(sent).toEqual([{ type: 'random-channel' }])
    expect(find('Random channel').label).toBe('R')
    expect(provider).toMatch(/case 'random-channel': \{\s*const picked = randomChannel\(channelRef\.current\)\s*if \(picked\) requestTune\(picked\.number\)/)
    expect(commandFromKey('r', { meta: false, ctrl: false, alt: false }, false)).toEqual({ type: 'random-channel' })
  })

  it('14. ↗ is the existing original-source link, from the programme record, never a built URL', () => {
    const link = pad().find('Open original source')
    const expected = creditFor(channel, youtube, { library: mediaLibrary(), register: EMPTY_REGISTER }).originalUrl
    expect(link.props).toMatchObject({ href: expected, target: '_blank', rel: 'noopener noreferrer' })
    expect(String(link.props.className)).toContain('info-original')
    expect(registrySource).toContain('href: (context) => context.original')
    // No source on record: a disabled cell, not a link.
    const none = pad({ programme: card }).find('Open original source')
    expect(none.props.href).toBeUndefined()
    expect(none.props.disabled).toBe(true)
  })

  it('15. Fullscreen, when chosen, is the existing fullscreen command, and is disabled where the browser cannot', () => {
    const assignment: ShortcutAssignment = { ...DEFAULT_SHORTCUTS, topLeft: 'fullscreen' }
    const chosen = pad({ assignment })
    if (fullscreenAvailable()) {
      chosen.press('Fullscreen')
      expect(chosen.sent).toEqual([{ type: 'fullscreen' }])
    } else {
      expect(chosen.find('Fullscreen').props.disabled).toBe(true)
    }
    expect(fullscreenAvailable({ fullscreenEnabled: false, documentElement: { requestFullscreen: () => Promise.resolve() } } as unknown as Document)).toBe(false)
    expect(fullscreenAvailable({ fullscreenEnabled: true, documentElement: {} } as unknown as Document)).toBe(false)
    expect(fullscreenAvailable({ fullscreenEnabled: true, documentElement: { requestFullscreen: () => Promise.resolve() } } as unknown as Document)).toBe(true)
    const fired: TvCommand[] = []
    const run = SHORTCUTS.fullscreen
    if (run.kind === 'action') run.run(context({ dispatch: (command) => void fired.push(command) }))
    expect(fired).toEqual([{ type: 'fullscreen' }])
    expect(provider).toContain("case 'fullscreen':")
    expect(provider).toContain('else if (fullscreenAvailable(document)) void document.documentElement.requestFullscreen().catch(() => {})')
    expect(commandFromKey('f', { meta: false, ctrl: false, alt: false }, false)).toEqual({ type: 'fullscreen' })
  })

  it('16. Captions, when chosen, toggle the existing subtitle preference, only where the player can switch them', () => {
    const assignment: ShortcutAssignment = { ...DEFAULT_SHORTCUTS, bottomLeft: 'captions' }
    const { sent, press, find } = pad({ assignment })
    expect(find('Subtitles/captions').props['aria-pressed']).toBe(false)
    press('Subtitles/captions')
    expect(sent).toEqual([{ type: 'subtitles' }])
    expect(pad({ assignment, subtitles: true }).find('Subtitles/captions').props['aria-pressed']).toBe(true)
    for (const programme of [card, session, stream]) {
      const cc = pad({ assignment, programme }).find('Subtitles/captions')
      expect(cc.props.disabled).toBe(true)
      expect(cc.props.onClick).toBeUndefined()
      expect(captionsAvailable(programme)).toBe(false)
    }
    expect(captionsAvailable(youtube)).toBe(true)
    // Nothing synthetic: no tracks, cues or caption text are made here.
    for (const source of [actionsSource, registrySource]) expect(source).not.toMatch(/<track|WebVTT|\.vtt|addTextTrack|VTTCue|loadModule|setOption/)
    expect(provider).toMatch(/case 'subtitles': \{\s*const nextSubtitles = !subtitlesRef\.current/)
  })

  it('17. the corners follow the assignment', () => {
    const assignment: ShortcutAssignment = { topLeft: 'random', topRight: 'captions', bottomLeft: 'source', bottomRight: 'fullscreen' }
    const grid = cells(pad({ assignment }).tree)
    expect([0, 2, 6, 8].map((index) => grid[index].props['aria-label'])).toEqual(['Random channel', 'Subtitles/captions', 'Open original source', 'Fullscreen'])
  })

  it('18. the assignment is saved with the other preferences and restored', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) }
    const original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
    try {
      expect(loadPreferences().infoShortcuts).toEqual(DEFAULT_SHORTCUTS)
      const chosen = assignShortcut(DEFAULT_SHORTCUTS, 'topLeft', 'fullscreen')
      savePreferences({ ...loadPreferences(), infoShortcuts: chosen })
      expect(JSON.parse(store.get(PREFERENCES_KEY)!).infoShortcuts).toEqual(chosen)
      expect(loadPreferences().infoShortcuts).toEqual(chosen)
      // A saved record from before this setting keeps the defaults.
      const { infoShortcuts: _dropped, ...older } = DEFAULT_PREFERENCES
      store.set(PREFERENCES_KEY, JSON.stringify(older))
      expect(loadPreferences().infoShortcuts).toEqual(DEFAULT_SHORTCUTS)
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
    }
    expect(provider).toContain('const [infoShortcuts, setInfoShortcuts] = useState<ShortcutAssignment>(stored.infoShortcuts)')
    expect(provider.slice(provider.indexOf('savePreferences({'), provider.indexOf('savePreferences({') + 500)).toContain('infoShortcuts,')
  })

  it('19. Reset to defaults restores Remote, Source, TVN, Random', () => {
    expect(provider).toContain('const resetInfoShortcuts = useCallback(() => setInfoShortcuts({ ...DEFAULT_SHORTCUTS }), [])')
    expect(remote).toContain('onClick={tv.resetInfoShortcuts}')
    expect(remote).toContain('Reset to defaults')
  })

  it('20. choosing an action already in use swaps the two corners; an unused one replaces; a bad saved record falls back', () => {
    expect(assignShortcut(DEFAULT_SHORTCUTS, 'topLeft', 'random')).toEqual({ topLeft: 'random', topRight: 'source', bottomLeft: 'tvn', bottomRight: 'remote' })
    expect(assignShortcut(DEFAULT_SHORTCUTS, 'bottomLeft', 'source')).toEqual({ topLeft: 'remote', topRight: 'tvn', bottomLeft: 'source', bottomRight: 'random' })
    expect(assignShortcut(DEFAULT_SHORTCUTS, 'topLeft', 'captions')).toEqual({ ...DEFAULT_SHORTCUTS, topLeft: 'captions' })
    expect(assignShortcut(DEFAULT_SHORTCUTS, 'topRight', 'source')).toEqual(DEFAULT_SHORTCUTS)
    for (const corner of CORNERS) {
      for (const id of SHORTCUT_IDS) expect(new Set(Object.values(assignShortcut(DEFAULT_SHORTCUTS, corner, id))).size).toBe(4)
    }
    expect(asShortcuts({ topLeft: 'random', topRight: 'random', bottomLeft: 'tvn', bottomRight: 'remote' })).toEqual(DEFAULT_SHORTCUTS)
    expect(asShortcuts({ topLeft: 'favourite', topRight: 'source', bottomLeft: 'tvn', bottomRight: 'random' })).toEqual(DEFAULT_SHORTCUTS)
    expect(asShortcuts(null)).toEqual(DEFAULT_SHORTCUTS)
    expect(remote).toContain('onChange={(event) => tv.setInfoShortcut(corner, event.target.value as ShortcutId)}')
  })

  it('21. every cell has an accessible name, and the names follow the assignment', () => {
    expect(pad().names).toEqual(DEFAULT_NAMES)
    const swapped = pad({ assignment: { topLeft: 'captions', topRight: 'random', bottomLeft: 'fullscreen', bottomRight: 'source' } }).names
    expect([swapped[0], swapped[3], swapped[7], swapped[10]]).toEqual(['Subtitles/captions', 'Random channel', 'Fullscreen', 'Open original source'])
    expect(SHORTCUT_IDS.map((id) => SHORTCUTS[id].name)).toEqual(['Remote control', 'Open original source', 'TVN surf', 'Random channel', 'Fullscreen', 'Subtitles/captions'])
    expect(remote).toContain('{SHORTCUTS[id].name}')
  })

  it('22. the TVN settings open and close through one store, and offer the four corners by name', () => {
    expect(tvnSettingsOpen()).toBe(false)
    openTvnSettings()
    expect(tvnSettingsOpen()).toBe(true)
    closeTvnSettings()
    expect(tvnSettingsOpen()).toBe(false)
    expect(remote).toContain('<legend className="tvn-settings-head">Information Overlay shortcuts</legend>')
    expect(remote).toContain('{CORNERS.map((corner) => (')
    expect(remote).toContain('{CORNER_LABELS[corner]}')
  })

  it('23. Channel 000 material keeps its safety: no source link, no captions', () => {
    const local = pad({ programme: session, assignment: { ...DEFAULT_SHORTCUTS, bottomLeft: 'captions' } })
    const source = local.find('Open original source')
    expect(source.props.href).toBeUndefined()
    expect(source.props.disabled).toBe(true)
    expect(local.find('Subtitles/captions').props.disabled).toBe(true)
  })

  it('24. one pad, in the Guide and over the picture, from the same actions', () => {
    for (const source of [guide, overlay]) {
      expect(source).toContain('corners={cornerActions(tv)}')
      expect(source).toContain('channels={channelActions(tv)}')
    }
    expect(guide).toMatch(/<InfoActions\s+key=\{channel\.number\}\s+channel=\{channel\}\s+programme=\{slot\.programme\}\s+onPrev=\{onPrev\}\s+onNext=\{onNext\}\s+history=\{history\}\s+corners=\{corners\}\s+channels=\{channels\}\s+\/>/)
    expect(guide).toContain('const pxPerMinute = usePxPerMinute() * tv.guideZoom')
    expect(provider).toContain('const [guideZoom, setGuideZoomState] = useState(1)')
  })

  it('25. GUIDE sits on the bar’s vertical centre at every width, however many lines the details take', () => {
    expect(css).toMatch(/\.guide-info\.is-programme \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) auto;\s*grid-template-rows: auto auto;/)
    expect(css).toMatch(/\.guide-info\.is-programme > \.info-actions \{\s*grid-column: 2;\s*grid-row: 1 \/ -1;\s*align-self: center;/)
    expect(css).toMatch(/\.guide-info\.is-programme > \.info-credit \{\s*grid-column: 1;\s*grid-row: 2;/)
    // The top rule takes no room, so the box's centre is the bar's centre.
    expect(block('.guide-info.is-programme')).toMatch(/border-top: 0;\s*box-shadow: inset 0 1px 0 #1d4c78;/)
    expect(read('src/styles/overlays.css')).toMatch(/\.info-bar \{[^}]*padding-top: 10px;\s*padding-bottom: 10px;/)
  })

  it('26. phone: the centre column narrows with GUIDE to 72px', () => {
    expect(css).toMatch(/@media \(max-width: 420px\) \{\s*\.info-pad \{ --watch-min: 72px; \}/)
    expect(css).toContain('@media (max-width: 420px) {\n  .info-actions.has-history { gap: 4px; }')
  })

  it('27. the four buttons on the player are gone; Multi lives in the remote', () => {
    const value = { remoteOpen: false, sleepMinutes: 60, dispatch: () => {} } as unknown as TvContextValue
    expect(renderToStaticMarkup(createElement(TvContext.Provider, { value }, createElement(TouchRemote)))).toBe('')
    expect(remote).not.toMatch(/remote-bar|guide-key|tvn-key|--dock-w/)
    expect(read('src/styles/stage2.css')).not.toContain('.remote-bar')
    expect(read('src/styles/tokens.css')).not.toContain('--dock-w')
    expect(remote).toContain("onClick={() => tv.dispatch({ type: 'multiview' })}")
  })

  it('28. opening the settings from the pad takes the remote’s place', () => {
    const sent: TvCommand[] = []
    const actions = cornerActions({ infoShortcuts: DEFAULT_SHORTCUTS, subtitles: false, remoteOpen: true, surfing: false, dispatch: (command) => void sent.push(command) })
    try {
      actions.openSettings()
      expect(sent).toEqual([{ type: 'remote' }])
      expect(tvnSettingsOpen()).toBe(true)
    } finally {
      closeTvnSettings()
    }
    expect(remote).toContain('if (tv.remoteOpen) closeTvnSettings()')
  })

  it('29. tuning, history and manual playback are untouched; the settings menu never reaches the television keys', () => {
    expect(provider).toMatch(/case 'history-back':\s*case 'history-forward': \{/)
    expect(provider).toContain("case 'channel-up':")
    expect(overlay).toContain('history={historyActions(tv)}')
    expect(overlay).toContain('onPrev={steps && hasPicture(stepFrom(channel, now, -1).programme) ? () => tv.screenStep(-1) : undefined}')
    expect(read('src/input/keyboard.ts')).toContain("['INPUT', 'TEXTAREA', 'SELECT']")
    expect(remote).toContain('<select')
  })
})
