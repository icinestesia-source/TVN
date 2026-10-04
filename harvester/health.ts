import { shippedChannel, shippedProgrammes } from '../src/data/catalogue.ts'
import { overrideRecord, overridesFromExport, type CentralOverride } from '../src/services/central-curation.ts'
import { eligibleOf } from '../src/services/channel-curation.ts'
import { channelsFromSources, type ImportedVideo, type StoredSource } from '../src/services/channels-import.ts'
import type { ExportChannel, UserNetworkExport } from '../src/services/user-network-export.ts'
import { channelSource } from '../src/services/user-network-restore.ts'
import type { HealthThresholds } from './config.ts'
import { channelExport, masterRest, userRecords } from './corpus.ts'
import { transaction, type Db } from './db.ts'

export const HEALTH_CLASSES = ['EMPTY', 'BROKEN SOURCE', 'THIN', 'FAIR', 'HEALTHY'] as const
export type HealthClass = (typeof HEALTH_CLASSES)[number]

export interface ChannelHealth {
  number: number
  name: string
  scope: 'user' | 'central'
  key: string
  class: HealthClass
  sourcesConfigured: number
  sourcesEnabled: number
  /** Everything the enabled sources hold and could play (not marked unavailable). */
  available: number
  /** Available programmes the channel's rules admit, held-back ones included. */
  eligible: number
  filteredOut: number
  /** What the saved schedule airs now: running order and schedule size as the curator left them. */
  scheduled: number
  /** Eligible, not unavailable; with TVN's own programming where it is switched on. */
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
  tvnProgrammes: number
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

function scheduledIds(record: StoredSource): Set<string> {
  const lists = [...channelsFromSources([record]).programmes.values()]
  return new Set(lists.flat().flatMap((programme) => (programme.videoId ? [programme.videoId] : [])))
}

/** Every channel's health from the working database as it is now, stored for reports and the Source Desk. */
export function computeHealth(db: Db, thresholds: HealthThresholds, now: Date = new Date()): ChannelHealth[] {
  const rest = masterRest(db)
  const latestRun = (db.prepare('SELECT MAX(id) AS id FROM runs').get() as { id: number | null }).id
  const channels = db.prepare('SELECT id, key, scope, number, name FROM channels ORDER BY number').all() as unknown as { id: number; key: string; scope: 'user' | 'central'; number: number; name: string }[]
  const sourceStates = db.prepare('SELECT id, position, enabled, reader, failures, refused, last_success_at, last_attempt_at FROM sources WHERE channel_id = ? ORDER BY position')
  const unavailable = db.prepare("SELECT video_id FROM programmes WHERE source_id = ? AND playability = 'unavailable'")
  const added = db.prepare("SELECT COUNT(*) AS n FROM changes WHERE run_id = ? AND channel_id = ? AND kind = 'added'")
  const out: ChannelHealth[] = []
  for (const row of channels) {
    const exported = channelExport(db, row.id)
    const states = sourceStates.all(row.id) as unknown as SourceState[]
    // A restore reads podcasts again, so TVN's conversion leaves their pool out; the corpus holds it.
    const sources = exported.sources.map((source, index) => {
      const made = channelSource(source, index)
      return made.kind === 'podcast' && (made.videos?.length ?? 0) === 0 && source.videos ? { ...made, videos: source.videos as ImportedVideo[] } : made
    })
    let record: StoredSource
    let excludedIds = new Set<string>()
    let tvnOn = false
    if (row.scope === 'central') {
      const override = exported as CentralOverride
      const [edit] = overridesFromExport({ format: 'tvn-central-overrides-v1', overrides: [override] })
      record = { ...overrideRecord(edit), ...(edit.order ? { runningOrder: edit.order } : {}), ...(edit.scheduleSize !== undefined ? { scheduleSize: edit.scheduleSize } : {}) }
      excludedIds = new Set(override.excluded ?? [])
      tvnOn = override.sources.some((source) => source.sourceType === 'tvn' && source.enabled)
    } else {
      const network = { ...(rest.userNetwork as Omit<UserNetworkExport, 'channels'>), channels: [exported as ExportChannel] }
      record = userRecords(network, now)[0]
    }
    const dead = new Set<string>()
    const held = new Set<string>()
    const available = new Map<string, { durationSec: number; published?: string }>()
    const eligible = new Map<string, number>()
    const owners = new Map<string, number>()
    const eligibleBySource = new Map<number, Set<string>>()
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
        eligible.set(video.id, video.durationSec)
        mine.add(video.id)
      }
      eligibleBySource.set(index, mine)
    })
    let tvnProgrammes = 0
    let tvnSeconds = 0
    if (tvnOn) {
      const shipped = shippedChannel(row.number)
      for (const programme of shipped ? shippedProgrammes(shipped.id) : []) {
        if (excludedIds.has(programme.id) || (programme.videoId && excludedIds.has(programme.videoId))) continue
        tvnProgrammes += 1
        tvnSeconds += programme.durationSeconds
      }
    }
    const enabledStates = states.filter((state) => state.enabled)
    const broken = enabledStates.filter((state) => state.reader !== 'none' && state.failures >= thresholds.brokenAfterFailures)
    const brokenIds = new Set(broken.flatMap((state) => [...(eligibleBySource.get(state.position) ?? [])]))
    const playable = eligible.size + tvnProgrammes
    const seconds = [...eligible.values()].reduce((sum, value) => sum + value, 0) + tvnSeconds
    const hours = Math.round((seconds / 3600) * 10) / 10
    const knownDates = [...available.values()].filter((video) => video.published).length
    const latest = (field: 'last_success_at' | 'last_attempt_at') => states.map((state) => state[field]).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null
    const metrics: Omit<ChannelHealth, 'class'> = {
      number: row.number,
      name: row.name,
      scope: row.scope,
      key: row.key,
      sourcesConfigured: states.length,
      sourcesEnabled: enabledStates.length,
      available: available.size,
      eligible: eligible.size,
      filteredOut: Math.max(0, available.size - eligible.size),
      scheduled: [...scheduledIds(record)].filter((id) => !dead.has(id) && !excludedIds.has(id)).length + tvnProgrammes,
      playable,
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
      tvnProgrammes,
      lastSuccess: latest('last_success_at'),
      lastAttempt: latest('last_attempt_at'),
    }
    const share = eligible.size > 0 ? brokenIds.size / eligible.size : broken.length > 0 ? 1 : 0
    out.push({ ...metrics, class: classify(metrics, share, broken.length, thresholds) })
  }
  transaction(db, () => {
    const save = db.prepare('INSERT INTO health (channel_id, computed_at, class, metrics) VALUES ((SELECT id FROM channels WHERE key = ?), ?, ?, ?) ON CONFLICT (channel_id) DO UPDATE SET computed_at = excluded.computed_at, class = excluded.class, metrics = excluded.metrics')
    for (const item of out) save.run(item.key, now.toISOString(), item.class, JSON.stringify(item))
  })
  return out
}

/** The Source Desk's order: the channels most in need first, then by number. */
export function deskQueue(health: readonly ChannelHealth[]): ChannelHealth[] {
  return [...health].sort((a, b) => HEALTH_CLASSES.indexOf(a.class) - HEALTH_CLASSES.indexOf(b.class) || a.number - b.number)
}

export function healthSummary(health: readonly ChannelHealth[]): Record<HealthClass, number> {
  const counts = Object.fromEntries(HEALTH_CLASSES.map((name) => [name, 0])) as Record<HealthClass, number>
  for (const item of health) counts[item.class] += 1
  return counts
}

/** Programmes held by more than one channel, by provider identity. Reported only; nothing is merged. */
export function crossChannelDuplicates(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM (SELECT p.video_id FROM programmes p JOIN sources s ON s.id = p.source_id WHERE s.enabled = 1 GROUP BY p.video_id HAVING COUNT(DISTINCT s.channel_id) > 1)').get() as { n: number }).n
}
