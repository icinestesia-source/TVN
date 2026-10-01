import { afterEach, describe, expect, it } from 'vitest'
import { channelByNumber, programmesFor } from '../data/catalogue.ts'
import { resolveSource } from '../player/resolve.ts'
import { SCHEDULE_EPOCH_MS } from '../scheduler/epoch.ts'
import { broadcast, guideSlots } from '../services/broadcast.ts'
import type { Channel } from '../types/channel.ts'
import { resetScheduleMemory, retained } from './cache.ts'
import { compileDay } from './compile.ts'
import {
  airPosition,
  directorStats,
  getSchedule,
  invalidateSchedule,
  invalidateScheduleRange,
  resetDirector,
} from './director.ts'
import { isEligible } from './eligibility.ts'
import { setMediaLibrary } from './library.ts'
import { scheduleSeed } from './network.ts'
import { RAILCAM_BLOCKS, newsPolicy, policyFor, strandPolicy } from './policies.ts'
import { REPEAT_RULES, repeatDecision, summariseUses } from './repeat.ts'
import { broadcastDateFor, broadcastWindow, localStartMs, zonedParts, zonedTimeToUtc } from './time.ts'
import type { FrozenDailySchedule, MediaItem, ProgrammingPolicy } from './types.ts'

afterEach(() => {
  resetDirector()
})

function ch(number: number): Channel {
  const found = channelByNumber(number)
  if (!found) throw new Error(`missing channel ${number}`)
  return found
}

function at(date: string, hhmm: string): number {
  return localStartMs(date, hhmm)
}

function block(schedule: FrozenDailySchedule, hhmm: string) {
  const found = schedule.blocks.find((item) => item.start === hhmm)
  if (!found) throw new Error(`no ${hhmm} block on ${schedule.broadcastDate}`)
  return found
}

function media(item: MediaItem): MediaItem {
  return item
}

function firstMedia(schedule: FrozenDailySchedule): string | undefined {
  for (const entry of schedule.blocks) {
    for (const child of entry.children) if (child.mediaItemId) return child.mediaItemId
  }
  return undefined
}

function expectJunction(schedule: FrozenDailySchedule, hhmm: string, title: string) {
  const junction = block(schedule, hhmm)
  expect(junction.title).toBe(title)
  expect(junction.hardStart).toBe(true)
  expect(junction.startMs).toBe(at(schedule.broadcastDate, hhmm))
  expect(junction.children[0]?.startMs).toBe(junction.startMs)
  for (const earlier of schedule.blocks) {
    if (earlier.startMs >= junction.startMs) continue
    for (const child of earlier.children) expect(child.endMs).toBeLessThanOrEqual(junction.startMs)
  }
  const parts = zonedParts(junction.startMs)
  const [hour, minute] = hhmm.split(':').map(Number)
  expect(parts.hour).toBe(hour)
  expect(parts.minute).toBe(minute)
}

