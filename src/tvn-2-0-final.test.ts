import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LONG_PRESS_MS } from './view/channel-edit.ts'
import { createGuidePress } from './view/guide-press.ts'

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
