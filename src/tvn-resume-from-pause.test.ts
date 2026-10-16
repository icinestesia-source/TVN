import { describe, expect, it } from 'vitest'
import { clearManual, onScreen, selectProgramme } from './player/manual.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'
import {
  holdPausedClip,
  loadResumeFromPause,
  RESUME_FROM_PAUSE_KEY,
  setResumeFromPause,
  takePausedClip,
  unpauseSeconds,
} from './view/resume-from-pause.ts'

const memory = () => {
  const items = new Map<string, string>()
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) }
}

const programme = { id: 'clip', title: 'Held', durationSeconds: 600, programmeType: 'video', source: 'youtube', videoId: 'abcdefghijk' } as unknown as Programme
const channel = { id: 'ch', number: 12, name: 'Twelve', origin: 'curated' } as unknown as Channel

describe('Playback: resume where paused', () => {
  it('is off until the viewer turns it on, and the choice is kept in this browser', () => {
    const store = memory()
    expect(loadResumeFromPause(store)).toBe(false)
    setResumeFromPause(true, store)
    expect(store.getItem(RESUME_FROM_PAUSE_KEY)).toBe('on')
    expect(loadResumeFromPause(store)).toBe(true)
    setResumeFromPause(false, store)
    expect(loadResumeFromPause(store)).toBe(false)
  })

  it('unpausing with it on rejoins the paused second; off follows the Guide', () => {
    const clip = { channelNumber: 12, programme, seconds: 84, slot: { startMs: 1_000, endMs: 601_000 } }
    expect(unpauseSeconds(true, clip, 12)).toBe(84)
    expect(unpauseSeconds(false, clip, 12)).toBeNull()
    expect(unpauseSeconds(true, clip, 13)).toBeNull()
    expect(unpauseSeconds(true, null, 12)).toBeNull()
  })

  it('the held second is what plays, not the time the Guide has reached', () => {
    holdPausedClip({ channelNumber: 12, programme, seconds: 84 })
    const clip = takePausedClip()
    expect(takePausedClip()).toBeNull()
    const seconds = unpauseSeconds(true, clip, 12)
    expect(seconds).toBe(84)
    const now = Date.UTC(2026, 9, 16, 12, 0, 0)
    selectProgramme(12, programme, now, undefined, undefined, seconds ?? 0)
    expect(onScreen(channel, now).current.seekSeconds).toBe(84)
    expect(onScreen(channel, now + 10_000).current.seekSeconds).toBe(94)
    clearManual()
  })
})
