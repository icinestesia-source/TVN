import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adjacentChannel, channelByNumber, listChannels, programmesFor, randomChannel } from '../data/catalogue.ts'
import { installUserCatalogue } from '../data/user-overlay.ts'
import { liveCams, liveEndpoint } from '../dynamic/providers.ts'
import { markLiveUnavailable, resetLiveState } from '../dynamic/runtime.ts'
import { excludedProgramme, REVIEWED_EXCLUSIONS } from '../library/exclusions.ts'
import { schedulingPool } from '../library/mode.ts'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { getChannelMedia } from '../library/query.ts'
import { isOnAir, refreshAiring } from '../network/airing.ts'
import { nightPool, originalCard, originalCards, originalFormat, STATUS_CARD_CLASSES, withCard } from '../originals/originals.ts'
import { broadcast, guideSlots } from '../services/broadcast.ts'
import { airingClass, userTestDiagnostic } from '../services/diagnostic.ts'
import { channelsFromSources, mergeParsedExports, parseChannelsExport, planImport } from '../services/channels-import.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import { compileDay } from './compile.ts'
import { getSchedule, primeDirector, resetDirector } from './director.ts'
import { containsExcluded, readFrozen } from './cache.ts'
import { setMediaLibrary } from './library.ts'
import { policyFor } from './policies.ts'
import type { MediaItem } from './types.ts'

const DATE = '2026-09-28'
const at = (date: string, time: string) => new Date(`${date}T${time}+01:00`).getTime()
const NOW = at(DATE, '11:23:00')
interface ManifestRow { number: number; name: string; status: string }

function media(overrides: Partial<MediaItem> & { id: string; durationSeconds: number }): MediaItem {
  return {
    title: overrides.id,
    provider: 'youtube',
    externalId: overrides.id,
    programmeType: 'documentary',
    explicitChannelIncludes: [400],
    ...overrides,
  } as MediaItem
}

/** The guide cell containing `t` says what broadcast() says: same programme, or one collapsed holding cell. */
function guideAgrees(channel: Channel, t: number): boolean {
  const now = broadcast(channel, t)
  const programme = now.current.programme
  const slot = guideSlots(channel, t - 60_000, t + 60_000).find((entry) => entry.startMs <= t && t < entry.endMs)
  if (!slot) return false
  if (slot.programme.id === programme.id) return slot.startMs === now.current.startMs && slot.endMs === now.current.endMs
  return !programme.videoId && !slot.programme.videoId && slot.programme.blockId === programme.blockId && slot.programme.title === programme.title && slot.programme.caption === programme.caption
}

