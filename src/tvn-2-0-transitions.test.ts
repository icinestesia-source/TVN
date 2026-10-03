import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChannelChangeOptions } from './components/ChannelChangeOptions.tsx'
import { TransitionOverlay } from './components/TransitionOverlay.tsx'
import { buildTvnExport, readTvnExportFile, serialiseTvnExport, validateTvnExport, type PortableSettings } from './services/tvn-export.ts'
import { commitTune } from './state/tune-commit.ts'
import {
  asTransitionSettings,
  DEFAULT_TRANSITION_SETTINGS,
  LEGACY_TRANSITION_KEY,
  loadTransitionSettings,
  presentedChannel,
  saveTransitionSettings,
  TRANSITION_IDS,
  TRANSITION_KEY,
  TRANSITIONS,
  transitionPhase,
  transitionSettingsErrors,
  transitionTiming,
  type Presentation,
  type TransitionSettings,
} from './state/transitions.ts'
import { DEFAULT_SHORTCUTS } from './view/info-shortcuts.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const provider = read('src/state/TvProvider.tsx')
const screen = read('src/app/TvScreen.tsx')
const NOW = Date.parse('2026-10-02T20:00:00Z')
const SAMPLE = { number: '225', name: 'TVN Preview', programme: 'Sample programme' }
const style = (patch: Partial<TransitionSettings> = {}): TransitionSettings => ({ ...DEFAULT_TRANSITION_SETTINGS, ...patch })
const presentation = (number: number, settings = style(), session = 1): Presentation => ({ session, number, settings })
const seen = (state: Partial<Parameters<typeof presentedChannel>[0]>) =>
  presentedChannel({ presentation: presentation(534), tuningNumber: null, channelNumber: 534, covered: true, single: true, ...state })

describe('TV Tune: the title card lasts the whole transition and leaves just before the picture', () => {
  it('keeps its default character: about 520 ms, the card from the first moment, a clean cut', () => {
    expect(transitionTiming(DEFAULT_TRANSITION_SETTINGS)).toEqual({ settleMs: 220, durationMs: 520, cardAtMs: 0, revealMs: 0 })
    expect(DEFAULT_TRANSITION_SETTINGS.id).toBe('tv-tune')
  })

  it('names the channel while tuning, still names it after the commit while the picture is covered, and goes with the cover', () => {
    expect(seen({ tuningNumber: 534 })).toBe(534)
    // Committed, picture not yet playing: the card stays rather than leaving nameless static.
    expect(seen({ tuningNumber: null, covered: true })).toBe(534)
    // The picture plays: the card goes at that moment, never over the picture.
    expect(seen({ tuningNumber: null, covered: false })).toBeNull()
  })

  it('phases: IDENTIFY from the start, held while the picture is not ready, REVEAL only once it is', () => {
    const timing = transitionTiming(DEFAULT_TRANSITION_SETTINGS)
    expect(transitionPhase(timing, 0, false)).toBe('identify')
    expect(transitionPhase(timing, 300, true)).toBe('identify')
    expect(transitionPhase(timing, 900, false)).toBe('identify')
    expect(transitionPhase(timing, 520, true)).toBe('reveal')
  })

  it('the overlay shows the card over the static, and no card while it reveals', () => {
    const live = renderToStaticMarkup(createElement(TransitionOverlay, { settings: DEFAULT_TRANSITION_SETTINGS, identity: SAMPLE }))
    expect(live).toContain('class="fx fx-tune"')
    expect(live).toContain('<p class="static-number">225</p>')
    expect(live).toContain('--card-delay:0ms')
    const leaving = renderToStaticMarkup(createElement(TransitionOverlay, { settings: style({ id: 'fade' }), identity: SAMPLE, revealing: true }))
    expect(leaving).toContain('is-revealing')
    expect(leaving).not.toContain('static-number')
  })

  it('the screen keeps one overlay from press to picture, and INFO waits for the picture', () => {
    expect(screen).toContain('<ChannelTransition key={layer.presentation.session}')
    expect(screen).toContain('covered: owner === \'cover\'')
    expect(screen).toContain("usePresence(tv.overlay === 'info' && tv.tuningNumber === null && presented === null, INFO_FADE_MS)")
    expect(screen).not.toContain('<StaticOverlay')
  })
})

