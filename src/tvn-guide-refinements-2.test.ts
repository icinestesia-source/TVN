import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, loadPreferences, PREFERENCES_KEY } from './services/preferences.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const guide = read('src/components/Guide.tsx')
const css = read('src/styles/guide.css')

describe('Guide tabs: All · TVN · users · + · Fav', () => {
  it('lists the viewer’s own network as TVN, with no separate TVN-only tab', () => {
    expect(guide).toMatch(/\['all', 'All'\],\s*\['user', userNetworkName\(undefined, tv\.networkUsers\)\],\s*\.\.\.tv\.networkUsers\.map/)
    const plus = guide.indexOf('className={tool === \'users\' ? \'tab guide-plus is-on\'')
    expect(plus).toBeGreaterThan(guide.indexOf('...tv.networkUsers.map'))
    expect(plus).toBeLessThan(guide.indexOf('<span className="guide-tab-glyph" aria-hidden="true">☆</span>'))
    expect(guide).not.toContain("['retrotv',")
    expect(guide).not.toContain("['user', 'User']")
  })

  it('opens a saved TVN-only Guide on All', () => {
    const store = new Map<string, string>([[PREFERENCES_KEY, JSON.stringify({ ...DEFAULT_PREFERENCES, guideFilter: 'retrotv' })]])
    const original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) },
      configurable: true,
    })
    try {
      expect(loadPreferences().guideFilter).toBe('all')
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
    }
  })
})

describe('Guide: the clip playing now is yellow', () => {
  it('marks the watched channel’s playing slot, the picked one when a programme was picked from the Guide', () => {
    expect(guide).toContain("playing={channel.number === tv.channel.number ? playingSlot : null}")
    expect(guide).toContain("const playingSlot: PlayingSlot = manual ? (manual.slot ? { startMs: manual.slot.startMs } : null) : 'airing'")
    expect(guide).toContain("const isPlaying = playing === 'airing' ? flags.airing : playing !== null && playing.startMs === slot.startMs")
    expect(guide).toContain("${isPlaying ? ' is-playing' : ''}")
  })

  it('letters and frames it in yellow, and the gold cursor still fills it', () => {
    const start = css.indexOf('\n.prog.is-playing {')
    const block = css.slice(start, css.indexOf('}', start))
    expect(block).toContain('color: var(--gold);')
    expect(block).toContain('box-shadow: inset 0 0 0 2px var(--gold);')
    expect(css.indexOf('\n.prog.is-focused {')).toBeGreaterThan(start)
  })
})

describe('Information bar: right-click anywhere but the buttons', () => {
  const press = read('src/components/use-edit-press.ts')

  it('skips the control pad and edits from everywhere else on the bar', () => {
    expect(press).toContain("target.closest('.info-actions') !== null")
    expect(press).toMatch(/onPointerDown: \(event: PointerEvent<HTMLElement>\) => \{\s*if \(editRef\.current && !inPad\(event\.target\)\) press\.down\(event\)/)
    expect(press).toMatch(/if \(!editRef\.current \|\| inPad\(event\.target\)\) return/)
  })

  it('is the same over the picture and in the Guide', () => {
    expect(read('src/components/NowNextOverlay.tsx')).toContain('{...handlers}')
    expect(guide).toContain('<footer className="guide-info is-programme" {...handlers} onPointerLeave={handlers.onPointerCancel}>')
    expect(guide).toContain("? () => tv.dispatch({ type: 'guide-tool', tool: 'edit', channelNumber: focusedChannel.number })")
  })
})
