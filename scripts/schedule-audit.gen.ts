// Compiles seven consecutive Director days for every channel 000–999 (as a returning viewer's cache would)
// and writes docs/schedule-audit-v43.{json,md}: where the hours go, and how often programmes repeat.
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { channelByNumber } from '../src/data/catalogue.ts'
import { getSchedule, resetDirector } from '../src/director/director.ts'
import { setMediaLibrary } from '../src/director/library.ts'
import { CATALOGUE_VERSION } from '../src/director/network.ts'
import { policyFor } from '../src/director/policies.ts'
import { ruleFor } from '../src/director/repeat.ts'
import { addCalendarDays } from '../src/director/time.ts'
import { DYNAMIC_VERSION, dynamicChannel, liveEndpoint } from '../src/dynamic/providers.ts'
import { expandPlayableCatalogue } from '../src/library/playable-catalogue.ts'
import { originalCard, originalFormat, originalSeconds } from '../src/originals/originals.ts'
import { mediaLibrary } from '../src/director/library.ts'

const START = '2026-09-28'
const DAYS = 7
const round = (hours: number) => Math.round(hours * 100) / 100

interface ManifestRow { number: number; status: string; hours: number }

it('writes the schedule audit', () => {
  const items = expandPlayableCatalogue(JSON.parse(readFileSync('public/independent/playable.json', 'utf8')))
  resetDirector()
  setMediaLibrary(items)
  const manifest = new Map((JSON.parse(readFileSync('docs/channel-manifest.json', 'utf8')).records as ManifestRow[]).map((row) => [row.number, row]))
  const totals = { airable: 0, liveStandby: 0, deliberateHold: 0, card: 0, genuineFallback: 0, original: 0, originalOffAir: 0, noDirector: 0 }
  const channels = []
  const fallbackRows = []
  const repeatRows = []
  for (let n = 0; n <= 999; n += 1) {
    const channel = channelByNumber(n)
    if (!channel) continue
    const status = manifest.get(n)?.status ?? 'ABSENT'
    const format = originalFormat(n)
    if (format) {
      // Originals intercept broadcast(); their Director days are never compiled.
      const seconds = format.kind === 'night-block' ? Math.min(4 * 3600, originalSeconds(n, mediaLibrary())) : 24 * 3600
      totals.original += (seconds / 3600) * DAYS
      totals.originalOffAir += ((24 * 3600 - seconds) / 3600) * DAYS
      channels.push({ number: n, name: channel.name, status, kind: `original:${format.kind}` })
      continue
    }
    const policy = policyFor(n)
    if (!policy) {
      totals.noDirector += 24 * DAYS
      channels.push({ number: n, name: channel.name, status, kind: 'clock-scheduler' })
      continue
    }
    const card = originalCard(n)
    const live = Boolean(liveEndpoint(n))
    const hours = { airable: 0, liveStandby: 0, deliberateHold: 0, card: 0, genuineFallback: 0, exhaustedRepeats: 0 }
    const placements: { id: string; day: number; type: string }[] = []
    for (let d = 0; d < DAYS; d += 1) {
      const schedule = getSchedule(channel, addCalendarDays(START, d))
      const template = new Map(Object.values(policy.dayTemplates).flatMap((day) => day?.blocks ?? []).map((block) => [block.id, block]))
      for (const block of schedule.blocks) {
        const hold = template.get(block.id)?.strategy === 'hold'
        for (const child of block.children) {
          const h = (child.endMs - child.startMs) / 3_600_000
          if (child.videoId && !child.fallback) {
            if (live) hours.liveStandby += h
            else hours.airable += h
            if (child.mediaItemId) placements.push({ id: child.mediaItemId, day: d, type: child.programmeType })
            if (child.penalties?.includes('exhausted-repeat')) hours.exhaustedRepeats += 1
          } else if (live) hours.liveStandby += h
          else if (card) hours.card += h
          else if (hold) hours.deliberateHold += h
          else hours.genuineFallback += h
        }
      }
    }
    totals.airable += hours.airable
    totals.liveStandby += hours.liveStandby
    totals.deliberateHold += hours.deliberateHold
    totals.card += hours.card
    totals.genuineFallback += hours.genuineFallback
    const window = (days: number) => {
      const inside = placements.filter((entry) => entry.day < days)
      const counts = new Map<string, number>()
      for (const entry of inside) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1)
      const unique = counts.size
      return { placements: inside.length, unique, repeatRatio: inside.length ? round(1 - unique / inside.length) : 0, maxAirings: Math.max(0, ...counts.values()) }
    }
    const poolHours = manifest.get(n)?.hours ?? 0
    const w7 = window(7)
    const films = placements.filter((entry) => ruleFor(entry.type as never, policy.typeRepeats).maxBroadcasts7d <= 1)
    const filmCounts = new Map<string, number>()
    for (const entry of films) filmCounts.set(entry.id, (filmCounts.get(entry.id) ?? 0) + 1)
    const hardRepeatBreaches = [...filmCounts.values()].filter((count) => count > 1).length
    const cause = live
      ? 'live channel (Director day is standby only)'
      : dynamicChannel(n)
        ? 'rolling window'
        : card
          ? 'carded channel'
          : poolHours < 24
            ? 'tiny catalogue (under one day of material)'
            : poolHours < 24 * DAYS && w7.repeatRatio > 0
              ? 'catalogue under a week of material'
              : w7.repeatRatio > 0.5
                ? 'SCHEDULER: repeats despite a week of material'
                : 'ok'
    repeatRows.push({ number: n, name: channel.name, status, poolHours, d2: window(2), d3: window(3), d7: w7, hardRepeatBreaches, exhaustedRepeatPlacements: hours.exhaustedRepeats, cause })
    const perDay = Object.fromEntries(Object.entries(hours).map(([key, value]) => [key, key === 'exhaustedRepeats' ? value : round(value / DAYS)]))
    fallbackRows.push({ number: n, name: channel.name, status, ...perDay })
    channels.push({ number: n, name: channel.name, status, kind: live ? 'live' : dynamicChannel(n) ? 'rolling' : 'director' })
  }
  const perDayTotals = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round(value / DAYS)]))
  const genuine = fallbackRows.filter((row) => Number(row.genuineFallback) > 0).sort((a, b) => Number(b.genuineFallback) - Number(a.genuineFallback))
  const onAirGenuine = genuine.filter((row) => ['PLAYABLE', 'PLAYABLE_STRONG'].includes(row.status))
  const causes = repeatRows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.cause]: (acc[row.cause] ?? 0) + 1 }), {})
  const out = {
    format: 'retrotv-schedule-audit',
    catalogue: CATALOGUE_VERSION,
    dynamic: DYNAMIC_VERSION,
    start: START,
    days: DAYS,
    hoursPerDay: perDayTotals,
    genuineFallbackChannels: genuine.length,
    genuineFallbackOnAirChannels: onAirGenuine.length,
    repeatCauses: causes,
    hardRepeatBreaches: repeatRows.reduce((sum, row) => sum + row.hardRepeatBreaches, 0),
    fallback: fallbackRows,
    repeats: repeatRows,
  }
  writeFileSync('docs/schedule-audit-v43.json', JSON.stringify(out, null, 1) + '\n')
  const md = [
    '# Schedule audit — fallback hours and repeats',
    '',
    `Catalogue ${CATALOGUE_VERSION}, dynamic ${DYNAMIC_VERSION}. Seven consecutive days from ${START} compiled per channel with each day's history, as a returning viewer's cache builds it.`,
    '',
    '## Network hours per day',
    '',
    '| Category | Hours per day | Meaning |',
    '|---|---|---|',
    `| Airable | ${perDayTotals.airable} | Real programmes on Director channels |`,
    `| Live standby | ${perDayTotals.liveStandby} | Director day of a live channel; airs only while the stream is down |`,
    `| RetroTV originals | ${perDayTotals.original} | Test card, clock, listings, closedown and night-block time |`,
    `| Original off-air | ${perDayTotals.originalOffAir} | Night Network outside 00:00–04:00 (deliberate card) |`,
    `| Card | ${perDayTotals.card} | Blocked, unavailable or unresolved channels showing their card |`,
    `| Deliberate hold | ${perDayTotals.deliberateHold} | Policy blocks whose strategy is hold |`,
    `| Genuine fallback | ${perDayTotals.genuineFallback} | Holding time on a programmed channel where nothing fits |`,
    `| Clock scheduler | ${perDayTotals.noDirector} | Channels without a policy (slates or catalogue loops) |`,
    '',
    `Genuine fallback on ${genuine.length} channels, ${onAirGenuine.length} of them PLAYABLE or PLAYABLE_STRONG. Hard once-a-week repeat breaches: ${out.hardRepeatBreaches}.`,
    '',
    '## Genuine fallback by channel (hours per day)',
    '',
    '| # | Channel | Status | Genuine | Airable |',
    '|---|---|---|---|---|',
    ...genuine.map((row) => `| ${String(row.number).padStart(3, '0')} | ${row.name} | ${row.status} | ${row.genuineFallback} | ${row.airable} |`),
    '',
    '## Repeat causes (7 days)',
    '',
    '| Cause | Channels |',
    '|---|---|',
    ...Object.entries(causes).sort().map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Highest 7-day repeat ratios',
    '',
    '| # | Channel | Pool hours | 2-day | 3-day | 7-day | Max airings of one item | Cause |',
    '|---|---|---|---|---|---|---|---|',
    ...[...repeatRows].sort((a, b) => b.d7.repeatRatio - a.d7.repeatRatio).slice(0, 60).map((row) => `| ${String(row.number).padStart(3, '0')} | ${row.name} | ${row.poolHours} | ${row.d2.repeatRatio} | ${row.d3.repeatRatio} | ${row.d7.repeatRatio} | ${row.d7.maxAirings} | ${row.cause} |`),
  ]
  writeFileSync('docs/schedule-audit-v43.md', md.join('\n') + '\n')
  expect(out.hardRepeatBreaches).toBe(0)
}, 1_800_000)
