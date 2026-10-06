import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pictureOwner, playingRequested } from './player/picture.ts'
import { afterRefusal, arrive, fallbackProgramme, giveUp, PROGRAMME_ATTEMPTS, type Recovery } from './player/refusal-fallback.ts'
import { STEP_REACH } from './player/manual.ts'
import { broadcast } from './services/broadcast.ts'
import { isRefusalCode } from './services/embed-refusals.ts'
import { channelsFromSources, type StoredSource } from './services/channels-import.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { channelByNumber } from './data/catalogue.ts'
import { addUser, userFilter } from './data/user-network/users.ts'
import { claimStarterInstall, setStarterState, starterIds, withoutStarter } from './data/user-network/starter.ts'
import { fallForwardTarget, guideRows, randomTarget, stepTarget, universeChannels, type ChannelUniverse } from './state/tuning.ts'
import { readUserNetworkFile, recordsFromExport } from './services/user-network-restore.ts'
import { carriesSecret } from './services/user-network-export.ts'
import { planStarterNetwork, planTestChannels, starterCollections } from './services/user-network.ts'
import { DEFAULT_FAVOURITES, placeStarterFavourites, starterFavouriteSources } from './services/default-favourites.ts'
import { mergeParsedExports, parseChannelsExport } from './services/channels-import.ts'
import { ringColour, RING_COLOURS } from './components/ring-colour.ts'
import { afterPaint } from './state/after-paint.ts'
import type { GuideFilter } from './types/preferences.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const provider = read('src/state/TvProvider.tsx')
const stage = read('src/player/YoutubeStage.tsx')
const between = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)))

function source(n: number, owner?: string, videos = 1): StoredSource {
  return {
    id: `yt:UC${String(n).padStart(22, '0')}`,
    name: `Channel ${n}`,
    videos: Array.from({ length: videos }, (_, i) => ({ id: `v${String(n).padStart(6, '0')}${String(i).padStart(4, '0')}`, title: `Video ${n}.${i}`, durationSec: 600 })),
    channelNumber: n,
    inLibrary: false,
    automatic: true,
    updatedAt: 1,
    ...(owner ? { owner } : {}),
  }
}

function install(sources: StoredSource[]) {
  const built = channelsFromSources(sources)
  installUserCatalogue(built.channels, built.programmes)
}

afterEach(() => {
  installUserCatalogue([], new Map())
  vi.unstubAllGlobals()
})

/**
 * The provider's picture as it tracks the player: a new request covers the picture, a PLAYING report
 * uncovers it only when it is for the video last asked for, and the viewer's pause shows the frame.
 */
function picture() {
  let requested: string | null = null
  let live = false
  let paused = false
  let face: 'picture' | 'card' = 'picture'
  return {
    request(videoId: string) {
      requested = videoId
      live = false
      face = 'picture'
    },
    playing(videoId: string) {
      if (playingRequested(requested, videoId, false, undefined)) live = true
    },
    buffering() {},
    pausedByPlayer() {},
    pause: () => void (paused = true),
    resume(videoId: string) {
      paused = false
      this.request(videoId)
    },
    error: () => void (face = 'card'),
    owner: () => pictureOwner({ face, live, paused }),
  }
}

