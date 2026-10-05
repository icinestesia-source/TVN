import type { Db } from './db.ts'

/**
 * The operator's job queue. Every piece of Harvester work (AUTO, RESUME, a channel refresh, harvesting approved
 * sources, discovery, export, reports) is a job owned by the one process that owns the workspace, so there is
 * one database writer and the operator window sees every job. The engine lane runs one job at a time (it owns
 * provider reads and corpus writes); the discovery lane runs beside it, so the desk can prepare the next channel
 * while approved sources are still being harvested. Both lanes live in this process, so SQLite never has two writers.
 */

export const JOB_KINDS = ['auto', 'resume', 'refresh', 'harvest', 'discover', 'export', 'report'] as const
export type JobKind = (typeof JOB_KINDS)[number]
export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted'
export type JobLane = 'engine' | 'discovery'

export interface Job {
  id: number
  kind: JobKind
  lane: JobLane
  channelId: number | null
  label: string
  params: Record<string, unknown>
  state: JobState
  origin: string
  submittedAt: string
  startedAt: string | null
  endedAt: string | null
  result: string | null
}

export interface JobRunners {
  run(job: Job, signal: AbortSignal): Promise<string>
  /** STOP for the engine lane's running job: the engine finishes safely and keeps what it committed. */
  stopEngine(): void
}

const laneOf = (kind: JobKind): JobLane => (kind === 'discover' ? 'discovery' : 'engine')

interface Row {
  id: number
  kind: JobKind
  lane: JobLane
  channel_id: number | null
  label: string
  params: string
  state: JobState
  origin: string
  submitted_at: string
  started_at: string | null
  ended_at: string | null
  result: string | null
}

const jobOf = (row: Row): Job => ({
  id: row.id,
  kind: row.kind,
  lane: row.lane,
  channelId: row.channel_id,
  label: row.label,
  params: JSON.parse(row.params) as Record<string, unknown>,
  state: row.state,
  origin: row.origin,
  submittedAt: row.submitted_at,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  result: row.result,
})

export class JobQueue {
  private readonly db: Db
  private readonly runners: JobRunners
  private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void
  private readonly now: () => Date
  private readonly running = new Map<JobLane, { id: number; controller: AbortController; work: Promise<void> }>()

  constructor(db: Db, runners: JobRunners, log: (level: 'info' | 'warn' | 'error', message: string) => void, now: () => Date = () => new Date()) {
    this.db = db
    this.runners = runners
    this.log = log
    this.now = now
    // Jobs left queued or running by a process that has gone are not run behind the operator's back.
    const left = this.db.prepare("UPDATE jobs SET state = 'interrupted', ended_at = ?, result = COALESCE(result, 'The Harvester closed before this job finished') WHERE state IN ('queued', 'running')").run(this.now().toISOString())
    if (Number(left.changes) > 0) this.log('warn', `${left.changes} job(s) from the last session did not finish; nothing was run in their place`)
  }

  /** Queue a job. The same job for the same channel already waiting is not queued twice. */
  submit(kind: JobKind, params: Record<string, unknown> = {}, options: { channelId?: number | null; label?: string; origin?: string } = {}): Job {
    const channelId = options.channelId ?? null
    const waiting = this.db.prepare("SELECT * FROM jobs WHERE kind = ? AND state = 'queued' AND channel_id IS ? AND params = ?").get(kind, channelId, JSON.stringify(params)) as Row | undefined
    if (waiting) return jobOf(waiting)
    const id = Number(
      this.db
        .prepare("INSERT INTO jobs (kind, lane, channel_id, label, params, state, origin, submitted_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)")
        .run(kind, laneOf(kind), channelId, options.label ?? kind.toUpperCase(), JSON.stringify(params), options.origin ?? 'operator', this.now().toISOString()).lastInsertRowid,
    )
    const job = this.get(id) as Job
    this.log('info', `Job ${id} queued: ${job.label}${job.origin !== 'operator' ? ` (${job.origin})` : ''}`)
    this.pump(job.lane)
    return job
  }

