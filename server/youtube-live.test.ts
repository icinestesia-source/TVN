import { describe, expect, it } from 'vitest'
import { LIVE_SLOT_SECONDS, seedFromPage } from './youtube-channel.ts'

const LIVE = 'wBjxt4Osqoc'
const page = (lengthSeconds: string, liveNow: boolean) =>
  `"videoDetails":{"videoId":"${LIVE}","title":"LIVE: Breaking News and Top Stories on CBS News 24/7","lengthSeconds":"${lengthSeconds}"}` +
  (liveNow ? ',"liveBroadcastDetails":{"isLiveNow":true,"startTimestamp":"2026-10-07T22:59:21+00:00"}' : '')

describe('A YouTube live broadcast named by its watch page', () => {
  it('is given an hour slot', () => {
    expect(LIVE_SLOT_SECONDS).toBe(3600)
  })

  it('reads a broadcast on air now as a live programme with a slot of its own, and nothing else with no length', () => {
    expect(seedFromPage(page('0', true), LIVE)).toEqual({ id: LIVE, title: 'LIVE: Breaking News and Top Stories on CBS News 24/7', durationSec: LIVE_SLOT_SECONDS, live: true })
    expect(seedFromPage(page('0', false), LIVE)).toBeNull()
    expect(seedFromPage(page('1800', false), LIVE)).not.toHaveProperty('live')
  })

})
