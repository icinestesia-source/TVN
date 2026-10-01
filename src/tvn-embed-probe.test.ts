import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CircuitBreaker,
  distrustLast,
  dueRecheck,
  migrateCheckpoint,
  observe,
  planBatch,
  planRechecks,
  playbackManifest,
  RateLimiter,
  RECHECK_COOLDOWN_MS,
  type Observation,
  type ProbeCheckpoint,
  type ProbeRecord,
} from '../scripts/embed-probe-core.ts'

const T = Date.parse('2026-10-01T12:00:00Z')
const batch = (verdict: string, at = T, run = 'r1'): Observation => ({ at, verdict, mode: 'batch', run })
const recheck = (verdict: string, at: number, control: 'ok' | 'failed' = 'ok'): Observation => ({ at, verdict, mode: 'recheck', run: 'r2', control })
const play = (...observations: Observation[]) => observations.reduce<ProbeRecord | undefined>((record, item) => observe(record, item), undefined)!

describe('probe states', () => {
  it('a batch refusal is only suspected', () => {
    expect(play(batch('150')).state).toBe('SUSPECTED_REFUSED')
    expect(play(batch('101')).state).toBe('SUSPECTED_REFUSED')
    expect(play(batch('ok')).state).toBe('PLAYABLE')
  })

  it('confirms only on an isolated recheck after the cool-down, beside a control that played', () => {
    const later = T + RECHECK_COOLDOWN_MS
    expect(play(batch('150'), recheck('150', later)).state).toBe('CONFIRMED_REFUSED')
    expect(play(batch('150'), recheck('150', later - 1)).state).toBe('SUSPECTED_REFUSED')
    expect(play(batch('150'), recheck('150', later, 'failed')).state).toBe('SUSPECTED_REFUSED')
    expect(play(recheck('150', later)).state).toBe('SUSPECTED_REFUSED')
    expect(play(batch('150'), recheck('ok', later)).state).toBe('PLAYABLE')
  })

  it('a timeout never confirms anything, and never clears a suspicion', () => {
    expect(play(batch('timeout')).state).toBe('TIMEOUT')
    expect(play(batch('timeout'), batch('timeout', T + RECHECK_COOLDOWN_MS)).state).toBe('TIMEOUT')
    expect(play(batch('150'), recheck('timeout', T + RECHECK_COOLDOWN_MS)).state).toBe('SUSPECTED_REFUSED')
  })

  it('a throttled result never changes a settled state and leaves untested videos inconclusive', () => {
    expect(observe(undefined, batch('150'), true).state).toBe('INCONCLUSIVE')
    expect(observe(play(batch('ok')), batch('150'), true).state).toBe('PLAYABLE')
    expect(observe(play(batch('150')), batch('150', T + RECHECK_COOLDOWN_MS), true).state).toBe('SUSPECTED_REFUSED')
  })

  it('other player errors are inconclusive', () => {
    expect(play(batch('5')).state).toBe('INCONCLUSIVE')
    expect(play(batch('ok'), batch('2')).state).toBe('PLAYABLE')
  })

  it('a throttled refusal cannot be the earlier refusal a recheck confirms against', () => {
    const throttled = observe(undefined, batch('150'), true)
    expect(dueRecheck(throttled, T + RECHECK_COOLDOWN_MS)).toBe(false)
    expect(observe(throttled, recheck('150', T + RECHECK_COOLDOWN_MS)).state).toBe('SUSPECTED_REFUSED')
  })
})

describe('circuit breaker', () => {
  it('stays closed at the honest refusal rate', () => {
    const breaker = new CircuitBreaker()
    for (let index = 0; index < 400; index += 1) expect(breaker.record(`v${index}`, index % 150 === 0 ? '150' : 'ok', T).tripped).toBe(false)
    expect(breaker.state(T)).toBe('closed')
  })

  it('trips on a spike, distrusts the bad results in its window, and pauses', () => {
    const breaker = new CircuitBreaker({ window: 20, minSamples: 10, maxBadShare: 0.2, maxConsecutiveBad: 99 })
    const outcomes = ['ok', 'ok', '150', 'ok', 'timeout', 'ok', '150', 'ok', 'ok', '150', '150']
    const results = outcomes.map((verdict, index) => breaker.record(`v${index}`, verdict, T))
    expect(results.findIndex((result) => result.tripped)).toBe(9)
    expect(results[9]?.distrust).toEqual(['v2', 'v4', 'v6', 'v9'])
    expect(breaker.state(T + 1)).toBe('open')
    expect(breaker.state(breaker.resumesAt())).toBe('closed')
  })

  it('trips on a run of consecutive failures, backs off longer each time, and halts', () => {
    const breaker = new CircuitBreaker({ maxConsecutiveBad: 3, cooldownMs: 1000, maxTrips: 3 })
    const pauses: number[] = []
    let now = T
    for (let trip = 0; trip < 3; trip += 1) {
      for (let index = 0; index < 3; index += 1) breaker.record(`t${trip}-${index}`, 'timeout', now)
      pauses.push(breaker.resumesAt() - now)
      now = breaker.resumesAt()
    }
    expect(pauses).toEqual([1000, 2000, 4000])
    expect(breaker.state(now)).toBe('halted')
  })

  it('distrusting a result rolls back exactly that run’s last observation', () => {
    const record = play(batch('ok', T - 5000, 'r0'), batch('150', T, 'r1'))
    expect(record.state).toBe('SUSPECTED_REFUSED')
    const rolled = distrustLast(record, 'r1')
    expect(rolled.state).toBe('PLAYABLE')
    expect(rolled.observations.at(-1)?.discarded).toBe(true)
    expect(distrustLast(record, 'other')).toBe(record)
    expect(distrustLast(play(batch('timeout')), 'r1').state).toBe('INCONCLUSIVE')
  })
})

