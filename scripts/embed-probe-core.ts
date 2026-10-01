/**
 * Decisions for the embedded-playback probe (scripts/embed_probe.ts), kept free of I/O so they can be
 * tested. A refusal only becomes CONFIRMED_REFUSED when an isolated recheck, run after a cool-down and
 * beside a control video that does play, refuses again. A timeout or anything seen while YouTube may be
 * throttling never confirms anything.
 */

export type ProbeState = 'UNTESTED' | 'PLAYABLE' | 'SUSPECTED_REFUSED' | 'CONFIRMED_REFUSED' | 'TIMEOUT' | 'INCONCLUSIVE'

export type ProbeMode = 'batch' | 'recheck'

/** 'ok', 'timeout', or the YouTube player error code. */
export type Verdict = string

export interface Observation {
  at: number
  verdict: Verdict
  mode: ProbeMode
  run: string
  /** Recheck only: whether the control video played in the same isolated player just before. */
  control?: 'ok' | 'failed'
  /** Set when the result was discarded because the circuit breaker tripped around it. */
  discarded?: true
  note?: string
}

export interface ProbeRecord {
  state: ProbeState
  observations: Observation[]
}

export interface ProbeRun {
  id: string
  startedAt: number
  endedAt?: number
  args: Record<string, string | number | boolean | string[] | number[]>
  origin?: string
  userAgent?: string
  trips: number
  observed: number
}

export interface ProbeCheckpoint {
  format: 'tvn-embed-probe-v2'
  updatedAt: number
  runs: ProbeRun[]
  records: Record<string, ProbeRecord>
}

/** YouTube player errors that mean the video will never play embedded (as src/services/embed-refusals.ts). */
export const REFUSED = new Set(['100', '101', '150'])

export const RECHECK_COOLDOWN_MS = 10 * 60_000
const KEPT_OBSERVATIONS = 12

const isRefusal = (verdict: Verdict) => REFUSED.has(verdict)

/** Apply one observation. `throttled` is true when the breaker is open or tripped on this result. */
export function observe(previous: ProbeRecord | undefined, observation: Observation, throttled = false): ProbeRecord {
  const prior = previous ?? { state: 'UNTESTED' as const, observations: [] }
  const observations = [...prior.observations, throttled ? { ...observation, discarded: true as const } : observation].slice(-KEPT_OBSERVATIONS)
  const keep = (state: ProbeState): ProbeRecord => ({ state, observations })
  if (throttled) return keep(prior.state === 'UNTESTED' || prior.state === 'TIMEOUT' ? 'INCONCLUSIVE' : prior.state)
  const { verdict, mode } = observation
  if (verdict === 'ok') return keep('PLAYABLE')
  if (verdict === 'timeout') return keep(prior.state === 'SUSPECTED_REFUSED' || prior.state === 'CONFIRMED_REFUSED' ? prior.state : 'TIMEOUT')
  if (!isRefusal(verdict)) return keep(prior.state === 'PLAYABLE' || prior.state === 'CONFIRMED_REFUSED' ? prior.state : 'INCONCLUSIVE')
  if (prior.state === 'CONFIRMED_REFUSED') return keep('CONFIRMED_REFUSED')
  if (mode === 'recheck' && observation.control === 'ok' && earlierRefusal(prior.observations, observation.at)) return keep('CONFIRMED_REFUSED')
  return keep('SUSPECTED_REFUSED')
}

/** The record its observations give, discarded ones counting as throttled. */
export function replay(observations: readonly Observation[]): ProbeRecord | undefined {
  return observations.reduce<ProbeRecord | undefined>((record, item) => observe(record, item, Boolean(item.discarded)), undefined)
}

/** After a breaker trip: discard this run's last result for the video and recompute its state. */
export function distrustLast(record: ProbeRecord, runId: string): ProbeRecord {
  const last = record.observations.at(-1)
  if (!last || last.run !== runId || last.discarded) return record
  return replay([...record.observations.slice(0, -1), { ...last, discarded: true }]) ?? record
}

/** A trusted refusal seen at least a cool-down before `at`. */
function earlierRefusal(observations: readonly Observation[], at: number): boolean {
  return observations.some((item) => !item.discarded && isRefusal(item.verdict) && at - item.at >= RECHECK_COOLDOWN_MS)
}

/** Whether a suspected refusal is due its isolated recheck. */
export function dueRecheck(record: ProbeRecord | undefined, now: number): boolean {
  return record?.state === 'SUSPECTED_REFUSED' && earlierRefusal(record.observations, now)
}

export interface BreakerOptions {
  window: number
  minSamples: number
  /** Share of bad results in the window that trips it; the honest refusal rate is well under 1%. */
  maxBadShare: number
  maxConsecutiveBad: number
  cooldownMs: number
  maxCooldownMs: number
  /** Trips in one run before it halts for good. */
  maxTrips: number
}

export const DEFAULT_BREAKER: BreakerOptions = {
  window: 40,
  minSamples: 15,
  maxBadShare: 0.15,
  maxConsecutiveBad: 6,
  cooldownMs: 15 * 60_000,
  maxCooldownMs: 2 * 3600_000,
  maxTrips: 4,
}

export type BreakerState = 'closed' | 'open' | 'halted'

/** Pauses the probe when refusals or timeouts spike, and hands back the results to distrust. */
export class CircuitBreaker {
  private readonly options: BreakerOptions
  private recent: { id: string; bad: boolean }[] = []
  private consecutive = 0
  private pausedUntil = 0
  trips = 0

