import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { advancing, confirmStart, soundHeld, START_HOLD_COPY, type StartHold } from './player/autoplay.ts'
import type { PlayerHandle } from './player/types.ts'
import { DEFAULT_PREFERENCES } from './services/preferences.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const provider = read('src/state/TvProvider.tsx')

/** A player whose clock moves only while `moving()` says so; waiting advances the clock by that much. */
function fakePlayer(moving: (muted: boolean) => boolean) {
  let time = 120
  let muted = false
  const calls: string[] = []
  const player: PlayerHandle = {
    load: async () => 'playing',
    play: () => void calls.push('play'),
    pause: () => void calls.push('pause'),
    seek: () => undefined,
    setAudible: (audible, _volume, mute) => {
      muted = !audible || mute
      calls.push(muted ? 'mute' : 'unmute')
    },
    currentTime: () => time,
    actualVideoId: () => 'abcdefghijk',
  }
  const wait = async (ms: number) => {
    if (moving(muted)) time += ms / 1000
  }
  return { player, calls, wait }
}

describe('the first programme really starts', () => {
  it('a moving clock is playback; a loaded video sitting on its still is not', async () => {
    const playing = fakePlayer(() => true)
    expect(await advancing(playing.player, playing.wait)).toBe(true)
    const still = fakePlayer(() => false)
    expect(await advancing(still.player, still.wait)).toBe(false)
  })

  it('where the browser allows it, playback simply continues with sound and nothing is held', async () => {
    const allowed = fakePlayer(() => true)
    expect(await confirmStart(allowed.player, () => true, allowed.wait)).toBeNull()
    expect(allowed.calls).toEqual([])
  })

  it('when sound is refused, the same programme plays muted and TVN says so', async () => {
    const soundBlocked = fakePlayer((muted) => muted)
    expect(await confirmStart(soundBlocked.player, () => true, soundBlocked.wait)).toBe('sound')
    expect(soundBlocked.calls).toEqual(['mute', 'play'])
  })

  it('when nothing may start, TVN asks for a key or tap instead of looking broken', async () => {
    const blocked = fakePlayer(() => false)
    expect(await confirmStart(blocked.player, () => true, blocked.wait)).toBe('picture')
    expect(START_HOLD_COPY.picture).toBe('Press any key or tap to start')
    expect(Object.keys(START_HOLD_COPY)).toEqual(['picture'])
  })

  it('stops if the viewer has already tuned, paused or left single view: their interaction allows sound', async () => {
    const blocked = fakePlayer(() => false)
    expect(await confirmStart(blocked.player, () => false, blocked.wait, () => true)).toBeNull()
    expect(blocked.calls).toEqual([])
  })

  it('a click during the check (CONTINUE on the welcome notice) allows sound: nothing is muted or held', async () => {
    const blocked = fakePlayer((muted) => muted)
    expect(await confirmStart(blocked.player, () => true, blocked.wait, () => true)).toBeNull()
    expect(blocked.calls).toEqual([])
    let clicked = false
    const late = fakePlayer((muted) => {
      if (muted) clicked = true
      return muted
    })
    expect(await confirmStart(late.player, () => true, late.wait, () => clicked)).toBeNull()
    expect(late.calls).toEqual(['mute', 'play'])
  })

  it('the first click or key while the start is checked turns the sound on at once', () => {
    const early = provider.slice(provider.indexOf('const early = () => {'), provider.indexOf('const early = () => {') + 500)
    expect(early).toContain('if (!startCheckRef.current) return')
    expect(early).toContain('player.setAudible(true, volumeRef.current, mutedRef.current)')
    expect(provider).toContain("window.addEventListener('pointerdown', early, true)")
  })

  it('stops if Surf tuned before the viewer interacted, keeping sound held because it was never proven allowed', async () => {
    const blocked = fakePlayer(() => false)
    expect(await confirmStart(blocked.player, () => false, blocked.wait, () => false)).toBe('sound')
    expect(blocked.calls).toEqual([])
    const mutedRetry = fakePlayer((muted) => muted)
    let checks = 0
    expect(await confirmStart(mutedRetry.player, () => (checks += 1) < 2, mutedRetry.wait, () => false)).toBe('sound')
    expect(mutedRetry.calls).toEqual(['mute', 'play'])
  })
})