describe('who owns the picture', () => {
  it('noise until the airing asked for is PLAYING; then the video, unobstructed', () => {
    const tv = picture()
    tv.request('cold0000001')
    expect(tv.owner()).toBe('cover')
    tv.buffering()
    expect(tv.owner()).toBe('cover')
    tv.playing('cold0000001')
    expect(tv.owner()).toBe('video')
  })

  it('a loaded-but-unstarted, cued or self-paused player never uncovers the picture', () => {
    const tv = picture()
    tv.request('slow0000001')
    tv.pausedByPlayer()
    tv.buffering()
    expect(tv.owner()).toBe('cover')
  })

  it('the viewer’s pause shows the paused frame; resume covers until PLAYING again', () => {
    const tv = picture()
    tv.request('warm0000001')
    tv.playing('warm0000001')
    tv.pause()
    expect(tv.owner()).toBe('video')
    tv.resume('warm0000001')
    expect(tv.owner()).toBe('cover')
    tv.playing('warm0000001')
    expect(tv.owner()).toBe('video')
  })

  it('rapid 225 → 534 → 769: late PLAYING, PAUSED or BUFFERING from 225 or 534 cannot uncover 769', () => {
    const tv = picture()
    tv.request('ch225000001')
    tv.request('ch534000001')
    tv.request('ch769000001')
    tv.playing('ch225000001')
    tv.playing('ch534000001')
    tv.pausedByPlayer()
    tv.buffering()
    expect(tv.owner()).toBe('cover')
    tv.playing('ch769000001')
    expect(tv.owner()).toBe('video')
  })

  it('a failure hands the picture to TVN’s card; cards and faces always replace the picture', () => {
    const tv = picture()
    tv.request('fail0000001')
    tv.error()
    expect(tv.owner()).toBe('face')
    expect(pictureOwner({ face: 'radio', live: false, paused: false })).toBe('face')
    expect(pictureOwner({ face: 'session-empty', live: true, paused: false })).toBe('face')
  })

  it('PLAYING counts only for the requested video, and never for a live request that is no longer live', () => {
    expect(playingRequested('a0000000001', 'a0000000001', false, undefined)).toBe(true)
    expect(playingRequested('a0000000001', 'b0000000001', false, undefined)).toBe(false)
    expect(playingRequested(null, 'a0000000001', false, undefined)).toBe(false)
    expect(playingRequested('a0000000001', 'a0000000001', true, false)).toBe(false)
    expect(playingRequested('a0000000001', 'a0000000001', true, true)).toBe(true)
  })

  it('the YouTube stage reports playing only from PLAYING for the requested video, not from loading it', () => {
    const confirm = between(stage, 'const confirmLoaded = ', 'const reportPlaying = ')
    expect(confirm).not.toMatch(/onStatusRef\.current\('playing'\)/)
    expect(confirm).toMatch(/finish\(id, 'playing'\)/)
    expect(stage).toMatch(/if \(event\.data === 1\) reportPlaying\(event\.target\)/)
    expect(between(stage, 'const reportPlaying = ', 'executeRef.current = ')).toMatch(/playingRequested\(requestedRef\.current/)
    expect(between(stage, 'onError: (event) =>', 'onStatusRef.current(\'error\'')).toMatch(/actual !== requestedRef\.current\) return/)
  })

  it('the provider covers on every new request and uncovers only on PLAYING; no timer decides it', () => {
    expect(between(provider, 'const deliverLive = async', 'const loadProgramme')).toMatch(/setPictureLive\(false\)/)
    const status = between(provider, 'const onPlayerStatus = useCallback', '}, [syncLive, refreshAfterFailure])')
    expect(status).toMatch(/if \(status === 'playing'\) \{\s*pictureLiveRef\.current = true\s*setPictureLive\(true\)/)
    const screen = read('src/app/TvScreen.tsx')
    expect(screen).toMatch(/pictureOwner\(\{ face, live: tv\.pictureLive, paused: tv\.paused \}\)/)
    expect(screen).not.toMatch(/setTimeout\([^)]*stage-waiting/)
    expect(read('src/player/picture.ts')).not.toMatch(/setTimeout|setInterval/)
  })

  it('the channel still commits without waiting for the player', () => {
    const commit = between(provider, 'commitTuneRef.current = async', '// Credits are')
    expect(commit).toMatch(/load: \(\) => loadProgramme\(target, Date\.now\(\)\)/)
    expect(commit).not.toMatch(/await loadProgramme|pictureLive/)
    expect(read('src/state/tune-commit.ts')).toMatch(/void steps\.load\(\)/)
  })
})

describe('the selected tab is the surfing universe', () => {
  const sam = addUser([], 'Sam', 1).user
  const universe = (filter: GuideFilter, favourites: number[] = []): ChannelUniverse => ({ filter, favourites })
  const tuned = (channelNumber: number) => ({ channelNumber, previousNumber: null })
  const setUp = () => install([source(1001), source(1002, sam.id), source(1003), source(1004, sam.id), source(1005)])

  it('FAV: CH+/CH- wrap in the viewer’s order; from outside, CH+ enters first and CH- last; R stays inside', () => {
    setUp()
    const fav = universe('favourites', [534, 1003, 225])
    expect(stepTarget(tuned(534), null, 1, fav)).toBe(1003)
    expect(stepTarget(tuned(225), null, 1, fav)).toBe(534)
    expect(stepTarget(tuned(700), null, 1, fav)).toBe(534)
    expect(stepTarget(tuned(700), null, -1, fav)).toBe(225)
    for (let i = 0; i < 20; i += 1) expect([534, 1003, 225]).toContain(randomTarget(700, fav)?.number)
  })

  it('TVN: from a channel typed outside it, CH+ and CH- come back at the numeric neighbours, wrapping', () => {
    setUp()
    const tvn = universe('user')
    expect(universeChannels(tvn).map((channel) => channel.number)).toEqual([1001, 1003, 1005])
    expect(stepTarget(tuned(1002), null, 1, tvn)).toBe(1003)
    expect(stepTarget(tuned(1002), null, -1, tvn)).toBe(1001)
    expect(stepTarget(tuned(225), null, -1, tvn)).toBe(1005)
    expect(stepTarget(tuned(225), null, 1, tvn)).toBe(1001)
    for (let i = 0; i < 20; i += 1) expect([1001, 1003, 1005]).toContain(randomTarget(225, tvn)?.number)
  })

  it('a named user’s tab surfs only that user’s channels', () => {
    setUp()
    const mine = universe(userFilter(sam.id))
    expect(stepTarget(tuned(1002), null, 1, mine)).toBe(1004)
    expect(stepTarget(tuned(1004), null, 1, mine)).toBe(1002)
    expect(stepTarget(tuned(1003), null, 1, mine)).toBe(1004)
    for (let i = 0; i < 20; i += 1) expect([1002, 1004]).toContain(randomTarget(1003, mine)?.number)
  })

  it('ALL is the whole network exactly as before', () => {
    setUp()
    expect(stepTarget(tuned(1001), null, 1, universe('all'))).toBe(stepTarget(tuned(1001), null, 1))
  })

  it('a channel watched outside the tab shows as a temporary row, never a member, and goes when not needed', () => {
    setUp()
    const fav = [534, 225]
    const listed = universeChannels(universe('favourites', fav))
    const visiting = guideRows(listed, channelByNumber(1003), 'favourites')
    expect(visiting.rows.map((channel) => channel.number)).toEqual([1003, 534, 225])
    expect(visiting.visiting).toBe(1003)
    expect(fav).toEqual([534, 225])
    expect(guideRows(listed, channelByNumber(534), 'favourites')).toEqual({ rows: listed, visiting: null })
    const tvn = guideRows(universeChannels(universe('user')), channelByNumber(1004), 'user')
    expect(tvn.rows.map((channel) => channel.number)).toEqual([1001, 1003, 1004, 1005])
  })

  it('numeric tuning is global, and opening the Guide keeps the selected tab', () => {
    const numeric = between(provider, 'commitNumericRef.current = () =>', 'bootRef.current = () =>')
    expect(numeric).toMatch(/if \(!channelByNumber\(number\)\)/)
    expect(numeric).not.toMatch(/setGuideFilter|setFavourites|channelMatchesFilter/)
    expect(between(provider, 'const openGuide = (mode: GuideMode) =>', 'const openGuideTool')).not.toMatch(/setGuideFilter/)
    expect(provider).toMatch(/guideRows\(guideFilter === 'favourites'/)
  })

  it('Previous and history follow channel history, whatever the tab', () => {
    const previous = between(provider, "case 'last-channel': {", "case 'confirm':")
    expect(previous).toMatch(/requestTune\(previous\)/)
    expect(previous).toMatch(/requestTune\(step\.channelNumber\)/)
    expect(previous).not.toMatch(/guideFilter|favourites|stepTarget|universe/)
  })
})

describe('the starter network', () => {
  const file = read('public/user-network/starter-network.json')
  const checked = readUserNetworkFile(file)
  const records = checked.ok ? recordsFromExport(checked.value, 0) : []

  it('is a valid TVN User Network file: 170 channels on their own numbers from 1001 to 1195, TVN’s, keyless', () => {
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.value.channels).toHaveLength(170)
    const numbers = checked.value.channels.map((channel) => channel.number)
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
    expect(new Set(numbers).size).toBe(numbers.length)
    expect([numbers[0], numbers.at(-1)]).toEqual([1001, 1195])
    expect(checked.value.users).toEqual([])
    expect(carriesSecret(file)).toBe(false)
    expect(file).not.toMatch(/\/Users\/|file:\/\/|localhost|127\.0\.0\.1|AIza/)
  })

  it('installs on a fresh viewer with every channel on its own number, each with programmes', () => {
    const plan = planStarterNetwork([], records, 5)
    expect(plan.added).toEqual(records.map((record) => record.channelNumber))
    expect(plan.sources.find((record) => record.channelNumber === 1001)?.sourceType).toBe('youtube-channel')
    expect(plan.sources.filter((record) => record.videos.length === 0)).toHaveLength(0)
    expect(starterCollections(records).sources).toHaveLength(170)
  })

  it('every default favourite resolves on a fresh install, in order', () => {
    const fresh = planStarterNetwork([], records, 5).sources
    const expected = starterFavouriteSources(fresh)
    expect([...expected.keys()]).toEqual(DEFAULT_FAVOURITES.filter((number) => number > 1000))
    expect(placeStarterFavourites(DEFAULT_FAVOURITES, expected, fresh)).toEqual(DEFAULT_FAVOURITES)
    const names = new Map(fresh.map((record) => [record.channelNumber, record.name]))
    expect([1014, 1033, 1072, 1148, 1188].map((number) => names.get(number))).toEqual([
      'Argyle Life | Green',
      'CinemaSins',
      'Heat Check',
      'Secret Base',
      'World Wanderings: 4K Walking Tours',
    ])
  })

  it('beside a viewer’s own channels: theirs stay, starter channels already present are not added twice', () => {
    const template = mergeParsedExports([read('public/user-network/channels.txt'), read('public/user-network/more-channels.txt')].map((text) => parseChannelsExport(text)))
    const old = planTestChannels([], template, 1).sources
    const mine = { ...source(1200), name: 'My own' }
    const renamed = old.map((record, index) => (index === 3 ? { ...record, name: 'Renamed by me' } : record)).filter((_, index) => index !== 5)
    const plan = planStarterNetwork([...renamed, mine], records, 5)
    expect(plan.sources.slice(0, renamed.length + 1)).toEqual([...renamed, mine])
    const ids = plan.sources.map((record) => record.id)
    expect(new Set(ids).size).toBe(ids.length)
    const numbers = plan.sources.map((record) => record.channelNumber)
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(plan.added.length).toBeLessThan(records.length)
  })

  it('Remove starter removes both the current and the earlier starter’s channels, nothing of the viewer’s', () => {
    const template = mergeParsedExports([read('public/user-network/channels.txt')].map((text) => parseChannelsExport(text)))
    const mine = { ...source(1200), name: 'My own' }
    const sources = [...planStarterNetwork([], records, 1).sources, mine]
    expect(withoutStarter(sources, starterIds(template, records))).toEqual([mine])
  })

  it('existing viewers are never reset: installed or removed stays so; only fresh viewers are due', () => {
    const memory = () => {
      const map = new Map<string, string>()
      return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) }
    }
    const installed = memory()
    setStarterState('installed', installed)
    expect(claimStarterInstall(installed)).toBe(false)
    const removed = memory()
    setStarterState('removed', removed)
    expect(claimStarterInstall(removed)).toBe(false)
    expect(claimStarterInstall(memory())).toBe(true)
    const effect = between(provider, 'const starterRanRef = useRef(false)', 'const removeStarterNetwork')
    expect(effect).toMatch(/starterDue \? loadTestChannels\(true\)/)
    expect(effect).toMatch(/if \(!favouritesSeeded\) return/)
  })

  it('runtime reads the checked-in file, never Downloads', () => {
    expect(read('src/data/user-network/bootstrap.ts')).toMatch(/STARTER_NETWORK_FILE = '\/user-network\/starter-network\.json'/)
    for (const path of ['src/data/user-network/bootstrap.ts', 'src/state/TvProvider.tsx']) expect(read(path)).not.toMatch(/Downloads/)
  })
})