describe('Pass 23 release-candidate hardening', () => {
  let manifest: Map<number, ManifestRow>
  const items = expandPlayableCatalogue(JSON.parse(readFileSync('public/independent/playable.json', 'utf8')))

  beforeAll(() => {
    manifest = new Map((JSON.parse(readFileSync('docs/channel-manifest.json', 'utf8')).records as ManifestRow[]).map((row) => [row.number, row]))
    installUserCatalogue([], new Map())
    resetDirector()
    resetLiveState()
    setMediaLibrary(items)
    refreshAiring(items, NOW)
  })

  afterAll(() => installUserCatalogue([], new Map()))

  it('gives every GENERATED or RETROTV_ORIGINAL channel a real format, and every format one of those statuses', () => {
    for (const row of manifest.values()) {
      if (row.status === 'GENERATED' || row.status === 'RETROTV_ORIGINAL') expect(originalFormat(row.number), `${row.number}`).toBeDefined()
      if (originalFormat(row.number)) expect(['GENERATED', 'RETROTV_ORIGINAL'], `${row.number}`).toContain(row.status)
    }
    for (const n of [97, 888, 899]) expect(manifest.get(n)?.status, `${n}`).toBe('DELIBERATELY_UNAVAILABLE')
    for (const n of [98, 285, 291, 294, 295]) expect(manifest.get(n)?.status, `${n}`).toBe('NEEDS_CONTENT')
    expect(originalFormat(99)?.kind).toBe('listings')
    expect(originalFormat(894)?.kind).toBe('listings')
  })

  it('never shows a pictureless programme without an explanation on any 000–999 channel', () => {
    const stamps = [at(DATE, '03:10:00'), NOW, at(DATE, '19:45:00')]
    for (const channel of listChannels()) {
      if (channel.number > 999) continue
      for (const t of stamps) {
        const programme = broadcast(channel, t).current.programme
        if (programme.videoId) continue
        const explained = Boolean(programme.caption) || programme.title === 'Programming resumes soon'
        expect(explained, `${channel.number} ${programme.title}`).toBe(true)
      }
    }
  }, 300_000)

  it('keeps every NEEDS_CONTENT, unavailable and excluded channel honest: no programming, a card that says why', () => {
    for (const row of manifest.values()) {
      if (!['NEEDS_CONTENT', 'DELIBERATELY_UNAVAILABLE', 'EXCLUDED', 'NEEDS_LIVE_PROVIDER', 'NEEDS_AUDIO_PROVIDER'].includes(row.status)) continue
      const channel = channelByNumber(row.number)
      if (!channel || liveCams(row.number).length > 0) continue
      const programme = broadcast(channel, NOW).current.programme
      expect(programme.videoId, `${row.number}`).toBeNull()
      expect(programme.caption, `${row.number}`).toBeTruthy()
      expect(programme.caption, `${row.number}`).not.toMatch(/undefined|null|NaN|[A-Z]+_[A-Z]+/)
    }
  })

  it('keeps presentation cards out of the manifest status and away from user channels', () => {
    for (const [number, card] of Object.entries(originalCards())) {
      if (STATUS_CARD_CLASSES.has(card.class)) continue
      expect(['OFF_AIR', 'LIVE_INTERRUPTED', 'DYNAMIC_EMPTY'], number).toContain(card.class)
      expect(manifest.get(Number(number))?.status, number).not.toBe('NEEDS_CONTENT')
    }
    const slate = { id: 'x', title: 'Off air', videoId: null, durationSeconds: 60 } as Programme
    expect(withCard(1001, [slate])[0]).toBe(slate)
    expect(originalCard(1001)).toBeUndefined()
  })

  it('keeps the rights ten off air, visibly named, with no path to their material', () => {
    const rights = [87, 211, 212, 213, 214, 215, 297, 361, 802, 841]
    const onAir = listChannels().filter((channel) => channel.enabled && isOnAir(channel)).map((channel) => channel.number)
    for (const n of rights) {
      const channel = channelByNumber(n)!
      expect(channel.name, `${n}`).toBeTruthy()
      expect(originalCard(n)?.class, `${n}`).toBe('RIGHTS_BLOCKED')
      expect(onAir, `${n}`).not.toContain(n)
      expect(randomChannelNever(n, onAir), `${n}`).toBe(true)
      for (const t of [NOW, at(DATE, '21:10:00'), at('2026-09-29', '02:00:00')]) {
        const programme = broadcast(channel, t).current.programme
        expect(programme.videoId, `${n}`).toBeNull()
        expect(programme.caption, `${n}`).toBe('OFF AIR · BROADCAST RIGHTS NOT CLEARED')
        expect(guideAgrees(channel, t), `${n}`).toBe(true)
      }
    }
  })

  it('reads listings from the real broadcast of each listed channel', () => {
    const teletext = broadcast(channelByNumber(894)!, NOW).current
    const format = originalFormat(894)
    if (format?.kind !== 'listings') throw new Error('894 has no listings format')
    const page = Math.floor((NOW - teletext.startMs) / (format.seconds * 1000)) % format.channels.length
    const listed = channelByNumber(format.channels[page])!
    const now = broadcast(listed, NOW).current
    expect(teletext.programme.title).toContain(now.programme.title)
    expect(teletext.programme.caption).toMatch(/^NOW ON \d{3} .+ · UNTIL \d{2}:\d{2}$/)
    expect(teletext.endMs - teletext.startMs).toBe(3_600_000)
    const preview = broadcast(channelByNumber(99)!, NOW).current.programme
    expect(preview.caption).toMatch(/^NEXT ON \d{3} .+ · FROM \d{2}:\d{2}$/)
    for (const n of [99, 894]) expect(guideAgrees(channelByNumber(n)!, NOW), `${n}`).toBe(true)
  })

  it('airs the clock and closedown formats without external media', () => {
    const clock = broadcast(channelByNumber(896)!, NOW).current.programme
    expect(clock.videoId).toBeNull()
    expect(clock.tags).toContain('clock')
    for (const n of [897]) {
      const day = Array.from({ length: 24 }, (_, hour) => broadcast(channelByNumber(n)!, at(DATE, `${String(hour).padStart(2, '0')}:30:00`)).current.programme)
      expect(day.every((programme) => !programme.videoId && programme.caption), `${n}`).toBe(true)
      expect(day.some((programme) => programme.programmeType === 'closedown'), `${n}`).toBe(true)
    }
    expect(channelByNumber(999)?.origin).toBe('session')
  })

  it('does not compile Director days for channels an original intercepts', () => {
    for (const n of [887, 896, 897, 898, 999, 894, 99]) {
      const channel = channelByNumber(n)!
      primeDirector(channel, NOW)
      broadcast(channel, NOW)
      guideSlots(channel, NOW - 3_600_000, NOW + 3_600_000)
      if (policyFor(n)) expect(readFrozen(n, DATE), `${n}`).toBeUndefined()
    }
  })

  it('shows a deliberate live-interruption state when a configured stream fails, then recovers', () => {
    for (let n = 0; n <= 999; n += 1) {
      const live = liveEndpoint(n)
      if (!live) continue
      const channel = channelByNumber(n)!
      resetLiveState()
      expect(broadcast(channel, NOW).current.programme.playback, `${n}`).toBe('live')
      markLiveUnavailable(live.videoId, NOW, n)
      const fallback = broadcast(channel, NOW + 1000).current.programme
      expect(fallback.playback, `${n}`).not.toBe('live')
      if (!fallback.videoId) expect(fallback.caption ?? fallback.title, `${n}`).toMatch(/LIVE STREAM UNAVAILABLE|Programming resumes soon/)
      expect(broadcast(channel, NOW + 16 * 60_000).current.programme.playback, `${n}`).toBe('live')
    }
    resetLiveState()
  })

  it('shows a deliberate card, not a blank, when a rolling window has expired', () => {
    const later = at('2027-11-02', '12:00:00')
    const config = JSON.parse(readFileSync('src/data/dynamic/providers.json', 'utf8')).channels as Record<string, { mode: string }>
    for (const [number, row] of Object.entries(config)) {
      if (row.mode !== 'ROLLING_CURRENT') continue
      const programme = broadcast(channelByNumber(Number(number))!, later).current.programme
      expect(programme.videoId, number).toBeNull()
      expect(programme.caption, number).toBe('OFF AIR · NO CURRENT PROGRAMMES IN THIS WINDOW')
      expect(broadcast(channelByNumber(Number(number))!, NOW).current.programme.videoId, number).toBeTruthy()
    }
  })

  it('agrees with the guide on now across boundaries, the hour, midnight and the broadcast-day change', () => {
    const stamps = [NOW, at(DATE, '12:00:00'), at(DATE, '23:59:59'), at('2026-09-29', '00:00:00'), at('2026-09-29', '05:59:59'), at('2026-09-29', '06:00:00')]
    for (let n = 0; n <= 999; n += 7) {
      const channel = channelByNumber(n)
      // 000 TVN has no schedule of its own to agree with: it chooses as it goes.
      if (!channel || channel.origin === 'tvn') continue
      for (const t of stamps) expect(guideAgrees(channel, t), `${n} @ ${new Date(t).toISOString()}`).toBe(true)
    }
  }, 300_000)

  it('moves cleanly across programme boundaries: no zero lengths, negative offsets or gaps', () => {
    for (const n of [1, 19, 61, 114, 225, 301, 500, 805, 898, 902]) {
      const channel = channelByNumber(n)!
      let t = at(DATE, '05:00:00')
      const end = at('2026-09-29', '07:00:00')
      let previous: { id: string; endMs: number } | undefined
      let guard = 0
      while (t < end && guard < 2000) {
        guard += 1
        const snap = broadcast(channel, t)
        const current = snap.current
        expect(current.endMs - current.startMs, `${n}`).toBeGreaterThan(0)
        expect(current.elapsedSeconds, `${n}`).toBeGreaterThanOrEqual(0)
        expect(current.startMs, `${n}`).toBeLessThanOrEqual(t)
        expect(current.endMs, `${n}`).toBeGreaterThan(t)
        if (previous) expect(current.startMs, `${n} after ${previous.id}`).toBe(previous.endMs)
        const before = broadcast(channel, current.endMs - 1).current
        expect(before.programme.id, `${n}`).toBe(current.programme.id)
        const after = broadcast(channel, current.endMs).current
        expect(after.startMs, `${n}`).toBe(current.endMs)
        expect(after.elapsedSeconds, `${n}`).toBe(0)
        previous = { id: current.programme.id, endMs: current.endMs }
        t = current.endMs
      }
    }
  }, 300_000)

  it('stays contiguous across the October clock change', () => {
    for (const n of [1, 301, 898]) {
      const channel = channelByNumber(n)!
      for (let t = Date.parse('2026-10-24T22:00:00Z'); t < Date.parse('2026-10-25T08:00:00Z'); t += 15 * 60_000) {
        const current = broadcast(channel, t).current
        expect(current.endMs - current.startMs, `${n} ${new Date(t).toISOString()}`).toBeGreaterThan(0)
        expect(current.startMs, `${n}`).toBeLessThanOrEqual(t)
        expect(current.endMs, `${n}`).toBeGreaterThan(t)
      }
    }
  })

  it('tries a fresh programme across a soft boundary before looping a short clip', () => {
    const long = Array.from({ length: 12 }, (_, index) => media({ id: `match-${index}`, durationSeconds: 8200, programmeType: 'unclassified' }))
    const clip = media({ id: 'clip', durationSeconds: 120, programmeType: 'unclassified' })
    const schedule = compileDay({ channel: channelByNumber(400)!, broadcastDate: DATE, policy: policyFor(400)!, library: [...long, clip] })
    const barriers = [...schedule.blocks.filter((block) => block.hardStart).map((block) => block.startMs), schedule.dayEndMs]
    const used = new Set(schedule.blocks.flatMap((block) => block.children.map((child) => child.mediaItemId)))
    const unusedMatch = long.some((item) => !used.has(item.id))
    let seen = 0
    for (const block of schedule.blocks) {
      for (const child of block.children) {
        if (child.mediaItemId !== 'clip' || (seen += 1) === 1) continue
        const barrier = Math.min(...barriers.filter((ms) => ms > child.startMs))
        // A clip may only loop where no unused match could still fit before the next hard barrier.
        if (unusedMatch) expect(barrier - child.startMs, new Date(child.startMs).toISOString()).toBeLessThan(8200 * 1000)
      }
    }
    expect(schedule.blocks.filter((block) => !block.hardStart).some((block) => block.children.length === 1 && block.children[0].mediaItemId?.startsWith('match'))).toBe(true)
  })

  it('repeats an exhausted documentary pool across days instead of holding, but still holds a hard film repeat', () => {
    const docs = [media({ id: 'doc-a', durationSeconds: 3 * 3600 }), media({ id: 'doc-b', durationSeconds: 3 * 3600 })]
    const history = docs.map((item) => ({ mediaItemId: item.id, broadcastDate: '2026-09-27', primeTime: false, programmeType: 'documentary' as const }))
    const schedule = compileDay({ channel: channelByNumber(400)!, broadcastDate: DATE, policy: policyFor(400)!, library: docs, history })
    const children = schedule.blocks.flatMap((block) => block.children)
    expect(children.some((child) => child.penalties?.includes('exhausted-repeat'))).toBe(true)
    const film = media({ id: 'film', durationSeconds: 90 * 60, programmeType: 'film', explicitChannelIncludes: [103] })
    const held = compileDay({
      channel: channelByNumber(103)!,
      broadcastDate: DATE,
      policy: policyFor(103)!,
      library: [film],
      history: [{ mediaItemId: 'film', broadcastDate: '2026-09-27', primeTime: false, programmeType: 'film' }],
    })
    expect(held.blocks.flatMap((block) => block.children).some((child) => child.mediaItemId === 'film')).toBe(false)
  })

  it('airs a week-deep pool before rerunning the week: fresh material beats the cross-channel preference', () => {
    // Pools of 170–210 hours; before the rerun weight each aired under half its pool across the week.
    for (const number of [76, 367, 489, 773]) {
      const channel = channelByNumber(number)!
      const pool = new Map(getChannelMedia(schedulingPool(items), number).map((item) => [item.id, item]))
      const aired = new Set<string>()
      let placedSeconds = 0
      for (let day = 0; day < 7; day += 1) {
        const date = new Date(Date.parse(`${DATE}T12:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10)
        for (const child of getSchedule(channel, date).blocks.flatMap((block) => block.children)) {
          if (!child.videoId || child.fallback || !child.mediaItemId) continue
          placedSeconds += (child.endMs - child.startMs) / 1000
          aired.add(child.mediaItemId)
        }
      }
      const uniqueSeconds = [...aired].reduce((sum, id) => sum + (pool.get(id)?.durationSeconds ?? 0), 0)
      expect(uniqueSeconds / placedSeconds, `${number} unique share of the week`).toBeGreaterThan(0.9)
    }
    // On 400 'old-doc' carries almost no cross-channel penalty and 'new-doc' nearly the most, so only the
    // rerun weight puts the unaired documentary first.
    const day = compileDay({
      channel: channelByNumber(400)!,
      broadcastDate: DATE,
      policy: policyFor(400)!,
      library: [media({ id: 'old-doc', durationSeconds: 3600 }), media({ id: 'new-doc', durationSeconds: 3600 })],
      history: [{ mediaItemId: 'old-doc', broadcastDate: '2026-09-23', primeTime: false, programmeType: 'documentary' }],
    })
    const first = day.blocks.flatMap((block) => block.children).find((child) => child.mediaItemId)
    expect(first?.mediaItemId).toBe('new-doc')
  })

  it('never airs the same programme back to back while anything else fits', () => {
    // 'clip' is the only item fresh today; 'older' aired two days ago and is blocked by the documentary
    // gap. The day must alternate them, not loop 'clip' because a same-day loop outranks a cross-day repeat.
    const clip = media({ id: 'clip', durationSeconds: 120 })
    const older = media({ id: 'older', durationSeconds: 120 })
    const schedule = compileDay({
      channel: channelByNumber(400)!,
      broadcastDate: DATE,
      policy: policyFor(400)!,
      library: [clip, older],
      history: [{ mediaItemId: 'older', broadcastDate: '2026-09-26', primeTime: false, programmeType: 'documentary' }],
    })
    const aired = schedule.blocks.flatMap((block) => block.children).filter((child) => child.mediaItemId).map((child) => child.mediaItemId)
    expect(aired.length).toBeGreaterThan(100)
    expect(aired.filter((id, index) => index > 0 && id === aired[index - 1])).toEqual([])
    // Across the real network the loop rotates instead of hammering one clip.
    for (const number of [136, 268, 310, 538, 599, 821]) {
      const children = getSchedule(channelByNumber(number)!, DATE).blocks.flatMap((block) => block.children).filter((child) => child.mediaItemId)
      const runs = children.filter((child, index) => index > 0 && child.mediaItemId === children[index - 1].mediaItemId)
      expect(runs.length, `${number} back-to-back airings`).toBe(0)
    }
  })

  it('surfs every on-air channel in both directions and steps off an off-air channel to its neighbour', () => {
    const onAir = listChannels().filter((channel) => channel.enabled && channel.origin !== 'session' && isOnAir(channel)).map((channel) => channel.number)
    let number = onAir[0]
    for (let step = 0; step < onAir.length; step += 1) {
      const next = adjacentChannel(number, 1).number
      expect(onAir, `${number} -> ${next}`).toContain(next)
      expect(adjacentChannel(next, -1).number).toBe(number)
      number = next
    }
    expect(number).toBe(onAir[0])
    for (const offAir of [64, 480, 97, 888]) {
      expect(isOnAir(channelByNumber(offAir) ?? { number: offAir, enabled: false })).toBe(false)
      expect(adjacentChannel(offAir, 1).number).toBe(onAir.find((n) => n > offAir))
      expect(adjacentChannel(offAir, -1).number).toBe([...onAir].reverse().find((n) => n < offAir))
    }
    const seen = new Set<number>()
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let jump = 0; jump < 400; jump += 1) {
      const picked = randomChannel(number, random)!
      expect(onAir).toContain(picked.number)
      const programme = broadcast(picked, NOW + jump * 997).current.programme
      expect(programme.durationSeconds, `${picked.number}`).toBeGreaterThan(0)
      seen.add(picked.number)
      number = picked.number
    }
    expect(seen.size).toBeGreaterThan(200)
  }, 300_000)

  it('keeps factual space, aviation and religious programming out of every 000–999 pool, and leaves fiction and songs alone', () => {
    const reviewed = items.filter((item) => REVIEWED_EXCLUSIONS.has(item.externalId))
    expect(reviewed.length).toBeGreaterThan(100)
    const network = schedulingPool(items)
    for (const item of reviewed) expect(network, item.externalId).not.toContain(item)
    for (let n = 0; n <= 999; n += 1) {
      const channel = channelByNumber(n)
      if (!channel) continue
      const format = originalFormat(n)
      const pools = [getChannelMedia(items, n), getChannelMedia(network, n), format?.kind === 'night-block' ? nightPool(format, items) : []]
      for (const pool of pools) {
        const leaked = pool.filter((item) => excludedProgramme(item)).map((item) => item.externalId)
        expect(leaked, `${n}`).toEqual([])
      }
      const legacy = programmesFor(channel.id).filter((programme) => programme.videoId && excludedProgramme(programme))
      expect(legacy.map((programme) => programme.videoId), `${n}`).toEqual([])
    }
    const frozen = { blocks: [{ children: [{ fallback: false, title: 'Planet Mars: 1979', videoId: 'dZzY8-nxabA' }] }] } as unknown as Parameters<typeof containsExcluded>[0]
    expect(containsExcluded(frozen)).toBe(true)
    expect(containsExcluded({ blocks: [{ children: [{ fallback: false, title: 'Quilting 101', videoId: 'abcdefghijk' }] }] } as unknown as Parameters<typeof containsExcluded>[0])).toBe(false)
    for (const title of ['Where did the Universe come from?', 'LA’s Space Industry is Taking Off', 'Apollo Program: The Complete Story', 'Broken Armor | Full Faith-Based Drama Movie', "1975: A Nun's Life", 'The British Are Coming! - British Fighter Aces', 'Air Cargo’s Coronavirus Problem', 'How Flying Cars Became a Billion-Dollar Bet']) {
      expect(excludedProgramme({ title }), title).toBe(true)
    }
    for (const id of ['ZvbQMqd0kEY', 'zEvgbpQgNnE', 'SjTOVR339Ck', 'fURATK5Yt30']) expect(excludedProgramme({ externalId: id, title: 'x' }), id).toBe(true)
    for (const title of ['Life On Mars - David Bowie (Smoky Jazz Ballad Cover)', 'Lost In Space (1998) Official Trailer', 'Soundgarden - Black Hole Sun', 'Pearl Jam - Dark Matter (SeaLegacy Version)', 'Christian Movie Reviews 2 | Dead Meat Podcast', 'Tacos Al Pastor On the Grill!', 'Top Gun (1986) Official Trailer - Tom Cruise Movie', 'Stone Temple Pilots: The Robert DeLeo Interview', 'LIVESTREAM: Drone Flight Over Iceland Lava Fields', 'Mr Bean\'s First Time Flying...', 'Green Bay Packers vs New York Jets Game Preview']) {
      expect(excludedProgramme({ title }), title).toBe(false)
    }
  }, 300_000)

  it('builds a local diagnostic block with the airing facts and nothing secret', () => {
    const rights = [...manifest.values()].find((row) => originalCard(row.number)?.class === 'RIGHTS_BLOCKED')!
    for (const n of [1, 34, rights.number, 894, 898, 999]) {
      const channel = channelByNumber(n)
      if (!channel) continue
      const text = userTestDiagnostic(channel, NOW, { playerStatus: 'playing', viewport: { width: 1280, height: 720, ratio: 2 } })
      expect(text.split('\n')[0]).toBe('TVN DIAGNOSTIC · LOCAL ONLY · NOTHING IS SENT')
      for (const field of ['Time:', 'Versions: catalogue-v43', 'Channel:', 'Airing:', 'Programme:', 'Programme id:', 'Video:', 'Source:', 'Slot:', 'Offset:', 'Next:', 'Player: playing', 'Viewport: 1280x720']) {
        expect(text, `${n} ${field}`).toContain(field)
      }
      expect(text).not.toMatch(/AIza|key=|undefined|null|NaN/)
    }
    const rightsChannel = channelByNumber(rights.number)!
    expect(airingClass(rightsChannel, broadcast(rightsChannel, NOW).current.programme)).toBe('RIGHTS_BLOCKED')
  })

  it('crosses 999 ↔ 1001 past 1000 Local Media with user channels installed and keeps both sides isolated', () => {
    const merged = mergeParsedExports([
      parseChannelsExport(readFileSync('public/user-network/channels.txt', 'utf8')),
      parseChannelsExport(readFileSync('public/user-network/more-channels.txt', 'utf8')),
    ])
    const built = channelsFromSources(planImport([], merged, { library: true, automatic: true }, [], 1).sources)
    installUserCatalogue(built.channels, built.programmes)
    try {
      const first = built.channels[0]
      expect(first.number).toBe(1001)
      expect(channelByNumber(1000)?.origin).toBe('session')
      const lastNetwork = [...listChannels()].filter((channel) => channel.number <= 999 && channel.origin !== 'session' && isOnAir(channel)).pop()!
      expect(adjacentChannel(lastNetwork.number, 1).number).toBe(1001)
      expect(adjacentChannel(1000, 1).number).toBe(1001)
      expect(adjacentChannel(1001, -1).number).toBe(lastNetwork.number)
      const userIds = new Set([...built.programmes.values()].flat().map((programme) => programme.videoId).filter(Boolean))
      const catalogueIds = new Set(items.map((item) => item.externalId))
      const user = broadcast(first, NOW).current.programme
      expect(user.videoId).toBeTruthy()
      expect(user.caption).toBeUndefined()
      expect(airingClass(first, user)).toBe('USER_CHANNEL')
      expect(originalFormat(first.number)).toBeUndefined()
      expect(policyFor(first.number)).toBeUndefined()
      for (const n of [1, 19, 99, 301, 500, 800, 894, 898, 902, 999]) {
        const video = broadcast(channelByNumber(n)!, NOW).current.programme.videoId
        if (video && !catalogueIds.has(video)) expect(userIds.has(video), `${n}`).toBe(false)
      }
      for (const channel of built.channels.slice(0, 20)) expect(getScheduleThrows(channel), `${channel.number}`).toBe(true)
    } finally {
      installUserCatalogue([], new Map())
    }
  })
})

function randomChannelNever(n: number, onAir: readonly number[]): boolean {
  return Array.from({ length: onAir.length }, (_, index) => randomChannel(-1, () => index / onAir.length)?.number).every((picked) => picked !== n)
}

function getScheduleThrows(channel: Channel): boolean {
  try {
    getSchedule(channel, DATE)
    return false
  } catch {
    return true
  }
}

