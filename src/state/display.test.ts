import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProgrammeInfo } from '../components/ProgrammeInfo.tsx'
import { SLEEP_COPY, SleepScreen } from '../components/SleepScreen.tsx'
import { STARTUP_COPY, StartupScreen } from '../components/StartupScreen.tsx'
import { TouchRemote } from '../components/TouchRemote.tsx'
import { DEFAULT_PREFERENCES, loadPreferences, PREFERENCES_KEY, savePreferences } from '../services/preferences.ts'
import { SESSION_CHANNEL } from '../session/session-channel.ts'
import type { Programme } from '../types/programme.ts'
import { asSleepMinutes, DEFAULT_SLEEP_MINUTES, nextSleepMinutes, sleepLabel, sleepPhase, SLEEP_WARNING_MS } from './sleep.ts'
import { TvContext, type TvContextValue } from './tv-context.ts'

const MIN = 60_000

describe('sleep timer', () => {
  it('is on by default at 60 minutes', () => {
    expect(DEFAULT_SLEEP_MINUTES).toBe(60)
    expect(DEFAULT_PREFERENCES.sleepMinutes).toBe(60)
    expect(sleepLabel(60)).toBe('Sleep 60')
    expect(sleepLabel(0)).toBe('Sleep off')
  })

  it('SLEEP steps through 30, 60, 90, 120 and off, then round again', () => {
    const seen = [60]
    for (let i = 0; i < 5; i += 1) seen.push(nextSleepMinutes(seen[seen.length - 1]))
    expect(seen).toEqual([60, 90, 120, 0, 30, 60])
  })

  it('counts idle time: awake, a one-minute warning, then due; off never sleeps', () => {
    const last = 1_000_000
    expect(sleepPhase(last, 60, last + 58 * MIN)).toBe('awake')
    expect(sleepPhase(last, 60, last + 60 * MIN - SLEEP_WARNING_MS + 1)).toBe('warning')
    expect(sleepPhase(last, 60, last + 60 * MIN)).toBe('due')
    expect(sleepPhase(last, 0, last + 1000 * MIN)).toBe('off')
  })

  it('keeps a saved setting and repairs a bad one', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) }
    const original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
    try {
      expect(loadPreferences().sleepMinutes).toBe(60)
      savePreferences({ ...loadPreferences(), sleepMinutes: 0 })
      expect(loadPreferences().sleepMinutes).toBe(0)
      store.set(PREFERENCES_KEY, JSON.stringify({ ...DEFAULT_PREFERENCES, sleepMinutes: 7 }))
      expect(loadPreferences().sleepMinutes).toBe(60)
      expect(asSleepMinutes('90')).toBe(60)
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
    }
  })

  it('the sleep screen replaces the whole television, so nothing keeps streaming', () => {
    const markup = renderToStaticMarkup(createElement(SleepScreen, { onWake: () => {} }))
    expect(markup).toContain(SLEEP_COPY.title)
    expect(markup).not.toMatch(/<iframe|<video|<audio/)
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toMatch(/if \(asleep\) return <SleepScreen onWake=\{wake\} \/>/)
  })
})

