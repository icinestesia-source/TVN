// Walks every channel 000–999 through broadcast() and guideSlots() across a whole day and writes
// docs/runtime-audit-v43.{json,md}: what each channel actually shows against what the manifest declares.
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { channelByNumber } from '../src/data/catalogue.ts'
import { resetDirector } from '../src/director/director.ts'
import { setMediaLibrary } from '../src/director/library.ts'
import { CATALOGUE_VERSION } from '../src/director/network.ts'
import { DYNAMIC_VERSION, dynamicChannel, liveEndpoint } from '../src/dynamic/providers.ts'
import { markLiveUnavailable, resetLiveState } from '../src/dynamic/runtime.ts'
import { expandPlayableCatalogue } from '../src/library/playable-catalogue.ts'
import { originalCard, originalFormat, STATUS_CARD_CLASSES } from '../src/originals/originals.ts'
import { broadcast, guideSlots } from '../src/services/broadcast.ts'
import type { Programme } from '../src/types/programme.ts'

const DATE = '2026-09-28'
const at = (hour: number, minute = 23) => new Date(`${DATE}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+01:00`).getTime()
const STAMPS = Array.from({ length: 24 }, (_, hour) => at(hour))
const SAMPLE = at(11)
/** Sampled hours of holding slate a real channel may show (end-of-day tails before the hard 06:00 boundary). */
const MAX_HOLDING_HOURS = 2

type Runtime =
  | 'LIVE'
  | 'REAL_STATIC'
  | 'REAL_DYNAMIC'
  | 'RETROTV_ORIGINAL'
  | 'GENERATED'
  | 'RIGHTS_BLOCKED'
  | 'INTENTIONALLY_UNAVAILABLE'
  | 'EXPLICIT_BLOCKER'
  | 'PARTIAL'
  | 'HOLDING'
  | 'BLANK'
  | 'NOT_A_CHANNEL'

/** Runtime results each declared manifest status may legitimately produce. */
const EXPECTED: Record<string, Runtime[]> = {
  PLAYABLE_STRONG: ['REAL_STATIC', 'REAL_DYNAMIC', 'LIVE'],
  PLAYABLE: ['REAL_STATIC', 'REAL_DYNAMIC', 'LIVE'],
  PLAYABLE_THIN: ['REAL_STATIC', 'REAL_DYNAMIC', 'PARTIAL', 'EXPLICIT_BLOCKER'],
  GENERATED: ['GENERATED'],
  RETROTV_ORIGINAL: ['RETROTV_ORIGINAL'],
  NEEDS_CONTENT: ['RIGHTS_BLOCKED', 'EXPLICIT_BLOCKER'],
  NEEDS_LIVE_PROVIDER: ['EXPLICIT_BLOCKER'],
  NEEDS_AUDIO_PROVIDER: ['EXPLICIT_BLOCKER'],
  DELIBERATELY_UNAVAILABLE: ['INTENTIONALLY_UNAVAILABLE'],
  EXCLUDED: ['INTENTIONALLY_UNAVAILABLE'],
}

interface ManifestRow { number: number; name: string; status: string; reason: string }

