import { readdirSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LOGOS, pickLogo, SESSION_LOGO } from '../components/logos.ts'
import { STARTUP_COPY, StartupScreen } from '../components/StartupScreen.tsx'
import { adjacentChannel, channelByNumber, listChannels, randomChannel } from '../data/catalogue.ts'
import { installUserCatalogue } from '../data/user-overlay.ts'
import { resetDirector } from '../director/director.ts'
import { setMediaLibrary } from '../director/library.ts'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { isOnAir, refreshAiring } from '../network/airing.ts'
import { channelsFromSources, mergeParsedExports, parseChannelsExport, planImport } from '../services/channels-import.ts'
import { DEFAULT_PREFERENCES } from '../services/preferences.ts'
import { createStartupRestore } from './startup-channel.ts'
import { independentNetworkLoaded, resolveStartupTuning, runStartup, startupAccepts, STARTUP_STALL_MS } from './startup.ts'
import { commitTuned, stepTarget, type Tuned } from './tuning.ts'

const deferred = () => {
  let resolve!: (usable: boolean) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<boolean>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const flush = () => Promise.resolve().then(() => undefined)
const screen = (phase: 'loading' | 'ready' | 'failed') => renderToStaticMarkup(createElement(StartupScreen, { phase }))
const start = (lastChannelNumber: number, previousChannelNumber: number | null = null): Tuned =>
  resolveStartupTuning(createStartupRestore(), { lastChannelNumber, previousChannelNumber })!

function installUserChannels() {
  const merged = mergeParsedExports([
    parseChannelsExport(readFileSync('public/user-network/channels.txt', 'utf8')),
    parseChannelsExport(readFileSync('public/user-network/more-channels.txt', 'utf8')),
  ])
  const built = channelsFromSources(planImport([], merged, { library: true, automatic: true }, [], 1).sources)
  installUserCatalogue(built.channels, built.programmes)
}

describe('startup loading presentation', () => {
  afterEach(() => vi.useRealTimers())

  it('A: holds the loading state, and the controls, until the load settles', async () => {
    vi.useFakeTimers()
    const load = deferred()
    const phases: string[] = []
    runStartup(() => load.promise, (phase) => phases.push(phase))
    await vi.advanceTimersByTimeAsync(5000)
    expect(phases).toEqual([])
    expect(screen('loading')).toContain(STARTUP_COPY.loading)
    expect(screen('loading')).toContain('aria-busy="true"')
    expect(startupAccepts('loading', { type: 'channel-up' })).toBe(false)
    expect(startupAccepts('loading', { type: 'last-channel' })).toBe(false)
    expect(startupAccepts('loading', { type: 'random-channel' })).toBe(false)
    expect(startupAccepts('ready', { type: 'channel-up' })).toBe(true)
  })

  it('B: becomes ready the moment the load completes, and the screen fades off', async () => {
    vi.useFakeTimers()
    const load = deferred()
    const phases: string[] = []
    runStartup(() => load.promise, (phase) => phases.push(phase))
    load.resolve(true)
    await flush()
    expect(phases).toEqual(['ready'])
    expect(screen('ready')).toContain('startup is-leaving')
  })

  it('B2: the logo stays over the static until the first channel is on screen, then fades off over the picture', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app.match(/<StartupScreen\b/g)).toHaveLength(1)
    expect(app).toMatch(/const phase = !ready \? startupPhase : startupSettled \? 'ready' : 'loading'/)
    expect(app).toMatch(/<StartupScreen phase=\{phase\} progress=\{ready \? 100 : startupProgress\} onLeft=\{\(\) => setCurtain\(false\)\} \/>/)
    expect(app.indexOf('<TvScreen />')).toBeLessThan(app.indexOf('<StartupScreen'))
    const held = renderToStaticMarkup(createElement(StartupScreen, { phase: 'loading', progress: 100 }))
    expect(held).toMatch(/class="startup"/)
    expect(held).toMatch(/<img[^>]*class="startup-logo"/)
    expect(held).not.toContain('static-ident')
    const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')
    expect(provider).toMatch(/setPictureLive\(true\)\s+setStartupSettled\(true\)/)
    expect(provider).toMatch(/if \(load !== loadToken\.current\) return result\s+if \(result === 'slate'\) setStartupSettled\(true\)\s+if \(result === 'error'\) setStartupFailed\(true\)/)
    expect(provider).toMatch(/if \(startupPhase !== 'ready' \|\| startupSettled \|\| !startupFailed\) return\s+const timer = window\.setTimeout\(\(\) => setStartupSettled\(true\), STARTUP_RETRY_MS\)/)
    expect(provider).toMatch(/if \(status === 'paused'\) setStartupSettled\(true\)/)
    expect(provider).toMatch(/if \(startupPhase !== 'ready' \|\| startupSettled\) return\s+const timer = window\.setTimeout\(\(\) => setStartupSettled\(true\), PLAYER_LOAD_TIMEOUT_MS\)/)
  })

  it('B3: the static behind the logo keeps moving while the start is busy: its frames are stepped by a CSS transform', () => {
    expect(screen('loading')).toContain('<div class="startup-noise" aria-hidden="true"><canvas class="startup-noise-frames"></canvas></div>')
    const css = readFileSync('src/styles/overlays.css', 'utf8')
    expect(css).toMatch(/\.startup-noise-frames \{[^}]*animation: startup-noise 0\.26s steps\(4\) infinite;/)
    expect(css).toMatch(/@keyframes startup-noise \{\s*to \{ transform: translateY\(-100%\); \}/)
  })

  it('C: is not driven by a timer: an instant load is ready at once, a slow one waits', async () => {
    vi.useFakeTimers()
    const phases: string[] = []
    runStartup(() => Promise.resolve(true), (phase) => phases.push(phase))
    await flush()
    expect(phases).toEqual(['ready'])

    const slow = deferred()
    const slowPhases: string[] = []
    runStartup(() => slow.promise, (phase) => slowPhases.push(phase))
    await vi.advanceTimersByTimeAsync(STARTUP_STALL_MS - 1)
    expect(slowPhases).toEqual([])
    slow.resolve(true)
    await flush()
    expect(slowPhases).toEqual(['ready'])
    await vi.advanceTimersByTimeAsync(STARTUP_STALL_MS)
    expect(slowPhases).toEqual(['ready'])
  })

  it('M: a failed or stalled start shows the off-air card, never raw error text, and recovers if the load lands', async () => {
    vi.useFakeTimers()
    const phases: string[] = []
    runStartup(() => Promise.reject(new TypeError('Failed to fetch: IndexedDB exploded')), (phase) => phases.push(phase))
    await flush()
    await flush()
    expect(phases).toEqual(['failed'])

    const stuck = deferred()
    const stuckPhases: string[] = []
    runStartup(() => stuck.promise, (phase) => stuckPhases.push(phase))
    await vi.advanceTimersByTimeAsync(STARTUP_STALL_MS)
    expect(stuckPhases).toEqual(['failed'])
    stuck.resolve(true)
    await flush()
    expect(stuckPhases).toEqual(['failed', 'ready'])

    const markup = screen('failed')
    expect(markup).toContain(STARTUP_COPY.failed)
    expect(markup).toContain('role="alert"')
    expect(markup).not.toContain(STARTUP_COPY.loading)
    expect(markup).not.toMatch(/error|exception|undefined|null|fetch|IndexedDB|stack/i)
  })

  it('L: the logos folder ships 1 to 10 bundled square PNGs, and the startup screen shows one of them', () => {
    const files = readdirSync('src/assets/logos').filter((file) => file.endsWith('.png'))
    expect(files.length).toBeGreaterThanOrEqual(1)
    expect(files.length).toBeLessThanOrEqual(10)
    expect(LOGOS).toHaveLength(files.length)
    for (const file of files) {
      const png = readFileSync(`src/assets/logos/${file}`)
      const header = new DataView(png.buffer, png.byteOffset, png.byteLength)
      expect(String.fromCharCode(...png.subarray(1, 4)), file).toBe('PNG')
      expect(header.getUint32(16), file).toBe(header.getUint32(20))
      expect(png.length, file).toBeGreaterThan(4096)
    }
    expect(LOGOS).toContain(SESSION_LOGO)
    const markup = screen('loading')
    expect(markup).toMatch(/<img[^>]*class="startup-logo"[^>]*alt="TVN"/)
    expect(markup).toContain(`src="${SESSION_LOGO}"`)
    expect(readFileSync('vite.config.ts', 'utf8')).not.toContain('assetsInlineLimit')
  })

  it('L: picks every logo in the folder, at random', () => {
    const logos = ['a.png', 'b.png', 'c.png']
    expect(pickLogo(logos, () => 0)).toBe('a.png')
    expect(pickLogo(logos, () => 0.5)).toBe('b.png')
    expect(pickLogo(logos, () => 0.999999)).toBe('c.png')
    expect(pickLogo(['only.png'], () => 0.7)).toBe('only.png')
  })
})