describe('Instant', () => {
  afterEach(() => vi.useRealTimers())
  const never = () => new Promise<unknown>(() => {})
  const steps = (durationMs: number, log: string[]) => {
    const since = performance.now()
    return {
      current: () => true,
      load: () => {
        log.push('load')
        return never()
      },
      holdStatic: async () => {
        const remain = durationMs - (performance.now() - since)
        if (remain > 0) await new Promise((resolve) => setTimeout(resolve, remain))
      },
      commit: () => void log.push('commit'),
      abandon: () => void log.push('abandon'),
    }
  }

  it('has no settle, no duration, no card and nothing to present', () => {
    const instant = style({ id: 'instant', speed: 2 })
    expect(transitionTiming(instant)).toEqual({ settleMs: 0, durationMs: 0, cardAtMs: null, revealMs: 0 })
    expect(TRANSITIONS.instant).toMatchObject({ effect: 'none', speed: false, colour: false, grain: false, cardAt: null })
    expect(seen({ presentation: presentation(534, instant), tuningNumber: 534 })).toBeNull()
    expect(provider).toContain("const presents = startupSettledRef.current && settings.id !== 'instant'")
  })

  it('commits at once without waiting for the provider, which was asked first', async () => {
    const log: string[] = []
    await expect(commitTune(steps(transitionTiming(style({ id: 'instant' })).durationMs, log))).resolves.toBe('committed')
    expect(log).toEqual(['load', 'commit'])
  })

  it('TV Tune keeps its ~520 ms and still never waits for the provider', async () => {
    vi.useFakeTimers()
    const log: string[] = []
    const done = commitTune(steps(transitionTiming(DEFAULT_TRANSITION_SETTINGS).durationMs, log))
    await vi.advanceTimersByTimeAsync(400)
    expect(log).toEqual(['load'])
    await vi.advanceTimersByTimeAsync(200)
    await expect(done).resolves.toBe('committed')
    expect(log).toEqual(['load', 'commit'])
  })

  it('the tune reads its timing once, at the first press, from the shared commit path', () => {
    expect(provider).toContain('const remain = tuneTiming.current.durationMs - (performance.now() - staticSince.current)')
    expect(provider).toContain('}, tuneTiming.current.settleMs)')
    expect(provider.match(/await commitTune\(/g)).toHaveLength(1)
  })
})

describe('the transition registry', () => {
  it('offers seven distinct transitions, TV Tune first', () => {
    expect(TRANSITION_IDS).toEqual(['tv-tune', 'instant', 'analogue', 'crt', 'glitch', 'fade', 'flash'])
    const effects = TRANSITION_IDS.map((id) => TRANSITIONS[id].effect)
    expect(new Set(effects).size).toBe(effects.length)
    for (const id of TRANSITION_IDS) {
      expect(TRANSITIONS[id].id).toBe(id)
      expect(TRANSITIONS[id].label.length).toBeGreaterThan(0)
      expect(TRANSITIONS[id].note.length).toBeGreaterThan(0)
    }
  })

  it('speed scales the visual duration only, within bounds; effects without colour or grain ignore them', () => {
    expect(transitionTiming(style({ speed: 2 })).durationMs).toBe(1040)
    expect(transitionTiming(style({ speed: 0.5 })).durationMs).toBe(260)
    expect(transitionTiming(style({ speed: 2 })).settleMs).toBe(220)
    expect(transitionTiming(style({ id: 'crt' })).cardAtMs).toBe(Math.round(0.55 * 650))
    expect(TRANSITIONS.fade).toMatchObject({ colour: false, grain: false, revealMs: 240 })
    expect(TRANSITIONS.flash.cardAt).toBeNull()
    expect(transitionTiming(style({ card: { ...DEFAULT_TRANSITION_SETTINGS.card, show: false } })).cardAtMs).toBeNull()
    expect(asTransitionSettings({ speed: 7 }).speed).toBe(1)
  })

  it('each effect renders its own layers, tinted only where colour means something', () => {
    const render = (patch: Partial<TransitionSettings>) => renderToStaticMarkup(createElement(TransitionOverlay, { settings: style(patch), identity: SAMPLE }))
    expect(render({ id: 'analogue' })).toMatch(/fx-scan[\s\S]*fx-roll/)
    expect(render({ id: 'crt' })).toContain('fx-beam')
    expect(render({ id: 'glitch' })).toContain('fx-tears')
    expect(render({ id: 'flash' })).toContain('fx-flash-light')
    expect(render({ id: 'flash' })).not.toContain('static-number')
    expect(render({ id: 'crt', colour: 'green' })).toContain('fx-tint')
    expect(render({ id: 'fade', colour: 'green' })).not.toContain('fx-tint')
    expect(render({ colour: 'mono' })).not.toContain('fx-tint')
  })

  it('the title card follows its settings', () => {
    const card = { ...DEFAULT_TRANSITION_SETTINGS.card, position: 'bottom-left' as const, panel: 'band' as const, type: 'mono' as const, programme: false, size: 'large' as const, opacity: 0.6 }
    const html = renderToStaticMarkup(createElement(TransitionOverlay, { settings: style({ card }), identity: SAMPLE }))
    expect(html).toContain('fx-card at-bottom-left panel-band type-mono')
    expect(html).not.toContain('Sample programme')
    expect(html).toContain('--card-opacity:0.6')
    expect(html).toContain('--card-zoom:1.3')
  })
})

describe('OPTIONS → Channel change', () => {
  const render = (settings: TransitionSettings) => renderToStaticMarkup(createElement(ChannelChangeOptions, { settings, onChange: () => {} }))

  it('Instant stays simple: no speed, colour, grain or title card controls', () => {
    const html = render(style({ id: 'instant' }))
    for (const control of ['aria-label="Speed"', 'aria-label="Colour"', 'aria-label="Grain"', 'Title card']) expect(html).not.toContain(control)
    expect(html).toContain('Reset to default')
    expect(html).toContain('>Preview<')
  })

  it('TV Tune shows speed, colour, grain and the title card; Fade has no colour or grain', () => {
    const tune = render(DEFAULT_TRANSITION_SETTINGS)
    for (const control of ['aria-label="Speed"', 'aria-label="Colour"', 'aria-label="Grain"', 'Title card', 'aria-label="Title card position"']) expect(tune).toContain(control)
    const fade = render(style({ id: 'fade' }))
    expect(fade).toContain('aria-label="Speed"')
    expect(fade).not.toContain('aria-label="Colour"')
    expect(fade).not.toContain('aria-label="Grain"')
  })

  it('the preview uses a sample channel and never touches the television', () => {
    const source = read('src/components/ChannelChangeOptions.tsx')
    expect(source).toContain("const SAMPLE: CardIdentity = { number: '225', name: 'TVN Preview', programme: 'Sample programme' }")
    expect(source).not.toMatch(/useTv|dispatch|requestTune/)
    expect(source).not.toMatch(/setInterval/)
  })
})

describe('saved settings and the complete export', () => {
  const fake = () => {
    const store = new Map<string, string>()
    return { store, io: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) } }
  }

  it('saves and loads the whole look; the first 2.0 id-only setting still loads', () => {
    const { store, io } = fake()
    expect(loadTransitionSettings(io)).toEqual(DEFAULT_TRANSITION_SETTINGS)
    store.set(LEGACY_TRANSITION_KEY, 'instant')
    expect(loadTransitionSettings(io).id).toBe('instant')
    const chosen = style({ id: 'crt', speed: 1.5, colour: 'amber', card: { ...DEFAULT_TRANSITION_SETTINGS.card, position: 'top-right' } })
    saveTransitionSettings(chosen, io)
    expect(JSON.parse(store.get(TRANSITION_KEY)!)).toEqual(chosen)
    expect(loadTransitionSettings(io)).toEqual(chosen)
    store.set(TRANSITION_KEY, '{ broken')
    expect(loadTransitionSettings(io)).toEqual(DEFAULT_TRANSITION_SETTINGS)
  })

  const settings = (transitionStyle: TransitionSettings): PortableSettings => ({
    volume: 50,
    muted: false,
    subtitles: false,
    sleepMinutes: 60,
    guideSplit: 0.5,
    infoShortcuts: { ...DEFAULT_SHORTCUTS },
    surfRange: { minSeconds: 4, maxSeconds: 10 },
    transition: transitionStyle.id,
    transitionStyle,
  })

  it('round-trips through tvn-export-v1', () => {
    const chosen = style({ id: 'glitch', speed: 0.75, colour: 'cool', grain: 'coarse', card: { ...DEFAULT_TRANSITION_SETTINGS.card, panel: 'none', accent: 'green', opacity: 0.8 } })
    const text = serialiseTvnExport(buildTvnExport({ stored: [], users: [], favourites: [], settings: settings(chosen), now: new Date(NOW) }))
    const back = readTvnExportFile(text)
    if (!back.ok) throw new Error(back.errors.join('; '))
    expect(back.value.settings.transitionStyle).toEqual(chosen)
    expect(back.value.settings.transition).toBe('glitch')
  })

  it('an export from before the look was saved is valid and restores the defaults', () => {
    const legacy = JSON.parse(serialiseTvnExport(buildTvnExport({ stored: [], users: [], favourites: [], settings: settings(style({ id: 'instant' })), now: new Date(NOW) })))
    delete legacy.settings.transitionStyle
    const checked = validateTvnExport(legacy)
    expect(checked.ok).toBe(true)
    expect(asTransitionSettings({ ...legacy.settings.transitionStyle, id: legacy.settings.transition })).toEqual(style({ id: 'instant' }))
    expect(provider).toContain('asTransitionSettings({ ...settings.transitionStyle, id: settings.transition ?? settings.transitionStyle?.id })')
  })

  it('a malformed look refuses the file', () => {
    expect(transitionSettingsErrors({ id: 'wipe', speed: 3, card: { opacity: 2, position: 'middle' } }, 's')).toHaveLength(4)
    const file = JSON.parse(serialiseTvnExport(buildTvnExport({ stored: [], users: [], favourites: [], settings: settings(style()), now: new Date(NOW) })))
    file.settings.transitionStyle.card.panel = 'neon'
    expect(validateTvnExport(file).ok).toBe(false)
  })
})

