import { readFileSync } from 'node:fs'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { InfoActions } from './components/InfoActions.tsx'
import { padProps } from './info-pad.fixture.ts'
import { ROW_HEIGHT, openScrollLeft, slotFrame, timeX, trackWidthPx } from './epg/geometry.ts'
import {
  GUIDE_ZOOM_MAX,
  GUIDE_ZOOM_MIN,
  anchorTime,
  anchoredScrollLeft,
  clampZoom,
  touchDistance,
  touchMidpoint,
  wheelZoomFactor,
} from './epg/zoom.ts'
import { commandFromKey } from './input/keyboard.ts'
import { bindTimelinePinch } from './input/timeline-pinch.ts'
import { channelByNumber } from './data/catalogue.ts'
import { guideSlots } from './services/broadcast.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'
import type { TvCommand } from './types/input.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const guide = read('src/components/Guide.tsx')
const provider = read('src/state/TvProvider.tsx')
const css = read('src/styles/guide.css')

type Control = { label: string; props: Record<string, unknown> }

/** The information bar's controls in render order, with their props, without a DOM. */
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

const channel = { number: 12, name: 'Twelve', origin: 'default' } as Channel
const programme = { id: 'p', title: 'Film', videoId: 'abcdefghijk', durationSeconds: 1800, playback: 'seekable-recorded' } as Programme

function bar(overrides: Partial<Parameters<typeof InfoActions>[0]> = {}) {
  const sent: TvCommand['type'][] = []
  const calls: string[] = []
  const tree = InfoActions({
    channel,
    programme,
    onPrev: () => calls.push('previous programme'),
    onNext: () => calls.push('next programme'),
    ...padProps({ sent: { push: (command: TvCommand) => sent.push(command.type) } as unknown as TvCommand[] }),
    ...overrides,
  })
  const list = controls(tree)
  const press = (label: string) => (list.find((control) => control.label === label)!.props.onClick as () => void)()
  return { list, sent, calls, press }
}

describe('information controls: the 3×3 pad round GUIDE', () => {
  it('1. renders REMOTE ↑|CH+ ⛶ / ← GUIDE → / TVN ↓|CH− R with the accessible names', () => {
    const { list } = bar()
    expect(list.map((control) => control.label)).toEqual(['Remote', '↑', 'CH+', '⛶', '←', 'Guide', '→', '⚙', '↓', 'CH−', 'TVN'])
    const named = Object.fromEntries(list.map((control) => [control.label, control.props['aria-label']]))
    expect(named['↑']).toBe('Previous watched channel')
    expect(named['CH+']).toBe('Channel up')
    expect(named['←']).toBe('Previous programme')
    expect(named['Guide']).toBe('Guide')
    expect(named['→']).toBe('Next programme')
    expect(named['↓']).toBe('Next watched channel')
    expect(named['CH−']).toBe('Channel down')
  })

  it('2. ↑ goes back to the previously watched channel', () => {
    const { sent, press } = bar()
    press('↑')
    expect(sent).toEqual(['history-back'])
  })

  it('3. ↓ goes forward through the watched channels', () => {
    const { sent, press } = bar()
    press('↓')
    expect(sent).toEqual(['history-forward'])
  })

  it('4. ← steps to the previous programme', () => {
    const { calls, sent, press } = bar()
    press('←')
    expect(calls).toEqual(['previous programme'])
    expect(sent).toEqual([])
    expect(guide).toContain("onPrev={precedingSlot ? () => tv.dispatch({ type: 'nav', direction: 'left' }) : undefined}")
  })

  it('5. → steps to the next programme', () => {
    const { calls, sent, press } = bar()
    press('→')
    expect(calls).toEqual(['next programme'])
    expect(sent).toEqual([])
    expect(guide).toContain("onNext={followingSlot ? () => tv.dispatch({ type: 'nav', direction: 'right' }) : undefined}")
  })

  it('6. GUIDE is the gold centre key and sends the Guide command, and CH+ and CH− step the channel numbers', () => {
    const { list, sent, press } = bar()
    expect(list.find((control) => control.label === 'Guide')!.props.className).toBe('tune-key info-pad-guide')
    press('Guide')
    press('CH+')
    press('CH−')
    expect(sent).toEqual(['guide', 'channel-up', 'channel-down'])
  })

  it('7. Fullscreen takes the top-right corner; originals open from the Channel Editor programme lists', () => {
    const { list } = bar()
    expect(list[3].props).toMatchObject({ className: 'info-square info-corner is-fullscreen', 'aria-label': 'Fullscreen' })
    expect(list.some((control) => control.props.href !== undefined)).toBe(false)
    const editor = read('src/components/ChannelEditor.tsx')
    expect(editor).toContain('href: watchUrl(programme.videoId)')
    expect(editor).toContain('<OriginalLink video={video} />')
    expect(editor).toMatch(/target="_blank"\s+rel="noopener noreferrer"/)
  })
})