describe('bottom controls', () => {
  it('TVN follows REMOTE; SLEEP sits in the remote after PAUSE and shows the setting', () => {
    const value = { guideOpen: false, remoteOpen: false, sleepMinutes: 60, muted: false, paused: false, surfing: false, dispatch: () => {} } as unknown as TvContextValue
    const markup = renderToStaticMarkup(createElement(TvContext.Provider, { value }, createElement(TouchRemote)))
    const labels = [...markup.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1])
    expect(labels).toEqual(['Guide', 'Multi', 'Remote', 'TVN'])
    const remote = renderToStaticMarkup(createElement(TvContext.Provider, { value: { ...value, remoteOpen: true } }, createElement(TouchRemote)))
    const remoteLabels = [...remote.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1])
    expect(remoteLabels.slice(-4)).toEqual(['Close', 'Credits', 'Pause', 'Sleep 60'])
  })

  it('TVN surfs on a click and opens its settings on a right-click or a hold, never both', () => {
    const remote = readFileSync('src/components/TouchRemote.tsx', 'utf8')
    expect(remote).toContain('if (!press.swallowClick()) tv.toggleSurf()')
    expect(remote).toMatch(/onContextMenu=\{\(event\) => \{\s*event\.preventDefault\(\)\s*press\.opened\(\)\s*openSettings\(\)/)
    const value = { guideOpen: false, remoteOpen: false, sleepMinutes: 60, surfing: true, dispatch: () => {} } as unknown as TvContextValue
    const markup = renderToStaticMarkup(createElement(TvContext.Provider, { value }, createElement(TouchRemote)))
    expect(markup).toContain('class="tvn-key is-on"')
    expect(markup).toContain('aria-pressed="true"')
  })

  it('the buttons show with the information bar and fade out with it', () => {
    const render = (overrides: Partial<TvContextValue>) => {
      const value = { guideOpen: false, remoteOpen: false, sleepMinutes: 60, overlay: 'none', dispatch: () => {}, ...overrides } as unknown as TvContextValue
      return renderToStaticMarkup(createElement(TvContext.Provider, { value }, createElement(TouchRemote)))
    }
    expect(render({})).toContain('class="remote-bar is-hidden"')
    expect(render({ overlay: 'info' })).toContain('class="remote-bar"')
    expect(render({ guideOpen: true })).toContain('class="remote-bar"')
    expect(readFileSync('src/styles/stage2.css', 'utf8')).toMatch(/\.remote-bar\.is-hidden \{[^}]*opacity: 0;[^}]*visibility: hidden;/)
  })
})

describe('loading screen', () => {
  const screen = (progress: number) => renderToStaticMarkup(createElement(StartupScreen, { phase: 'loading', progress }))

  it('pulses the logo and shows the loaded percentage after LOADING', () => {
    const markup = screen(0)
    expect(markup).toContain('aria-busy="true"')
    expect(readFileSync('src/styles/overlays.css', 'utf8')).toMatch(/\.startup\[aria-busy='true'\] \.startup-logo \{\s*animation: logo-pulse/)
    expect(markup).toMatch(new RegExp(`${STARTUP_COPY.loading.replace(/\./g, '\\.')}<span class="startup-percent"[^>]*>0%</span>`))
    expect(screen(42)).toContain('>42%<')
    expect(screen(180)).toContain('>100%<')
  })

  it('stops pulsing once ready', () => {
    const markup = renderToStaticMarkup(createElement(StartupScreen, { phase: 'ready' }))
    expect(markup).toContain('aria-busy="false"')
  })
})

describe('INFO display', () => {
  const programme: Programme = {
    id: 'p1',
    title: 'Home Film',
    videoId: null,
    durationSeconds: 1800,
    source: 'imported',
    programmeType: 'unclassified',
    playback: 'seekable-recorded',
  } as Programme

  it('uses the guide information bar, with Now and Next', () => {
    const start = Date.UTC(2026, 8, 29, 20, 0)
    const markup = renderToStaticMarkup(
      createElement(ProgrammeInfo, {
        channel: SESSION_CHANNEL,
        programme,
        startMs: start,
        endMs: start + 30 * MIN,
        now: start + 5 * MIN,
        next: { title: 'Second Film', startMs: start + 30 * MIN, endMs: start + 60 * MIN },
      }),
    )
    expect(markup).toContain('class="info-main"')
    expect(markup).toContain('Home Film')
    expect(markup).toContain('On air')
    expect(markup).toMatch(/class="info-next"[\s\S]*Second Film/)

    const overlay = readFileSync('src/components/NowNextOverlay.tsx', 'utf8')
    expect(overlay).toContain("'guide-info is-programme info-bar'")
    expect(overlay).toContain('<ProgrammeInfo')
    expect(readFileSync('src/components/Guide.tsx', 'utf8')).toContain('<ProgrammeInfo')
  })

  it('the guide rises out of the information bar and folds back into it', () => {
    const css = readFileSync('src/styles/guide.css', 'utf8')
    expect(css).toMatch(/@keyframes guide-rise/)
    expect(css).toMatch(/\.guide\.is-closing \{[\s\S]*?animation: guide-fold/)
    const screen = readFileSync('src/app/TvScreen.tsx', 'utf8')
    expect(screen).toContain("<Guide closing={guide === 'closing'} />")
  })
})
