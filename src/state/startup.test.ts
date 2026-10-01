import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { STARTUP_COPY, StartupScreen } from '../components/StartupScreen.tsx'
import { adjacentChannel, channelByNumber, listChannels, randomChannel } from '../data/catalogue.ts'
import { installUserCatalogue } from '../data/user-overlay.ts'
import { resetDirector } from '../director/director.ts'
import { setMediaLibrary } from '../director/library.ts'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { firstOnAir, isOnAir, refreshAiring } from '../network/airing.ts'
import { channelsFromSources, mergeParsedExports, parseChannelsExport, planImport } from '../services/channels-import.ts'
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

  it('L: TVNolo.png ships as a bundled 640x640 PNG asset referenced by the startup screen', () => {
    const png = readFileSync('src/assets/TVNolo.png')
    const header = new DataView(png.buffer, png.byteOffset, png.byteLength)
    expect(String.fromCharCode(...png.subarray(1, 4))).toBe('PNG')
    expect(header.getUint32(16)).toBe(640)
    expect(header.getUint32(20)).toBe(640)
    expect(readFileSync('src/components/StartupScreen.tsx', 'utf8')).toContain("from '../assets/TVNolo.png'")
    expect(screen('loading')).toMatch(/<img[^>]*class="startup-logo"[^>]*alt="TVN"/)
    expect(png.length).toBeGreaterThan(4096)
    expect(readFileSync('vite.config.ts', 'utf8')).not.toContain('assetsInlineLimit')
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
    expect(tuned.channelNumber).toBe(firstOnAir(listChannels())!.number)
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

  it('J: 999 and 1001 step directly into each other with no channel 1000', () => {
    installUserChannels()
    try {
      expect(channelByNumber(1000)).toBeUndefined()
      expect(isOnAir(channelByNumber(999)!)).toBe(true)
      const up = commitTuned(start(999), stepTarget(start(999), null, 1))
      expect(up).toEqual({ channelNumber: 1001, previousNumber: 999 })
      const down = commitTuned(up, stepTarget(up, null, -1))
      expect(down).toEqual({ channelNumber: 999, previousNumber: 1001 })
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
      expect(stepTarget(after, null, -1)).toBeLessThan(1000)
    } finally {
      installUserCatalogue([], new Map())
    }
  })
})
