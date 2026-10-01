import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { advancing, confirmStart, START_HOLD_COPY } from './player/autoplay.ts'
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
    expect(START_HOLD_COPY.sound).toBe('Sound off · press any key or tap for sound')
  })

  it('stops if the viewer has already tuned, paused or left single view', async () => {
    const blocked = fakePlayer(() => false)
    expect(await confirmStart(blocked.player, () => false, blocked.wait)).toBeNull()
    expect(blocked.calls).toEqual([])
  })
})

describe('startup activates the selected channel', () => {
  it('fresh viewers start on 225 and returning viewers on their own channel, then the player is loaded and checked', () => {
    expect(DEFAULT_PREFERENCES.lastChannelNumber).toBe(225)
    expect(provider).toContain('const tuning = resolveStartupTuning(startup, stored)')
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
    expect(provider.match(/setAudible\(true, volumeRef\.current, mutedRef\.current \|\| startHoldRef\.current !== null\)/g)?.length).toBe(2)
  })

  it('shows the held state on screen', () => {
    expect(read('src/app/TvScreen.tsx')).toContain('{tv.startHold && !tv.paused ? <div className="paused-bug" role="status">{START_HOLD_COPY[tv.startHold]}</div> : null}')
  })

  it('a direct stream the browser will not start yet is waiting, not unavailable', () => {
    const local = read('src/player/LocalStage.tsx')
    expect(local).toMatch(/error\.name === 'NotAllowedError'\) \{[\s\S]{0,200}settle\(id, 'playing'\)/)
  })

  it('leaves Random, CH+/CH−, numeric tuning and Multi View as they were', () => {
    expect(provider).toMatch(/case 'random-channel': \{\s+const picked = randomChannel\(channelRef\.current\)\s+if \(picked\) requestTune\(picked\.number\)/)
    expect(provider).toContain("requestTune(stepTarget(tuned(), pending, command.type === 'channel-up' ? 1 : -1))")
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
    expect(read('src/components/NowNextOverlay.tsx')).toContain('onNext={steps && hasPicture(stepFrom(channel, now, 1).programme) ? () => tv.screenStep(1) : undefined}')

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
