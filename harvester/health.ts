import { overrideRecord, overridesFromExport, type CentralOverride } from '../src/services/central-curation.ts'
import { eligibleOf } from '../src/services/channel-curation.ts'
import { channelsFromSources, type ImportedVideo, type StoredSource } from '../src/services/channels-import.ts'
import type { ExportChannel, UserNetworkExport } from '../src/services/user-network-export.ts'
import { channelSource } from '../src/services/user-network-restore.ts'
import { excludedProgramme } from '../src/library/exclusions.ts'
import type { HealthThresholds } from './config.ts'
import { channelExport, masterRest, userRecords } from './corpus.ts'
import { transaction, type Db } from './db.ts'

export const HEALTH_CLASSES = ['EMPTY', 'BROKEN SOURCE', 'THIN', 'FAIR', 'HEALTHY'] as const
export type HealthClass = (typeof HEALTH_CLASSES)[number]

/** Why a channel needs a person rather than AUTO: never an error, just what the corpus is. */
export type SourceGap = 'NO REFRESHABLE SOURCE' | 'SHIPPED POOL ONLY' | 'NEEDS SOURCE DESK'

export interface ChannelHealth {
  number: number
  name: string
  scope: 'user' | 'central'
  layer: 'master' | 'shipped'
  key: string
  stableId: string | null
  class: HealthClass
  gap: SourceGap | null
  sourcesConfigured: number
  sourcesEnabled: number
  /** Enabled sources Harvester can read again. */
  sourcesRefreshable: number
  /** Distinct creators among the enabled sources' eligible programmes (the source itself where a programme names none). */
  creators: number
  /** The creator supplying most eligible programmes, and their share of them (0–100). */
  topCreator: string | null
  topCreatorShare: number
  /** Everything the enabled sources hold and could play (not marked unavailable). */
  available: number
  /** Available programmes the channel's rules admit, held-back ones included; on 001–999, TVN's default exclusions apply. */
  eligible: number
  filteredOut: number
  /** On 001–999: programmes TVN's default editorial exclusions keep off (factual space, aviation, religion). */
  editorialExcluded: number
  /** What the saved schedule airs now: running order and schedule size as the curator left them. */
  scheduled: number
  /** Eligible, not unavailable. */
  playable: number
  hours: number
  knownDates: number
  unknownDates: number
  knownDatePct: number
  /** Held back from the schedule (loaded, not yet admitted), and programmes the curator left out. */
  held: number
  excluded: number
  /** Marked unavailable, plus videos the provider refused for embedding at the last read. */
  deadRefused: number
  /** Programmes held by more than one of the channel's enabled sources. */
  duplicates: number
  /** Added by the latest run. */
  newLatestRun: number
  brokenSources: number
  /** Programmes by where they came from. */
  shipped: number
  fromMaster: number
  fromAuto: number
  fromDesk: number
  lastSuccess: string | null
  lastAttempt: string | null
}

interface SourceState {
  id: number
  position: number
  enabled: number
  reader: string
  failures: number
  refused: number | null
  last_success_at: string | null
  last_attempt_at: string | null
}

/** The class from the numbers, against the configured thresholds. A broken source outranks thinness. */
export function classify(metrics: Pick<ChannelHealth, 'playable' | 'hours'>, brokenShare: number, brokenSources: number, thresholds: HealthThresholds): HealthClass {
  if (brokenSources > 0 && (metrics.playable === 0 || brokenShare >= thresholds.brokenShare)) return 'BROKEN SOURCE'
  if (metrics.playable === 0) return 'EMPTY'
  if (metrics.playable < thresholds.thinProgrammes || metrics.hours < thresholds.thinHours) return 'THIN'
  if (metrics.playable < thresholds.fairProgrammes || metrics.hours < thresholds.fairHours) return 'FAIR'
  return 'HEALTHY'
}

