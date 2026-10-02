import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createWheelStepper, swipeStep, WHEEL_REST_MS } from './gestures.ts'

const scroll = (deltaY: number, timeStamp: number, extra: Partial<{ deltaX: number; deltaMode: number; ctrlKey: boolean }> = {}) => ({
  deltaX: 0,
  deltaMode: 0,
  ctrlKey: false,
  ...extra,
  deltaY,
  timeStamp,
})

describe('scrolling over the picture', () => {
  it('scrolling down (two fingers up on a Mac trackpad) goes one channel back; scrolling up, one on', () => {
    const down = createWheelStepper()
    expect(down(scroll(30, 0))).toBeNull()
    expect(down(scroll(40, 16))).toEqual({ type: 'channel-down' })
    const up = createWheelStepper()
    expect(up(scroll(-80, 0))).toEqual({ type: 'channel-up' })
  })

  it('changes one channel per gesture, however long its momentum runs, and the next gesture another', () => {
    const wheel = createWheelStepper()
    const steps = Array.from({ length: 40 }, (_, index) => wheel(scroll(25, index * 16))).filter(Boolean)
    expect(steps).toEqual([{ type: 'channel-down' }])
    const later = 40 * 16 + WHEEL_REST_MS + 1
    expect(wheel(scroll(90, later))).toEqual({ type: 'channel-down' })
  })

  it('counts a mouse wheel in lines, and leaves sideways scrolls and pinches alone', () => {
    expect(createWheelStepper()(scroll(-4, 0, { deltaMode: 1 }))).toEqual({ type: 'channel-up' })
    expect(createWheelStepper()(scroll(200, 0, { deltaX: 300 }))).toBeNull()
    expect(createWheelStepper()(scroll(200, 0, { ctrlKey: true }))).toBeNull()
  })
})

describe('swiping the picture', () => {
  const at = (x: number, y: number, t: number) => ({ x, y, at: t })
  it('a swipe up goes one channel on, a swipe down one back, the reverse of a trackpad', () => {
    expect(swipeStep(at(100, 400, 0), at(110, 250, 200))).toEqual({ type: 'channel-up' })
    expect(swipeStep(at(100, 200, 0), at(90, 360, 200))).toEqual({ type: 'channel-down' })
  })

  it('ignores taps, sideways drags and slow drags', () => {
    expect(swipeStep(at(100, 400, 0), at(102, 390, 120))).toBeNull()
    expect(swipeStep(at(100, 400, 0), at(300, 330, 200))).toBeNull()
    expect(swipeStep(at(100, 400, 0), at(100, 200, 2000))).toBeNull()
  })

  it('is wired to the picture, where a tap still shows the information bar', () => {
    const screen = readFileSync('src/app/TvScreen.tsx', 'utf8')
    expect(screen).toContain('<PictureCatch />')
    expect(screen).toMatch(/onWheel=\{\(event\) => \{\s*const step = wheel\(event\)\s*if \(step\) tv\.dispatch\(step\)/)
    expect(screen).toMatch(/if \(swiped\.current\) swiped\.current = false\s*else tv\.dispatch\(\{ type: 'info' \}\)/)
    expect(readFileSync('src/styles/shell.css', 'utf8')).toMatch(/\.click-catch \{[^}]*touch-action: pinch-zoom;/)
  })
})
