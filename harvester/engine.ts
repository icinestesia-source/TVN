import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_LIST_VIDEOS, type ExportSource, type ExportVideo } from '../src/services/user-network-export.ts'
import { programmesOf } from './corpus.ts'
import { setMeta, transaction } from './db.ts'
import { computeHealth, type ChannelHealth } from './health.ts'
import type { Reader } from './importer.ts'
import { enrichedVideo, mergeFresh } from './merge.ts'
import { snapshotDb, writeAdditions, writeReports } from './outputs.ts'
import { Pacer, pause, ReadFailure, readSource, Stopped, type ReadResult, type ReadSource as ReadSourceInput, type SourceOutcome } from './provider.ts'
import type { Workspace } from './workspace.ts'

export type RunMode = 'audit' | 'incremental'
export type RunStatus = 'running' | 'stopped' | 'interrupted' | 'completed'

export interface RunRow {
  id: number
  mode: RunMode
  status: RunStatus
  started_at: string
  ended_at: string | null
  elapsed_ms: number
  note: string | null
}

interface SourceRow {
  id: number
  channel_id: number
  position: number
  key: string
  source_type: string
  url: string
  provider_id: string | null
  label: string
  enabled: number
  reader: Reader
  body: string
  status: string | null
  last_success_at: string | null
  failures: number
  not_found_runs: number
  audited_run: number | null
}

interface QueueRow {
  run_id: number
  seq: number
  channel_id: number
  source_id: number | null
  state: 'pending' | 'done' | 'failed' | 'skipped'
  depth: RunMode | null
}

export interface Progress {
  running: boolean
  stopping: boolean
  runId: number | null
  mode: RunMode | null
  channel: { index: number; total: number; number: number; name: string } | null
  source: { index: number; total: number; url: string; label: string; sourceType: string; depth: RunMode | null } | null
  known: number
  added: number
  datesAdded: number
  enriched: number
  rejected: number
  failed: number
  done: number
  queued: number
  elapsedMs: number
  lastError: string | null
}

export interface LogLine {
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface EngineDeps {
  fetch?: typeof fetch
  now?: () => Date
  /** Channel numbers a run is limited to (inclusive), for trials. */
  numbers?: { from: number; to: number }
  onLog?: (line: LogLine) => void
  /** Reads one source; TVN's readers through the pacer unless a test gives its own. */
  read?: (source: ReadSourceInput, depth: RunMode, known: ReadonlySet<string>, signal: AbortSignal) => Promise<ReadResult>
}

const STATIC_REASONS: Partial<Record<Reader, string>> = { none: 'Nothing to read: TVN programming, or an imported list with no known uploader' }

/** Whether the process that wrote a lock is still alive. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * AUTO: walks channels by number, refreshing each enabled source the way TVN reads it, and commits after
 * every source so that STOP, a crash or closing the window loses at most the source in flight. A run's queue
 * is persisted; RESUME carries the same run on from its first unvisited source.
 */
export class Harvester {
  readonly workspace: Workspace
  private readonly deps: EngineDeps
  private controller: AbortController | null = null
  private sessionStart = 0
  private sessionBase = 0
  private finishing: Promise<void> | null = null
  private sinceOutputs = 0
  private lastSnapshot = 0
  private readonly lines: LogLine[] = []
  private pacer: Pacer | null = null
  progress: Progress = Harvester.idle()

  constructor(workspace: Workspace, deps: EngineDeps = {}) {
    this.workspace = workspace
    this.deps = deps
    this.markInterrupted()
    const recent = this.db.prepare('SELECT at, level, message FROM log ORDER BY id DESC LIMIT 200').all() as unknown as LogLine[]
    this.lines.push(...recent.reverse())
  }

  private static idle(): Progress {
    return { running: false, stopping: false, runId: null, mode: null, channel: null, source: null, known: 0, added: 0, datesAdded: 0, enriched: 0, rejected: 0, failed: 0, done: 0, queued: 0, elapsedMs: 0, lastError: null }
  }