describe('startup activates the selected channel', () => {
  it('fresh viewers start on 000 TVN and returning viewers on their own channel, then the player is loaded and checked', () => {
    expect(DEFAULT_PREFERENCES.lastChannelNumber).toBe(0)
    expect(provider).toContain('const tuning = resolveStartupTuning(startup, stored, currentEntryMode())')
    expect(provider).toMatch(/commitChannel\(tuning, false\)[\s\S]{0,600}bootRef\.current\(\)/)
    expect(provider).toMatch(/void loadProgramme\(current, Date\.now\(\)\)\.then\(\(result\) => \{[\s\S]{0,500}void confirmStart\(player, stillFirst, sleep\)/)
  })

  it('startup records no history entry beyond the channel it starts on', () => {
    expect(provider).toContain('commitChannel(tuning, false)')
    expect(provider).toContain('historyRef.current = visit(EMPTY_HISTORY, tuning.channelNumber)')
  })

  it('the first key or tap starts the selected programme with sound, without changing channel', () => {
    const release = provider.slice(provider.indexOf('const release = () => {'), provider.indexOf('}, [startHold])'))
    expect(release).toContain('player.setAudible(!tuningRef.current, volumeRef.current, mutedRef.current)')
    expect(release).toContain('player.play()')
    expect(release).not.toMatch(/requestTune|randomChannel|commitChannel/)
    expect(release).toContain("window.addEventListener('pointerdown', release, true)")
    expect(release).toContain("window.addEventListener('keydown', release, true)")
  })

  it('a channel change before that first interaction (Surf) keeps the picture muted rather than stalling again', () => {
    expect(
      provider.match(/setAudible\(true, volumeRef\.current, mutedRef\.current \|\| soundHeld\(startHoldRef\.current, startCheckRef\.current, viewerInteracted\(\)\)\)/g)
        ?.length,
    ).toBe(2)
    const boot = provider.slice(provider.indexOf('bootRef.current = () => {'), provider.indexOf('// The viewer\'s first key or tap'))
    expect(boot).toMatch(/startCheckRef\.current = true\s+void loadProgramme/)
    expect(boot.match(/startCheckRef\.current = false/g)?.length).toBe(2)
  })

  it('asks for a key or tap only when the picture is held; held sound shows as Muted, with no message', () => {
    const screen = read('src/app/TvScreen.tsx')
    expect(screen).toContain("{tv.startHold === 'picture' && !tv.paused ? <div className=\"paused-bug\" role=\"status\">{START_HOLD_COPY.picture}</div> : null}")
    expect(screen).not.toMatch(/press any key or tap for sound|Sound off/)
    expect(read('src/state/TvProvider.tsx')).toContain("muted: muted || startHold === 'sound',")
  })

  it('UNMUTE pressed while sound is held turns sound on, rather than muting TVN on the same press', () => {
    const provider = read('src/state/TvProvider.tsx')
    const release = provider.slice(provider.indexOf('const release = () => {'), provider.indexOf('}, [startHold])'))
    expect(release).toContain("if (startHoldRef.current === 'sound') soundReleasedAt.current = Date.now()")
    const mute = provider.slice(provider.indexOf("case 'mute': {"), provider.indexOf("case 'subtitles': {"))
    expect(mute).toMatch(/if \(!mutedRef\.current && Date\.now\(\) - soundReleasedAt\.current < SOUND_RELEASE_MS\) \{[\s\S]*?setAudible\(!tuningRef\.current, volumeRef\.current, false\)[\s\S]*?break/)
    expect(mute.indexOf('soundReleasedAt')).toBeLessThan(mute.indexOf('const nextMuted'))
  })

  it('a direct stream the browser will not start yet is waiting, not unavailable', () => {
    const local = read('src/player/LocalStage.tsx')
    expect(local).toMatch(/error\.name === 'NotAllowedError'\) \{[\s\S]{0,200}settle\(id, 'playing'\)/)
  })

  it('leaves Random, CH+/CH−, numeric tuning and Multi View as they were', () => {
    expect(provider).toMatch(/case 'random-channel': \{\s+const picked = randomTarget\(channelRef\.current, \{ filter: guideFilter, favourites \}\)\s+if \(picked\) requestTune\(picked\.number\)/)
    expect(provider).toContain("const target = stepTarget(tuned(), pending, command.type === 'channel-up' ? 1 : -1, { filter: guideFilter, favourites })")
    expect(provider).toMatch(/if \(target === null\) flash\(emptyUniverseNote\(guideFilter\)\)\s+else requestTune\(target\)/)
    expect(provider).toMatch(/commitNumericRef\.current = \(\) => \{[\s\S]{0,400}requestTune\(number\)/)
    expect(provider).toMatch(/bootRef\.current = \(\) => \{\s+if \(bootedRef\.current\) return\s+if \(multiviewRef\.current !== '1'\) return/)
    expect(read('src/components/BroadcastTile.tsx')).not.toContain('confirmStart')
  })
})

describe('programme Prev and Next over the picture', () => {
  it('step past a holding card to the nearest programme with a picture, on the same channel', async () => {
    const { expandPlayableCatalogue } = await import('./library/playable-catalogue.ts')
    const { installUserCatalogue } = await import('./data/user-overlay.ts')
    const { resetDirector } = await import('./director/director.ts')
    const { setMediaLibrary } = await import('./director/library.ts')
    const { refreshAiring } = await import('./network/airing.ts')
    const { channelByNumber } = await import('./data/catalogue.ts')
    const { broadcast } = await import('./services/broadcast.ts')
    const { clearManual, onScreen, selectProgramme, stepFrom } = await import('./player/manual.ts')
    const { hasPicture } = await import('./session/session-channel.ts')
    const { visit, EMPTY_HISTORY, canGoForward } = await import('./state/history.ts')
    const items = expandPlayableCatalogue(JSON.parse(read('public/independent/playable.json')))
    installUserCatalogue([], new Map())
    resetDirector()
    setMediaLibrary(items)
    refreshAiring(items)

    const channel = channelByNumber(225)!
    // Find a holding card in 225's running order and stand on the programme just before it.
    const at = Date.UTC(2026, 9, 1, 12, 0)
    let before = broadcast(channel, at).current
    for (let i = 0; i < 400 && hasPicture(broadcast(channel, before.endMs).current.programme); i += 1) before = broadcast(channel, before.endMs).current
    const card = broadcast(channel, before.endMs).current
    expect(hasPicture(card.programme)).toBe(false)

    // Channel history plays no part: a fresh session has no Back and no Forward.
    const history = visit(EMPTY_HISTORY, 225)
    expect(canGoForward(history)).toBe(false)

    clearManual()
    selectProgramme(225, before.programme, at, before)
    const next = stepFrom(channel, at, 1)
    expect(hasPicture(next.programme)).toBe(true)
    expect(next.startMs).toBeGreaterThanOrEqual(card.endMs)
    expect(read('src/components/NowNextOverlay.tsx')).toContain('steps && hasPicture(stepFrom(channel, now, 1).programme) ? () => tv.screenStep(1) : undefined}')

    // Next from there, then Prev back over the card, lands on the programme before it.
    selectProgramme(225, next.programme, at, next)
    expect(onScreen(channel, at).current.programme.id).toBe(next.programme.id)
    const back = stepFrom(channel, at, -1)
    expect(back.programme.id).toBe(before.programme.id)
    expect(back.startMs).toBe(before.startMs)

    // Programme steps never change channel or touch channel history.
    expect(history.entries).toEqual([225])
    clearManual()
  }, 60000)

  it('play the stepped programme in place on the channel being watched, never a channel change or history entry', () => {
    const step = provider.slice(provider.indexOf('const screenStep = useCallback('), provider.indexOf('const holdInfo = useCallback('))
    expect(step).toContain('const target = stepFrom(here, Date.now(), direction)')
    expect(step).toContain('playFromGuide(here, target.programme, target)')
    expect(step).not.toMatch(/requestTune|history/)
    // playFromGuide on the channel being watched plays in place; only another channel would tune.
    expect(read('src/player/manual.ts')).toContain('return targetNumber !== watchingNumber || tuning')
  })

  it('a channel change ends the picked programme, so stepping starts again from the new channel’s schedule', () => {
    expect(provider).toMatch(/const requestTune = \(number: number, keepPick = false\) => \{[\s\S]{0,300}if \(!keepPick\) clearManual\(\)/)
  })
})

/**
 * A browser as autoplay policy has it: before the viewer interacts, a video may start only muted, and
 * unmuting a playing video pauses it on its still. Time is virtual; `advance` runs the timers due.
 */
function policyBrowser() {
  let now = 0
  const timers: { at: number; resolve: () => void }[] = []
  const wait = (ms: number) => new Promise<void>((resolve) => void timers.push({ at: now + ms, resolve }))
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const advance = async (ms: number) => {
    const end = now + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const next = timers[0]
      if (!next || next.at > end) break
      timers.shift()
      now = next.at
      next.resolve()
      await settle()
    }
    now = end
    await settle()
  }
  const state = { interacted: false, muted: false, playing: false, video: '', base: 0, since: 0 }
  const start = () => {
    if (state.muted || state.interacted) {
      state.playing = true
      state.since = now
    }
  }
  const stop = () => {
    state.base += state.playing ? (now - state.since) / 1000 : 0
    state.playing = false
  }
  const player: PlayerHandle = {
    async load(request) {
      stop()
      state.video = request.videoId ?? ''
      state.base = 600
      start()
      return 'playing'
    },
    play: start,
    pause: stop,
    seek: () => undefined,
    setAudible(audible, volume, mute) {
      const muted = !audible || mute || volume <= 0
      if (state.muted && !muted && state.playing && !state.interacted) stop()
      state.muted = muted
    },
    currentTime: () => state.base + (state.playing ? (now - state.since) / 1000 : 0),
    actualVideoId: () => state.video,
  }
  return { player, state, wait, advance }
}

/** TvProvider's order of events: boot and its start check, then Surf hops through requestTune and the tune commit. */
async function surfSession(options: { interacted: boolean; hops: number; firstHopMs: number; dwellMs: number }) {
  const browser = policyBrowser()
  const { player, state, wait, advance } = browser
  state.interacted = options.interacted
  let hold: StartHold = null
  let checking = true
  let token = 0
  const load = (videoId: string) => player.load({ videoId, startSeconds: 600, loop: false })
  player.setAudible(true, 80, false)
  await load('first000001')
  const first = token
  void confirmStart(player, () => token === first, wait, () => state.interacted).then((result) => {
    checking = false
    hold = result
    if (!result && !state.interacted) player.setAudible(true, 80, false)
  })
  const results: { video: string; moving: boolean; muted: boolean; hold: StartHold }[] = []
  await advance(options.firstHopMs)
  for (let hop = 1; hop <= options.hops; hop += 1) {
    token += 1
    player.setAudible(false, 0, true)
    await advance(800)
    await load(`surfhop${String(hop).padStart(4, '0')}`)
    player.setAudible(true, 80, soundHeld(hold, checking, state.interacted))
    const from = player.currentTime()
    await advance(3000)
    results.push({ video: state.video, moving: player.currentTime() - from > 2, muted: state.muted, hold })
    await advance(options.dwellMs - 3800)
  }
  return { results, browser, hold: () => hold }
}

describe('/tvn before the viewer interacts: every Surf hop plays', () => {
  it('a Surf hop during the start check, then hop after hop, each loads its programme and the clock moves', async () => {
    const { results, browser, hold } = await surfSession({ interacted: false, hops: 4, firstHopMs: 4500, dwellMs: 6000 })
    expect(results.map((result) => result.video)).toEqual(['surfhop0001', 'surfhop0002', 'surfhop0003', 'surfhop0004'])
    expect(results.every((result) => result.moving && result.muted)).toBe(true)
    expect(hold()).toBe('sound')
    browser.state.interacted = true
    browser.player.setAudible(true, 80, false)
    browser.player.play()
    const from = browser.player.currentTime()
    await browser.advance(2000)
    expect(browser.state.muted).toBe(false)
    expect(browser.player.currentTime() - from).toBeGreaterThan(1.5)
  })

  it('also when the hop lands before the first programme was even found still, and when it lands after the check', async () => {
    for (const firstHopMs of [1500, 9000]) {
      const { results } = await surfSession({ interacted: false, hops: 3, firstHopMs, dwellMs: 5000 })
      expect(results.every((result) => result.moving && result.muted)).toBe(true)
    }
  })

  it('reproduces the 1.0.1 failure under the old rule, which unmuted the hop because no hold had been recorded', async () => {
    const browser = policyBrowser()
    await browser.player.load({ videoId: 'surfhop0001', startSeconds: 0, loop: false })
    browser.player.setAudible(false, 0, true)
    browser.player.play()
    const oldHold: StartHold = null
    browser.player.setAudible(true, 80, oldHold !== null)
    const from = browser.player.currentTime()
    await browser.advance(3000)
    expect(browser.player.currentTime() - from).toBe(0)
  })

  it('after the viewer has interacted (/ with Surf switched on), hops play with sound', async () => {
    const { results, hold } = await surfSession({ interacted: true, hops: 3, firstHopMs: 4500, dwellMs: 6000 })
    expect(results.every((result) => result.moving && !result.muted)).toBe(true)
    expect(hold()).toBeNull()
  })

  it('sound is held only before interaction while the start is held or being checked', () => {
    expect(soundHeld(null, false, false)).toBe(false)
    expect(soundHeld(null, true, false)).toBe(true)
    expect(soundHeld(null, true, true)).toBe(false)
    expect(soundHeld('sound', false, true)).toBe(true)
  })
})
