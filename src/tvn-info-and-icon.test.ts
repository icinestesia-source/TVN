import { existsSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InfoActions } from './components/InfoActions.tsx'
import { ProgrammeInfo } from './components/ProgrammeInfo.tsx'
import { channelByNumber } from './data/catalogue.ts'
import { clearManual, onScreen, selectProgramme, stepFrom } from './player/manual.ts'
import { LoadingRing, STARTUP_COPY, StartupScreen } from './components/StartupScreen.tsx'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'

describe('the Guide information bar', () => {
  it('ends with the Next line, like the one over the picture', () => {
    const guide = readFileSync('src/components/Guide.tsx', 'utf8')
    expect(guide).toContain('next={followingSlot}')
    expect(guide).toContain('next={next ? { title: next.programme.title, startMs: next.startMs, endMs: next.endMs } : undefined}')
    expect(guide).toMatch(/focusedSlots\.find\(\(slot\) => slot\.startMs >= focused\.endMs\)/)
  })
})

describe('Next on the information bar', () => {
  const channel = { number: 12, name: 'Twelve', origin: 'default' } as Channel
  const programme = { id: 'p', title: 'Film', videoId: 'abcdefghijk', durationSeconds: 1800, playback: 'seekable-recorded' } as Programme
  const actions = (onPrev?: () => void, onNext?: () => void) =>
    renderToStaticMarkup(createElement(InfoActions, { channel, programme, live: true, onTune: () => {}, onPrev, onNext }))

  it('reads ← Watch →, each step only when there is a programme to step to', () => {
    expect(actions(() => {}, () => {})).toMatch(/aria-label="Previous programme"[^>]*>←<\/button><button[^>]*>Watch<\/button><button[^>]*aria-label="Next programme"[^>]*>→<\/button>/)
    expect(actions(undefined, () => {})).not.toContain('Previous programme')
    expect(actions(() => {})).not.toContain('Next programme')
  })

  it('moves the Guide back and forth, and over the picture plays the programme either side from its start', () => {
    const guide = readFileSync('src/components/Guide.tsx', 'utf8')
    expect(guide).toContain("onPrev={precedingSlot ? () => tv.dispatch({ type: 'nav', direction: 'left' }) : undefined}")
    expect(guide).toContain("onNext={followingSlot ? () => tv.dispatch({ type: 'nav', direction: 'right' }) : undefined}")
    const overlay = readFileSync('src/components/NowNextOverlay.tsx', 'utf8')
    expect(overlay).toContain('onPrev={steps && hasPicture(stepFrom(channel, now, -1).programme) ? () => tv.screenStep(-1) : undefined}')
    expect(overlay).toContain('onNext={steps && hasPicture(stepFrom(channel, now, 1).programme) ? () => tv.screenStep(1) : undefined}')
  })

  it('steps along the running order from a picked programme, not from when it was picked', () => {
    const shipped = channelByNumber(1)!
    const now = Date.UTC(2026, 8, 30, 12, 0)
    const onAir = onScreen(shipped, now).current
    const after = stepFrom(shipped, now, 1)
    expect(after.startMs).toBe(onAir.endMs)
    expect(stepFrom(shipped, now, -1).endMs).toBe(onAir.startMs)
    selectProgramme(shipped.number, after.programme, now, after)
    expect(stepFrom(shipped, now, -1).startMs).toBe(onAir.startMs)
    expect(stepFrom(shipped, now, 1).startMs).toBe(after.endMs)
    expect(onScreen(shipped, now).next.startMs).toBe(after.endMs)
    clearManual()
  })
})

describe('the channel type', () => {
  it('sits on the time line after the status, not on a line of its own', () => {
    const start = Date.UTC(2026, 8, 30, 12, 0)
    const markup = renderToStaticMarkup(
      createElement(ProgrammeInfo, {
        channel: { number: 7, name: 'Seven', origin: 'default', category: 'News' } as Channel,
        programme: { id: 'n', title: 'Bulletin', videoId: 'abcdefghijk', durationSeconds: 1800, programmeType: 'unclassified' } as Programme,
        startMs: start,
        endMs: start + 1_800_000,
        now: start + 60_000,
      }),
    )
    expect(markup).toMatch(/<p class="info-time">[\s\S]*?On air<\/span><span class="info-meta"><span class="info-sep" aria-hidden="true">•<\/span>News<\/span><\/p>/)
    expect(markup).not.toContain('<p class="info-meta">')
  })
})