  private get db() {
    return this.workspace.db
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private get lockPath(): string {
    return join(this.workspace.dir, 'harvester.lock')
  }

  /** A run left `running` by a process that is gone was interrupted; RESUME is offered for it. */
  private markInterrupted(): void {
    if (existsSync(this.lockPath)) {
      const pid = Number(readFileSync(this.lockPath, 'utf8'))
      if (pid && pid !== process.pid && alive(pid)) return
      rmSync(this.lockPath, { force: true })
    }
    this.db.prepare("UPDATE runs SET status = 'interrupted', note = COALESCE(note, 'The run ended without STOP (closed or crashed)') WHERE status = 'running'").run()
  }

  get log(): readonly LogLine[] {
    return this.lines
  }

  private say(level: LogLine['level'], message: string): void {
    const line = { at: this.now().toISOString(), level, message }
    this.lines.push(line)
    if (this.lines.length > 500) this.lines.splice(0, this.lines.length - 500)
    this.db.prepare('INSERT INTO log (run_id, at, level, message) VALUES (?, ?, ?, ?)').run(this.progress.runId, line.at, level, message)
    appendFileSync(this.workspace.path('logs', 'harvester.log'), `${line.at} ${level.toUpperCase()} ${this.progress.runId ? `run ${this.progress.runId} ` : ''}${message}\n`)
    this.deps.onLog?.(line)
  }

  /** The latest run that still has sources to visit and was not completed. */
  unfinishedRun(): RunRow | null {
    return (
      (this.db
        .prepare("SELECT r.* FROM runs r WHERE r.status IN ('stopped', 'interrupted', 'running') AND EXISTS (SELECT 1 FROM run_queue q WHERE q.run_id = r.id AND q.state = 'pending') ORDER BY r.id DESC LIMIT 1")
        .get() as unknown as RunRow | undefined) ?? null
    )
  }

  lastRun(): RunRow | null {
    return (this.db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get() as unknown as RunRow | undefined) ?? null
  }

  get running(): boolean {
    return this.controller !== null
  }

  /** START AUTO: a new run of whatever is due, previous failures included. An unfinished run is set aside, never lost. */
  start(): Promise<void> {
    if (this.running) throw new Error('A run is already going')
    const runId = this.createRun()
    return this.go(runId)
  }

  /** RESUME AUTO: the same run, from its first unvisited source. */
  resume(): Promise<void> {
    if (this.running) throw new Error('A run is already going')
    const run = this.unfinishedRun()
    if (!run) throw new Error('There is no stopped run to resume')
    this.db.prepare("UPDATE runs SET status = 'running', note = NULL WHERE id = ?").run(run.id)
    return this.go(run.id, true)
  }

  /** STOP: abandon whatever is in flight now, including any retry or wait; what was committed stays. */
  stop(): void {
    if (!this.controller || this.controller.signal.aborted) return
    this.progress.stopping = true
    this.say('info', 'STOP pressed: finishing safely')
    this.controller.abort()
  }

  /** Resolves once the current run has wound down and written its outputs. */
  settled(): Promise<void> {
    return this.finishing ?? Promise.resolve()
  }

  private isDue(source: SourceRow): boolean {
    if (source.audited_run === null || source.last_success_at === null || source.failures > 0) return true
    return this.now().getTime() - Date.parse(source.last_success_at) >= this.workspace.config.staleHours * 3600_000
  }

  private createRun(): number {
    const now = this.now().toISOString()
    return transaction(this.db, () => {
      this.db.prepare("UPDATE runs SET status = 'stopped', note = COALESCE(note, 'Set aside by a new run') WHERE status IN ('running', 'interrupted')").run()
      const range = this.deps.numbers
      const channels = this.db
        .prepare('SELECT id, number, name FROM channels WHERE number BETWEEN ? AND ? ORDER BY number, scope')
        .all(range?.from ?? 0, range?.to ?? Number.MAX_SAFE_INTEGER) as { id: number; number: number; name: string }[]
      const sourcesOf = this.db.prepare('SELECT * FROM sources WHERE channel_id = ? ORDER BY position')
      const plan: { channel: number; source: number | null; state: QueueRow['state']; depth: RunMode | null; outcome: string | null; detail: string | null }[] = []
      for (const channel of channels) {
        const sources = sourcesOf.all(channel.id) as unknown as SourceRow[]
        if (sources.length === 0) plan.push({ channel: channel.id, source: null, state: 'skipped', depth: null, outcome: 'UNSUPPORTED', detail: 'The channel has no sources' })
        for (const source of sources) {
          if (!source.enabled) plan.push({ channel: channel.id, source: source.id, state: 'skipped', depth: null, outcome: 'DISABLED', detail: 'Switched off by the curator' })
          else if (source.reader === 'none') plan.push({ channel: channel.id, source: source.id, state: 'skipped', depth: null, outcome: 'UNSUPPORTED', detail: STATIC_REASONS.none ?? null })
          else if (this.isDue(source)) plan.push({ channel: channel.id, source: source.id, state: 'pending', depth: source.audited_run === null ? 'audit' : 'incremental', outcome: null, detail: null })
          else plan.push({ channel: channel.id, source: source.id, state: 'skipped', depth: null, outcome: 'NO CHANGE', detail: `Read ${source.last_success_at}; not due yet` })
        }
      }
      const mode: RunMode = plan.some((item) => item.depth === 'audit') ? 'audit' : 'incremental'
      const runId = Number(this.db.prepare("INSERT INTO runs (mode, status, started_at, heartbeat_at, note) VALUES (?, 'running', ?, ?, ?)").run(mode, now, now, range ? `Channels ${range.from}–${range.to}` : null).lastInsertRowid)
      const add = this.db.prepare('INSERT INTO run_queue (run_id, seq, channel_id, source_id, state, depth, outcome, detail, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const mark = this.db.prepare('UPDATE sources SET status = ?, status_detail = ? WHERE id = ?')
      plan.forEach((item, seq) => {
        add.run(runId, seq, item.channel, item.source, item.state, item.depth, item.outcome, item.detail, item.state === 'skipped' ? now : null)
        if (item.source !== null && (item.outcome === 'DISABLED' || item.outcome === 'UNSUPPORTED')) mark.run(item.outcome, item.detail, item.source)
      })
      return runId
    })
  }

  private go(runId: number, resumed = false): Promise<void> {
    writeFileSync(this.lockPath, String(process.pid))
    this.controller = new AbortController()
    const run = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as unknown as RunRow
    this.sessionStart = Date.now()
    this.sessionBase = run.elapsed_ms
    this.lastSnapshot = Date.now()
    this.sinceOutputs = 0
    this.pacer = new Pacer(this.workspace.config.pacing, this.controller.signal, this.deps.fetch ?? fetch)
    this.progress = { ...Harvester.idle(), running: true, runId, mode: run.mode }
    this.refreshCounters(runId)
    const pending = (this.db.prepare("SELECT COUNT(*) AS n FROM run_queue WHERE run_id = ? AND state = 'pending'").get(runId) as { n: number }).n
    this.say('info', `${resumed ? 'RESUME' : 'START'} AUTO: run ${runId} (${run.mode === 'audit' ? 'full audit and refresh' : 'incremental'}), ${pending} sources to visit`)
    this.finishing = this.loop(runId).finally(() => {
      this.controller = null
      this.pacer = null
      rmSync(this.lockPath, { force: true })
    })
    return this.finishing
  }

  private refreshCounters(runId: number): void {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS queued, SUM(state = 'done') AS done, SUM(state = 'failed') AS failed,
          COALESCE(SUM(added), 0) AS added, COALESCE(SUM(dates_added), 0) AS dates, COALESCE(SUM(enriched), 0) AS enriched, COALESCE(SUM(refused), 0) AS refused
         FROM run_queue WHERE run_id = ? AND source_id IS NOT NULL`,
      )
      .get(runId) as Record<string, number | null>
    Object.assign(this.progress, {
      queued: row.queued ?? 0,
      done: row.done ?? 0,
      failed: row.failed ?? 0,
      added: row.added ?? 0,
      datesAdded: row.dates ?? 0,
      enriched: row.enriched ?? 0,
      rejected: row.refused ?? 0,
      elapsedMs: this.sessionBase + (Date.now() - this.sessionStart),
    })
  }

  elapsed(): number {
    return this.running ? this.sessionBase + (Date.now() - this.sessionStart) : this.progress.elapsedMs
  }

  private async loop(runId: number): Promise<void> {
    const signal = (this.controller as AbortController).signal
    const queue = this.db.prepare('SELECT * FROM run_queue WHERE run_id = ? ORDER BY seq').all(runId) as unknown as QueueRow[]
    const channelOrder = [...new Set(queue.map((item) => item.channel_id))]
    let crashed: unknown = null
    try {
      for (const item of queue) {
        if (item.state !== 'pending' || item.source_id === null) continue
        if (signal.aborted) break
        const source = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(item.source_id) as unknown as SourceRow
        const channel = this.db.prepare('SELECT number, name FROM channels WHERE id = ?').get(item.channel_id) as { number: number; name: string }
        const siblings = queue.filter((other) => other.channel_id === item.channel_id && other.source_id !== null)
        const held = programmesOf(this.db, source.id)
        this.progress.channel = { index: channelOrder.indexOf(item.channel_id) + 1, total: channelOrder.length, number: channel.number, name: channel.name }
        this.progress.source = { index: siblings.indexOf(item) + 1, total: siblings.length, url: source.url, label: source.label, sourceType: source.source_type, depth: item.depth }
        this.progress.known = held.length
        const startedAt = this.now().toISOString()
        const read = await this.readWithRetries(source, item.depth ?? 'incremental', held, signal, `${String(channel.number).padStart(3, '0')} ${channel.name}`)
        if (read === 'stopped' || signal.aborted) break
        this.commit(runId, item, source, held, read, startedAt, `${String(channel.number).padStart(3, '0')} ${channel.name}`)
        this.refreshCounters(runId)
        this.sinceOutputs += 1
        if (this.sinceOutputs >= this.workspace.config.outputsEvery) {
          this.sinceOutputs = 0
          writeAdditions(this.workspace, runId, this.now())
        }
        if (Date.now() - this.lastSnapshot >= this.workspace.config.snapshotMinutes * 60_000) {
          this.lastSnapshot = Date.now()
          this.say('info', `Checkpoint: ${snapshotDb(this.workspace, runId, 'periodic', this.now())}`)
        }
        try {
          await pause(this.workspace.config.pacing.betweenSourcesMs, signal)
        } catch {
          break
        }
      }
    } catch (error) {
      crashed = error
      this.progress.lastError = error instanceof Error ? error.message : String(error)
      this.say('error', `The run stopped on an error: ${this.progress.lastError}`)
    }
    this.finish(runId, crashed)
  }

  private async readWithRetries(source: SourceRow, depth: RunMode, held: readonly ExportVideo[], signal: AbortSignal, where: string): Promise<ReadResult | ReadFailure | 'stopped'> {
    const config = this.workspace.config
    const known = new Set(held.map((video) => video.id))
    for (let attempt = 0; ; attempt += 1) {
      try {
        const input = { reader: source.reader, sourceType: source.source_type, url: source.url, providerId: source.provider_id, uploaderChannelId: (JSON.parse(source.body) as ExportSource).uploaderChannelId ?? null }
        return await (this.deps.read ? this.deps.read(input, depth, known, signal) : readSource(input, depth, known, this.pacer as Pacer, config.catchUpBatches, signal))
      } catch (error) {
        if (error instanceof Stopped || signal.aborted) return 'stopped'
        const failure = error instanceof ReadFailure ? error : new ReadFailure('TEMPORARY FAILURE', String(error))
        if (failure.outcome !== 'TEMPORARY FAILURE' || attempt >= config.retries) return failure
        const wait = config.backoffMs[Math.min(attempt, config.backoffMs.length - 1)] ?? 5000
        this.say('warn', `${where}: ${failure.message}; trying again in ${Math.round(wait / 1000)}s`)
        try {
          await pause(wait, signal)
        } catch {
          return 'stopped'
        }
      }
    }
  }

  /** One source's result, committed in one transaction with its queue entry: the checkpoint RESUME relies on. */
  private commit(runId: number, item: QueueRow, source: SourceRow, held: readonly ExportVideo[], read: ReadResult | ReadFailure, startedAt: string, where: string): void {
    const config = this.workspace.config
    const at = this.now().toISOString()
    const db = this.db
    transaction(db, () => {
      const change = db.prepare('INSERT INTO changes (run_id, channel_id, source_id, kind, video_id, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      const finishItem = db.prepare(
        'UPDATE run_queue SET state = ?, outcome = ?, detail = ?, known = ?, added = ?, enriched = ?, dates_added = ?, refused = ?, unavailable = ?, started_at = ?, finished_at = ? WHERE run_id = ? AND seq = ?',
      )
      const statusChange = (to: SourceOutcome, detail: string | null) => {
        if (source.status && source.status !== to && !(source.status === 'NO CHANGE' && to === 'NEW CONTENT') && !(source.status === 'NEW CONTENT' && to === 'NO CHANGE')) {
          change.run(runId, source.channel_id, source.id, 'status', null, JSON.stringify({ from: source.status, to, ...(detail ? { detail } : {}) }), at)
        }
      }
      if (read instanceof ReadFailure) {
        const notFound = read.outcome === 'NOT FOUND' ? source.not_found_runs + 1 : 0
        let unavailable = 0
        if (read.outcome === 'NOT FOUND' && notFound >= config.unavailableAfterNotFound) {
          const gone = db.prepare("SELECT video_id FROM programmes WHERE source_id = ? AND playability != 'unavailable'").all(source.id) as { video_id: string }[]
          db.prepare("UPDATE programmes SET playability = 'unavailable' WHERE source_id = ?").run(source.id)
          for (const { video_id } of gone) change.run(runId, source.channel_id, source.id, 'unavailable', video_id, null, at)
          unavailable = gone.length
        }
        db.prepare('UPDATE sources SET status = ?, status_detail = ?, last_attempt_at = ?, failures = failures + 1, not_found_runs = ? WHERE id = ?').run(read.outcome, read.message, at, notFound, source.id)
        statusChange(read.outcome, read.message)
        finishItem.run('failed', read.outcome, read.message, held.length, 0, 0, 0, 0, unavailable, startedAt, at, runId, item.seq)
        this.say('warn', `${where} · ${source.label}: REFRESH FAILED (${read.outcome}): ${read.message}. The pool of ${held.length} is kept.`)
        return
      }
      const merged = mergeFresh(held, read.programmes, { hold: config.holdNew, limit: MAX_LIST_VIDEOS })
      const first = (db.prepare('SELECT MIN(ord) AS ord FROM programmes WHERE source_id = ?').get(source.id) as { ord: number | null }).ord ?? 0
      const insert = db.prepare(
        "INSERT INTO programmes (source_id, video_id, ord, body, published, duration_sec, pending, playability, origin, first_run, last_seen_run) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'harvest', ?, ?)",
      )
      const playable = source.reader === 'youtube' || source.reader === 'collection' ? 'playable' : 'unknown'
      merged.added.forEach((video, index) => {
        insert.run(source.id, video.id, first - merged.added.length + index, JSON.stringify(video), video.published ?? null, video.durationSec, video.pending ? 1 : 0, playable, runId, runId)
        change.run(runId, source.channel_id, source.id, 'added', video.id, JSON.stringify(video), at)
      })
      const byId = new Map(held.map((video) => [video.id, video]))
      const update = db.prepare('UPDATE programmes SET body = ?, published = ?, duration_sec = ? WHERE source_id = ? AND video_id = ?')
      let datesAdded = 0
      for (const { id, fields } of merged.enriched) {
        const video = enrichedVideo(byId.get(id) as ExportVideo, fields)
        update.run(JSON.stringify(video), video.published ?? null, video.durationSec, source.id, id)
        const { published, ...rest } = fields
        if (published) {
          datesAdded += 1
          change.run(runId, source.channel_id, source.id, 'date', id, JSON.stringify({ published }), at)
        }
        if (Object.keys(rest).length > 0) change.run(runId, source.channel_id, source.id, 'metadata', id, JSON.stringify(rest), at)
      }
      const seen = db.prepare(`UPDATE programmes SET last_seen_run = ?${playable === 'playable' ? ", playability = 'playable'" : ''} WHERE source_id = ? AND video_id = ?`)
      for (const id of merged.seen) seen.run(runId, source.id, id)
      const outcome: SourceOutcome = read.checked ? 'OK' : merged.added.length > 0 ? 'NEW CONTENT' : merged.enriched.length > 0 ? 'OK' : 'NO CHANGE'
      const body = JSON.parse(source.body) as ExportSource
      const nextBody = read.listed !== undefined && read.listed !== body.listed ? { ...body, listed: read.listed } : body
      db.prepare(
        'UPDATE sources SET status = ?, status_detail = ?, last_attempt_at = ?, last_success_at = ?, failures = 0, not_found_runs = 0, refused = ?, audited_run = CASE WHEN ? THEN ? ELSE audited_run END, body = ? WHERE id = ?',
      ).run(outcome, merged.overflow > 0 ? `${merged.overflow} new programmes over the bound were left out` : null, at, at, read.refused, item.depth === 'audit' ? 1 : 0, runId, JSON.stringify(nextBody), source.id)
      statusChange(outcome, null)
      finishItem.run('done', outcome, null, held.length, merged.added.length, merged.enriched.length, datesAdded, read.refused, 0, startedAt, at, runId, item.seq)
      setMeta(db, `run_${runId}_requests`, String(Number(db.prepare('SELECT value FROM meta WHERE key = ?').get(`run_${runId}_requests`)?.value ?? 0) + read.requests))
      db.prepare('UPDATE runs SET heartbeat_at = ?, elapsed_ms = ? WHERE id = ?').run(at, this.elapsed(), runId)
      const parts = [`${merged.added.length} new`, `${datesAdded} dates`, merged.enriched.length - datesAdded > 0 ? `${merged.enriched.length - datesAdded} enriched` : null, read.refused > 0 ? `${read.refused} refused embedding` : null, `${read.requests} requests`]
      this.say('info', `${where} · ${source.label}: ${outcome} (${parts.filter(Boolean).join(', ')}; held ${held.length})`)
    })
  }

  /** Close the run: its state, health, additions, reports and a checkpoint snapshot. */
  private finish(runId: number, crashed: unknown): void {
    const now = this.now()
    const pending = (this.db.prepare("SELECT COUNT(*) AS n FROM run_queue WHERE run_id = ? AND state = 'pending'").get(runId) as { n: number }).n
    const status: RunStatus = pending === 0 && !crashed ? 'completed' : crashed ? 'interrupted' : 'stopped'
    this.refreshCounters(runId)
    this.db
      .prepare('UPDATE runs SET status = ?, ended_at = ?, heartbeat_at = ?, elapsed_ms = ?, note = ? WHERE id = ?')
      .run(status, status === 'completed' ? now.toISOString() : null, now.toISOString(), this.progress.elapsedMs, crashed ? String(crashed) : status === 'stopped' ? `Stopped with ${pending} sources to visit` : null, runId)
    let health: ChannelHealth[] = []
    try {
      health = computeHealth(this.db, this.workspace.config.health, now)
      const files = [writeAdditions(this.workspace, runId, now), ...writeReports(this.workspace, health, runId, now), snapshotDb(this.workspace, runId, status, now)]
      this.say('info', `Run ${runId} ${status.toUpperCase()}${pending > 0 ? ` (${pending} sources left: RESUME AUTO carries on)` : ''}. Written: ${files.map((file) => file.slice(this.workspace.dir.length + 1)).join(', ')}`)
    } catch (error) {
      this.say('error', `Outputs could not be written: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.progress = { ...this.progress, running: false, stopping: false }
  }
}
