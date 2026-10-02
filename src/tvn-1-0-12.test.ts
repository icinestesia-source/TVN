import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mediaLibrary } from './director/library.ts'
import { librarySnapshot, loadShippedIndependentCatalogue, recordPlaybackFailure, resetLibraryForTests, setLibraryWriter } from './library/store.ts'
import { channelByNumber, listChannels } from './data/catalogue.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { clearManual, onScreen, pickTunes, selectProgramme } from './player/manual.ts'
import { resetTuneTimings, notePhase, notePress, tuneTimings } from './player/tune-timing.ts'
import { liveAiring } from './player/viewing.ts'
import type { SourceFilter } from './services/channel-curation.ts'
import { inventoryOf, type ChannelSource } from './services/channel-sources.ts'
import { channelsFromSources, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import { commitHistory, EMPTY_HISTORY, type ViewingHistory } from './state/history.ts'
import { pictureOwner, playingRequested } from './player/picture.ts'
import { commitTune } from './state/tune-commit.ts'
import { commitTuned, stepTarget, type Tuned } from './state/tuning.ts'

const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')
const between = (from: string, to: string) => provider.slice(provider.indexOf(from), provider.indexOf(to, provider.indexOf(from)))

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const flush = () => new Promise<void>((done) => setTimeout(done, 0))

/**
 * A provider that answers only when told to, and like the YouTube stage settles an earlier request as
 * 'slate' the moment a later one is made: only the latest request ever reaches the picture.
 */
function delayedProvider() {
  const asked: { number: number; answer: Deferred<string> }[] = []
  let showing: number | null = null
  return {
    asked,
    showing: () => showing,
    load(number: number): Promise<string> {
      asked.at(-1)?.answer.resolve('slate')
      const answer = deferred<string>()
      asked.push({ number, answer })
      return answer.promise.then((result) => {
        if (asked.at(-1)?.number === number && result === 'playing') showing = number
        return result
      })
    },
    answer(number: number, result = 'playing') {
      asked.filter((item) => item.number === number).at(-1)?.answer.resolve(result)
    },
  }
}

/**
 * The viewer's side of tuning, as the provider runs it: every press is a new generation, the static's
 * minimum is under the test's control, and commitTune is the provider's own last step.
 */
function tuner(start: number, player: ReturnType<typeof delayedProvider>) {
  let generation = 0
  let tuned: Tuned = { channelNumber: start, previousNumber: null }
  let history: ViewingHistory = commitHistory(EMPTY_HISTORY, start, null)
  // The picture follows the player as the provider tracks it: a new request covers it, PLAYING for the
  // video last asked for uncovers it, and a failure hands it to the unavailable card.
  let live = false
  let failed = false
  let requested: number | null = null
  const statics: Deferred<void>[] = []
  const press = (number: number, options: { holdStatic?: boolean } = {}) => {
    const mine = ++generation
    const origin = tuned.channelNumber
    const hold = deferred<void>()
    statics.push(hold)
    if (!options.holdStatic) hold.resolve()
    return commitTune({
      current: () => mine === generation,
      load: () => {
        requested = number
        live = false
        failed = false
        return player.load(number).then((result) => {
          if (result === 'playing' && playingRequested(String(requested), String(number), false, undefined)) live = true
          if (result === 'error' && requested === number) failed = true
          return result
        })
      },
      holdStatic: () => hold.promise,
      abandon: () => {},
      commit: () => {
        tuned = commitTuned(tuned, number, origin)
        history = commitHistory(history, number, null)
      },
    })
  }
  return {
    press,
    step: (delta: 1 | -1) => press(stepTarget(tuned, null, delta)),
    endStatic: (index: number) => statics[index].resolve(),
    tuned: () => tuned,
    history: () => history.entries.map((entry) => (typeof entry === 'number' ? entry : (entry as { channelNumber: number }).channelNumber)),
    waiting: () => pictureOwner({ face: failed ? 'card' : 'picture', live, paused: false }) === 'cover',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  clearManual()
  installUserCatalogue([], new Map())
})

describe('asynchronous channel tuning', () => {
  it('commits the channel before a delayed player answers, and lifts the waiting picture when it plays', async () => {
    const events: string[] = []
    const answer = deferred<string>()
    const result = await commitTune({
      current: () => true,
      load: () => {
        events.push('asked')
        return answer.promise
      },
      holdStatic: async () => {
        events.push('static')
      },
      commit: () => events.push('committed'),
      abandon: () => events.push('abandoned'),
    })
    expect(result).toBe('committed')
    expect(events).toEqual(['asked', 'static', 'committed'])
    const player = delayedProvider()
    const tv = tuner(101, player)
    await tv.press(225)
    expect(tv.waiting()).toBe(true)
    player.answer(225)
    await flush()
    expect(tv.waiting()).toBe(false)
  })

  it('a player that plays within the static commits with no waiting picture', async () => {
    const player = delayedProvider()
    const tv = tuner(101, player)
    const pending = tv.press(225, { holdStatic: true })
    player.answer(225)
    await flush()
    tv.endStatic(0)
    expect(await pending).toBe('committed')
    expect(tv.waiting()).toBe(false)
  })

  it('a provider that never answers cannot hold the channel, and CH+ and CH- still move at once', async () => {
    const player = delayedProvider()
    const tv = tuner(225, player)
    expect(await tv.press(534)).toBe('committed')
    expect(tv.tuned()).toEqual({ channelNumber: 534, previousNumber: 225 })
    expect(tv.waiting()).toBe(true)
    const up = stepTarget(tv.tuned(), null, 1)
    expect(await tv.step(1)).toBe('committed')
    expect(tv.tuned().channelNumber).toBe(up)
    expect(await tv.step(-1)).toBe('committed')
    expect(tv.tuned().channelNumber).toBe(534)
    expect(player.asked.map((item) => item.number)).toEqual([534, up, 534])
  })

  it('a late answer for 225 or 534 never steals the picture or the waiting state from 769', async () => {
    const player = delayedProvider()
    const tv = tuner(101, player)
    await tv.press(225)
    await tv.press(534)
    await tv.press(769)
    expect(tv.tuned().channelNumber).toBe(769)
    player.answer(225)
    player.answer(534)
    await flush()
    expect(player.showing()).toBeNull()
    expect(tv.waiting()).toBe(true)
    player.answer(769)
    await flush()
    expect(player.showing()).toBe(769)
    expect(tv.waiting()).toBe(false)
    expect(tv.tuned().channelNumber).toBe(769)
  })

  it('a slow tune the viewer leaves before it settles is abandoned: it never commits or enters history', async () => {
    const player = delayedProvider()
    const tv = tuner(101, player)
    const first = tv.press(225, { holdStatic: true })
    const second = tv.press(534)
    expect(await second).toBe('committed')
    tv.endStatic(0)
    expect(await first).toBe('abandoned')
    expect(tv.tuned()).toEqual({ channelNumber: 534, previousNumber: 101 })
    expect(tv.history()).toEqual([101, 534])
  })

  it('a failed or rejected load still commits, clears the waiting picture and leaves the controls working', async () => {
    const player = delayedProvider()
    const tv = tuner(101, player)
    await tv.press(769)
    player.answer(769, 'error')
    await flush()
    expect(tv.waiting()).toBe(false)
    const rejected = deferred<string>()
    const result = await commitTune({
      current: () => true,
      load: () => rejected.promise,
      holdStatic: async () => {},
      commit: () => {},
      abandon: () => {},
    })
    rejected.reject(new Error('player gone'))
    await flush()
    expect(result).toBe('committed')
    expect(await tv.press(787)).toBe('committed')
    expect(tv.tuned().channelNumber).toBe(787)
  })

  it('history and Previous follow committed tunes exactly as before', async () => {
    const tv = tuner(101, delayedProvider())
    await tv.press(225)
    await tv.press(534)
    await tv.press(769)
    expect(tv.history()).toEqual([101, 225, 534, 769])
    expect(tv.tuned().previousNumber).toBe(534)
  })
})

describe('the provider tunes this way', () => {
  const commit = between('commitTuneRef.current = async', '// Credits are')
  const request = between('const requestTune = ', 'commitNumericRef.current = ')

  it('asks for the airing without awaiting it, then commits through commitTune', () => {
    expect(commit).toMatch(/await commitTune\(\{/)
    expect(commit).toMatch(/load: \(\) => loadProgramme\(target, Date\.now\(\)\)/)
    expect(commit).not.toMatch(/await loadProgramme/)
  })

  it('Multi View still commits at once', () => {
    const multi = request.slice(request.indexOf("if (multiviewRef.current !== '1') {"), request.indexOf('if (pendingOrigin.current === null)'))
    expect(multi).toMatch(/commitChannel\(commitTuned\(tuned\(\), target\.number\)\)/)
    expect(multi).not.toMatch(/loadProgramme|commitTune\(/)
  })

  it('the waiting picture is noise inside the stage, beneath INFO, and only for a picture channel', () => {
    const screen = readFileSync('src/app/TvScreen.tsx', 'utf8')
    expect(screen).toMatch(/owner === 'cover' \? \(\s*<div className="stage-waiting"/)
    expect(readFileSync('src/styles/shell.css', 'utf8')).toMatch(/\.stage-waiting \{[^}]*pointer-events: none/)
  })

  it('ordinary tuning never looks a source up, rescans, enumerates or rebuilds the User Network', () => {
    const path = [
      commit,
      request,
      between('const loadProgramme = async', 'const resumeViewing'),
      between('const syncLive = useCallback', 'const onPlayerReady'),
      between('const onPlayerReady = useCallback', 'const refreshAfterFailure'),
      between("case 'channel-up':", "case 'confirm':"),
    ].join('\n')
    expect(path).not.toMatch(/lookUpChannel|resolveYouTube|rescan|widenSources|loadStoredSources|channelsFromSources|inventoryOf|eligibleOf|previewFilter|currentFacts|userChannelManifest|fetch\(/i)
  })

  it('a player error is blamed on what the player was asked for, never on the channel left behind', () => {
    const status = between('const onPlayerStatus = useCallback', '}, [syncLive, refreshAfterFailure])')
    expect(status).toMatch(/const asked = askedRef\.current/)
    expect(status).toMatch(/channelByNumber\(asked\.channelNumber\)/)
    expect(status).toMatch(/const videoId = asked\.videoId/)
    expect(status).not.toMatch(/channelRef\.current|onScreen\(/)
    expect(between('const deliverLive = async', 'const loadProgramme')).toMatch(/askedRef\.current = \{ channelNumber, videoId: command\.videoId \}/)
  })

  it('whole-network failure work waits for the tune to commit and is shared by several failures', () => {
    const status = between('const onPlayerStatus = useCallback', '}, [syncLive, refreshAfterFailure])')
    expect(status).not.toMatch(/republishLibrary\(\)|recordPlaybackFailure\(|channelsFromSources\(/)
    const refresh = between('const refreshAfterFailure = useCallback', 'const onPlayerStatus')
    expect(refresh).toMatch(/if \(tuningRef\.current\) \{\s+failureTimer\.current = window\.setTimeout\(run, 200\)/)
    expect(refresh).toMatch(/window\.clearTimeout\(failureTimer\.current\)/)
    expect(refresh).toMatch(/failuresRef\.current\.splice\(0\)/)
  })

  it('Guide exact-programme playback keeps its pick through the tune', () => {
    expect(request).toMatch(/if \(!keepPick\) clearManual\(\)/)
    expect(between('const playFromGuide', 'const activateGuide')).toMatch(/requestTune\(target\.number, true\)/)
  })
})

describe('a curated ALL MATCHING User Channel tunes from its stored programmes', () => {
  const ARTIST = 'UCbig000000000000000000a'
  const filter: SourceFilter = { include: { terms: ['Artist'], minSeconds: 120 }, exclude: { terms: ['teaser'], shorts: true } }
  const videos: ImportedVideo[] = Array.from({ length: 500 }, (_, index) =>
    index % 4 === 0
      ? { id: `s${String(index).padStart(10, '0')}`, title: `Artist moment #shorts ${index}`, durationSec: 50 }
      : index % 9 === 0
        ? { id: `t${String(index).padStart(10, '0')}`, title: `Artist teaser ${index}`, durationSec: 150 }
        : { id: `a${String(index).padStart(10, '0')}`, title: `Artist - Track ${index} (Official Video ${1990 + (index % 30)})`, durationSec: 200 + (index % 90) },
  )
  const source: ChannelSource = { id: 's1', kind: 'youtube', url: `https://www.youtube.com/channel/${ARTIST}`, label: 'Artist', enabled: true, ref: ARTIST, youtube: 'channel', videos, mode: 'all', filter }
  const record: StoredSource = {
    id: `yt:${ARTIST}`,
    name: 'Curated All',
    videos: inventoryOf([source]),
    channelNumber: 1500,
    inLibrary: false,
    automatic: true,
    updatedAt: 1,
    channelSources: [source],
  }

  it('selects what airs from the installed pool with no lookup, quickly, and only eligible programmes', () => {
    const read = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', read)
    const built = channelsFromSources([record])
    installUserCatalogue(built.channels, built.programmes)
    const channel = channelByNumber(1500)!
    expect(channel).toBeTruthy()
    const start = Date.UTC(2026, 9, 2, 12)
    const began = performance.now()
    const seen = new Set<string>()
    for (let minute = 0; minute < 600; minute += 1) seen.add(liveAiring(channel, start + minute * 60_000, null).programme.title)
    const each = (performance.now() - began) / 600
    expect(read).not.toHaveBeenCalled()
    expect(each).toBeLessThan(5)
    expect(seen.size).toBeGreaterThan(20)
    for (const title of seen) expect(title).not.toMatch(/#shorts|teaser/i)
    vi.unstubAllGlobals()
  })

  it('a Guide pick on it plays that exact programme', () => {
    const built = channelsFromSources([record])
    installUserCatalogue(built.channels, built.programmes)
    const channel = channelByNumber(1500)!
    const now = Date.UTC(2026, 9, 2, 12)
    const later = onScreen(channel, now + 3 * 3_600_000).current.programme
    selectProgramme(1500, later, now)
    expect(onScreen(channel, now).current.programme.id).toBe(later.id)
    expect(pickTunes(1500, 769, false)).toBe(true)
    expect(listChannels().some((item) => item.number === 1500)).toBe(true)
  })
})

describe('tune timings keep the phases apart', () => {
  it('records press, commit, programme, request, answer and playing separately, and flags a tune left behind', () => {
    resetTuneTimings()
    notePress(225)
    notePress(769)
    notePhase(769, 'committedAt')
    notePhase(769, 'programmeAt', { scheduleMs: 0.2 })
    notePhase(769, 'requestAt')
    notePhase(769, 'answeredAt', { result: 'playing' })
    notePhase(769, 'playingAt')
    const [left, tune] = tuneTimings()
    expect(left).toMatchObject({ channelNumber: 225, superseded: true, committedAt: null })
    expect(tune).toMatchObject({ channelNumber: 769, superseded: false, result: 'playing', scheduleMs: 0.2 })
    for (const phase of ['committedAt', 'programmeAt', 'requestAt', 'answeredAt', 'playingAt'] as const) expect(tune[phase]).not.toBeNull()
  })
})

describe('recording a playback failure', () => {
  it('updates the library record but leaves the scheduled library, and every cache keyed on it, as it was', async () => {
    const shipped = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))
    resetLibraryForTests()
    setLibraryWriter({ async write() {}, async read() { return { media: [], sources: [] } } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(shipped), { status: 200 })))
    await loadShippedIndependentCatalogue()
    const scheduled = mediaLibrary()
    const videoId = (shipped.items as [string, string, number, string, number[]][]).find((row) => row[4]?.includes(769))![0]
    const failed = await recordPlaybackFailure(videoId, 'timeout', 1234)
    expect(failed?.failureCount).toBe(1)
    expect(librarySnapshot().media.find((item) => item.externalId === videoId)?.availability).toBe('temporarily_unavailable')
    expect(mediaLibrary()).toBe(scheduled)
    vi.unstubAllGlobals()
    resetLibraryForTests()
  }, 120_000)
})