describe('the programme bar in a narrow window', () => {
  it('wraps the actions under the details only when both do not fit, with no width breakpoint', () => {
    const css = readFileSync('src/styles/guide.css', 'utf8')
    expect(css).toMatch(/\.guide-info\.is-programme \{\s*display: flex;\s*flex-wrap: wrap;/)
    expect(css).toMatch(/\.guide-info\.is-programme > \.info-main \{\s*flex: 1 1 20rem;\s*min-width: 0;/)
    expect(css).toMatch(/\.info-actions \{[^}]*flex-wrap: wrap;/)
    const block = css.slice(css.indexOf('.guide-info.is-programme {'), css.indexOf('.info-credit {'))
    expect(block).not.toMatch(/@media|@container/)
    expect(readFileSync('src/components/Guide.tsx', 'utf8')).toContain('<footer className="guide-info is-programme">')
  })
})

describe('the Guide button', () => {
  it('keeps its name and turns gold while the Guide is open', () => {
    const remote = readFileSync('src/components/TouchRemote.tsx', 'utf8')
    expect(remote).not.toContain('Close guide')
    expect(remote).toContain("className={tv.guideOpen ? 'guide-key is-on' : 'guide-key'}")
    expect(readFileSync('src/styles/stage2.css', 'utf8')).toMatch(/\.remote-bar \.guide-key\.is-on,\s*\.remote-bar \.tvn-key\.is-on \{ color: var\(--gold\)/)
  })
})

describe('I', () => {
  it('opens the information display, and closes it while it is up', () => {
    const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')
    expect(provider).toMatch(/case 'info':[\s\S]{0,160}if \(overlay === 'info'\) showOverlay\('none', 0\)\s*else showOverlay\('info', INFO_MS\)/)
  })
})

describe('the TVN icon', () => {
  const html = readFileSync('index.html', 'utf8')

  it('is served everywhere from public, largest first, with no placeholder left', () => {
    for (const file of ['favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'android-chrome-192x192.png', 'android-chrome-512x512.png', 'site.webmanifest']) {
      expect(existsSync(`public/${file}`)).toBe(true)
    }
    expect(existsSync('public/favicon.svg')).toBe(false)
    expect(html).not.toContain('favicon.svg')
    expect(html.indexOf('sizes="512x512"')).toBeLessThan(html.indexOf('sizes="32x32"'))
    expect(html).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />')
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest" />')
    const manifest = JSON.parse(readFileSync('public/site.webmanifest', 'utf8')) as { icons: { sizes: string }[] }
    expect(manifest.icons.map((icon) => icon.sizes)).toContain('512x512')
  })
})

describe('the loading ring', () => {
  it('runs LOADING TVN and the percentage twice round the logo, clockwise from the top, spaced over the whole circle', () => {
    const ring = renderToStaticMarkup(createElement(LoadingRing, { percent: 42 }))
    expect(ring).toContain('d="M 50,4 a 46,46 0 1,1 0,92 a 46,46 0 1,1 0,-92"')
    expect(ring).toContain('lengthAdjust="spacing"')
    expect(ring).toContain('aria-hidden="true"')
    const letters = [...ring.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((match) => match[1]).join('')
    expect(letters).toBe('LOADING TVN · 42% · '.repeat(2))
    expect(ring.match(/class="is-gold"/g)).toHaveLength(6)
  })

  it('sits round the logo on the loading screen, not on the off-air card, and the status text stays readable', () => {
    const loading = renderToStaticMarkup(createElement(StartupScreen, { phase: 'loading', progress: 42 }))
    expect(loading).toMatch(/class="startup-emblem"><img class="startup-logo"[^>]*\/><svg class="startup-ring"/)
    expect(loading).toContain(`<p class="startup-message sr">${STARTUP_COPY.loading}`)
    expect(renderToStaticMarkup(createElement(StartupScreen, { phase: 'failed' }))).not.toContain('startup-ring')
    const css = readFileSync('src/styles/overlays.css', 'utf8')
    expect(css).toMatch(/\.startup-ring \{[^}]*animation: ring-turn 18s linear infinite/)
    expect(css).toMatch(/@keyframes ring-turn \{\s*to \{ transform: rotate\(360deg\); \}/)
  })
})