it('writes the 000–999 runtime audit', () => {
  const doc = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))
  const items = expandPlayableCatalogue(doc)
  resetDirector()
  setMediaLibrary(items)
  const byVideo = new Map(items.map((item) => [item.externalId, item]))
  const manifest = new Map((JSON.parse(readFileSync('docs/channel-manifest.json', 'utf8')).records as ManifestRow[]).map((row) => [row.number, row]))
  const rows = []
  const discrepancies = []
  for (let n = 0; n <= 999; n += 1) {
    const channel = channelByNumber(n)
    const declared = manifest.get(n)
    if (!channel) {
      // A number with no channel is only right when nothing is declared there, or the declaration says the
      // number is closed (EXCLUDED) or deliberately unavailable (the reserved 000).
      const matches = !declared || declared.status === 'EXCLUDED' || declared.status === 'DELIBERATELY_UNAVAILABLE'
      const row = { number: n, name: declared?.name ?? '', configured: declared?.status ?? 'ABSENT', runtime: 'NOT_A_CHANNEL' as Runtime, matches }
      rows.push(row)
      if (!matches) discrepancies.push({ number: n, name: row.name, configured: row.configured, runtime: row.runtime, unexpectedFallback: false, guideAgrees: true, cardHours: 0 })
      continue
    }
    resetLiveState()
    const day: Programme[] = STAMPS.map((t) => broadcast(channel, t).current.programme)
    const pictured = day.filter((p) => p.videoId)
    const live = day.some((p) => p.playback === 'live')
    const card = originalCard(n)
    const format = originalFormat(n)
    // Caption-less pictureless segments are the "programming resumes soon" holding slate: nothing in the
    // pool fits before a hard boundary. A blank is a programme with no title or no duration at all.
    const holding = day.filter((p) => !p.videoId && !p.caption)
    const blank = day.some((p) => !p.title?.trim() || !(p.durationSeconds > 0))
    let runtime: Runtime
    if (blank) runtime = 'BLANK'
    else if (format?.kind === 'night-block') runtime = broadcast(channel, at(1, 30)).current.programme.videoId && day.every((p) => p.videoId || p.caption) ? 'RETROTV_ORIGINAL' : 'HOLDING'
    else if (format) runtime = 'GENERATED'
    else if (live) runtime = 'LIVE'
    else if (pictured.length > 0 && pictured.length + holding.length === day.length && holding.length <= MAX_HOLDING_HOURS) runtime = dynamicChannel(n) ? 'REAL_DYNAMIC' : 'REAL_STATIC'
    else if (holding.length === day.length) runtime = 'HOLDING'
    else if (pictured.length > 0) runtime = 'PARTIAL'
    else if (card?.class === 'RIGHTS_BLOCKED') runtime = 'RIGHTS_BLOCKED'
    else if (card?.class === 'INTENTIONALLY_UNAVAILABLE' || declared?.status === 'DELIBERATELY_UNAVAILABLE' || declared?.status === 'EXCLUDED') runtime = 'INTENTIONALLY_UNAVAILABLE'
    else runtime = 'EXPLICIT_BLOCKER'

    const now = broadcast(channel, SAMPLE)
    const programme = now.current.programme
    const slot = guideSlots(channel, SAMPLE - 60_000, SAMPLE + 60_000).find((entry) => entry.startMs <= SAMPLE && SAMPLE < entry.endMs)
    // A block with nothing playable is one guide cell over the player's holding segments; it must say the same thing.
    const collapsed = Boolean(slot && !programme.videoId && !slot.programme.videoId && slot.programme.blockId === programme.blockId && slot.programme.title === programme.title && slot.programme.caption === programme.caption && slot.startMs <= now.current.startMs && now.current.endMs <= slot.endMs)
    const guideAgrees = collapsed || (slot?.programme.id === programme.id && slot.startMs === now.current.startMs && slot.endMs === now.current.endMs)
    let liveFailure: { title: string; caption?: string; playable: boolean } | undefined
    const endpoint = liveEndpoint(n)
    if (endpoint) {
      markLiveUnavailable(endpoint.videoId, SAMPLE, n)
      const fallback = broadcast(channel, SAMPLE + 1000).current.programme
      liveFailure = { title: fallback.title, caption: fallback.caption, playable: Boolean(fallback.videoId) }
      resetLiveState()
    }
    const unexpectedFallback = ['PLAYABLE', 'PLAYABLE_STRONG'].includes(declared?.status ?? '') && pictured.length + holding.length < day.length && !live
    const matches = (EXPECTED[declared?.status ?? ''] ?? []).includes(runtime) && !unexpectedFallback && guideAgrees
    const source = programme.videoId ? byVideo.get(programme.videoId)?.sourceId ?? (programme.playback === 'live' ? `live:${endpoint?.provider ?? 'configured'}` : 'unknown') : null
    const row = {
      number: n,
      name: channel.name,
      configured: declared?.status ?? 'ABSENT',
      runtime,
      title: programme.title,
      caption: programme.caption,
      type: programme.programmeType,
      source,
      startMs: now.current.startMs,
      endMs: now.current.endMs,
      playable: Boolean(programme.videoId),
      live,
      dynamic: Boolean(dynamicChannel(n)),
      generated: runtime === 'GENERATED',
      original: runtime === 'RETROTV_ORIGINAL',
      unavailable: runtime === 'INTENTIONALLY_UNAVAILABLE',
      rightsBlocked: runtime === 'RIGHTS_BLOCKED',
      statusCard: card && STATUS_CARD_CLASSES.has(card.class) ? card.class : undefined,
      presentationCard: card && !STATUS_CARD_CLASSES.has(card.class) ? card.class : undefined,
      pictureHours: pictured.length,
      holdingHours: holding.length,
      unexpectedFallback,
      guideAgrees,
      liveFailure,
      matches,
    }
    rows.push(row)
    if (!matches) discrepancies.push({ number: n, name: channel.name, configured: row.configured, runtime, unexpectedFallback, guideAgrees, cardHours: day.length - pictured.length })
  }
  const counts = (key: 'runtime' | 'configured') => Object.fromEntries(Object.entries(rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row[key]]: (acc[row[key]] ?? 0) + 1 }), {})).sort())
  const blanks = rows.filter((row) => row.runtime === 'BLANK')
  const holdingRows = rows.filter((row) => 'holdingHours' in row && row.holdingHours > 0)
  const out = {
    format: 'retrotv-runtime-audit',
    catalogue: CATALOGUE_VERSION,
    dynamic: DYNAMIC_VERSION,
    date: DATE,
    sampledAt: new Date(SAMPLE).toISOString(),
    stamps: STAMPS.length,
    runtime: counts('runtime'),
    configured: counts('configured'),
    blanks: blanks.map((row) => row.number),
    holding: holdingRows.map((row) => [row.number, 'holdingHours' in row ? row.holdingHours : 0]),
    discrepancies,
    rows,
  }
  writeFileSync('docs/runtime-audit-v43.json', JSON.stringify(out, null, 1) + '\n')
  const cell = (text: unknown) => String(text ?? '').replace(/\|/g, '/')
  const md = [
    '# Runtime audit — channels 000–999',
    '',
    `Catalogue ${CATALOGUE_VERSION}, dynamic ${DYNAMIC_VERSION}. Every channel sampled through broadcast() at ${STAMPS.length} hourly instants on ${DATE} (Europe/London); the row shows 11:23. Live channels also sampled with their stream marked failed.`,
    '',
    `Accidental blanks: ${blanks.length}. Declared-versus-runtime discrepancies: ${discrepancies.length}.`,
    '',
    `Holding slate ("programming resumes soon", next programme time shown) at a sampled hour: ${holdingRows.length} channels, ${holdingRows.reduce((sum, row) => sum + ('holdingHours' in row ? row.holdingHours : 0), 0)} channel-hours of ${rows.filter((row) => 'holdingHours' in row).length * STAMPS.length} sampled. Each is the end-of-day tail where nothing left in the pool fits before the hard 06:00 boundary; docs/schedule-audit-v43.md accounts the exact fallback hours.`,
    '',
    '## Runtime results',
    '',
    '| Result | Channels |',
    '|---|---|',
    ...Object.entries(out.runtime).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Discrepancies',
    '',
    ...(discrepancies.length ? ['| # | Channel | Declared | Runtime | Card hours | Guide agrees |', '|---|---|---|---|---|---|', ...discrepancies.map((d) => `| ${String(d.number).padStart(3, '0')} | ${cell(d.name)} | ${d.configured} | ${d.runtime} | ${d.cardHours} | ${d.guideAgrees} |`)] : ['None.']),
    '',
    '## All channels',
    '',
    '| # | Channel | Declared | Runtime | Now (11:23) | Source | Live | Dynamic | Picture hours / 24 | Guide | Live failure shows |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => 'title' in r
      ? `| ${String(r.number).padStart(3, '0')} | ${cell(r.name)} | ${r.configured} | ${r.runtime} | ${cell(r.title?.slice(0, 60))}${r.caption ? ` — ${cell(r.caption)}` : ''} | ${cell(r.source ?? '—')} | ${r.live ? 'yes' : ''} | ${r.dynamic ? 'yes' : ''} | ${r.pictureHours} | ${r.guideAgrees ? 'ok' : 'MISMATCH'} | ${r.liveFailure ? cell(r.liveFailure.caption ?? r.liveFailure.title) : ''} |`
      : `| ${String(r.number).padStart(3, '0')} | ${cell(r.name)} | ${r.configured} | ${r.runtime} | | | | | | | |`),
  ]
  writeFileSync('docs/runtime-audit-v43.md', md.join('\n') + '\n')
  expect(rows).toHaveLength(1000)
  expect(blanks).toEqual([])
}, 900_000)