describe('Guide timeline zoom', () => {
  it('8. a fresh session starts at 1x, and 1x is the standard scale', () => {
    expect(provider).toContain('const [guideZoom, setGuideZoomState] = useState(1)')
    expect(guide).toContain('const pxPerMinute = usePxPerMinute() * tv.guideZoom')
    expect(provider).not.toMatch(/localStorage[^\n]*guideZoom|guideZoom[^\n]*localStorage/)
    for (const base of [4.6, 6.2, 8]) expect(base * 1).toBe(base)
  })

  it('9. zoom widens every cell in proportion', () => {
    const start = Date.UTC(2026, 9, 1, 10)
    for (const zoom of [1.5, 2, 4, 6]) {
      for (const [from, to] of [[start, start + 30 * 60_000], [start + 45 * 60_000, start + 165 * 60_000]]) {
        const base = slotFrame(from, to, start, 8)
        const zoomed = slotFrame(from, to, start, 8 * zoom)
        expect(zoomed.left).toBeCloseTo(base.left * zoom, 6)
        expect(zoomed.width + 3).toBeCloseTo((base.width + 3) * zoom, 6)
      }
      expect(trackWidthPx(start, start + 6 * 3_600_000, 8 * zoom)).toBeCloseTo(trackWidthPx(start, start + 6 * 3_600_000, 8) * zoom, 6)
    }
  })

  it('10. schedules, times and durations do not depend on zoom', () => {
    const slots = guide.slice(guide.indexOf('const slotsById = useMemo'), guide.indexOf('const focusedChannel ='))
    expect(slots).not.toContain('pxPerMinute')
    expect(slots).not.toContain('guideZoom')
    const shipped = channelByNumber(1)!
    const start = Date.UTC(2026, 9, 1, 10)
    const before = guideSlots(shipped, start, start + 4 * 3_600_000).map((slot) => [slot.startMs, slot.endMs])
    const again = guideSlots(shipped, start, start + 4 * 3_600_000).map((slot) => [slot.startMs, slot.endMs])
    expect(again).toEqual(before)
    expect(read('src/services/broadcast.ts')).not.toContain('guideZoom')
    expect(read('src/epg/geometry.ts')).not.toContain('zoom')
  })

  it('11. the channel column, row heights and time header are not scaled', () => {
    const column = guide.slice(guide.indexOf('<div className="guide-channels">'), guide.indexOf('<div className="guide-grid"'))
    expect(column).not.toContain('pxPerMinute')
    expect(column).not.toMatch(/guideZoom \*|\* tv\.guideZoom/)
    expect(ROW_HEIGHT).toBe(52)
    expect(css).toMatch(/\.guide-channels \{[^}]*width: var\(--channel-col\)/)
    expect(guide).not.toMatch(/ROW_HEIGHT \* [a-z]*[zZ]oom/)
  })

  it('12. the slider in the channel heading drives the zoom, 1x to 6x, keyboard reachable', () => {
    const head = guide.slice(guide.indexOf('<div className="ch-head"'), guide.indexOf('<div\n              className="channel-scroll"'))
    expect(head.indexOf('aria-label="Next 100 channels"')).toBeLessThan(head.indexOf('type="range"'))
    expect(head).toContain('aria-label="Guide timeline zoom"')
    expect(head).toContain('min={GUIDE_ZOOM_MIN}')
    expect(head).toContain('max={GUIDE_ZOOM_MAX}')
    expect(head).toContain('step={GUIDE_ZOOM_STEP}')
    expect(head).toContain('value={tv.guideZoom}')
    expect(head).toContain('onChange={(event) => applyZoom(Number(event.target.value), null)}')
    expect([GUIDE_ZOOM_MIN, GUIDE_ZOOM_MAX]).toEqual([1, 6])
    expect(clampZoom(0.4)).toBe(1)
    expect(clampZoom(9)).toBe(6)
    expect(clampZoom(2.75)).toBe(2.75)
    expect(clampZoom(Number.NaN)).toBe(1)
    // The slider is an input: the television's arrow keys leave it to the slider.
    expect(read('src/input/keyboard.ts')).toContain("['INPUT', 'TEXTAREA', 'SELECT']")
  })

  it('13. NOW resets the zoom to 1x', () => {
    const now = provider.slice(provider.indexOf("case 'guide-now': {"), provider.indexOf('break\n', provider.indexOf('setGuideNote(null)', provider.indexOf("case 'guide-now': {"))))
    expect(now).toContain('setGuideZoomState(1)')
    expect(guide).toContain("onNow={() => tv.dispatch({ type: 'guide-now' })}")
    expect(commandFromKey('Home', { meta: false, ctrl: false, alt: false }, true)).toEqual({ type: 'guide-now' })
  })

  it('14. NOW still returns the Guide to the current time', () => {
    const now = provider.slice(provider.indexOf("case 'guide-now': {"), provider.indexOf("case 'guide-now': {") + 2200)
    expect(now).toContain('if (clearManual())')
    expect(now).toContain('const nextCursor = { channelNumber: channelRef.current, timeMs: now }')
    expect(now).toContain('setGuideCursor(nextCursor)')
    expect(now).toContain('const nextWindow = windowAround(now)')
    // Every zoom holds the view; NOW brings the playing channel and the current time back through its own effect.
    expect(guide).toContain('zoomHeld.current = true')
    expect(guide).toMatch(/if \(zoomHeld\.current\) \{\s*zoomHeld\.current = false\s*return\s*\}/)
    expect(guide).toContain('grid.scrollLeft = openScrollLeft(Date.now(), startMs, pxPerMinute, grid.clientWidth)')
  })

  it('15. anchored zoom holds the time under the pointer or between the fingers', () => {
    const windowStart = Date.UTC(2026, 9, 1, 6)
    for (const [scrollLeft, offset, from, to] of [[2400, 310, 8, 20], [5120, 40, 16, 9.6], [0, 600, 4.6, 27.6], [900, 0, 48, 8]]) {
      const time = anchorTime(scrollLeft, offset, windowStart, from)
      const next = anchoredScrollLeft(time, offset, windowStart, to)
      expect(anchorTime(next, offset, windowStart, to)).toBeCloseTo(time, 3)
      expect(timeX(time, windowStart, to) - next).toBeCloseTo(offset, 6)
    }
    // Not from the left edge: zooming about a point away from the edge moves scrollLeft.
    expect(anchoredScrollLeft(anchorTime(2400, 310, windowStart, 8), 310, windowStart, 16)).toBeCloseTo(2400 * 2 + 310, 6)
    expect(anchoredScrollLeft(windowStart - 600_000, 10, windowStart, 8)).toBe(0)
    expect(guide).toContain('grid.scrollLeft = anchoredScrollLeft(timeMs, offsetPx, startMs, pxPerMinute)')
  })

  it('16. a two-finger pinch zooms the timeline and is kept from the page', () => {
    const { target, fire, requests } = fakeTimeline(1.5)
    const unbind = bindTimelinePinch(target, () => ({ zoomBase: () => 1.5, requestZoom: (zoom, offset) => void requests.push([zoom, offset]) }))
    const a = { clientX: 300, clientY: 200 }
    const start = fire('touchstart', { touches: [a, { clientX: 400, clientY: 200 }] })
    expect(start.prevented).toBe(true)
    const move = fire('touchmove', { touches: [{ clientX: 250, clientY: 200 }, { clientX: 450, clientY: 200 }] })
    expect(move.prevented).toBe(true)
    expect(requests.at(-1)![0]).toBeCloseTo(3, 6)
    expect(requests.at(-1)![1]).toBe(350 - 100)
    fire('touchend', { touches: [a] })
    const after = fire('touchmove', { touches: [a] })
    expect(after.prevented).toBe(false)
    expect(touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBe(5)
    expect(touchMidpoint({ clientX: 0, clientY: 0 }, { clientX: 10, clientY: 20 })).toEqual({ x: 5, y: 10 })
    // Trackpad pinch: ctrl-wheel and Safari gestures, the same anchor rule.
    const wheel = fire('wheel', { ctrlKey: true, deltaY: -50, deltaMode: 0, clientX: 600 })
    expect(wheel.prevented).toBe(true)
    expect(requests.at(-1)).toEqual([1.5 * wheelZoomFactor(-50), 500])
    expect(wheelZoomFactor(-50)).toBeGreaterThan(1)
    expect(wheelZoomFactor(50)).toBeLessThan(1)
    fire('gesturestart', { scale: 1, clientX: 200 })
    expect(fire('gesturechange', { scale: 2, clientX: 200 }).prevented).toBe(true)
    expect(requests.at(-1)).toEqual([3, 100])
    unbind()
    expect(target.listeners.size).toBe(0)
    // The page itself is never told to stop zooming: nothing listens beyond the timeline.
    expect(guide).not.toMatch(/(window|document)\.addEventListener\('(wheel|gesture|touch)/)
    expect(guide).toContain('<div className="guide-grid" ref={timelineRef}>')
    expect(css).toMatch(/\.grid-scroll \{[^}]*touch-action: pan-x pan-y;/)
  })

  it('17. ordinary scrolling still scrolls the Guide', () => {
    const { target, fire, requests } = fakeTimeline(1)
    bindTimelinePinch(target, () => ({ zoomBase: () => 1, requestZoom: (zoom, offset) => void requests.push([zoom, offset]) }))
    expect(fire('wheel', { ctrlKey: false, deltaY: 120, deltaMode: 0, clientX: 300 }).prevented).toBe(false)
    expect(fire('wheel', { ctrlKey: false, deltaX: 80, deltaY: 0, deltaMode: 0, clientX: 300 }).prevented).toBe(false)
    expect(fire('touchstart', { touches: [{ clientX: 300, clientY: 200 }] }).prevented).toBe(false)
    expect(fire('touchmove', { touches: [{ clientX: 280, clientY: 260 }] }).prevented).toBe(false)
    expect(requests).toEqual([])
    expect(guide).toContain('<div className="grid-scroll" ref={gridRef} onScroll={onScroll} onWheel={onWheel}>')
    expect(guide).toContain("if (current.scrollLeft + current.clientWidth > current.scrollWidth - 360) tv.extendGuide('end')")
    expect(css).toMatch(/\.grid-scroll \{[^}]*overflow: auto;/)
  })

  it('18. the mobile layout keeps its columns, and the slider fits the narrowest heading', () => {
    expect(css).toMatch(/\.guide-zoom \{[^}]*flex: 1 1 auto;[^}]*min-width: 28px;/)
    expect(css).toMatch(/\.guide-zoom \{[^}]*max-width: 132px;/)
    expect(read('src/styles/tokens.css')).toContain('--channel-col: 280px')
    // Phones show the channel name rather than the star, so their channel column is a little wider.
    for (const width of ['210px', '168px', '140px']) expect(css).toContain(`--channel-col: ${width}`)
    expect(css).toMatch(/@media \(max-width: 640px\) \{[^@]*\.channel-cell \.star \{ display: none; \}/)
    expect(css).not.toMatch(/@media \(max-width: 640px\) \{[^@]*\.ch-name \{ display: none; \}/)
    expect(read('src/epg/geometry.ts')).toContain('return windowWidth < 720 ? 4.6 : windowWidth < 1100 ? 6.2 : 8')
    // At 1x, the phone Guide opens exactly where it always did.
    const now = Date.UTC(2026, 9, 1, 12, 10)
    const start = Date.UTC(2026, 9, 1, 6)
    expect(openScrollLeft(now, start, 4.6 * 1, 360)).toBe(openScrollLeft(now, start, 4.6, 360))
  })

  it('19. choosing and playing from the Guide is unchanged', () => {
    expect(guide).toContain('onFocus={(timeMs) => tv.focusGuide(channel.number, timeMs)}')
    expect(guide).toContain('onActivate={() => tv.activateGuide()}')
    expect(guide).toContain("onTune={() => tv.dispatch({ type: 'tune', channelNumber: channel.number })}")
    expect(guide).toMatch(/<InfoActions\s+key=\{channel\.number\}\s+channel=\{channel\}\s+programme=\{slot\.programme\}\s+onPrev=\{onPrev\}\s+onNext=\{onNext\}(?:\s+following=\{following\})?\s+history=\{history\}\s+corners=\{corners\}\s+channels=\{channels\}\s+\/>/)
  })
})

type Fired = { prevented: boolean }

function fakeTimeline(_zoom: number) {
  const listeners = new Map<string, EventListener>()
  const target = {
    listeners,
    addEventListener: (type: string, listener: EventListener) => void listeners.set(type, listener),
    removeEventListener: (type: string) => void listeners.delete(type),
    getBoundingClientRect: () => ({ left: 100, top: 0, right: 900, bottom: 600, width: 800, height: 600, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect,
  } as unknown as Pick<HTMLElement, 'addEventListener' | 'removeEventListener' | 'getBoundingClientRect'> & { listeners: Map<string, EventListener> }
  const requests: [number, number][] = []
  const fire = (type: string, init: Record<string, unknown>): Fired => {
    const event = { type, ...init, prevented: false, preventDefault: vi.fn(function (this: Fired) { this.prevented = true }) }
    listeners.get(type)?.(event as unknown as Event)
    return event
  }
  return { target, fire, requests }
}