describe('initial tuned channel', () => {
  beforeAll(() => {
    const items = expandPlayableCatalogue(JSON.parse(readFileSync('public/independent/playable.json', 'utf8')))
    installUserCatalogue([], new Map())
    resetDirector()
    setMediaLibrary(items)
    refreshAiring(items)
  }, 60000)

  afterAll(() => installUserCatalogue([], new Map()))

  it('D: CH+ from the restored start steps from the channel on screen', () => {
    const tuned = start(225, 582)
    expect(tuned.channelNumber).toBe(225)
    const target = stepTarget(tuned, null, 1)
    expect(target).toBe(adjacentChannel(225, 1).number)
    expect(target).toBe(226)
    expect(commitTuned(tuned, target)).toEqual({ channelNumber: 226, previousNumber: 225 })
  })

  it('E: CH- from the restored start steps from the channel on screen', () => {
    const tuned = start(225, 582)
    const target = stepTarget(tuned, null, -1)
    expect(target).toBe(224)
    expect(commitTuned(tuned, target)).toEqual({ channelNumber: 224, previousNumber: 225 })
  })

  it('D/E: the fallback start (saved channel off air) is also the channel CH+/CH- step from', () => {
    const offAir = listChannels().find((channel) => channel.number < 1001 && !isOnAir(channel))!
    const tuned = start(offAir.number, null)
    expect(tuned.channelNumber).toBe(0)
    expect(stepTarget(tuned, null, 1)).toBe(adjacentChannel(tuned.channelNumber, 1).number)
  })

  it('F: startup never invents a Previous entry', () => {
    expect(start(225, null).previousNumber).toBeNull()
    expect(start(225, 225).previousNumber).toBeNull()
    expect(start(225, 1500).previousNumber).toBeNull()
    expect(start(225, 582).previousNumber).toBe(582)
    const tuned = start(225, null)
    expect(commitTuned(tuned, 225)).toBe(tuned)
  })

  it('rapid CH+ presses step from the tune still settling, not back from the start', () => {
    const tuned = start(225)
    const first = stepTarget(tuned, null, 1)
    const second = stepTarget(tuned, first, 1)
    expect(second).toBe(227)
    expect(commitTuned(tuned, second)).toEqual({ channelNumber: 227, previousNumber: 225 })
  })

  it('G: a numeric tune then CH+ steps from the entered channel', () => {
    const tuned = commitTuned(start(225), 501)
    expect(tuned).toEqual({ channelNumber: 501, previousNumber: 225 })
    expect(stepTarget(tuned, null, 1)).toBe(adjacentChannel(501, 1).number)
  })

  it('H: a Guide tune then CH+ steps from the Guide destination', () => {
    const destination = listChannels().filter((channel) => channel.number < 1001 && isOnAir(channel))[40]!
    const tuned = commitTuned(start(225), destination.number)
    expect(stepTarget(tuned, null, 1)).toBe(adjacentChannel(destination.number, 1).number)
    expect(tuned.previousNumber).toBe(225)
  })

  it('I: a Random tune then CH+ steps from the Random destination', () => {
    const initial = start(225)
    const picked = randomChannel(initial.channelNumber, () => 0.37)!
    const tuned = commitTuned(initial, picked.number)
    expect(tuned.channelNumber).toBe(picked.number)
    expect(stepTarget(tuned, null, 1)).toBe(adjacentChannel(picked.number, 1).number)
  })

  it('J: the last network channel steps past Local Media 992–1000 to 1001; numbers 1001+ are unchanged', () => {
    installUserChannels()
    try {
      expect(channelByNumber(1000)?.origin).toBe('session')
      const last = listChannels().filter((channel) => channel.number <= 999 && channel.origin !== 'session' && isOnAir(channel)).at(-1)!.number
      expect(last).toBeLessThan(992)
      const up = commitTuned(start(last), stepTarget(start(last), null, 1))
      expect(up).toEqual({ channelNumber: 1001, previousNumber: last })
      const down = commitTuned(up, stepTarget(up, null, -1))
      expect(down).toEqual({ channelNumber: last, previousNumber: 1001 })
      // 1000 is still reached by number, and steps on from there.
      expect(stepTarget(start(last), 1000, 1)).toBe(1001)
    } finally {
      installUserCatalogue([], new Map())
    }
  })

  it('N: a start with nothing valid to resume is 000 TVN, never a random channel and never 1000', () => {
    expect(DEFAULT_PREFERENCES.lastChannelNumber).toBe(0)
    expect(start(DEFAULT_PREFERENCES.lastChannelNumber).channelNumber).toBe(0)
    expect(start(1500).channelNumber).toBe(0)
    expect(start(99999, 225)).toEqual({ channelNumber: 0, previousNumber: 225 })
    expect(start(1000, null).channelNumber).toBe(0)
    expect(start(1000, 1000).channelNumber).toBe(0)
    expect(resolveStartupTuning(createStartupRestore(), { lastChannelNumber: 225, previousChannelNumber: null }, 'tvn')!.channelNumber).toBe(0)
    for (const path of ['src/state/startup.ts', 'src/state/startup-channel.ts']) {
      expect(readFileSync(path, 'utf8')).not.toMatch(/Math\.random|randomChannel/)
    }
  })

  it('O: from 000, CH+ is 001 and CH- is the highest User channel; 1000 is never stepped onto but tunes by number', () => {
    expect(stepTarget(start(0), null, 1)).toBe(1)
    installUserChannels()
    try {
      const highest = Math.max(...listChannels().filter((channel) => channel.number > 1000 && channel.enabled && !channel.emptySlot && isOnAir(channel)).map((channel) => channel.number))
      expect(highest).toBeGreaterThan(1000)
      expect(stepTarget(start(0), null, -1)).toBe(highest)
      expect(adjacentChannel(highest, 1).number).toBe(0)
      const ring = new Set<number>()
      for (let number = 0, steps = 0; steps < listChannels().length; steps += 1) {
        number = adjacentChannel(number, 1).number
        ring.add(number)
      }
      expect(ring.has(1000)).toBe(false)
      expect(channelByNumber(1000)?.origin).toBe('session')
      expect(commitTuned(start(225), 1000)).toEqual({ channelNumber: 1000, previousNumber: 225 })
    } finally {
      installUserCatalogue([], new Map())
    }
  })

  it('K: user channels restore only once installed, and never count as the independent network', () => {
    expect(independentNetworkLoaded([{ ingestedFrom: 'user-import' }, {}])).toBe(false)
    expect(independentNetworkLoaded([{ ingestedFrom: 'youtube-discovery' }])).toBe(true)

    const before = start(1001, 1002)
    expect(before.channelNumber).toBeLessThan(1000)
    expect(before.previousNumber).toBeNull()

    installUserChannels()
    try {
      const after = start(1001, 225)
      expect(after).toEqual({ channelNumber: 1001, previousNumber: 225 })
      expect(start(225, 1001).previousNumber).toBe(1001)
      expect(stepTarget(after, null, -1)).toBeLessThan(992)
    } finally {
      installUserCatalogue([], new Map())
    }
  })
})