  get(id: number): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined
    return row ? jobOf(row) : null
  }

  /** The running and waiting jobs, then the most recent finished ones. */
  list(recent = 12): Job[] {
    const open = (this.db.prepare("SELECT * FROM jobs WHERE state IN ('running', 'queued') ORDER BY id").all() as unknown as Row[]).map(jobOf)
    const done = (this.db.prepare("SELECT * FROM jobs WHERE state NOT IN ('running', 'queued') ORDER BY id DESC LIMIT ?").all(recent) as unknown as Row[]).map(jobOf)
    return [...open, ...done]
  }

  busy(lane?: JobLane): boolean {
    if (lane) return this.running.has(lane) || Boolean(this.db.prepare("SELECT 1 FROM jobs WHERE lane = ? AND state = 'queued' LIMIT 1").get(lane))
    return this.running.size > 0 || Boolean(this.db.prepare("SELECT 1 FROM jobs WHERE state = 'queued' LIMIT 1").get())
  }

  /** Withdraw a waiting job, or STOP a running one. */
  cancel(id: number): void {
    const job = this.get(id)
    if (!job) return
    if (job.state === 'queued') {
      this.db.prepare("UPDATE jobs SET state = 'cancelled', ended_at = ? WHERE id = ? AND state = 'queued'").run(this.now().toISOString(), id)
      this.log('info', `Job ${id} withdrawn: ${job.label}`)
      return
    }
    const live = this.running.get(job.lane)
    if (live?.id === id) {
      live.controller.abort()
      if (job.lane === 'engine') this.runners.stopEngine()
    }
  }

  /** STOP everything: the running jobs finish safely and nothing waiting starts. */
  stopAll(): void {
    const withdrawn = this.db.prepare("UPDATE jobs SET state = 'cancelled', ended_at = ? WHERE state = 'queued'").run(this.now().toISOString())
    if (Number(withdrawn.changes) > 0) this.log('info', `STOP: ${withdrawn.changes} waiting job(s) withdrawn`)
    for (const [lane, live] of this.running) {
      live.controller.abort()
      if (lane === 'engine') this.runners.stopEngine()
    }
  }

  /** Resolves once nothing is running or waiting. */
  async idle(): Promise<void> {
    for (;;) {
      const live = [...this.running.values()].map((item) => item.work)
      if (live.length === 0 && !this.busy()) return
      await Promise.all(live)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  private pump(lane: JobLane): void {
    if (this.running.has(lane)) return
    const row = this.db.prepare("SELECT * FROM jobs WHERE lane = ? AND state = 'queued' ORDER BY id LIMIT 1").get(lane) as Row | undefined
    if (!row) return
    const job = jobOf(row)
    const controller = new AbortController()
    this.db.prepare("UPDATE jobs SET state = 'running', started_at = ? WHERE id = ?").run(this.now().toISOString(), job.id)
    const work = (async () => {
      let state: JobState = 'done'
      let result: string
      try {
        result = await this.runners.run({ ...job, state: 'running' }, controller.signal)
        if (controller.signal.aborted) state = 'cancelled'
      } catch (error) {
        state = controller.signal.aborted ? 'cancelled' : 'failed'
        result = error instanceof Error ? error.message : String(error)
        if (state === 'failed') this.log('error', `Job ${job.id} failed: ${job.label}: ${result}`)
      }
      this.db.prepare('UPDATE jobs SET state = ?, ended_at = ?, result = ? WHERE id = ?').run(state, this.now().toISOString(), result.slice(0, 2000), job.id)
      if (state !== 'failed') this.log('info', `Job ${job.id} ${state === 'done' ? 'done' : state}: ${job.label}${result ? ` · ${result}` : ''}`)
    })().finally(() => {
      this.running.delete(lane)
      this.pump(lane)
    })
    this.running.set(lane, { id: job.id, controller, work })
  }
}
