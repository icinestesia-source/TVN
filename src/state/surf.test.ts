import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { commandFromKey } from '../input/keyboard.ts'
import { asSurfRange, DEFAULT_SURF_RANGE, loadSurfOn, loadSurfRange, saveSurfOn, saveSurfRange, SURF_KEY, surfDelayMs } from './surf.ts'

const memory = () => {
  const map = new Map<string, string>()
  return { map, store: { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) } }
}

describe('TVN surf range', () => {
  it('starts at 4 to 10 seconds and keeps whole seconds within 1 to 60', () => {
    expect(DEFAULT_SURF_RANGE).toEqual({ minSeconds: 4, maxSeconds: 10 })
    expect(asSurfRange({ minSeconds: 0, maxSeconds: 400 })).toEqual({ minSeconds: 1, maxSeconds: 60 })
    expect(asSurfRange({ minSeconds: 4.6, maxSeconds: 12.2 })).toEqual({ minSeconds: 5, maxSeconds: 12 })
    expect(asSurfRange('nonsense')).toEqual(DEFAULT_SURF_RANGE)
  })

  it('never lets the minimum pass the maximum; the end just moved wins', () => {
    expect(asSurfRange({ minSeconds: 40, maxSeconds: 20 }, 'min')).toEqual({ minSeconds: 40, maxSeconds: 40 })
    expect(asSurfRange({ minSeconds: 40, maxSeconds: 20 }, 'max')).toEqual({ minSeconds: 20, maxSeconds: 20 })
  })

  it('is kept in this browser and read back after a reload', () => {
    const { map, store } = memory()
    expect(loadSurfRange(store)).toEqual(DEFAULT_SURF_RANGE)
    saveSurfRange({ minSeconds: 8, maxSeconds: 25 }, store)
    expect([...map.keys()]).toEqual([SURF_KEY])
    expect(loadSurfRange(store)).toEqual({ minSeconds: 8, maxSeconds: 25 })
    map.set(SURF_KEY, '{broken')
    expect(loadSurfRange(store)).toEqual(DEFAULT_SURF_RANGE)
  })

  it('stores the switch independently of the range; whether Surf starts running is set by the entry address', () => {
    const { store } = memory()
    expect(loadSurfOn(store)).toBe(true)
    saveSurfOn(false, store)
    saveSurfRange({ minSeconds: 3, maxSeconds: 9 }, store)
    expect(loadSurfOn(store)).toBe(false)
    expect(loadSurfRange(store)).toEqual({ minSeconds: 3, maxSeconds: 9 })
    saveSurfOn(true, store)
    expect(loadSurfOn(store)).toBe(true)
    expect(loadSurfRange(store)).toEqual({ minSeconds: 3, maxSeconds: 9 })
    const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')
    expect(provider).toContain('const [surfing, setSurfing] = useState(() => surfsOnEntry(currentEntryMode()))')
  })

  it('T switches surfing like the TVN button, in or out of the Guide; comma and full stop are programme Prev and Next', () => {
    const plain = { meta: false, ctrl: false, alt: false }
    expect(commandFromKey('t', plain, false)).toEqual({ type: 'surf' })
    expect(commandFromKey('T', plain, true)).toEqual({ type: 'surf' })
    expect(commandFromKey(',', plain, false)).toEqual({ type: 'step', direction: -1 })
    expect(commandFromKey('.', plain, true)).toEqual({ type: 'step', direction: 1 })
    expect(readFileSync('src/state/TvProvider.tsx', 'utf8')).toMatch(/case 'surf':\s*toggleSurf\(\)/)
    expect(readFileSync('src/state/TvProvider.tsx', 'utf8')).toMatch(
      /case 'step':\s*if \(guideOpenRef\.current\) stepGuideTime\(command\.direction\)\s*else if \(multiviewRef\.current === '1'\) screenStep\(command\.direction\)/,
    )
  })

  it('waits anywhere between the minimum and the maximum', () => {
    const range = { minSeconds: 5, maxSeconds: 30 }
    expect(surfDelayMs(range, () => 0)).toBe(5000)
    expect(surfDelayMs(range, () => 0.999999)).toBe(30000)
    expect(surfDelayMs({ minSeconds: 7, maxSeconds: 7 }, () => 0.5)).toBe(7000)
  })

  it('hops without counting as activity, pauses in the Guide and the Channel Editor, and stops for SLEEP', () => {
    const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')
    expect(provider).toContain("if (!surfing || asleep || guideOpen || screenEdit !== null || startupPhase !== 'ready' || !noticeSeen) return")
    expect(provider).toMatch(/const picked = randomChannel\(channelRef\.current\)\s*if \(picked\) requestTune\(picked\.number\)/)
    expect(provider).toMatch(/asleepRef\.current = true\s*surfingRef\.current = false\s*setSurfing\(false\)/)
  })
})
