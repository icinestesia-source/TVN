import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adjacentChannel, channelByNumber } from '../data/catalogue.ts'
import { installUserCatalogue } from '../data/user-overlay.ts'
import { resetDirector } from '../director/director.ts'
import { setMediaLibrary } from '../director/library.ts'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { refreshAiring } from '../network/airing.ts'
import { broadcast, guideSlots } from '../services/broadcast.ts'
import type { Channel } from '../types/channel.ts'
import { deliver, playbackCommand } from './command.ts'
import type { PlayerHandle, PlayerLoadRequest } from './types.ts'
import { liveAiring, pauseViewing } from './viewing.ts'

const MINUTE = 60_000

function fakePlayer(position = 0) {
  const calls: string[] = []
  const loads: PlayerLoadRequest[] = []
  const handle: PlayerHandle = {
    load(request) {
      calls.push('load')
      loads.push(request)
      return Promise.resolve('playing')
    },
    play: () => calls.push('play'),
    pause: () => calls.push('pause'),
    seek: () => calls.push('seek'),
    setAudible: () => {},
    currentTime: () => position,
    actualVideoId: () => null,
  }
  return { calls, loads, handle }
}

/** A moment one minute into a programme on this channel that runs at least twelve minutes. */
function insideLongProgramme(channel: Channel): number {
  for (let at = Date.UTC(2026, 8, 27, 11); at < Date.UTC(2026, 8, 28, 11); at += 17 * MINUTE) {
    const current = broadcast(channel, at).current
    if (current.programme.videoId && current.endMs - current.startMs >= 12 * MINUTE) return current.startMs + MINUTE
  }
  throw new Error(`no long programme on ${channel.number}`)
}

describe('remote pause and play', () => {
  let channel: Channel

  beforeAll(() => {
    const items = expandPlayableCatalogue(JSON.parse(readFileSync('public/independent/playable.json', 'utf8')))
    installUserCatalogue([], new Map())
    resetDirector()
    setMediaLibrary(items)
    refreshAiring(items)
    channel = channelByNumber(501)!
  }, 60000)

  afterAll(() => installUserCatalogue([], new Map()))

  it('PAUSE pauses the active player and loads nothing', () => {
    const player = fakePlayer()
    pauseViewing(player.handle)
    expect(player.calls).toEqual(['pause'])
  })

  it('PLAY rejoins the broadcast at the current scheduled position, not the paused frame', async () => {
    const pausedAt = insideLongProgramme(channel)
    const paused = liveAiring(channel, pausedAt, null)
    const player = fakePlayer(paused.command.startSeconds)
    pauseViewing(player.handle)

    const playAt = pausedAt + 5 * MINUTE
    const rejoin = liveAiring(channel, playAt, null)
    await deliver(player.handle, rejoin.command)

    const scheduled = broadcast(channel, playAt).current
    expect(rejoin.programme.id).toBe(paused.programme.id)
    expect(player.loads).toHaveLength(1)
    expect(player.loads[0].videoId).toBe(scheduled.programme.videoId)
    expect(player.loads[0].startSeconds).toBe(playbackCommand(scheduled.programme, scheduled.seekSeconds, null).startSeconds)
    expect(player.loads[0].startSeconds - player.handle.currentTime()).toBeCloseTo(300, 0)
  })

  it('PLAY joins the next programme when a boundary passed during the pause', async () => {
    const pausedAt = insideLongProgramme(channel)
    const before = broadcast(channel, pausedAt).current
    const playAt = before.endMs + MINUTE
    const player = fakePlayer(before.seekSeconds)
    pauseViewing(player.handle)

    const rejoin = liveAiring(channel, playAt, null)
    await deliver(player.handle, rejoin.command)

    const scheduled = broadcast(channel, playAt).current
    expect(scheduled.startMs).toBeGreaterThanOrEqual(before.endMs)
    expect(rejoin.startMs).toBe(scheduled.startMs)
    expect(rejoin.programme.id).toBe(scheduled.programme.id)
    expect(player.loads[0].videoId).toBe(scheduled.programme.videoId)
    expect(player.loads[0].startSeconds).toBe(playbackCommand(scheduled.programme, scheduled.seekSeconds, null).startSeconds)
  })

  it('a tune while paused plays the new channel at its own live position', async () => {
    const pausedAt = insideLongProgramme(channel)
    const player = fakePlayer(liveAiring(channel, pausedAt, null).command.startSeconds)
    pauseViewing(player.handle)

    const tunedAt = pausedAt + 5 * MINUTE
    const next = adjacentChannel(channel.number, 1)
    const airing = liveAiring(next, tunedAt, null)
    await deliver(player.handle, airing.command)

    const scheduled = broadcast(next, tunedAt).current
    expect(next.number).not.toBe(channel.number)
    expect(airing.key.startsWith(`${next.id}`)).toBe(true)
    expect(player.loads[0].videoId).toBe(scheduled.programme.videoId)
    expect(player.loads[0].startSeconds).toBe(playbackCommand(scheduled.programme, scheduled.seekSeconds, null).startSeconds)
  })

  it('keeps the Guide and Now/Next on the real clock while paused', () => {
    const pausedAt = insideLongProgramme(channel)
    const before = broadcast(channel, pausedAt).current
    pauseViewing(fakePlayer().handle)

    const later = before.endMs + MINUTE
    const now = broadcast(channel, later).current
    expect(now.startMs).toBeGreaterThanOrEqual(before.endMs)
    const slot = guideSlots(channel, later - 30 * MINUTE, later + 30 * MINUTE).find((item) => item.startMs <= later && later < item.endMs)
    expect(slot?.programme.id).toBe(now.programme.id)

    for (const file of ['src/components/Guide.tsx', 'src/components/NowNextOverlay.tsx', 'src/services/broadcast.ts']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/paused/i)
    }
  })

  it('leaves the provider tuning path to clear pause and load the live airing', () => {
    const source = readFileSync('src/state/TvProvider.tsx', 'utf8')
    const commit = source.slice(source.indexOf('commitTuneRef.current = async'), source.indexOf('const closeGuide'))
    expect(commit).toMatch(/if \(pausedRef\.current\) resumeViewing\(\)/)
    expect(commit).toMatch(/pausedRef\.current = false\s+setPaused\(false\)/)
    expect(commit).toMatch(/await loadProgramme\(target, Date\.now\(\)\)/)
    const resume = source.slice(source.indexOf('const resumeViewing'), source.indexOf('commitTuneRef.current = async'))
    expect(resume).toMatch(/loadProgramme\(current, Date\.now\(\)\)/)
    expect(resume).not.toMatch(/\.play\(\)/)
  })
})