export function sourceGap(metrics: Pick<ChannelHealth, 'sourcesRefreshable' | 'shipped' | 'available' | 'class'>): SourceGap | null {
  if (metrics.sourcesRefreshable === 0) return metrics.shipped > 0 && metrics.shipped === metrics.available ? 'SHIPPED POOL ONLY' : 'NO REFRESHABLE SOURCE'
  return metrics.class === 'EMPTY' || metrics.class === 'THIN' || metrics.class === 'BROKEN SOURCE' ? 'NEEDS SOURCE DESK' : null
}

function scheduledIds(record: StoredSource): Set<string> {
  const lists = [...channelsFromSources([record]).programmes.values()]
  return new Set(lists.flat().flatMap((programme) => (programme.videoId ? [programme.videoId] : [])))
}

interface ChannelRow {
  id: number
  key: string
  scope: 'user' | 'central'
  layer: 'master' | 'shipped'
  number: number
  name: string
  stable_id: string | null
}

/**
 * Every channel's health (or only the given ones) from the working corpus as it is now, each channel seen
 * with all its layers, stored for reports and the Source Desk.
 */
export function computeHealth(db: Db, thresholds: HealthThresholds, now: Date = new Date(), only?: readonly number[]): ChannelHealth[] {
  const rest = masterRest(db)
  const latestRun = (db.prepare("SELECT MAX(id) AS id FROM runs WHERE kind = 'auto'").get() as { id: number | null }).id
  const all = db.prepare('SELECT id, key, scope, layer, number, name, stable_id FROM channels ORDER BY number, scope').all() as unknown as ChannelRow[]
  const channels = only ? all.filter((row) => only.includes(row.id)) : all
  const sourceStates = db.prepare('SELECT id, position, enabled, reader, failures, refused, last_success_at, last_attempt_at FROM sources WHERE channel_id = ? ORDER BY position')
  const unavailable = db.prepare("SELECT video_id FROM programmes WHERE source_id = ? AND playability = 'unavailable'")
  const byProvenance = db.prepare('SELECT p.provenance, COUNT(DISTINCT p.video_id) AS n FROM programmes p JOIN sources s ON s.id = p.source_id WHERE s.channel_id = ? AND s.enabled = 1 GROUP BY p.provenance')
  const added = db.prepare("SELECT COUNT(*) AS n FROM changes WHERE run_id = ? AND channel_id = ? AND kind = 'added'")
  const out: ChannelHealth[] = []
  for (const row of channels) {
    const exported = channelExport(db, row.id, 'effective')
    const states = sourceStates.all(row.id) as unknown as SourceState[]
    // A restore reads podcasts again, so TVN's conversion leaves their pool out; the corpus holds it.
    const sources = exported.sources.map((source, index) => {
      const made = channelSource(source, index)
      return made.kind === 'podcast' && (made.videos?.length ?? 0) === 0 && source.videos ? { ...made, videos: source.videos as ImportedVideo[] } : made
    })
    const central = row.scope === 'central'
    let record: StoredSource
    let excludedIds = new Set<string>()
    if (central && row.layer === 'master') {
      const override = channelExport(db, row.id) as CentralOverride
      const [edit] = overridesFromExport({ format: 'tvn-central-overrides-v1', overrides: [override] })
      record = { ...overrideRecord(edit), channelSources: sources, ...(edit.order ? { runningOrder: edit.order } : {}), ...(edit.scheduleSize !== undefined ? { scheduleSize: edit.scheduleSize } : {}) }
      excludedIds = new Set(override.excluded ?? [])
    } else if (central) {
      record = { id: `tvn-${row.number}`, name: row.name, videos: [], channelNumber: row.number, inLibrary: false, automatic: true, updatedAt: 0, channelSources: sources }
    } else {
      const network = { ...(rest.userNetwork as Omit<UserNetworkExport, 'channels'>), channels: [{ ...(exported as ExportChannel), sources: exported.sources }] }
      record = { ...userRecords(network, now)[0], channelSources: sources }
    }
    const dead = new Set<string>()
    const held = new Set<string>()
    const available = new Map<string, { durationSec: number; published?: string }>()
    const eligible = new Map<string, number>()
    const owners = new Map<string, number>()
    const creators = new Set<string>()
    const creatorCounts = new Map<string, { name: string; n: number }>()
    const eligibleBySource = new Map<number, Set<string>>()
    let editorialExcluded = 0
    sources.forEach((source, index) => {
      const state = states[index]
      if (!source.enabled) return
      for (const { video_id } of unavailable.all(state.id) as { video_id: string }[]) dead.add(video_id)
      for (const video of source.videos ?? []) {
        owners.set(video.id, (owners.get(video.id) ?? 0) + 1)
        if (dead.has(video.id)) continue
        available.set(video.id, { durationSec: video.durationSec, ...(video.published ? { published: video.published } : {}) })
        if (video.pending) held.add(video.id)
      }
      const mine = new Set<string>()
      for (const video of eligibleOf(source)) {
        if (dead.has(video.id) || excludedIds.has(video.id)) continue
        if (central && excludedProgramme({ title: video.title, videoId: video.id })) {
          editorialExcluded += 1
          continue
        }
        if (!eligible.has(video.id)) {
          const key = video.creator?.channelId ?? video.creator?.name ?? `source:${state.id}`
          const count = creatorCounts.get(key)
          creatorCounts.set(key, { name: video.creator?.name ?? source.label ?? key, n: (count?.n ?? 0) + 1 })
        }
        eligible.set(video.id, video.durationSec)
        mine.add(video.id)
        creators.add(video.creator?.channelId ?? video.creator?.name ?? `source:${state.id}`)
      }
      eligibleBySource.set(index, mine)
    })
    const enabledStates = states.filter((state) => state.enabled)
    const broken = enabledStates.filter((state) => state.reader !== 'none' && state.failures >= thresholds.brokenAfterFailures)
    const brokenIds = new Set(broken.flatMap((state) => [...(eligibleBySource.get(states.indexOf(state)) ?? [])]))
    const seconds = [...eligible.values()].reduce((sum, value) => sum + value, 0)
    const hours = Math.round((seconds / 3600) * 10) / 10
    const knownDates = [...available.values()].filter((video) => video.published).length
    const latest = (field: 'last_success_at' | 'last_attempt_at') => states.map((state) => state[field]).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null
    const provenance = Object.fromEntries((byProvenance.all(row.id) as { provenance: string; n: number }[]).map((item) => [item.provenance, item.n]))
    const top = [...creatorCounts.values()].sort((a, b) => b.n - a.n)[0]
    const metrics = {
      number: row.number,
      name: row.name,
      scope: row.scope,
      layer: row.layer,
      key: row.key,
      stableId: row.stable_id,
      sourcesConfigured: states.length,
      sourcesEnabled: enabledStates.length,
      sourcesRefreshable: enabledStates.filter((state) => state.reader !== 'none').length,
      creators: creators.size,
      topCreator: top?.name ?? null,
      topCreatorShare: top && eligible.size > 0 ? Math.round((top.n / eligible.size) * 100) : 0,
      available: available.size,
      eligible: eligible.size,
      filteredOut: Math.max(0, available.size - eligible.size),
      editorialExcluded,
      scheduled: [...scheduledIds(record)].filter((id) => !dead.has(id) && !excludedIds.has(id)).length,
      playable: eligible.size,
      hours,
      knownDates,
      unknownDates: available.size - knownDates,
      knownDatePct: available.size > 0 ? Math.round((knownDates / available.size) * 1000) / 10 : 0,
      held: held.size,
      excluded: excludedIds.size,
      deadRefused: dead.size + enabledStates.reduce((sum, state) => sum + (state.refused ?? 0), 0),
      duplicates: [...owners.values()].filter((count) => count > 1).length,
      newLatestRun: latestRun ? (added.get(latestRun, row.id) as { n: number }).n : 0,
      brokenSources: broken.length,
      shipped: provenance.shipped ?? 0,
      fromMaster: provenance.master ?? 0,
      fromAuto: provenance.auto ?? 0,
      fromDesk: provenance.desk ?? 0,
      lastSuccess: latest('last_success_at'),
      lastAttempt: latest('last_attempt_at'),
    }
    const share = eligible.size > 0 ? brokenIds.size / eligible.size : broken.length > 0 ? 1 : 0
    const healthClass = classify(metrics, share, broken.length, thresholds)
    out.push({ ...metrics, class: healthClass, gap: sourceGap({ ...metrics, class: healthClass }) })
  }
  transaction(db, () => {
    const save = db.prepare('INSERT INTO health (channel_id, computed_at, class, metrics) VALUES ((SELECT id FROM channels WHERE key = ?), ?, ?, ?) ON CONFLICT (channel_id) DO UPDATE SET computed_at = excluded.computed_at, class = excluded.class, metrics = excluded.metrics')
    for (const item of out) save.run(item.key, now.toISOString(), item.class, JSON.stringify(item))
  })
  return out
}

