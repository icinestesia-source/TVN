import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOADING_LOGO_KEY, loadLoadingLogo, releaseSpin, setLoadingLogo, slowedSpin, SPIN_MAX, turnBetween, WHEEL_GAIN, wheelSpin } from './loading-logo.ts'

const memory = () => {
  const items = new Map<string, string>()
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) }
}

describe('OPTIONS → Loading logo: Pulse, or a logo to flick and spin', () => {
  it('pulses unless the viewer chose Spin, and remembers the choice', () => {
    const store = memory()
    expect(loadLoadingLogo(store)).toBe('pulse')
    setLoadingLogo('spin', store)
    expect(store.getItem(LOADING_LOGO_KEY)).toBe('spin')
    expect(loadLoadingLogo(store)).toBe('spin')
    setLoadingLogo('pulse', store)
    expect(loadLoadingLogo(store)).toBe('pulse')
  })

  it('reads a turn across ±180° as the short way round', () => {
    expect(turnBetween(170, -170)).toBe(20)
    expect(turnBetween(-170, 170)).toBe(-20)
    expect(turnBetween(10, 40)).toBe(30)
  })

  it('a flick leaves the logo spinning at the speed of the last moments of the drag, both ways, within a limit', () => {
    const flick = [
      { angle: 0, at: 1000 },
      { angle: 30, at: 1050 },
      { angle: 60, at: 1100 },
    ]
    expect(releaseSpin(flick, 1100)).toBeCloseTo(600)
    expect(releaseSpin(flick.map((sample) => ({ ...sample, angle: -sample.angle })), 1100)).toBeCloseTo(-600)
    // Held still before letting go: no spin.
    expect(releaseSpin(flick, 1400)).toBe(0)
    expect(releaseSpin([{ angle: 0, at: 0 }, { angle: 170, at: 10 }], 10)).toBe(SPIN_MAX)
  })

  it('slows to a stop, a hard flick running for several seconds', () => {
    let spin = SPIN_MAX
    let seconds = 0
    while (spin !== 0 && seconds < 60) {
      spin = slowedSpin(spin, 1 / 60)
      seconds += 1 / 60
    }
    expect(seconds).toBeGreaterThan(4)
    expect(seconds).toBeLessThan(10)
  })

  it('a trackpad swipe pushes it round: fingers right or down clockwise, and the swipe’s momentum adds on', () => {
    expect(wheelSpin(0, { deltaX: -20, deltaY: 0, deltaMode: 0 })).toBe(20 * WHEEL_GAIN)
    expect(wheelSpin(0, { deltaX: 0, deltaY: 20, deltaMode: 0 })).toBe(-20 * WHEEL_GAIN)
    expect(wheelSpin(100, { deltaX: -10, deltaY: 0, deltaMode: 0 })).toBe(100 + 10 * WHEEL_GAIN)
    // A mouse wheel that counts in lines moves it as far as the same scroll in pixels.
    expect(wheelSpin(0, { deltaX: 0, deltaY: -1, deltaMode: 1 })).toBe(16 * WHEEL_GAIN)
    expect(wheelSpin(SPIN_MAX, { deltaX: -500, deltaY: 0, deltaMode: 0 })).toBe(SPIN_MAX)
  })

  it('takes swipes anywhere on the loading screen, from a finger, a pen, a mouse or a trackpad', () => {
    const screen = readFileSync('src/components/StartupScreen.tsx', 'utf8')
    expect(screen).toContain("screen.addEventListener('wheel', wheel, { passive: false })")
    expect(screen).toContain("screen.addEventListener('pointerdown', down)")
    expect(readFileSync('src/styles/overlays.css', 'utf8')).toMatch(/\.startup\.has-spinner \{[^}]*touch-action: none;[^}]*overscroll-behavior: none;/)
  })

  it('the logo stands in front of the LOADING TVN ring', () => {
    expect(readFileSync('src/styles/overlays.css', 'utf8')).toContain('.startup-emblem .startup-logo { position: relative; z-index: 1; width: 100%; }')
  })

  it('the loading screen and OPTIONS offer it', () => {
    const screen = readFileSync('src/components/StartupScreen.tsx', 'utf8')
    expect(screen).toContain("logo === 'spin' && !failed ? <SpinLogo />")
    const options = readFileSync('src/components/GuideOptions.tsx', 'utf8')
    expect(options).toContain('aria-label="Loading logo"')
  })
})
