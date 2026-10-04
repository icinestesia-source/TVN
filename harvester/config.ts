/**
 * Every Harvester threshold and limit in one place. A workspace may override any of them in its own
 * `harvester.config.json`; nothing here is a secret, and no credential is ever read from this file.
 */
export interface HealthThresholds {
  /** Fewer playable programmes than this, or fewer hours than `thinHours`, is THIN. */
  thinProgrammes: number
  thinHours: number
  /** Below these (and not THIN) is FAIR; at or above both is HEALTHY. */
  fairProgrammes: number
  fairHours: number
  /** A source failing this many runs in a row counts as broken. */
  brokenAfterFailures: number
  /** A channel is BROKEN SOURCE when broken sources held at least this share of its eligible programmes. */
  brokenShare: number
}

export interface Pacing {
  /** Provider requests in flight at once, per provider. */
  concurrency: number
  /** The least time between two requests starting, per provider (ms). */
  gapMs: number
  /** The pause between one source and the next (ms). */
  betweenSourcesMs: number
  /** A request that has not answered by then is abandoned (ms). */
  requestTimeoutMs: number
  /** After a provider says slow down (429), every request to it waits this long (ms). */
  cooldownMs: number
}

export interface HarvesterConfig {
  health: HealthThresholds
  pacing: Pacing
  /** A temporary failure is tried again this many times, after these waits (ms). STOP cuts any wait short. */
  retries: number
  backoffMs: number[]
  /** A source read successfully within this many hours is not due on an incremental run. */
  staleHours: number
  /** An incremental read follows the list past its newest page at most this many batches, until it meets a known programme. */
  catchUpBatches: number
  /** A source missing at its address this many runs in a row has its programmes marked unavailable (never deleted). */
  unavailableAfterNotFound: number
  /** New programmes are held back from the schedule, as LOAD holds them, until the curator rescans or rebuilds. */
  holdNew: boolean
  /** Write a database snapshot to checkpoints/ at most this often during a run (minutes), and always at its end or STOP. */
  snapshotMinutes: number
  /** Refresh additions and reports during a run after this many sources. */
  outputsEvery: number
}

export const DEFAULT_CONFIG: HarvesterConfig = {
  health: { thinProgrammes: 12, thinHours: 6, fairProgrammes: 40, fairHours: 24, brokenAfterFailures: 2, brokenShare: 0.5 },
  pacing: { concurrency: 4, gapMs: 120, betweenSourcesMs: 1500, requestTimeoutMs: 20_000, cooldownMs: 60_000 },
  retries: 2,
  backoffMs: [5_000, 20_000],
  staleHours: 12,
  catchUpBatches: 10,
  unavailableAfterNotFound: 2,
  holdNew: true,
  snapshotMinutes: 30,
  outputsEvery: 10,
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The defaults with a workspace's own numbers laid over them; anything of the wrong type is ignored. */
export function withOverrides(raw: unknown, base: HarvesterConfig = DEFAULT_CONFIG): HarvesterConfig {
  if (!isRecord(raw)) return base
  const pick = <T extends object>(defaults: T, given: unknown): T => {
    if (!isRecord(given)) return defaults
    const out = { ...defaults } as Record<string, unknown>
    for (const [key, value] of Object.entries(defaults)) {
      const next = given[key]
      if (typeof value === 'number' && typeof next === 'number' && Number.isFinite(next) && next >= 0) out[key] = next
      else if (typeof value === 'boolean' && typeof next === 'boolean') out[key] = next
      else if (Array.isArray(value) && Array.isArray(next) && next.every((item) => typeof item === 'number' && item >= 0)) out[key] = next
    }
    return out as T
  }
  const top = pick({ ...base, health: undefined, pacing: undefined } as unknown as Record<string, unknown>, raw) as unknown as HarvesterConfig
  return { ...top, health: pick(base.health, raw.health), pacing: pick(base.pacing, raw.pacing) }
}