  constructor(options: Partial<BreakerOptions> = {}) {
    this.options = { ...DEFAULT_BREAKER, ...options }
  }

  state(now: number): BreakerState {
    if (this.trips >= this.options.maxTrips) return 'halted'
    return now < this.pausedUntil ? 'open' : 'closed'
  }

  resumesAt(): number {
    return this.pausedUntil
  }

  /** Record a batch result. On a trip, returns the ids in the window whose bad result is now suspect. */
  record(id: string, verdict: Verdict, now: number): { tripped: boolean; distrust: string[] } {
    const bad = verdict !== 'ok'
    this.recent.push({ id, bad })
    if (this.recent.length > this.options.window) this.recent.shift()
    this.consecutive = bad ? this.consecutive + 1 : 0
    const badCount = this.recent.filter((item) => item.bad).length
    const spiking = this.recent.length >= this.options.minSamples && badCount / this.recent.length > this.options.maxBadShare
    if (!spiking && this.consecutive < this.options.maxConsecutiveBad) return { tripped: false, distrust: [] }
    const distrust = this.recent.filter((item) => item.bad).map((item) => item.id)
    this.trips += 1
    this.pausedUntil = now + Math.min(this.options.cooldownMs * 2 ** (this.trips - 1), this.options.maxCooldownMs)
    this.recent = []
    this.consecutive = 0
    return { tripped: true, distrust }
  }
}

/** At most `perMinute` probe starts a minute, evenly spaced. */
export class RateLimiter {
  private next = 0
  private readonly perMinute: number
  constructor(perMinute: number) {
    this.perMinute = perMinute
  }

  /** Milliseconds to wait before the next start; zero means start now (and the slot is taken). */
  take(now: number): number {
    if (now < this.next) return this.next - now
    this.next = now + 60_000 / Math.max(this.perMinute, 1)
    return 0
  }
}

export interface QueueOptions {
  channelsOf: (id: string) => readonly number[]
  /** Only videos on these channels; empty means the whole catalogue. */
  channels?: readonly number[]
  limit?: number
}

/** What a run will probe, in catalogue order: untested, timed-out and inconclusive videos first. */
export function planBatch(ids: readonly string[], records: Readonly<Record<string, ProbeRecord>>, options: QueueOptions): string[] {
  const wanted = options.channels?.length ? new Set(options.channels) : null
  const out: string[] = []
  for (const id of ids) {
    if (wanted && !options.channelsOf(id).some((channel) => wanted.has(channel))) continue
    const state = records[id]?.state ?? 'UNTESTED'
    if (state !== 'UNTESTED' && state !== 'TIMEOUT' && state !== 'INCONCLUSIVE') continue
    out.push(id)
    if (options.limit !== undefined && out.length >= options.limit) break
  }
  return out
}

export function planRechecks(ids: readonly string[], records: Readonly<Record<string, ProbeRecord>>, now: number, options: QueueOptions): string[] {
  const wanted = options.channels?.length ? new Set(options.channels) : null
  return ids.filter((id) => dueRecheck(records[id], now) && (!wanted || options.channelsOf(id).some((channel) => wanted.has(channel))))
}

export function stateCounts(ids: readonly string[], records: Readonly<Record<string, ProbeRecord>>): Record<ProbeState, number> {
  const counts: Record<ProbeState, number> = { UNTESTED: 0, PLAYABLE: 0, SUSPECTED_REFUSED: 0, CONFIRMED_REFUSED: 0, TIMEOUT: 0, INCONCLUSIVE: 0 }
  for (const id of ids) counts[records[id]?.state ?? 'UNTESTED'] += 1
  return counts
}

/** The file TVN reads: confirmed refusals only. Suspected ones are listed for review and never hidden. */
export function playbackManifest(ids: readonly string[], checkpoint: ProbeCheckpoint) {
  const counts = stateCounts(ids, checkpoint.records)
  const of = (state: ProbeState) => ids.filter((id) => checkpoint.records[id]?.state === state)
  return {
    checked: new Date(checkpoint.updatedAt).toISOString().slice(0, 10),
    videos: ids.length - counts.UNTESTED,
    embedRefused: of('CONFIRMED_REFUSED'),
    suspectedRefused: of('SUSPECTED_REFUSED'),
    states: counts,
    probe: {
      method: 'Each video loaded muted in the public YouTube embedded player; no API key. Refusals confirmed by an isolated recheck beside a playing control video.',
      runs: checkpoint.runs.map(({ id, startedAt, endedAt, args, trips, observed }) => ({ id, startedAt, endedAt, args, trips, observed })),
    },
  }
}

/** Earlier checkpoints were `{ results: { id: verdict } }` from a batch run: refusals there are only suspected. */
export function migrateCheckpoint(raw: unknown, run: ProbeRun): ProbeCheckpoint {
  const doc = raw as Partial<ProbeCheckpoint> & { results?: Record<string, string> }
  if (doc?.format === 'tvn-embed-probe-v2' && doc.records) return doc as ProbeCheckpoint
  const records: Record<string, ProbeRecord> = {}
  for (const [id, verdict] of Object.entries(doc?.results ?? {})) {
    records[id] = observe(undefined, { at: run.startedAt, verdict, mode: 'batch', run: run.id })
  }
  return { format: 'tvn-embed-probe-v2', updatedAt: run.startedAt, runs: [run], records }
}