export type Diversity = 'GOOD' | 'MODERATE' | 'LOW'

/** Source diversity, gently: how far one creator carries the channel. Advisory; a single great archive is allowed. */
export function diversityOf(health: Pick<ChannelHealth, 'eligible' | 'creators' | 'topCreatorShare'>): Diversity | null {
  if (health.eligible === 0) return null
  if (health.creators <= 1 || health.topCreatorShare >= 75) return 'LOW'
  return health.topCreatorShare >= 50 ? 'MODERATE' : 'GOOD'
}

/**
 * STRONG CHANNEL: already a deep television channel (healthy, many hours, no broken source, not leaning on
 * one creator), so NEXT is the obvious move. WEAK: thin, fair, broken or without a refreshable source, where
 * DISCOVER SOURCES deserves the operator's attention.
 */
export function deskStanding(health: ChannelHealth | null, strongHours = 100): 'STRONG' | 'WEAK' | 'OK' | null {
  if (!health) return null
  if (health.class !== 'HEALTHY' || health.gap === 'NO REFRESHABLE SOURCE' || health.gap === 'SHIPPED POOL ONLY') return 'WEAK'
  return health.hours >= strongHours && health.brokenSources === 0 && diversityOf(health) !== 'LOW' ? 'STRONG' : 'OK'
}