describe('rapid tuning, refusals and start-up', () => {
  it('a tune during a presentation takes it over: same effect, newest channel’s card', () => {
    expect(provider).toContain('presentationRef.current = presents ? (held ? { session: held.session, number, settings: held.settings } : { session: ++presentationSession.current, number, settings }) : null')
    // 225 → 534 → 769: only 769 can be named, in tuning and after the commit.
    expect(seen({ presentation: presentation(769), tuningNumber: 769 })).toBe(769)
    expect(seen({ presentation: presentation(769), tuningNumber: 534 })).toBeNull()
    expect(seen({ presentation: presentation(769), tuningNumber: null, channelNumber: 534 })).toBeNull()
  })

  it('a late end for an earlier presentation leaves the newer one alone', () => {
    expect(provider).toMatch(/const endTransition = useCallback\(\(session: number\) => \{\s*if \(presentationRef\.current\?\.session !== session\) return/)
  })

  it('a refused programme on the same channel does not replay the transition; giving up on the channel does', () => {
    const recover = provider.slice(provider.indexOf('recoverRef.current = (channelNumber, cause) => {'), provider.indexOf('const resumeViewing = () => {'))
    const nextProgramme = recover.slice(recover.indexOf("if (step.action === 'next-programme') {"), recover.indexOf('recoveryRef.current = giveUp(step.recovery, channelNumber)'))
    expect(nextProgramme).toContain('void loadProgramme(current, now)')
    expect(nextProgramme).not.toContain('requestTune')
    // The card holds over the next attempt's cover, as the same presentation.
    expect(seen({ tuningNumber: null, covered: true })).toBe(534)
    expect(recover).toMatch(/autoTuneRef\.current = true\s+requestTune\(target\)/)
  })

  it('the next clip on the same channel comes in on a plain cut: static belongs to changing channel', () => {
    expect(screen).toContain('const nextClip = owner === \'cover\' && tv.tuningNumber === null && tv.presentation === null && tv.pictureChannel === tv.channel.number')
    expect(screen).toContain('{nextClip ? null : <Noise />}')
    expect(provider).toMatch(/pictureLiveRef\.current = true\s+setPictureLive\(true\)\s+setStartupSettled\(true\)\s+if \(asked\) setPictureChannel\(asked\.channelNumber\)/)
  })

  it('start-up keeps its own presentation', () => {
    expect(provider).toContain("tuneTiming.current = transitionTiming(presents || settings.id === 'instant' ? settings : DEFAULT_TRANSITION_SETTINGS)")
    expect(seen({ presentation: null, tuningNumber: 534 })).toBeNull()
    expect(seen({ single: false, tuningNumber: 534 })).toBeNull()
  })
})