describe('rate limit, queue, checkpoint', () => {
  it('spaces starts evenly', () => {
    const limiter = new RateLimiter(30)
    expect(limiter.take(T)).toBe(0)
    expect(limiter.take(T + 500)).toBe(1500)
    expect(limiter.take(T + 2000)).toBe(0)
  })

  it('plans a bounded channel-specific batch and resumes past settled videos', () => {
    const channels: Record<string, number[]> = { a: [225], b: [225, 300], c: [300], d: [225], e: [225], f: [225] }
    const records: Record<string, ProbeRecord> = {
      a: play(batch('ok')),
      b: play(batch('timeout')),
      d: observe(undefined, batch('150'), true),
      e: play(batch('150')),
    }
    const options = { channelsOf: (id: string) => channels[id] ?? [], channels: [225] }
    expect(planBatch(Object.keys(channels), records, options)).toEqual(['b', 'd', 'f'])
    expect(planBatch(Object.keys(channels), records, { ...options, limit: 2 })).toEqual(['b', 'd'])
    expect(planBatch(Object.keys(channels), records, { channelsOf: options.channelsOf })).toEqual(['b', 'c', 'd', 'f'])
    expect(planRechecks(Object.keys(channels), records, T + RECHECK_COOLDOWN_MS - 1, options)).toEqual([])
    expect(planRechecks(Object.keys(channels), records, T + RECHECK_COOLDOWN_MS, options)).toEqual(['e'])
  })

  it('migrates the first batch checkpoint with its refusals only suspected, and records provenance', () => {
    const run = { id: 'legacy', startedAt: T, args: { channels: [225] }, trips: 1, observed: 3 }
    const checkpoint = migrateCheckpoint({ checked: '2026-10-01', results: { a: 'ok', b: '150', c: 'timeout' } }, run)
    expect(checkpoint.records.a?.state).toBe('PLAYABLE')
    expect(checkpoint.records.b?.state).toBe('SUSPECTED_REFUSED')
    expect(checkpoint.records.c?.state).toBe('TIMEOUT')
    expect(checkpoint.runs).toEqual([run])
    expect(migrateCheckpoint(checkpoint, run)).toBe(checkpoint)
  })

  it('the manifest TVN reads carries confirmed refusals only', () => {
    const checkpoint: ProbeCheckpoint = {
      format: 'tvn-embed-probe-v2',
      updatedAt: T,
      runs: [],
      records: {
        a: play(batch('ok')),
        b: play(batch('150')),
        c: play(batch('150'), recheck('150', T + RECHECK_COOLDOWN_MS)),
        d: play(batch('timeout')),
      },
    }
    const manifest = playbackManifest(['a', 'b', 'c', 'd', 'e'], checkpoint)
    expect(manifest.embedRefused).toEqual(['c'])
    expect(manifest.suspectedRefused).toEqual(['b'])
    expect(manifest.videos).toBe(4)
    expect(manifest.states).toEqual({ UNTESTED: 1, PLAYABLE: 1, SUSPECTED_REFUSED: 1, CONFIRMED_REFUSED: 1, TIMEOUT: 1, INCONCLUSIVE: 0 })
  })
})

describe('probe runner safeguards', () => {
  const runner = readFileSync('scripts/embed_probe.ts', 'utf8')

  it('defaults to few players and a slow start rate, with hard caps', () => {
    expect(runner).toContain("Math.min(Number(option('workers', '2')), 4)")
    expect(runner).toContain("Math.min(Number(option('per-minute', '30')), 90)")
  })

  it('needs a channel scope unless the whole catalogue is asked for deliberately', () => {
    expect(runner).toContain("if (!CHANNELS.length && !flag('whole-catalogue'))")
  })

  it('checkpoints atomically and on Ctrl-C, and stops at a time limit or when the breaker halts', () => {
    expect(runner).toContain('renameSync(temp, CHECKPOINT)')
    expect(runner).toContain("process.on('SIGINT'")
    expect(runner).toContain("'time limit reached'")
    expect(runner).toContain("if (state === 'halted')")
  })
})