/** Every channel's last computed health, by number. */
export function storedHealth(db: Db): ChannelHealth[] {
  return (db.prepare('SELECT h.metrics FROM health h JOIN channels c ON c.id = h.channel_id ORDER BY c.number, c.scope').all() as { metrics: string }[]).map((row) => JSON.parse(row.metrics) as ChannelHealth)
}

/** The channels most in need first, then by number. */
export function deskQueue(health: readonly ChannelHealth[]): ChannelHealth[] {
  return [...health].sort((a, b) => HEALTH_CLASSES.indexOf(a.class) - HEALTH_CLASSES.indexOf(b.class) || a.number - b.number)
}

export function healthSummary(health: readonly ChannelHealth[]): Record<HealthClass, number> {
  const counts = Object.fromEntries(HEALTH_CLASSES.map((name) => [name, 0])) as Record<HealthClass, number>
  for (const item of health) counts[item.class] += 1
  return counts
}

export function gapSummary(health: readonly ChannelHealth[]): Record<SourceGap, number> {
  const counts: Record<SourceGap, number> = { 'NO REFRESHABLE SOURCE': 0, 'SHIPPED POOL ONLY': 0, 'NEEDS SOURCE DESK': 0 }
  for (const item of health) if (item.gap) counts[item.gap] += 1
  return counts
}

/** Programmes held by more than one channel, by provider identity. Reported only; nothing is merged. */
export function crossChannelDuplicates(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM (SELECT p.video_id FROM programmes p JOIN sources s ON s.id = p.source_id WHERE s.enabled = 1 GROUP BY p.video_id HAVING COUNT(DISTINCT s.channel_id) > 1)').get() as { n: number }).n
}
