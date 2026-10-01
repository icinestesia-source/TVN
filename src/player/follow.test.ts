import { afterEach, describe, expect, it } from 'vitest'
import { channelByNumber } from '../data/catalogue.ts'
import { DEMO_FILMS } from '../data/media.ts'
import { getSchedule, resetDirector } from '../director/director.ts'
import { setMediaLibrary } from '../director/library.ts'
import type { MediaItem } from '../director/types.ts'
import { resetLibraryForTests } from '../library/store.ts'
import { broadcast, guideSlots } from '../services/broadcast.ts'
import type { Programme } from '../types/programme.ts'
import { deliver, playbackCommand } from './command.ts'
import { resetPlaybackTrace } from './trace.ts'
import type { PlayerHandle, PlayerLoadRequest } from './types.ts'

afterEach(() => {
  resetLibraryForTests()
  resetDirector()
  resetPlaybackTrace()
})

function channel(number: number) {
  const found = channelByNumber(number)
  if (!found) throw new Error(`missing channel ${number}`)
  return found
}

function programme(patch: Partial<Programme> & Pick<Programme, 'id' | 'title' | 'videoId'>): Programme {
  return {
    description: patch.title,
    durationSeconds: 600,
    mediaDurationSeconds: 600,
    channelId: 'ch-test',
    category: 'test',
    source: 'imported',
    kind: 'programme',
    playbackMode: 'linear',
    playback: 'seekable-recorded',
    ...patch,
  }
}

function fakePlayer() {
  const loads: PlayerLoadRequest[] = []
  let actual: string | null = null
  const player: PlayerHandle = {
    load(request) {
      loads.push(request)
      actual = request.videoId
      return Promise.resolve(request.videoId ? 'playing' : 'slate')
    },
    play() {},
    pause() {},
    seek() {},
    setAudible() {},
    currentTime() {
      return loads.at(-1)?.startSeconds ?? 0
    },
    actualVideoId() {
      return actual
    },
  }
  return { player, loads }
}

function film(id: string, videoId: string, seconds: number): MediaItem {
  return {
    id,
    title: id,
    durationSeconds: seconds,
    programmeType: 'film',
    provider: 'youtube',
    externalId: videoId,
    mediaKind: 'video',
    playbackKind: 'seekable-recorded',
    live: false,
    canSeek: true,
    explicitChannelIncludes: [21],
  }
}

describe('playback follows the broadcast', () => {
  it('loads a different video for each channel and restores the first', async () => {
    const { player, loads } = fakePlayer()
    const sequence = [
      programme({ id: 'a', title: 'Alpha', videoId: 'videoA00001' }),
      programme({ id: 'b', title: 'Beta', videoId: 'videoB00002' }),
      programme({ id: 'c', title: 'Gamma', videoId: 'videoC00003' }),
      programme({ id: 'a', title: 'Alpha', videoId: 'videoA00001' }),
    ]
    for (const item of sequence) {
      const command = playbackCommand(item, 12, null)
      await deliver(player, command)
      expect(player.actualVideoId()).toBe(item.videoId)
    }
    expect(loads.map((load) => load.videoId)).toEqual(['videoA00001', 'videoB00002', 'videoC00003', 'videoA00001'])
    expect(loads.every((load) => load.startSeconds === 12)).toBe(true)
  })

  it('changes video when the broadcast crosses a programme boundary', async () => {
    const { player, loads } = fakePlayer()
    const first = programme({ id: 'early', title: 'Early', videoId: 'earlyvid001', durationSeconds: 60, mediaDurationSeconds: 60 })
    const second = programme({ id: 'later', title: 'Later', videoId: 'latervid002', durationSeconds: 60, mediaDurationSeconds: 60 })
    await deliver(player, playbackCommand(first, 10, null))
    await deliver(player, playbackCommand(second, 4, null))
    expect(loads.map((load) => load.videoId)).toEqual(['earlyvid001', 'latervid002'])
    expect(loads[1]?.startSeconds).toBe(4)
    expect(loads[0]?.videoId).not.toBe(loads[1]?.videoId)
  })

  it('does not replace a resolved video with a demonstration film', () => {
    const command = playbackCommand(programme({ id: 'real', title: 'Real', videoId: 'realvideo01' }), 30, null)
    expect(command.videoId).toBe('realvideo01')
    expect(command.kind).toBe('real')
    expect(DEMO_FILMS.some((film) => film.videoId === command.videoId)).toBe(false)
  })

  it('keeps a missing video empty instead of substituting the demonstration reel', async () => {
    const { player, loads } = fakePlayer()
    const missing = programme({ id: 'gap', title: 'Gap', videoId: null, source: 'demo', playback: 'generated' })
    const command = playbackCommand(missing, 90, null)
    expect(command.kind).toBe('holding')
    expect(command.videoId).toBeNull()
    expect(command.startSeconds).toBe(0)
    const result = await deliver(player, command)
    expect(result).toBe('slate')
    expect(loads[0]?.videoId).toBeNull()
    expect(DEMO_FILMS.some((film) => film.videoId === player.actualVideoId())).toBe(false)
  })

  it('shows the same video in the guide and on the player after the first child has ended', () => {
    setMediaLibrary([
      film('net:first', 'firstvid001', 8 * 60),
      film('net:second', 'secondvid02', 12 * 60),
    ])
    const day = getSchedule(channel(21), '2026-12-01')
    const playable = day.blocks.flatMap((block) => block.children).filter((child) => child.videoId)
    const first = playable[0]
    const second = playable[1]
    expect(first?.videoId).toBeTruthy()
    expect(second?.videoId).toBeTruthy()
    expect(second?.videoId).not.toBe(first?.videoId)
    const when = (second?.startMs ?? 0) + 5_000
    const picture = broadcast(channel(21), when)
    const live = guideSlots(channel(21), when - 1_000, when + 1_000).find((slot) => slot.startMs <= when && when < slot.endMs)
    expect(picture.current.programme.videoId).toBe(second?.videoId)
    expect(live?.programme.videoId).toBe(picture.current.programme.videoId)
    expect(live?.programme.title).toBe(picture.current.programme.title)
    expect(live?.programme.videoId).not.toBe(first?.videoId)
    const command = playbackCommand(picture.current.programme, picture.current.seekSeconds, null)
    expect(command.videoId).toBe(second?.videoId)
    expect(command.startSeconds).toBeGreaterThan(0)
    expect(command.startSeconds).toBeLessThan(12 * 60)
  })
})