describe('refused programmes', () => {
  const recovery = (channelNumber: number, refusals = 0, failedChannels: number[] = []): Recovery => ({ channelNumber, refusals, failedChannels })

  it('only YouTube’s permanent refusals (100, 101, 150) are remembered; a timeout or other error is not', () => {
    for (const code of ['100', '101', '150']) expect(isRefusalCode(code)).toBe(true)
    for (const detail of ['timeout', '2', '5', 'api unavailable', 'player stayed on x', 'stream is no longer live', '']) expect(isRefusalCode(detail)).toBe(false)
    const status = between(provider, 'const onPlayerStatus = useCallback', '}, [syncLive, refreshAfterFailure])')
    expect(status).toMatch(/if \(!videoId \|\| !isRefusalCode\(detail\) \|\| !learnRefusal\(videoId\)\) return/)
  })

  it('first refusal → second programme; second → third; the bounded run → next channel', () => {
    expect(PROGRAMME_ATTEMPTS).toBe(3)
    const first = afterRefusal(null, 225)
    expect(first).toEqual({ action: 'next-programme', recovery: recovery(225, 1) })
    const second = afterRefusal(first.recovery, 225)
    expect(second).toEqual({ action: 'next-programme', recovery: recovery(225, 2) })
    const third = afterRefusal(second.recovery, 225)
    expect(third).toEqual({ action: 'next-channel', recovery: recovery(225, 0, [225]) })
  })

  it('a refusal on the channel recovery arrived at starts its own count, keeping the channels given up on', () => {
    const moved = arrive(giveUp(null, 225), 226)
    expect(moved).toEqual(recovery(226, 0, [225]))
    expect(afterRefusal(moved, 226)).toEqual({ action: 'next-programme', recovery: recovery(226, 1, [225]) })
  })

  it('the next programme that will play: known refused ones are passed over, never tried again', () => {
    install([source(1001, undefined, 8)])
    const channel = channelByNumber(1001)!
    const now = Date.UTC(2026, 9, 2, 12)
    const current = broadcast(channel, now).current
    const upcoming: string[] = []
    let place = current
    for (let i = 0; i < 4; i += 1) {
      place = broadcast(channel, place.endMs).current
      upcoming.push(place.programme.videoId!)
    }
    expect(fallbackProgramme(channel, current, new Set())?.programme.videoId).toBe(upcoming[0])
    expect(fallbackProgramme(channel, current, new Set([upcoming[0]]))?.programme.videoId).toBe(upcoming[1])
    expect(fallbackProgramme(channel, current, new Set([upcoming[0], upcoming[1]]))?.programme.videoId).toBe(upcoming[2])
    const every = new Set(channel.number ? [...Array(STEP_REACH + 8)].flatMap((_, i) => [`v${String(1001).padStart(6, '0')}${String(i).padStart(4, '0')}`]) : [])
    expect(fallbackProgramme(channel, current, every)).toBeNull()
  })

  it('the schedule itself is not changed by a fallback', () => {
    install([source(1001, undefined, 8)])
    const channel = channelByNumber(1001)!
    const now = Date.UTC(2026, 9, 2, 12)
    const before = broadcast(channel, now).current
    fallbackProgramme(channel, before, new Set([before.programme.videoId!]))
    expect(broadcast(channel, now).current).toEqual(before)
  })

  describe('falls forward in the selected universe, never looping', () => {
    const sam = addUser([], 'Sam', 1).user
    const setUp = () => install([source(1001), source(1002, sam.id), source(1003), source(1004, sam.id), source(1005)])

    it('FAV → next FAV channel', () => {
      setUp()
      expect(fallForwardTarget(1003, { filter: 'favourites', favourites: [534, 1003, 225] }, new Set([1003]))).toBe(225)
    })
    it('TVN → next TVN User channel', () => {
      setUp()
      expect(fallForwardTarget(1003, { filter: 'user', favourites: [] }, new Set([1003]))).toBe(1005)
    })
    it('named user → that user’s next channel', () => {
      setUp()
      expect(fallForwardTarget(1002, { filter: userFilter(sam.id), favourites: [] }, new Set([1002]))).toBe(1004)
    })
    it('ALL → next channel in the whole network', () => {
      setUp()
      expect(fallForwardTarget(1001, { filter: 'all', favourites: [] }, new Set([1001]))).toBe(stepTarget({ channelNumber: 1001, previousNumber: null }, null, 1))
    })
    it('an out-of-universe numeric tune that fails falls into the still-selected tab', () => {
      setUp()
      expect(fallForwardTarget(225, { filter: 'user', favourites: [] }, new Set([225]))).toBe(1001)
      expect(fallForwardTarget(1002, { filter: 'favourites', favourites: [534, 225] }, new Set([1002]))).toBe(534)
    })
    it('A bad → B bad never returns to A; once every channel is tried, recovery stops', () => {
      setUp()
      const tvn: ChannelUniverse = { filter: 'user', favourites: [] }
      expect(fallForwardTarget(1003, tvn, new Set([1001, 1003]))).toBe(1005)
      expect(fallForwardTarget(1005, tvn, new Set([1001, 1003, 1005]))).toBeNull()
    })
  })

  it('a viewer tune or PLAYING ends the recovery; the recovery’s own tune keeps it', () => {
    const request = between(provider, 'const requestTune = ', 'notePress(target.number)')
    expect(request).toMatch(/if \(!autoTuneRef\.current\) recoveryRef\.current = null/)
    const status = between(provider, 'const onPlayerStatus = useCallback', '}, [syncLive, refreshAfterFailure])')
    expect(status).toMatch(/recoveryRef\.current = null/)
    const recover = between(provider, 'recoverRef.current = (channelNumber, cause) =>', 'const resumeViewing')
    expect(recover).toMatch(/autoTuneRef\.current = true\s*requestTune\(target\)/)
    expect(recover).toMatch(/fallForwardTarget\(channelNumber, \{ filter: guideFilter, favourites \}, failed\)/)
    expect(recover).toMatch(/if \(target === null\) return/)
  })

  it('a stale refusal from an abandoned tune cannot drive recovery on the channel now watched', () => {
    const status = between(provider, 'const onPlayerStatus = useCallback', '}, [syncLive, refreshAfterFailure])')
    expect(status).toMatch(/const meant = videoId !== null && channel\.number === watchingNumber\(\) && liveAiring\(channel, now, videoOverride\(channel\.number\)\)\.command\.videoId === videoId/)
    expect(status.match(/if \(meant\) recoverRef\.current/g)).toHaveLength(2)
    expect(between(provider, 'recoverRef.current = (channelNumber, cause) =>', 'const resumeViewing')).toMatch(/channelNumber !== watchingNumber\(\)\) return/)
  })

  it('recording the failure stays off the tune: no library work in the status handler or the recovery', () => {
    const status = between(provider, 'const onPlayerStatus = useCallback', '}, [syncLive, refreshAfterFailure])')
    const recover = between(provider, 'recoverRef.current = (channelNumber, cause) =>', 'const resumeViewing')
    for (const part of [status, recover]) expect(part).not.toMatch(/recordPlaybackFailure\(|republishLibrary\(\)|saveStoredSources\(/)
  })
})

describe('startup', () => {
  it('the shipped catalogue’s save never holds the start; a later write or an idle moment makes it', () => {
    const store = read('src/library/store.ts')
    expect(between(store, 'export async function loadShippedIndependentCatalogue', '/** Records an import session')).toMatch(/true, 'deferred'\)/)
    expect(provider).toMatch(/if \(startupPhase !== 'ready' \|\| starterDue\) return\s+return afterPaint\(\(\) => void saveDeferredLibrary\(\)/)
    expect(provider).toMatch(/if \(starterDue\) void installed\.then\(\(\) => afterPaint\(\(\) => void saveDeferredLibrary\(\)/)
  })

  it('the save only starts after the frame has painted, then in idle time; cancelling stops it at any stage', () => {
    const order: string[] = []
    const frames: (() => void)[] = []
    const timers: (() => void)[] = []
    const idles: (() => void)[] = []
    vi.stubGlobal('window', {
      requestAnimationFrame: (run: () => void) => frames.push(run),
      cancelAnimationFrame: (id: number) => { frames[id - 1] = () => undefined },
      setTimeout: (run: () => void) => timers.push(run),
      clearTimeout: (id: number) => { if (id) timers[id - 1] = () => undefined },
      requestIdleCallback: (run: () => void) => idles.push(run),
      cancelIdleCallback: (id: number) => { idles[id - 1] = () => undefined },
    })
    try {
      afterPaint(() => order.push('save'))
      expect(order).toEqual([])
      frames.shift()!()
      expect(order).toEqual([])
      timers.shift()!()
      expect(order).toEqual([])
      idles.shift()!()
      expect(order).toEqual(['save'])
      const cancel = afterPaint(() => order.push('late'))
      frames[0]()
      cancel()
      timers.forEach((run) => run())
      idles.forEach((run) => run())
      expect(order).toEqual(['save'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a fresh install’s starter waits until the start has settled (picture, refusal, or the player’s own timeout), so the first picture comes first', () => {
    expect(provider).toMatch(/if \(starterDue && !starterClear\) return/)
    // and then until the logo has faded off: in Firefox the install holds the main thread for seconds.
    expect(provider).toMatch(/if \(!startupSettled \|\| starterClear\) return\s+const timer = window\.setTimeout\(\(\) => setStarterClear\(true\), STARTER_AFTER_PICTURE_MS\)/)
    expect(provider).toMatch(/window\.setTimeout\(\(\) => setStartupSettled\(true\), PLAYER_LOAD_TIMEOUT_MS\)/)
    expect(read('src/player/YoutubeStage.tsx')).toMatch(/\}, PLAYER_LOAD_TIMEOUT_MS\)/)
  })

  it('the loading ring takes one of its readable colours each time TVN loads', () => {
    expect(ringColour(() => 0)).toBe(RING_COLOURS[0])
    expect(ringColour(() => 0.999)).toBe(RING_COLOURS.at(-1))
    expect(RING_COLOURS).not.toContain('#f2f2f2')
  })
})

