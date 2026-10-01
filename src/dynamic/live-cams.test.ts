import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { channelByNumber } from '../data/catalogue.ts'
import { installUserCatalogue } from '../data/user-overlay.ts'
import { resetDirector } from '../director/director.ts'
import { setMediaLibrary } from '../director/library.ts'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { isOnAir } from '../network/airing.ts'
import { broadcast, guideSlots } from '../services/broadcast.ts'
import { CAM_SLOT_MS, camBroadcast, camFor } from './cams.ts'
import { liveCams } from './providers.ts'
import { LIVE_RETRY_MS, markLiveUnavailable, resetLiveState } from './runtime.ts'

const providers = JSON.parse(readFileSync('src/data/dynamic/providers.json', 'utf8'))
const CAM_CHANNELS = Array.from({ length: 30 }, (_, index) => 850 + index).filter((number) => ![862, 873, 874].includes(number))
const now = Date.UTC(2026, 8, 30, 18, 3)

describe('live cam channels 850-879', () => {
  beforeAll(() => {
    installUserCatalogue([], new Map())
    resetDirector()
    setMediaLibrary(expandPlayableCatalogue(JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))))
  })
  afterEach(() => resetLiveState())

  it('ships verified cams for every webcam channel, keyless and complete', () => {
    for (const number of CAM_CHANNELS) {
      const entry = providers.channels[String(number)]
      expect(entry?.mode, `channel ${number}`).toBe('LIVE_CAMS')
      expect(entry.cams.length, `channel ${number}`).toBeGreaterThan(0)
      for (const cam of entry.cams) {
        expect(cam.videoId).toMatch(/^[\w-]{11}$/)
        expect(cam.sourceId).toMatch(/^yt:UC[\w-]{22}$/)
        expect(cam.service).toBeTruthy()
        expect(cam.verifiedAt).toBeTruthy()
      }
      expect(new Set(entry.cams.map((cam: { videoId: string }) => cam.videoId)).size).toBe(entry.cams.length)
    }
    expect(JSON.stringify(providers)).not.toMatch(/AIza[0-9A-Za-z_-]{20}/)
  })

  it('leaves airports and space off air by policy', () => {
    for (const number of [862, 873, 874]) {
      expect(providers.channels[String(number)]?.mode).not.toBe('LIVE_CAMS')
      expect(liveCams(number)).toHaveLength(0)
    }
  })

  it('names 879 Cat Cams', () => {
    expect(channelByNumber(879)?.name).toBe('Cat Cams')
  })

  it('is on air and plays a live cam, ahead of any shipped programmes', () => {
    for (const number of CAM_CHANNELS) {
      const channel = channelByNumber(number)!
      expect(isOnAir(channel), `channel ${number}`).toBe(true)
      const current = broadcast(channel, now).current
      expect(current.programme.playback).toBe('live')
      expect(liveCams(number).map((cam) => cam.videoId)).toContain(current.programme.videoId)
    }
  })

  it('changes cam every ten minutes on the clock, the same for every viewer', () => {
    const channel = channelByNumber(850)!
    const snapshot = camBroadcast(channel, now)!
    expect(snapshot.current.startMs % CAM_SLOT_MS).toBe(0)
    expect(snapshot.current.endMs - snapshot.current.startMs).toBe(CAM_SLOT_MS)
    expect(snapshot.next.startMs).toBe(snapshot.current.endMs)
    expect(snapshot.next.programme.videoId).not.toBe(snapshot.current.programme.videoId)
    expect(camBroadcast(channel, now)!.current.programme.id).toBe(snapshot.current.programme.id)
    const slots = guideSlots(channel, now, now + 60 * 60_000)
    expect(slots.length).toBeGreaterThanOrEqual(6)
    expect(slots.every((slot) => slot.endMs - slot.startMs === CAM_SLOT_MS)).toBe(true)
  })

  it('skips a cam that failed until it is retried', () => {
    const channel = channelByNumber(852)!
    const failing = camBroadcast(channel, now)!.current.programme.videoId!
    expect(markLiveUnavailable(failing, now, 852)).toBe(true)
    expect(camBroadcast(channel, now)!.current.programme.videoId).not.toBe(failing)
    expect(camFor(liveCams(852), Math.floor(now / CAM_SLOT_MS), now + LIVE_RETRY_MS)?.videoId).toBe(failing)
  })

  it('shows nothing rather than a dead cam when every cam has failed', () => {
    const cams = liveCams(853).slice(0, 2)
    for (const cam of cams) expect(markLiveUnavailable(cam.videoId, now, 853)).toBe(true)
    expect(camFor(cams, 0, now)).toBeNull()
    expect(camFor(cams, 0, now + LIVE_RETRY_MS)?.videoId).toBe(cams[0].videoId)
  })
})
