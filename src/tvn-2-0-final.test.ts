import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LONG_PRESS_MS } from './view/channel-edit.ts'
import { createGuidePress } from './view/guide-press.ts'
import { GuideActions } from './components/GuideAdd.tsx'
import type { GuideTool } from './types/input.ts'

const mouse = { pointerType: 'mouse', clientX: 5, clientY: 5 }
const touch = { pointerType: 'touch', clientX: 5, clientY: 5 }

function guideTab() {
  const open = vi.fn()
  const search = vi.fn()
  const actions = { open, search }
  const press = createGuidePress()
  return {
    open,
    search,
    press: {
      down: (point: typeof mouse) => press.down(point, actions),
      move: press.move,
      up: press.up,
      cancel: press.cancel,
      click: () => press.click(actions),
      contextMenu: () => press.contextMenu(actions),
    },
  }
}

describe('TVN 2.0 final: GUIDE in the Guide header answers the first click', () => {
  afterEach(() => vi.useRealTimers())

  it('a left click opens the Guide at once, every time, and never searches', () => {
    vi.useFakeTimers()
    const { open, search, press } = guideTab()
    press.down(mouse)
    press.up()
    press.click()
    expect(open).toHaveBeenCalledTimes(1)
    press.down(mouse)
    vi.advanceTimersByTime(LONG_PRESS_MS * 3)
    press.up()
    press.click()
    expect(open).toHaveBeenCalledTimes(2)
    expect(search).not.toHaveBeenCalled()
  })

  it('a right-click opens CREATE GUIDE FROM… and not the Guide as well', () => {
    vi.useFakeTimers()
    const { open, search, press } = guideTab()
    press.down(mouse)
    press.contextMenu()
    press.up()
    expect(search).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
  })

  it('a tap opens the Guide; a tap released before the threshold never searches', () => {
    vi.useFakeTimers()
    const { open, search, press } = guideTab()
    press.down(touch)
    vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    press.up()
    vi.advanceTimersByTime(LONG_PRESS_MS * 3)
    press.click()
    expect(open).toHaveBeenCalledTimes(1)
    expect(search).not.toHaveBeenCalled()
  })

  it('a completed long press searches once, and the lift and the phone menu after it do nothing more', () => {
    vi.useFakeTimers()
    const { open, search, press } = guideTab()
    press.down(touch)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(search).toHaveBeenCalledTimes(1)
    press.contextMenu()
    press.up()
    press.click()
    expect(search).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
    press.down(touch)
    press.up()
    press.click()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('the phone menu raised during a hold is that hold, once', () => {
    vi.useFakeTimers()
    const { open, search, press } = guideTab()
    press.down(touch)
    vi.advanceTimersByTime(LONG_PRESS_MS - 100)
    press.contextMenu()
    vi.advanceTimersByTime(LONG_PRESS_MS)
    press.up()
    press.click()
    expect(search).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
  })

  it('moving, a cancelled pointer or leaving the page cancels the hold', () => {
    vi.useFakeTimers()
    const { search, press } = guideTab()
    press.down(touch)
    press.move({ pointerType: 'touch', clientX: 5, clientY: 60 })
    vi.advanceTimersByTime(LONG_PRESS_MS * 3)
    press.down(touch)
    press.cancel()
    vi.advanceTimersByTime(LONG_PRESS_MS * 3)
    press.down(touch)
    press.up()
    vi.advanceTimersByTime(LONG_PRESS_MS * 3)
    expect(search).not.toHaveBeenCalled()
  })

  it('the header wires the press: click opens, right-click or hold searches, unmount clears the timer', () => {
    const add = readFileSync('src/components/GuideAdd.tsx', 'utf8')
    expect(add).toContain('onClick={() => press.click(actions)}')
    expect(add).toContain('useEffect(() => press.cancel, [press])')
    expect(add).toContain('onPointerCancel={press.cancel}')
    expect(add).toMatch(/const openGuide = \(\) => \{\s+if \(!open\) onTool\('guides'\)/)
    const guide = readFileSync('src/components/Guide.tsx', 'utf8')
    expect(guide).toMatch(/onGuideSearch=\{\(\) => \{\s+setSearchAsk\(\(asked\) => asked \+ 1\)\s+if \(tool !== 'guides'\)/)
    expect(guide).toContain('<GuidePanel searchAsk={searchAsk} />')
  })
})

describe('TVN 2.0 final: regenerating the originals cannot bring back 586 Punk 90', () => {
  it('a decision belongs to the channel it was made for, and is set aside when the slot changes hands', () => {
    const build = readFileSync('scripts/originals_build.py', 'utf8')
    const identities = readFileSync('scripts/decision_identities.py', 'utf8')
    const canonical = JSON.parse(readFileSync('src/data/canonical-network.json', 'utf8')) as { channels: { number: number; name: string }[] }
    const originals = JSON.parse(readFileSync('src/data/originals/originals.json', 'utf8')) as { cards: Record<string, unknown> }
    expect(identities).toContain('586: "Punk 90",')
    expect(canonical.channels.find((channel) => channel.number === 586)?.name).toBe('Live')
    expect(build).toContain('SET_ASIDE = {n for n in {**P22, **P23} if NAMES.get(n) != DECIDED_FOR[n]}')
    expect(build).toContain('DECISIONS = {n: d for n, d in {**P22, **P23}.items() if n not in SET_ASIDE}')
    expect(originals.cards['586']).toBeUndefined()
  })
})

describe('TVN 2.0 final: the diagnostic names the build and the reserved channels', () => {
  it('says which application, commit and build is running, and what 000, 555, 586 and 1000 are', async () => {
    const { channelIdentityLine, BUILD_INFO } = await import('./build-info.ts')
    const { userTestDiagnostic } = await import('./services/diagnostic.ts')
    const { channelByNumber } = await import('./data/catalogue.ts')
    expect(BUILD_INFO.app).toBe('TVN')
    expect(channelIdentityLine()).toBe('000 TVN · 555 Daft Punk · 586 Live · 1000 Local Media')
    const text = userTestDiagnostic(channelByNumber(555)!, Date.UTC(2026, 9, 2, 20), { playerStatus: 'playing' })
    expect(text).toMatch(/^Build: TVN · commit \S+ · built \S+ · id \S+$/m)
    expect(text).toContain('Channels: 000 TVN · 555 Daft Punk · 586 Live · 1000 Local Media')
    const config = readFileSync('vite.config.ts', 'utf8')
    expect(config).toContain('if (process.env.COMMIT_REF) return process.env.COMMIT_REF.slice(0, 7)')
  })
})

describe('TVN 2.0 final: GUIDE is the screen’s default section', () => {
  const header = (tool: GuideTool | null, following = false) =>
    renderToStaticMarkup(createElement(GuideActions, { tool, picked: false, following, onNow: () => {}, onTool: () => {} }))
  const active = (markup: string) => [...markup.matchAll(/class="tab[^"]*\bis-on\b[^"]*"[^>]*>([A-Za-z ]+)</g)].map((match) => match[1])

  it('one section carries the gold underline: GUIDE while the listings show, OPTIONS, ADD or MEDIA while they are open', () => {
    expect(active(header(null))).toEqual(['Guide'])
    expect(active(header('guides'))).toEqual(['My Guide'])
    expect(active(header('options'))).toEqual(['Options'])
    expect(active(header('add'))).toEqual(['Add'])
    expect(active(header('media'))).toEqual(['Media'])
    expect(header('options')).not.toMatch(/aria-current="page"[^>]*>Guide</)
  })

  it('a Guide choosing what plays keeps GUIDE green, apart from which section is active', () => {
    expect(header(null, true)).toContain('class="tab guide-follow is-following"')
    expect(header('guides', true)).toContain('class="tab guide-follow is-on is-open is-following"')
    expect(header('options', true)).toContain('class="tab guide-follow is-following"')
    const css = readFileSync('src/styles/guide.css', 'utf8')
    expect(css).toContain('.tab.guide-follow.is-following { color: var(--follow); font-weight: 600; }')
    expect(css).not.toMatch(/\.tab\.guide-follow\.is-current/)
    expect(css).toMatch(/\.tab\.is-on \{\s+color: var\(--gold\);\s+border-bottom-color: var\(--gold\);/)
  })

  it('closing OPTIONS or the Network Editor brings the listings straight back where they were, never a blank grid', () => {
    const guide = readFileSync('src/components/Guide.tsx', 'utf8')
    expect(guide).toContain("const gridShown = tool !== 'options' && !networkShown && tv.visibleChannels.length > 0")
    expect(guide).toMatch(/if \(!grid \|\| !gridHidden\.current\) return\s+gridHidden\.current = false\s+grid\.scrollLeft = scrollLeft\s+grid\.scrollTop = scrollTop/)
  })
})
