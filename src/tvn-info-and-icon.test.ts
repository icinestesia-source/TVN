import { existsSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InfoActions } from './components/InfoActions.tsx'
import { padProps } from './info-pad.fixture.ts'
import { ProgrammeInfo } from './components/ProgrammeInfo.tsx'
import { channelByNumber } from './data/catalogue.ts'
import { clearManual, onScreen, selectProgramme, stepFrom } from './player/manual.ts'
import { LoadingRing, STARTUP_COPY, StartupScreen } from './components/StartupScreen.tsx'
import type { Channel } from './types/channel.ts'
import type { TvCommand } from './types/input.ts'
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
    renderToStaticMarkup(createElement(InfoActions, { channel, programme, onPrev, onNext, ...padProps() }))

  it('reads ← Guide →, each step usable only when there is a programme to step to', () => {
    expect(actions(() => {}, () => {})).toMatch(/aria-label="Previous programme"[^>]*>←<\/button><button[^>]*>Guide<\/button><button[^>]*aria-label="Next programme"[^>]*>→<\/button>/)
    const disabled = (markup: string, label: string) => markup.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))![0].includes('disabled=""')
    expect(disabled(actions(undefined, () => {}), 'Previous programme')).toBe(true)
    expect(disabled(actions(() => {}), 'Next programme')).toBe(true)
    expect(disabled(actions(() => {}, () => {}), 'Previous programme')).toBe(false)
    expect(disabled(actions(() => {}, () => {}), 'Next programme')).toBe(false)
  })

  it('moves the Guide back and forth, and over the picture plays the programme either side from its start', () => {
    const guide = readFileSync('src/components/Guide.tsx', 'utf8')
    expect(guide).toContain("onPrev={precedingSlot ? () => tv.dispatch({ type: 'nav', direction: 'left' }) : undefined}")
    expect(guide).toContain("onNext={followingSlot ? () => tv.dispatch({ type: 'nav', direction: 'right' }) : undefined}")
    const overlay = readFileSync('src/components/NowNextOverlay.tsx', 'utf8')
    expect(overlay).toContain('onPrev={steps && hasPicture(stepFrom(channel, now, -1).programme) ? () => tv.screenStep(-1) : undefined}')
    expect(overlay).toContain('steps && hasPicture(stepFrom(channel, now, 1).programme) ? () => tv.screenStep(1) : undefined}')
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

describe('the time line', () => {
  const start = Date.UTC(2026, 8, 30, 12, 0)
  const line = (now: number, programme: Partial<Programme> = {}) =>
    renderToStaticMarkup(
      createElement(ProgrammeInfo, {
        channel: { number: 7, name: 'Seven', origin: 'default', category: 'News' } as Channel,
        programme: { id: 'n', title: 'Bulletin', videoId: 'abcdefghijk', durationSeconds: 1800, programmeType: 'unclassified', ...programme } as Programme,
        startMs: start,
        endMs: start + 1_800_000,
        now,
      }),
    )

  it('ends at the clock: no ON AIR, no channel type, no creator or tags after it', () => {
    const airing = line(start + 60_000)
    expect(airing).not.toContain('On air')
    expect(airing).not.toContain('info-status')
    expect(airing).not.toContain('News')
    expect(airing).not.toContain('info-meta')
    expect(airing).toMatch(/<p class="info-time"><span class="info-kind">Video<\/span><span>[^<]+<\/span><span>[^<]+<\/span><span class="info-date">\([0-9-]{2}\/[0-9-]{2}\/[0-9-]{2}\)<\/span><span>[^<]+<\/span><\/p>/)
  })

  it('still names the exceptions, and never repeats the creator, type or tags', () => {
    expect(line(start - 60_000)).toContain('>Later</span>')
    expect(line(start + 3_600_000)).toContain('>Already broadcast</span>')
    const credited = line(start + 60_000, { creator: 'Maker', programmeType: 'documentary', tags: ['Bulletin'] } as Partial<Programme>)
    expect(credited).not.toMatch(/Maker|documentary|info-meta/)
    expect(credited.match(/Bulletin/g)).toHaveLength(1)
    expect(readFileSync('src/styles/guide.css', 'utf8')).not.toMatch(/\.info-meta|\.info-sep/)
  })
})

describe('the programme bar in a narrow window', () => {
  it('keeps the details beside the pad at every width, the pad spanning every row, with no width breakpoint', () => {
    const css = readFileSync('src/styles/guide.css', 'utf8')
    expect(css).toMatch(/\.guide-info\.is-programme \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) auto;/)
    expect(css).toMatch(/\.guide-info\.is-programme > \.info-main \{\s*grid-column: 1;\s*grid-row: 1;\s*min-width: 0;/)
    expect(css).toMatch(/\.guide-info\.is-programme > \.info-actions \{\s*grid-column: 2;\s*grid-row: 1 \/ -1;\s*align-self: center;/)
    const start = css.indexOf('.guide-info.is-programme {')
    const block = css.slice(start, css.indexOf('.guide-info.is-programme .info-kicker', start))
    expect(block).not.toMatch(/@media|@container/)
    expect(readFileSync('src/components/Guide.tsx', 'utf8')).toContain('<footer className="guide-info is-programme" {...handlers}')
  })
})

describe('the Guide button', () => {
  it('is the pad’s centre key: it opens the Guide, and inside the Guide it closes it', () => {
    const sent: TvCommand[] = []
    const channel = { number: 12, name: 'Twelve', origin: 'default' } as Channel
    const programme = { id: 'p', title: 'Film', videoId: 'abcdefghijk', durationSeconds: 1800 } as Programme
    const markup = renderToStaticMarkup(createElement(InfoActions, { channel, programme, ...padProps({ sent }) }))
    expect(markup).toMatch(/<button[^>]*class="tune-key info-pad-guide"[^>]*aria-label="Guide"[^>]*>Guide<\/button>/)
    expect(readFileSync('src/components/InfoActions.tsx', 'utf8')).toContain("corners.dispatch({ type: 'guide' })")
    expect(readFileSync('src/state/TvProvider.tsx', 'utf8')).toMatch(/case 'guide':\s*if \(command\.listings\) \{[\s\S]*?break\s*\}\s*if \(guideModeRef\.current === 'closed'\) openGuide\('expanded'\)\s*else \{\s*closeGuide\(\)/)
    const remote = readFileSync('src/components/TouchRemote.tsx', 'utf8')
    expect(remote).not.toContain('remote-bar')
    expect(remote).not.toContain('guide-key')
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