describe('programme director', () => {
  it('keeps channels without a manifest route on the existing clock scheduler', () => {
    expect(policyFor(920)).toBeUndefined()
    expect(policyFor(64)).toBeUndefined()
    const late = ch(920)
    const snap = broadcast(late, at('2026-09-26', '21:30'))
    expect(snap.epochMs).toBe(SCHEDULE_EPOCH_MS)
    expect(programmesFor(late.id).some((item) => item.id === snap.current.programme.id)).toBe(true)
  })

  it('gives manifest-routed channels a routed-only policy', () => {
    for (const number of [1, 19, 60, 101, 415, 863]) {
      expect(policyFor(number)?.eligibility.routedOnly).toBe(true)
    }
    expect(policyFor(950)?.scheduleStyle).toBe('radio')
    const routed = media({ id: 'pathe', title: 'Pathé reel', durationSeconds: 180, programmeType: 'film', explicitChannelIncludes: [415] })
    const stray = media({ id: 'stray', title: 'History', durationSeconds: 1800, programmeType: 'documentary', topics: ['history'] })
    expect(isEligible(routed, 415, policyFor(415)!.eligibility)).toBe(true)
    expect(isEligible(stray, 415, policyFor(415)!.eligibility)).toBe(false)
    expect(isEligible(routed, 19, policyFor(19)!.eligibility)).toBe(false)
  })

  it('compiles a deterministic frozen day and reuses it', () => {
    const channel = ch(301)
    const first = getSchedule(channel, '2026-09-26')
    const second = getSchedule(channel, '2026-09-26')
    expect(second).toBe(first)
    expect(first.seed).toBe(scheduleSeed(301, '2026-09-26'))
    expect(first.seed).toBe('RETROTV|301|2026-09-26|policy-v1|catalogue-v43')
    expect(directorStats.cacheHits).toBe(1)
    expect(directorStats.compiles).toBe(1)
    resetScheduleMemory()
    const rebuilt = getSchedule(channel, '2026-09-26')
    expect(JSON.stringify(rebuilt.blocks)).toBe(JSON.stringify(first.blocks))
    expect(rebuilt.generation).not.toBe(first.generation)
  })

  it('does not regenerate a frozen day when the catalogue changes', () => {
    const channel = ch(103)
    setMediaLibrary([
      media({ id: 'early-film', title: 'Fixture morning picture', durationSeconds: 40 * 60, programmeType: 'film' }),
    ])
    const frozen = getSchedule(channel, '2026-09-22')
    const chosen = firstMedia(frozen)
    setMediaLibrary([
      media({ id: 'later-film', title: 'Fixture later picture', durationSeconds: 40 * 60, programmeType: 'film', editorialPriority: 10 }),
    ])
    expect(getSchedule(channel, '2026-09-22')).toBe(frozen)
    expect(firstMedia(getSchedule(channel, '2026-09-22'))).toBe(chosen)
    invalidateSchedule(103, '2026-09-22')
    const regenerated = getSchedule(channel, '2026-09-22')
    expect(regenerated).not.toBe(frozen)
    expect(firstMedia(regenerated)).toBe('later-film')
  })

  it('keeps guide and multiview from recompiling', () => {
    const football = ch(301)
    const horror = ch(140)
    const noon = at('2026-09-26', '12:00')
    broadcast(football, noon)
    broadcast(horror, noon)
    const compiled = directorStats.compiles
    guideSlots(football, noon, noon + 3 * 60 * 60 * 1000)
    guideSlots(horror, noon, noon + 3 * 60 * 60 * 1000)
    broadcast(football, noon)
    broadcast(horror, noon)
    expect(directorStats.compiles).toBe(compiled)
    expect(directorStats.materialised).toBe(2)
  })

  it('compiles the current day without building the whole network', () => {
    broadcast(ch(301), at('2026-09-26', '12:00'))
    expect(directorStats.materialised).toBe(1)
    expect(directorStats.eagerCompiles).toBe(1)
    expect(directorStats.lazyCompiles).toBe(0)
    expect(directorStats.materialised).toBeLessThan(9)
  })

  it('compiles a future guide date lazily', () => {
    const start = at('2026-09-27', '12:00')
    const slots = guideSlots(ch(301), start, start + 60 * 60 * 1000)
    expect(directorStats.lazyCompiles).toBe(1)
    expect(directorStats.eagerCompiles).toBe(0)
    expect(slots.some((slot) => slot.programme.title === 'MATCHDAY')).toBe(false)
    // Stage 4D: an empty block is an unprogrammed cell, not a fabricated programme title.
    expect(slots.some((slot) => slot.programme.title === 'Programming resumes soon')).toBe(true)
  })

  it('uses different templates for different days and channels', () => {
    const saturday = getSchedule(ch(301), '2026-09-26')
    const tuesday = getSchedule(ch(301), '2026-09-22')
    expect(block(saturday, '15:00').title).toBe('MATCHDAY')
    expect(block(tuesday, '15:00').title).not.toBe('MATCHDAY')
    expect(block(tuesday, '15:00').title).not.toBe('CLASSIC MATCH')
    const horror = getSchedule(ch(140), '2026-09-26')
    expect(horror.scheduleId).not.toBe(saturday.scheduleId)
    expect(horror.blocks.some((item) => item.title === 'MATCHDAY')).toBe(false)
  })

  it('places Saturday football appointments and keeps the classic match off 15:00', () => {
    setMediaLibrary([
      media({
        id: 'fixture-classic',
        title: 'Fixture classic match',
        durationSeconds: 105 * 60,
        programmeType: 'classic-match',
        topics: ['football'],
      }),
    ])
    const saturday = getSchedule(ch(301), '2026-09-26')
    expect(block(saturday, '14:00').title).toBe('MATCHDAY BUILD-UP')
    expectJunction(saturday, '15:00', 'MATCHDAY')
    expect(block(saturday, '15:00').eventHook).toBe('matchday')
    expect(block(saturday, '15:00').children.every((child) => child.mediaItemId !== 'fixture-classic')).toBe(true)
    expect(block(saturday, '15:00').children.every((child) => child.programmeType !== 'classic-match')).toBe(true)
    expect(block(saturday, '17:00').title).toBe('RESULTS / REACTION')
    expectJunction(saturday, '20:00', 'CLASSIC MATCH')
    const classic = block(saturday, '20:00').children[0]
    expect(classic?.mediaItemId).toBe('fixture-classic')
    expect(classic?.durationSeconds).toBe(105 * 60)
    expect(classic?.programmeType).toBe('classic-match')
  })

  it('hits movie and horror junctions without overrun', () => {
    const horror = getSchedule(ch(140), '2026-09-22')
    expectJunction(horror, '20:00', 'FEATURE PRESENTATION')
    expectJunction(horror, '00:00', 'MIDNIGHT HORROR')
    const classic = getSchedule(ch(103), '2026-09-22')
    expectJunction(classic, '20:00', 'CLASSIC FEATURE')
    expect(block(getSchedule(ch(103), '2026-09-25'), '20:00').title).toBe('FRIDAY NIGHT FILM')
    expect(block(getSchedule(ch(103), '2026-09-27'), '20:00').title).toBe('SUNDAY CLASSICS')
  })

  it('fills the gap before a hard junction without truncating the programme', () => {
    const policy = policyFor(103)
    if (!policy) throw new Error('missing classic film policy')
    const custom: ProgrammingPolicy = {
      ...policy,
      dayTemplates: {
        ...policy.dayTemplates,
        weekday: {
          id: 'weekday',
          blocks: [
            {
              id: 'day',
              title: 'Day',
              start: '06:00',
              programmeType: 'generated',
              strategy: 'hold',
              hardStart: true,
              continuityPolicy: 'generated-fill',
            },
            {
              id: 'early',
              title: 'Film Documentary',
              start: '18:00',
              programmeType: 'documentary',
              strategy: 'feature',
              preferTypes: ['documentary', 'short'],
              continuityPolicy: 'generated-fill',
            },
            {
              id: 'feature',
              title: 'FEATURE PRESENTATION',
              start: '20:00',
              programmeType: 'film',
              strategy: 'feature',
              hardStart: true,
              preferTypes: ['film'],
              continuityPolicy: 'generated-fill',
            },
          ],
        },
      },
    }
    const schedule = compileDay({
      channel: ch(103),
      broadcastDate: '2026-09-22',
      policy: custom,
      library: [
        media({ id: 'doc', title: 'Fixture documentary', durationSeconds: 100 * 60, programmeType: 'documentary' }),
        media({ id: 'short', title: 'Fixture short', durationSeconds: 15 * 60, programmeType: 'short' }),
      ],
    })
    const early = block(schedule, '18:00')
    expect(early.children[0]?.mediaItemId).toBe('doc')
    expect(early.children[0]?.durationSeconds).toBe(100 * 60)
    expect(early.children.some((child) => child.mediaItemId === 'short')).toBe(true)
    expect(early.children.some((child) => child.fallback)).toBe(true)
    expectJunction(schedule, '20:00', 'FEATURE PRESENTATION')
  })

  it('plays a long programme across a soft block boundary', () => {
    const schedule = compileDay({
      channel: ch(32),
      broadcastDate: '2026-09-26',
      policy: strandPolicy(32, 'music', ['concert'], ['live-music']),
      library: [
        media({
          id: 'gig',
          title: 'Fixture concert',
          durationSeconds: 100 * 60,
          programmeType: 'concert',
          topics: ['live-music'],
        }),
      ],
    })
    const children = schedule.blocks.flatMap((entry) => entry.children)
    const crosses = children.some(
      (child) =>
        child.mediaItemId === 'gig' &&
        schedule.blocks.some((entry) => {
          const boundary = localStartMs(schedule.broadcastDate, entry.start)
          return child.startMs < boundary && child.endMs > boundary
        }),
    )
    const fallbackSeconds = children
      .filter((child) => child.fallback)
      .reduce((sum, child) => sum + child.durationSeconds, 0)
    const covered = children.reduce((sum, child) => sum + child.durationSeconds, 0)
    expect(crosses).toBe(true)
    expect(fallbackSeconds).toBeLessThan(100 * 60)
    expect(covered * 1000).toBe(schedule.dayEndMs - schedule.dayStartMs)
  })

  it('resolves a music running order inside one guide block', () => {
    const channel = ch(544)
    const when = at('2026-09-26', '14:37')
    const air = airPosition(channel, when)
    const snap = broadcast(channel, when)
    expect(air?.block.title).toBe('BRITPOP')
    expect(air?.child.durationSeconds).toBe(300)
    expect(air?.elapsedSeconds).toBe(120)
    expect(snap.current.elapsedSeconds).toBe(120)
    expect(snap.current.seekSeconds).toBe(120)
    expect(snap.current.programme.blockTitle).toBe('BRITPOP')
    expect(air?.block.children.length).toBeGreaterThan(1)
    const slots = guideSlots(channel, at('2026-09-26', '14:10'), at('2026-09-26', '15:50'))
    expect(slots).toHaveLength(1)
    expect(slots[0]?.programme.title).toBe('Programming resumes soon')
    expect(slots[0]?.programme.blockTitle).toBe('BRITPOP')
    expect(slots[0]?.programme.durationSeconds).toBe(2 * 60 * 60)
    expect(slots[0]?.programme.id).not.toBe(air?.child.id)
    const boundary = airPosition(channel, at('2026-09-26', '16:00'))
    expect(boundary?.block.title).toBe('MTV GENERATION')
    expect(boundary?.child.startMs).toBe(at('2026-09-26', '16:00'))
  })

  it('keeps a late programme whole across midnight', () => {
    const when = at('2026-09-26', '00:30')
    expect(broadcastDateFor(when)).toBe('2026-09-26')
    const air = airPosition(ch(61), when)
    expect(air?.block.title).toBe('LATE FILM')
    expect(air?.child.startMs).toBe(at('2026-09-26', '23:00'))
    expect(air?.child.endMs).toBe(at('2026-09-26', '02:00'))
    expect(air?.elapsedSeconds).toBe(90 * 60)
    expect(broadcast(ch(61), when).current.seekSeconds).toBe(90 * 60)
    const slots = guideSlots(ch(61), at('2026-09-26', '23:30'), at('2026-09-26', '00:40'))
    const late = slots.filter((slot) => slot.programme.blockTitle === 'LATE FILM')
    expect(late).toHaveLength(1)
    expect(late[0]?.startMs).toBe(at('2026-09-26', '23:00'))
    expect(late[0]?.endMs).toBe(at('2026-09-26', '02:00'))
  })

  it('schedules Europe/London through GMT, BST, and the clock changes', () => {
    expect(zonedTimeToUtc('2026-01-10', '15:00')).toBe(Date.UTC(2026, 0, 10, 15, 0, 0))
    expect(zonedTimeToUtc('2026-09-26', '15:00')).toBe(Date.UTC(2026, 8, 26, 14, 0, 0))
    expect(zonedTimeToUtc('2026-03-29', '06:00')).toBe(Date.UTC(2026, 2, 29, 5, 0, 0))
    expect(zonedTimeToUtc('2026-10-25', '06:00')).toBe(Date.UTC(2026, 9, 25, 6, 0, 0))
    expect(zonedTimeToUtc('2026-03-29', '06:00')).toBe(zonedTimeToUtc('2026-03-29', '06:00'))
    const spring = broadcastWindow('2026-03-28')
    const autumn = broadcastWindow('2026-10-24')
    expect(spring.endMs - spring.startMs).toBe(23 * 60 * 60 * 1000)
    expect(autumn.endMs - autumn.startMs).toBe(25 * 60 * 60 * 1000)
    for (const date of ['2026-01-10', '2026-09-26', '2026-03-28', '2026-10-24']) {
      const schedule = getSchedule(ch(301), date)
      const seconds = schedule.blocks.reduce(
        (sum, entry) => sum + entry.children.reduce((childSum, child) => childSum + child.durationSeconds, 0),
        0,
      )
      expect(seconds * 1000).toBe(schedule.dayEndMs - schedule.dayStartMs)
      expect(zonedParts(block(schedule, '15:00').startMs).hour).toBe(15)
      expect(block(schedule, '15:00').title).toBe('MATCHDAY')
    }
  })

  it('penalises recent repeats and still fills a tiny catalogue', () => {
    const aired = media({ id: 'aired', title: 'Fixture aired film', durationSeconds: 90 * 60, programmeType: 'film' })
    const fresh = media({ id: 'fresh', title: 'Fixture fresh film', durationSeconds: 90 * 60, programmeType: 'film' })
    const decision = repeatDecision('aired', [
      { mediaItemId: 'aired', broadcastDate: '2026-09-14', primeTime: true, programmeType: 'film' },
    ], '2026-09-22', REPEAT_RULES.film, true)
    expect(decision.status).toBe('penalized')
    expect(decision.reasons).toContain('preferred-gap')
    const picked = compileDay({
      channel: ch(103),
      broadcastDate: '2026-09-22',
      policy: policyFor(103)!,
      library: [aired, fresh],
      history: [{ mediaItemId: 'aired', broadcastDate: '2026-09-14', primeTime: true, programmeType: 'film' }],
    })
    expect(firstMedia(picked)).toBe('fresh')
    const blocked = compileDay({
      channel: ch(103),
      broadcastDate: '2026-09-22',
      policy: policyFor(103)!,
      library: [aired],
      history: [{ mediaItemId: 'aired', broadcastDate: '2026-09-21', primeTime: false, programmeType: 'film' }],
    })
    expect(firstMedia(blocked)).toBeUndefined()
    expect(blocked.blocks.length).toBeGreaterThan(0)
    expect(blocked.blocks.every((entry) => entry.children.length > 0)).toBe(true)
    expect(summariseUses('aired', [
      { mediaItemId: 'aired', broadcastDate: '2026-09-21', primeTime: true, programmeType: 'film' },
    ], '2026-09-22').broadcastCount7d).toBe(1)
  })

  it('allows an intentional music repeat and refuses a hard film repeat', () => {
    const video = media({
      id: 'video-1',
      title: 'Fixture video',
      durationSeconds: 180,
      programmeType: 'music-video',
      topics: ['1990s'],
    })
    const music = compileDay({
      channel: ch(544),
      broadcastDate: '2026-09-26',
      policy: policyFor(544)!,
      library: [video],
    })
    const wake = block(music, '06:00')
    expect(wake.children[0]?.mediaItemId).toBe('video-1')
    expect(wake.children[1]?.mediaItemId).toBe('video-1')
    const yesterday = repeatDecision('only-film', [
      { mediaItemId: 'only-film', broadcastDate: '2026-09-21', primeTime: false, programmeType: 'film' },
    ], '2026-09-22', REPEAT_RULES.film, false)
    expect(yesterday.status).toBe('blocked')
  })

  it('spreads equal documentaries across creators', () => {
    const docs = ['A', 'B', 'C'].map((creator) =>
      media({
        id: `doc-${creator}`,
        title: `Fixture documentary ${creator}`,
        durationSeconds: 20 * 60,
        programmeType: 'documentary',
        topics: ['history'],
        creator,
      }),
    )
    const schedule = compileDay({
      channel: ch(400),
      broadcastDate: '2026-09-22',
      policy: policyFor(400)!,
      library: docs,
    })
    const creators: string[] = []
    for (const entry of schedule.blocks) {
      for (const child of entry.children) if (child.creator) creators.push(child.creator)
    }
    expect(new Set(creators.slice(0, 3)).size).toBe(3)
  })

  it('prefers the morning short and the higher editorial priority', () => {
    const morning = compileDay({
      channel: ch(103),
      broadcastDate: '2026-09-22',
      policy: policyFor(103)!,
      library: [
        media({ id: 'picture', title: 'Fixture picture', durationSeconds: 40 * 60, programmeType: 'film' }),
        media({ id: 'brief', title: 'Fixture brief', durationSeconds: 40 * 60, programmeType: 'short' }),
      ],
    })
    expect(block(morning, '06:00').children[0]?.mediaItemId).toBe('brief')
    const ranked = compileDay({
      channel: ch(103),
      broadcastDate: '2026-09-22',
      policy: policyFor(103)!,
      library: [
        media({ id: 'plain', title: 'Fixture plain', durationSeconds: 90 * 60, programmeType: 'film' }),
        media({
          id: 'priority',
          title: 'Fixture priority',
          durationSeconds: 90 * 60,
          programmeType: 'film',
          editorialPriority: 10,
        }),
      ],
    })
    expect(firstMedia(ranked)).toBe('priority')
  })

  it('lets an explicit exclusion beat an explicit inclusion', () => {
    const item = media({ id: 'rome', title: 'Fixture Rome', durationSeconds: 50 * 60, programmeType: 'documentary', topics: ['rome'] })
    const rule = { includeTopics: ['rome', 'roman-empire'], excludeTypes: ['music-video' as const], excludeTopics: ['sport'] }
    expect(isEligible(item, 400, rule)).toBe(true)
    expect(
      isEligible(
        media({ id: 'kick', title: 'Fixture sport', durationSeconds: 50 * 60, programmeType: 'documentary', topics: ['sport'] }),
        400,
        rule,
      ),
    ).toBe(false)
    expect(isEligible(item, 400, { explicitExclude: ['rome'] }, { explicitInclude: ['rome'] })).toBe(false)
    expect(isEligible({ ...item, explicitChannelExcludes: [400] }, 400, { explicitInclude: ['rome'] })).toBe(false)
  })

  it('applies the Halloween event without inventing a catalogue title', () => {
    const ordinary = compileDay({
      channel: ch(140),
      broadcastDate: '2026-10-30',
      policy: policyFor(140)!,
      library: [],
    })
    const halloween = compileDay({
      channel: ch(140),
      broadcastDate: '2026-10-31',
      policy: policyFor(140)!,
      library: [
        media({ id: 'h', title: 'Fixture halloween', durationSeconds: 90 * 60, programmeType: 'film', topics: ['halloween'] }),
        media({ id: 'g', title: 'Fixture gothic', durationSeconds: 90 * 60, programmeType: 'film', topics: ['horror'] }),
      ],
    })
    expect(block(ordinary, '00:00').title).toBe('MIDNIGHT HORROR')
    expect(block(halloween, '00:00').title).toBe('All Hallows Late Feature')
    expect(firstMedia(halloween)).toBe('h')
  })

  it('survives empty movie, music, football, and webcam pools', () => {
    const noon = at('2026-09-26', '12:00')
    for (const number of [103, 544, 301, 850]) {
      const channel = ch(number)
      const snap = broadcast(channel, noon)
      expect(snap.current.programme.durationSeconds).toBeGreaterThan(0)
      expect(snap.current.seekSeconds).toBeGreaterThanOrEqual(0)
      const schedule = getSchedule(channel, '2026-09-26')
      expect(schedule.blocks.length).toBeGreaterThan(0)
      expect(schedule.blocks.every((entry) => entry.children.length > 0)).toBe(true)
    }
    const live = getSchedule(ch(850), '2026-09-26')
    expect(block(live, '06:00').title).toBe('SUNRISE')
    expect(block(live, '06:00').eventHook).toBe('live-source')
    const radio = broadcast(ch(960), at('2026-09-26', '07:30'))
    expect(radio.current.programme.blockTitle).toBe('Breakfast')
    expect(radio.current.programme.programmeType).toBe('radio')
    expect(block(getSchedule(ch(400), '2026-09-22'), '20:00').title).toBe('PRIME DOCUMENTARY')
    expect(block(getSchedule(ch(61), '2026-09-26'), '09:00').title).toBe('SATURDAY MORNING CARTOONS')
    expect(block(getSchedule(ch(61), '2026-09-22'), '09:00').title).toBe('Morning Programme')
  })

  it('does not rebuild the schedule when a source fails to play', () => {
    const channel = ch(301)
    const when = at('2026-09-26', '12:00')
    const first = broadcast(channel, when)
    resolveSource(first.current.programme, 'video')
    const compiled = directorStats.compiles
    const second = broadcast(channel, when)
    expect(directorStats.compiles).toBe(compiled)
    expect(second.current.programme.id).toBe(first.current.programme.id)
    expect(second.current.startMs).toBe(first.current.startMs)
  })

  it('drops old cache dates and can invalidate a range', () => {
    expect(retained('2026-09-25', '2026-09-26')).toBe(true)
    expect(retained('2026-08-01', '2026-09-26')).toBe(false)
    getSchedule(ch(301), '2026-09-26')
    getSchedule(ch(301), '2026-09-27')
    invalidateScheduleRange(301, '2026-09-26', '2026-09-27')
    expect(directorStats.compiles).toBe(2)
    getSchedule(ch(301), '2026-09-26')
    expect(directorStats.compiles).toBe(3)
  })

  it('keeps official news and railcams as policy structure only', () => {
    expect(policyFor(920)).toBeUndefined()
    expect(RAILCAM_BLOCKS[0]?.title).toBe('MORNING RAILCAMS')
    const schedule = compileDay({
      channel: ch(920),
      broadcastDate: '2026-09-26',
      policy: newsPolicy(920),
      library: [],
    })
    expect(schedule.blocks).toHaveLength(1)
    expect(schedule.blocks[0]?.title).toBe('LIVE SERVICE')
    expect(schedule.blocks[0]?.eventHook).toBe('live-service')
    const snap = broadcast(ch(920), at('2026-09-26', '12:00'))
    expect(snap.epochMs).toBe(SCHEDULE_EPOCH_MS)
  })

  it('compiles representative days quickly', () => {
    const noon = at('2026-09-26', '12:00')
    const one = performance.now()
    broadcast(ch(301), noon)
    const currentMs = performance.now() - one
    const full = performance.now()
    getSchedule(ch(544), '2026-09-26')
    const fullMs = performance.now() - full
    const visibleStarted = performance.now()
    for (const number of [61, 103, 140, 301, 400, 544, 850, 960]) {
      guideSlots(ch(number), noon - 2 * 60 * 60 * 1000, noon + 8 * 60 * 60 * 1000)
    }
    const visibleMs = performance.now() - visibleStarted
    const hitStarted = performance.now()
    getSchedule(ch(301), '2026-09-26')
    const hitMs = performance.now() - hitStarted
    console.log(
      `DIRECTOR_BENCH ${JSON.stringify({
        currentMs: Number(currentMs.toFixed(2)),
        fullMs: Number(fullMs.toFixed(2)),
        visibleMs: Number(visibleMs.toFixed(2)),
        hitMs: Number(hitMs.toFixed(2)),
        materialised: directorStats.materialised,
        lazy: directorStats.lazyCompiles,
      })}`,
    )
    expect(currentMs).toBeLessThan(250)
    expect(fullMs).toBeLessThan(250)
    expect(visibleMs).toBeLessThan(2000)
    expect(directorStats.materialised).toBeLessThan(40)
  })
})
