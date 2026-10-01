import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { channelByNumber } from '../data/catalogue.ts'
import { dynamicChannel, liveEndpoint } from '../dynamic/providers.ts'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { getChannelMedia } from '../library/query.ts'
import { schedulingPool } from '../library/mode.ts'
import { broadcast } from '../services/broadcast.ts'
import { getSchedule, resetDirector } from './director.ts'
import { mediaLibrary, setMediaLibrary } from './library.ts'
import { broadcastDateFor } from './time.ts'
import type { MediaItem } from './types.ts'

const items = expandPlayableCatalogue(JSON.parse(readFileSync('public/independent/playable.json', 'utf8')))
const manifest = JSON.parse(readFileSync('docs/channel-manifest.json', 'utf8')).records as { number: number; status: string }[]
const PLAYABLE = manifest.filter((row) => row.number <= 999 && (row.status === 'PLAYABLE' || row.status === 'PLAYABLE_STRONG')).map((row) => row.number)
const DATE = '2026-09-28'
const STAMPS = [7, 11, 15, 20].map((hour) => new Date(`${DATE}T${String(hour).padStart(2, '0')}:23:00+01:00`).getTime())
const VIDEO = /^[\w-]{11}$/

function resolve(number: number, nowMs: number) {
  return broadcast(channelByNumber(number)!, nowMs).current.programme
}

describe('runtime playback', () => {
  it('replaces a day compiled before the catalogue loaded once its programmes arrive', () => {
    resetDirector()
    setMediaLibrary([])
    const channel = channelByNumber(225)!
    const early = getSchedule(channel, broadcastDateFor(STAMPS[1]!, '06:00'))
    expect(early.blocks.flatMap((block) => block.children).every((child) => child.fallback)).toBe(true)
    setMediaLibrary(items)
    const programme = resolve(225, STAMPS[1]!)
    expect(programme.videoId).toMatch(VIDEO)
    expect(items.find((item) => item.externalId === programme.videoId)?.sourceId).toBe('src_orbital_bacon')
  })

  describe('every PLAYABLE and PLAYABLE_STRONG channel', () => {
    beforeAll(() => {
      resetDirector()
      setMediaLibrary(items)
    })

    it('has a runtime pool with schedulable duration', () => {
      const pool = schedulingPool(mediaLibrary()) as MediaItem[]
      const empty = PLAYABLE.filter((number) => {
        const media = getChannelMedia(pool, number)
        return media.length === 0 || media.reduce((sum, item) => sum + item.durationSeconds, 0) <= 0
      })
      expect(PLAYABLE.length).toBeGreaterThan(600)
      expect(empty.filter((number) => dynamicChannel(number)?.mode !== 'LIVE_STREAM' || !liveEndpoint(number))).toEqual([])
    })

    it('resolves a playable video at every representative timestamp', () => {
      const failures: string[] = []
      for (const number of PLAYABLE) {
        for (const at of STAMPS) {
          const programme = resolve(number, at)
          if (!programme.videoId || !VIDEO.test(programme.videoId)) failures.push(`${number}@${new Date(at).toISOString().slice(11, 16)}`)
        }
      }
      expect(failures).toEqual([])
    }, 300000)

    it('airs each owned catalogue on its home channel', () => {
      for (const [number, source] of [[114, 'src_kofa'], [225, 'src_orbital_bacon'], [805, 'src_british_pathe']] as const) {
        for (const at of STAMPS) {
          const programme = resolve(number, at)
          expect(items.find((item) => item.externalId === programme.videoId)?.sourceId, `${number}`).toBe(source)
        }
      }
    })
  })
})
