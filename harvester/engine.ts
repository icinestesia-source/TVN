import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eligibleOf } from '../src/services/channel-curation.ts'
import { excludedProgramme } from '../src/library/exclusions.ts'
import { MAX_LIST_VIDEOS, type ExportSource, type ExportVideo } from '../src/services/user-network-export.ts'
import { channelSource } from '../src/services/user-network-restore.ts'
import { ensureBaseline } from './baseline.ts'
import { programmesOf } from './corpus.ts'
import { setMeta, transaction, type Db } from './db.ts'
import { canonicalSource, detectSource, duplicateCheck, recordEnrichment, type SourceResult } from './desk.ts'
import { channelRules, discoveryContext } from './discovery.ts'
import { computeHealth, storedHealth, type ChannelHealth } from './health.ts'
import { readerOf, type Reader } from './importer.ts'
import { enrichedVideo, mergeFresh } from './merge.ts'
import { snapshotDb, writeAdditions, writeReports } from './outputs.ts'
import { Pacer, pause, ReadFailure, readBatch, readSource, Stopped, youTubeAddress, type ReadDepth, type ReadResult, type ReadSource as ReadSourceInput, type SourceOutcome } from './provider.ts'
import type { Workspace } from './workspace.ts'

export type RunMode = 'audit' | 'incremental'
export type RunStatus = 'running' | 'stopped' | 'interrupted' | 'completed'
/** auto: AUTO over a channel range (RESUME carries it on). channel: AUTO REFRESH CHANNEL. desk: SCAN SOURCES. */
export type RunKind = 'auto' | 'channel' | 'desk'
type Provenance = 'auto' | 'desk'

export interface RunRow {
  id: number
  kind: RunKind
  mode: RunMode
  status: RunStatus
  range_from: number | null
  range_to: number | null
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
  provenance: string
  continuation: string | null
  complete: number
}

interface QueueRow {
  run_id: number
  seq: number
  channel_id: number
  source_id: number | null
  state: 'pending' | 'done' | 'failed' | 'skipped'
  depth: ReadDepth | null
}

export interface Progress {
  running: boolean
  stopping: boolean
  runId: number | null
  kind: RunKind | null
  mode: RunMode | null
  range: { from: number; to: number } | null
  channel: { index: number; total: number; number: number; name: string } | null
  source: { index: number; total: number; url: string; label: string; sourceType: string; depth: ReadDepth | null } | null
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
  /** Channel numbers an AUTO run is limited to (inclusive) when START gives none. */
  numbers?: { from: number; to: number }
  onLog?: (line: LogLine) => void
  /** Reads one source; TVN's readers through the pacer unless a test gives its own. */
  read?: (source: ReadSourceInput, depth: ReadDepth, known: ReadonlySet<string>, signal: AbortSignal) => Promise<ReadResult>
  /** Reads the next batch of a deep enumeration from its cursor; TVN's own unless a test gives its own. */
  readBatch?: (cursor: string, signal: AbortSignal) => Promise<ReadResult>
  /** Whether the shipped 001–999 baseline is taken on first use (tests of the User Network alone turn it off). */
  baseline?: boolean
}

/** Before and after one Source Desk action, for the desk's channel result. */
export interface ChannelCompare {
  channelId: number
  kind: RunKind
  runId: number
  before: Pick<ChannelHealth, 'sourcesEnabled' | 'creators' | 'available' | 'eligible' | 'hours' | 'knownDates' | 'knownDatePct' | 'class'> | null
  after: Pick<ChannelHealth, 'sourcesEnabled' | 'creators' | 'available' | 'eligible' | 'hours' | 'knownDates' | 'knownDatePct' | 'class'> | null
  results: (SourceResult & { url: string; status: string; note?: string })[]
}

const STATIC_REASONS: Partial<Record<Reader, string>> = { none: 'Nothing to read: TVN programming, or an imported list with no known uploader' }

const compareOf = (health: ChannelHealth | null | undefined) => (health ? { sourcesEnabled: health.sourcesEnabled, creators: health.creators, available: health.available, eligible: health.eligible, hours: health.hours, knownDates: health.knownDates, knownDatePct: health.knownDatePct, class: health.class } : null)

/** The latest AUTO run that still has sources to visit and was not completed (read-only). */
export function unfinishedRunOf(db: Db): RunRow | null {
  return (
    (db
      .prepare("SELECT r.* FROM runs r WHERE r.kind = 'auto' AND r.status IN ('stopped', 'interrupted', 'running') AND EXISTS (SELECT 1 FROM run_queue q WHERE q.run_id = r.id AND q.state = 'pending') ORDER BY r.id DESC LIMIT 1")
      .get() as unknown as RunRow | undefined) ?? null
  )
}

export function lastRunOf(db: Db, kind: RunKind = 'auto'): RunRow | null {
  return (db.prepare('SELECT * FROM runs WHERE kind = ? ORDER BY id DESC LIMIT 1').get(kind) as unknown as RunRow | undefined) ?? null
}

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
 * every source (and every batch of a deep enumeration) so that STOP, a crash or closing the window loses at
 * most what is in flight. A run's queue is persisted; RESUME carries the same AUTO run on from where it was.
 * AUTO REFRESH CHANNEL and SCAN SOURCES are runs of their own on one channel, one at a time with AUTO.
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
  /** Reads shared by several channels (a shipped original many channels carry) are made once per run. */
  private cache = new Map<string, ReadResult>()
  private baselineWarned = false
  progress: Progress = Harvester.idle()
  /** The latest Source Desk action's before/after. */
  compare: ChannelCompare | null = null

  constructor(workspace: Workspace, deps: EngineDeps = {}) {
    this.workspace = workspace
    this.deps = deps
    this.markInterrupted()
    const recent = this.db.prepare('SELECT at, level, message FROM log ORDER BY id DESC LIMIT 200').all() as unknown as LogLine[]
    this.lines.push(...recent.reverse())
  }

  private static idle(): Progress {
    return { running: false, stopping: false, runId: null, kind: null, mode: null, range: null, channel: null, source: null, known: 0, added: 0, datesAdded: 0, enriched: 0, rejected: 0, failed: 0, done: 0, queued: 0, elapsedMs: 0, lastError: null }
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

  /** The shipped 001–999 network, read once into the workspace as its baseline layer. */
  baseline(): void {
    if (this.deps.baseline === false) return
    let taken
    try {
      taken = ensureBaseline(this.db)
    } catch (error) {
      if (!this.baselineWarned) this.say('warn', `Shipped 001–999 baseline not read: ${error instanceof Error ? error.message : String(error)}`)
      this.baselineWarned = true
      return
    }
    if (taken) {
      this.say('info', `Shipped baseline read from TVN ${taken.appCommit}: ${taken.channels} channels, ${taken.sources} original sources, ${taken.programmes} programmes`)
      computeHealth(this.db, this.workspace.config.health, this.now())
    }
  }

  /** A run left `running` by a process that is gone was interrupted; RESUME is offered for it. */
  private markInterrupted(): void {
    if (existsSync(this.lockPath)) {
      const pid = Number(readFileSync(this.lockPath, 'utf8'))
      if (pid && pid !== process.pid && alive(pid)) return
      rmSync(this.lockPath, { force: true })
    }
    this.db.prepare("UPDATE runs SET status = 'interrupted', note = COALESCE(note, 'The run ended without STOP (closed or crashed)') WHERE status = 'running'").run()
    this.db.prepare("UPDATE desk_pending SET status = 'READY' WHERE status = 'SCANNING'").run()
  }

  get log(): readonly LogLine[] {
    return this.lines
  }

  /** A line in the operator's Activity from outside a run (discovery, the job queue). */
  note(level: LogLine['level'], message: string): void {
    this.say(level, message)
  }

  private say(level: LogLine['level'], message: string): void {
    const line = { at: this.now().toISOString(), level, message }
    this.lines.push(line)
    if (this.lines.length > 500) this.lines.splice(0, this.lines.length - 500)
    this.db.prepare('INSERT INTO log (run_id, at, level, message) VALUES (?, ?, ?, ?)').run(this.progress.runId, line.at, level, message)
    appendFileSync(this.workspace.path('logs', 'harvester.log'), `${line.at} ${level.toUpperCase()} ${this.progress.runId ? `run ${this.progress.runId} ` : ''}${message}\n`)
    this.deps.onLog?.(line)
  }

  /** The latest AUTO run that still has sources to visit and was not completed. */
  unfinishedRun(): RunRow | null {
    return unfinishedRunOf(this.db)
  }

  lastRun(kind: RunKind = 'auto'): RunRow | null {
    return lastRunOf(this.db, kind)
  }

  get running(): boolean {
    return this.controller !== null
  }

  /** START AUTO: a new run over a channel range (default all), previous failures included. An unfinished run is set aside, never lost. */
  start(range: { from?: number; to?: number } = {}): Promise<void> {
    if (this.running) throw new Error('A run is already going')
    this.baseline()
    const given = range.from !== undefined || range.to !== undefined ? { from: range.from ?? 1, to: range.to ?? Number.MAX_SAFE_INTEGER } : this.deps.numbers
    const runId = this.createRun('auto', given ?? null)
    return this.go(runId)
  }

  /** RESUME AUTO: the same run, from its first unvisited source (or the batch a deep read stopped at). */
  resume(): Promise<void> {
    if (this.running) throw new Error('A run is already going')
    const run = this.unfinishedRun()
    if (!run) throw new Error('There is no stopped run to resume')
    this.db.prepare("UPDATE runs SET status = 'running', note = NULL WHERE id = ?").run(run.id)
    return this.go(run.id, true)
  }

  /** AUTO REFRESH CHANNEL: AUTO's reading of one channel's existing sources, due or not. */
  refreshChannel(channelId: number): Promise<void> {
    if (this.running) throw new Error('A run is already going')
    this.baseline()
    const channel = this.db.prepare('SELECT number FROM channels WHERE id = ?').get(channelId) as { number: number } | undefined
    if (!channel) throw new Error('No such channel')
    const before = computeHealth(this.db, this.workspace.config.health, this.now(), [channelId])[0]
    const runId = this.createRun('channel', { from: channel.number, to: channel.number }, channelId)
    this.compare = { channelId, kind: 'channel', runId, before: compareOf(before), after: null, results: [] }
    return this.go(runId)
  }

  /** SCAN SOURCES: every READY address pasted for the channel, then any of its desk sources left PARTIAL. */
  scanDesk(channelId: number): Promise<void> {
    if (this.running) throw new Error('A run is already going')
    this.baseline()
    const channel = this.db.prepare('SELECT number FROM channels WHERE id = ?').get(channelId) as { number: number } | undefined
    if (!channel) throw new Error('No such channel')
    const before = computeHealth(this.db, this.workspace.config.health, this.now(), [channelId])[0]
    const runId = this.createRun('desk', { from: channel.number, to: channel.number }, channelId)
    this.compare = { channelId, kind: 'desk', runId, before: compareOf(before), after: null, results: [] }
    return this.go(runId)
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
    if (source.continuation) return true
    if (source.audited_run === null || source.last_success_at === null || source.failures > 0) return true
    return this.now().getTime() - Date.parse(source.last_success_at) >= this.workspace.config.staleHours * 3600_000
  }

  private depthOf(source: SourceRow): ReadDepth {
    if (source.continuation || (source.provenance === 'desk' && !source.complete)) return 'deep'
    return source.audited_run === null ? 'audit' : 'incremental'
  }

  private createRun(kind: RunKind, range: { from: number; to: number } | null, channelId?: number): number {
    const now = this.now().toISOString()
    return transaction(this.db, () => {
      if (kind === 'auto') this.db.prepare("UPDATE runs SET status = 'stopped', note = COALESCE(note, 'Set aside by a new run') WHERE kind = 'auto' AND status IN ('running', 'interrupted')").run()
      const channels = (
        channelId !== undefined
          ? this.db.prepare('SELECT id, number, name FROM channels WHERE id = ?').all(channelId)
          : this.db.prepare('SELECT id, number, name FROM channels WHERE number BETWEEN ? AND ? ORDER BY number, scope').all(range?.from ?? 0, range?.to ?? Number.MAX_SAFE_INTEGER)
      ) as { id: number; number: number; name: string }[]
      const sourcesOf = this.db.prepare('SELECT * FROM sources WHERE channel_id = ? ORDER BY position')
      const plan: { channel: number; source: number | null; state: QueueRow['state']; depth: ReadDepth | null; outcome: string | null; detail: string | null }[] = []
      for (const channel of channels) {
        const sources = sourcesOf.all(channel.id) as unknown as SourceRow[]
        if (kind === 'desk') {
          // Pasted addresses are queued as they are added; desk sources left PARTIAL carry on after them.
          for (const source of sources) if (source.enabled && source.provenance === 'desk' && source.continuation) plan.push({ channel: channel.id, source: source.id, state: 'pending', depth: 'deep', outcome: null, detail: null })
          continue
        }
        if (sources.length === 0) plan.push({ channel: channel.id, source: null, state: 'skipped', depth: null, outcome: 'UNSUPPORTED', detail: 'The channel has no sources' })
        for (const source of sources) {
          if (!source.enabled) plan.push({ channel: channel.id, source: source.id, state: 'skipped', depth: null, outcome: 'DISABLED', detail: 'Switched off by the curator' })
          else if (source.reader === 'none') plan.push({ channel: channel.id, source: source.id, state: 'skipped', depth: null, outcome: 'UNSUPPORTED', detail: STATIC_REASONS.none ?? null })
          else if (kind === 'channel' || this.isDue(source)) plan.push({ channel: channel.id, source: source.id, state: 'pending', depth: this.depthOf(source), outcome: null, detail: null })
          else plan.push({ channel: channel.id, source: source.id, state: 'skipped', depth: null, outcome: 'NO CHANGE', detail: `Read ${source.last_success_at}; not due yet` })
        }
      }
      const mode: RunMode = kind === 'desk' || plan.some((item) => item.depth === 'audit' || item.depth === 'deep') ? 'audit' : 'incremental'
      const note = range && kind === 'auto' ? `Channels ${range.from}–${range.to >= Number.MAX_SAFE_INTEGER ? 'ALL' : range.to}` : null
      const runId = Number(
        this.db
          .prepare("INSERT INTO runs (kind, mode, status, started_at, heartbeat_at, note, range_from, range_to) VALUES (?, ?, 'running', ?, ?, ?, ?, ?)")
          .run(kind, mode, now, now, note, range?.from ?? null, range && range.to < Number.MAX_SAFE_INTEGER ? range.to : null).lastInsertRowid,
      )
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
    this.cache = new Map()
    this.pacer = new Pacer(this.workspace.config.pacing, this.controller.signal, this.deps.fetch ?? fetch)
    const range = run.range_from !== null ? { from: run.range_from, to: run.range_to ?? Number.MAX_SAFE_INTEGER } : null
    this.progress = { ...Harvester.idle(), running: true, runId, kind: run.kind, mode: run.mode, range }
    this.refreshCounters(runId)
    const pending = (this.db.prepare("SELECT COUNT(*) AS n FROM run_queue WHERE run_id = ? AND state = 'pending'").get(runId) as { n: number }).n
    const what = { auto: 'AUTO', channel: 'AUTO REFRESH CHANNEL', desk: 'SCAN SOURCES' }[run.kind]
    const span = run.kind === 'auto' && range ? ` from ${String(range.from).padStart(3, '0')}${run.range_to !== null ? ` to ${String(run.range_to).padStart(3, '0')}` : ''}` : ''
    this.say('info', `${resumed ? 'RESUME' : 'START'} ${what}: run ${runId}${span} (${run.mode === 'audit' ? 'full read' : 'incremental'}), ${pending} sources to visit`)
    const work = run.kind === 'desk' ? this.deskLoop(runId) : this.loop(runId)
    this.finishing = work.finally(() => {
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

  private where(channelId: number): string {
    const channel = this.db.prepare('SELECT number, name FROM channels WHERE id = ?').get(channelId) as { number: number; name: string }
    return `${String(channel.number).padStart(3, '0')} ${channel.name}`
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
        const channel = this.db.prepare('SELECT number, name FROM channels WHERE id = ?').get(item.channel_id) as { number: number; name: string }
        const siblings = queue.filter((other) => other.channel_id === item.channel_id && other.source_id !== null)
        this.progress.channel = { index: channelOrder.indexOf(item.channel_id) + 1, total: channelOrder.length, number: channel.number, name: channel.name }
        const visited = await this.visit(runId, item, siblings.indexOf(item) + 1, siblings.length, 'auto', signal)
        if (visited === 'stopped' || signal.aborted) break
        await this.between(runId, signal)
      }
    } catch (error) {
      crashed = error
      this.progress.lastError = error instanceof Error ? error.message : String(error)
      this.say('error', `The run stopped on an error: ${this.progress.lastError}`)
    }
    this.finish(runId, crashed)
  }

  /** Outputs and checkpoints as a run goes, then the pause between sources. Throws Stopped on STOP. */
  private async between(runId: number, signal: AbortSignal): Promise<void> {
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
      // STOP during the pause: the loop sees the signal.
    }
  }

  private inputOf(source: SourceRow): ReadSourceInput {
    return { reader: source.reader, sourceType: source.source_type, url: source.url, providerId: source.provider_id, uploaderChannelId: (JSON.parse(source.body) as ExportSource).uploaderChannelId ?? null }
  }

  /**
   * One queued source: its read (or, deep, its first read and then batch after batch to the end), each part
   * committed as it arrives. A deep read stopped or bounded leaves the source PARTIAL with its cursor.
   */
  private async visit(runId: number, item: QueueRow, index: number, total: number, provenance: Provenance, signal: AbortSignal, first?: ReadResult): Promise<'done' | 'stopped' | 'failed'> {
    const depth = item.depth ?? 'incremental'
    let source = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(item.source_id) as unknown as SourceRow
    const where = this.where(item.channel_id)
    this.progress.source = { index, total, url: source.url, label: source.label, sourceType: source.source_type, depth }
    let held = programmesOf(this.db, source.id)
    this.progress.known = held.length
    const startedAt = this.now().toISOString()
    let read: ReadResult | ReadFailure | 'stopped'
    let append = false
    if (first) read = first
    else if (depth === 'deep' && source.continuation) {
      read = await this.withRetries(() => (this.deps.readBatch ? this.deps.readBatch(source.continuation as string, signal) : readBatch(source.continuation as string, this.pacer as Pacer, signal)), signal, where)
      append = true
      // A cursor too old to use: the list is read again from its start; what is held is kept.
      if (read instanceof ReadFailure) read = await this.readWithRetries(source, 'deep', held, signal, where)
    } else read = await this.readWithRetries(source, depth, held, signal, where)
    if (read === 'stopped' || signal.aborted) return 'stopped'
    let batches = 0
    for (;;) {
      const more = depth === 'deep' && !(read instanceof ReadFailure) && Boolean(read.next) && held.length < MAX_LIST_VIDEOS
      const bounded = more && batches >= this.workspace.config.deepBatches
      this.commit(runId, item, source, held, read, startedAt, where, { final: !more || bounded, append, provenance, deep: depth === 'deep' })
      this.refreshCounters(runId)
      if (read instanceof ReadFailure) return 'failed'
      if (!more || bounded) return 'done'
      batches += 1
      if (signal.aborted) return 'stopped'
      source = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(source.id) as unknown as SourceRow
      held = programmesOf(this.db, source.id)
      this.progress.known = held.length
      const cursor = read.next as string
      read = await this.withRetries(() => (this.deps.readBatch ? this.deps.readBatch(cursor, signal) : readBatch(cursor, this.pacer as Pacer, signal)), signal, where)
      append = true
      if (read === 'stopped' || signal.aborted) {
        this.say('info', `${where} · ${source.label}: PARTIAL at ${held.length} programmes; SCAN or RESUME carries on from here`)
        return 'stopped'
      }
    }
  }

  private async withRetries(attempt: () => Promise<ReadResult>, signal: AbortSignal, where: string): Promise<ReadResult | ReadFailure | 'stopped'> {
    const config = this.workspace.config
    for (let tries = 0; ; tries += 1) {
      try {
        return await attempt()
      } catch (error) {
        if (error instanceof Stopped || signal.aborted) return 'stopped'
        const failure = error instanceof ReadFailure ? error : new ReadFailure('TEMPORARY FAILURE', String(error))
        if (failure.outcome !== 'TEMPORARY FAILURE' || tries >= config.retries) return failure
        const wait = config.backoffMs[Math.min(tries, config.backoffMs.length - 1)] ?? 5000
        this.say('warn', `${where}: ${failure.message}; trying again in ${Math.round(wait / 1000)}s`)
        try {
          await pause(wait, signal)
        } catch {
          return 'stopped'
        }
      }
    }
  }

  private readWithRetries(source: SourceRow | (ReadSourceInput & { provenance?: string }), depth: ReadDepth, held: readonly ExportVideo[], signal: AbortSignal, where: string): Promise<ReadResult | ReadFailure | 'stopped'> {
    const known = new Set(held.map((video) => video.id))
    const input = 'channel_id' in source ? this.inputOf(source) : source
    const shipped = 'provenance' in source && source.provenance === 'shipped'
    // A shipped original is TVN's own list: a quick look at its newest page, shared by every channel carrying it.
    const catchUp = shipped ? 0 : this.workspace.config.catchUpBatches
    const key = shipped && depth !== 'deep' ? `${input.reader}|${youTubeAddress(input)}|${depth}` : null
    const cached = key ? this.cache.get(key) : undefined
    if (cached) return Promise.resolve({ ...cached, requests: 0 })
    return this.withRetries(
      async () => {
        const read = await (this.deps.read ? this.deps.read(input, depth, known, signal) : readSource(input, depth, known, this.pacer as Pacer, catchUp, signal))
        if (key) this.cache.set(key, read)
        return read
      },
      signal,
      where,
    )
  }

  /**
   * One read (or one batch of a deep read), committed in one transaction with its queue entry: the checkpoint
   * RESUME relies on. Until a deep read is final its queue entry stays pending and its source PARTIAL.
   */
  private commit(
    runId: number,
    item: QueueRow,
    source: SourceRow,
    held: readonly ExportVideo[],
    read: ReadResult | ReadFailure,
    startedAt: string,
    where: string,
    options: { final: boolean; append: boolean; provenance: Provenance; deep: boolean },
  ): void {
    const config = this.workspace.config
    const at = this.now().toISOString()
    const db = this.db
    transaction(db, () => {
      const change = db.prepare('INSERT INTO changes (run_id, channel_id, source_id, kind, video_id, detail, at, provenance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      const finishItem = db.prepare(
        `UPDATE run_queue SET state = ?, outcome = ?, detail = ?, known = COALESCE(known, ?), added = COALESCE(added, 0) + ?, enriched = COALESCE(enriched, 0) + ?, dates_added = COALESCE(dates_added, 0) + ?,
          refused = COALESCE(refused, 0) + ?, unavailable = COALESCE(unavailable, 0) + ?, started_at = COALESCE(started_at, ?), finished_at = ? WHERE run_id = ? AND seq = ?`,
      )
      const statusChange = (to: SourceOutcome, detail: string | null) => {
        const quiet = new Set<string>(['NO CHANGE', 'NEW CONTENT', 'PARTIAL', 'OK'])
        if (source.status && source.status !== to && !(quiet.has(source.status) && quiet.has(to))) {
          change.run(runId, source.channel_id, source.id, 'status', null, JSON.stringify({ from: source.status, to, ...(detail ? { detail } : {}) }), at, options.provenance)
        }
      }
      if (read instanceof ReadFailure) {
        const notFound = read.outcome === 'NOT FOUND' ? source.not_found_runs + 1 : 0
        let unavailable = 0
        // A shipped original's programmes are TVN's own catalogue: a missing publisher page does not take them off the air.
        if (read.outcome === 'NOT FOUND' && notFound >= config.unavailableAfterNotFound && source.provenance !== 'shipped') {
          const gone = db.prepare("SELECT video_id FROM programmes WHERE source_id = ? AND playability != 'unavailable'").all(source.id) as { video_id: string }[]
          db.prepare("UPDATE programmes SET playability = 'unavailable' WHERE source_id = ?").run(source.id)
          for (const { video_id } of gone) change.run(runId, source.channel_id, source.id, 'unavailable', video_id, null, at, options.provenance)
          unavailable = gone.length
        }
        db.prepare('UPDATE sources SET status = ?, status_detail = ?, last_attempt_at = ?, failures = failures + 1, not_found_runs = ? WHERE id = ?').run(read.outcome, read.message, at, notFound, source.id)
        statusChange(read.outcome, read.message)
        finishItem.run('failed', read.outcome, read.message, held.length, 0, 0, 0, 0, unavailable, startedAt, at, runId, item.seq)
        this.say('warn', `${where} · ${source.label}: REFRESH FAILED (${read.outcome}): ${read.message}. The pool of ${held.length} is kept.`)
        return
      }
      const merged = mergeFresh(held, read.programmes, { hold: config.holdNew, limit: MAX_LIST_VIDEOS })
      const bounds = db.prepare('SELECT MIN(ord) AS low, MAX(ord) AS high FROM programmes WHERE source_id = ?').get(source.id) as { low: number | null; high: number | null }
      const insert = db.prepare(
        "INSERT INTO programmes (source_id, video_id, ord, body, published, duration_sec, pending, playability, origin, first_run, last_seen_run, provenance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'harvest', ?, ?, ?)",
      )
      const playable = source.reader === 'youtube' || source.reader === 'collection' ? 'playable' : 'unknown'
      // New programmes on a first read are the newest, ahead of the pool; a later batch is older, after it.
      const ordOf = (index: number) => (options.append ? (bounds.high ?? -1) + 1 + index : (bounds.low ?? 0) - merged.added.length + index)
      merged.added.forEach((video, index) => {
        insert.run(source.id, video.id, ordOf(index), JSON.stringify(video), video.published ?? null, video.durationSec, video.pending ? 1 : 0, playable, runId, runId, options.provenance)
        change.run(runId, source.channel_id, source.id, 'added', video.id, JSON.stringify(video), at, options.provenance)
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
          change.run(runId, source.channel_id, source.id, 'date', id, JSON.stringify({ published }), at, options.provenance)
        }
        if (Object.keys(rest).length > 0) change.run(runId, source.channel_id, source.id, 'metadata', id, JSON.stringify(rest), at, options.provenance)
      }
      const seen = db.prepare(`UPDATE programmes SET last_seen_run = ?${playable === 'playable' ? ", playability = 'playable'" : ''} WHERE source_id = ? AND video_id = ?`)
      for (const id of merged.seen) seen.run(runId, source.id, id)
      const partial = options.deep && Boolean(read.next) && held.length + merged.added.length < MAX_LIST_VIDEOS
      const complete = options.deep ? !read.next : Boolean(source.complete)
      const outcome: SourceOutcome = partial ? 'PARTIAL' : read.checked ? 'OK' : merged.added.length > 0 ? 'NEW CONTENT' : merged.enriched.length > 0 ? 'OK' : 'NO CHANGE'
      const body = JSON.parse(source.body) as ExportSource
      const total = held.length + merged.added.length
      const nextBody: ExportSource = {
        ...body,
        ...(read.listed !== undefined ? { listed: read.listed } : {}),
        ...(options.deep ? { deep: true, complete } : {}),
      }
      const detail = partial ? `${total} loaded${read.listed !== undefined ? ` of ${read.listed} listed` : ''}; carries on from its cursor` : merged.overflow > 0 ? `${merged.overflow} new programmes over the bound were left out` : null
      db.prepare(
        `UPDATE sources SET status = ?, status_detail = ?, last_attempt_at = ?, last_success_at = ?, failures = 0, not_found_runs = 0, refused = COALESCE(refused, 0) * ? + ?,
          audited_run = CASE WHEN ? THEN ? ELSE audited_run END, body = ?, has_videos = 1, continuation = ?, complete = ? WHERE id = ?`,
      ).run(outcome, detail, at, at, options.append ? 1 : 0, read.refused, item.depth === 'audit' || item.depth === 'deep' ? 1 : 0, runId, JSON.stringify(nextBody), options.deep ? (partial ? (read.next as string) : null) : source.continuation, complete ? 1 : 0, source.id)
      statusChange(outcome, null)
      finishItem.run(options.final ? 'done' : 'pending', outcome, detail, held.length, merged.added.length, merged.enriched.length, datesAdded, read.refused, 0, startedAt, at, runId, item.seq)
      setMeta(db, `run_${runId}_requests`, String(Number(db.prepare('SELECT value FROM meta WHERE key = ?').get(`run_${runId}_requests`)?.value ?? 0) + read.requests))
      db.prepare('UPDATE runs SET heartbeat_at = ?, elapsed_ms = ? WHERE id = ?').run(at, this.elapsed(), runId)
      const parts = [`${merged.added.length} new`, `${datesAdded} dates`, merged.enriched.length - datesAdded > 0 ? `${merged.enriched.length - datesAdded} enriched` : null, read.refused > 0 ? `${read.refused} refused embedding` : null, `${read.requests} requests`]
      this.say('info', `${where} · ${source.label}: ${outcome} (${parts.filter(Boolean).join(', ')}; held ${total})`)
    })
  }

  /**
   * SCAN SOURCES: each READY address is read deep before anything is added; a source TVN can read joins the
   * channel (provenance Source Desk) and is committed batch by batch. Duplicates found once the provider
   * names the source are reported, never added.
   */
  private async deskLoop(runId: number): Promise<void> {
    const signal = (this.controller as AbortController).signal
    const compare = this.compare as ChannelCompare
    const channelId = compare.channelId
    const channel = this.db.prepare('SELECT id, key, number, name, scope FROM channels WHERE id = ?').get(channelId) as { id: number; key: string; number: number; name: string; scope: string }
    const where = this.where(channelId)
    this.progress.channel = { index: 1, total: 1, number: channel.number, name: channel.name }
    let crashed: unknown = null
    try {
      const rows = this.db.prepare("SELECT id, url, candidate_id FROM desk_pending WHERE channel_id = ? AND status = 'READY' ORDER BY id").all(channelId) as { id: number; url: string; candidate_id: number | null }[]
      const partials = this.db.prepare("SELECT * FROM run_queue WHERE run_id = ? AND state = 'pending' ORDER BY seq").all(runId) as unknown as QueueRow[]
      const total = rows.length + partials.length
      let index = 0
      for (const row of rows) {
        if (signal.aborted) break
        index += 1
        const detection = detectSource(row.url)
        const setRow = (status: string, note: string | null, result: object | null = null, sourceId: number | null = null) => {
          this.db.prepare('UPDATE desk_pending SET status = ?, note = ?, result = COALESCE(?, result), source_id = COALESCE(?, source_id) WHERE id = ?').run(status, note, result ? JSON.stringify(result) : null, sourceId, row.id)
          // A discovered candidate follows its row: harvested, partial, failed, or a duplicate once the provider named it.
          const candidate = { ADDED: 'ADDED', PARTIAL: 'PARTIAL', FAILED: 'FAILED', 'ALREADY ADDED': 'DUPLICATE', 'EXISTING SOURCE — DISABLED': 'DUPLICATE', 'UNKNOWN — REVIEW': 'FAILED' }[status]
          if (row.candidate_id !== null && candidate) {
            this.db.prepare('UPDATE discovery_candidates SET status = ?, source_id = COALESCE(?, source_id), result = COALESCE(?, result) WHERE id = ?').run(candidate, sourceId, result ? JSON.stringify(result) : null, row.candidate_id)
          }
        }
        if (!detection.ready || !detection.sourceType) {
          setRow('UNKNOWN — REVIEW', detection.note ?? 'TVN cannot tell what this address is')
          continue
        }
        setRow('SCANNING', null)
        this.progress.source = { index, total, url: detection.url, label: detection.url, sourceType: detection.sourceType, depth: 'deep' }
        const input = { reader: detection.reader, sourceType: detection.sourceType, url: detection.url, providerId: null, uploaderChannelId: null }
        const read = await this.readWithRetries(input, 'deep', [], signal, where)
        if (read === 'stopped' || signal.aborted) {
          setRow('READY', null)
          break
        }
        if (read instanceof ReadFailure) {
          setRow('FAILED', `${read.outcome}: ${read.message}`)
          compare.results.push({ url: row.url, status: 'FAILED', note: `${read.outcome}: ${read.message}`, label: row.url, programmes: 0, eligible: 0, seconds: 0, dated: 0, refused: 0, complete: false })
          this.say('warn', `${where}: ${row.url} could not be added (${read.outcome}): ${read.message}`)
          continue
        }
        const identity = read.identity ?? { sourceType: detection.sourceType, url: detection.url, label: detection.url }
        const duplicate = duplicateCheck(this.db, channelId, canonicalSource(identity.url, identity.providerId))
        if (duplicate.status !== 'READY') {
          setRow(duplicate.status, `${identity.label}${duplicate.note ? ` · ${duplicate.note}` : ''}`)
          compare.results.push({ url: row.url, status: duplicate.status, label: identity.label, programmes: 0, eligible: 0, seconds: 0, dated: 0, refused: 0, complete: false })
          continue
        }
        const item = this.addDeskSource(runId, channel, row, identity, detection.url, row.candidate_id)
        setRow('SCANNING', duplicate.note, null, item.source_id)
        const visited = await this.visit(runId, item, index, total, 'desk', signal, read)
        const result = this.sourceResult(item.source_id as number, runId, channel.scope === 'central')
        const status = visited === 'stopped' || result.partial ? 'PARTIAL' : 'ADDED'
        setRow(status, duplicate.note, result, item.source_id)
        compare.results.push({ url: row.url, status, ...(duplicate.note ? { note: duplicate.note } : {}), ...result })
        recordEnrichment(this.db, channelId, { sources: 1, programmes: result.programmes, seconds: result.seconds }, this.now())
        if (visited === 'stopped' || signal.aborted) break
        await this.between(runId, signal)
      }
      for (const item of partials) {
        if (signal.aborted) break
        index += 1
        const before = this.sourceResult(item.source_id as number, runId, channel.scope === 'central')
        const visited = await this.visit(runId, item, index, total, 'desk', signal)
        const result = this.sourceResult(item.source_id as number, runId, channel.scope === 'central')
        const pending = this.db.prepare('SELECT id FROM desk_pending WHERE source_id = ?').get(item.source_id) as { id: number } | undefined
        if (pending) this.db.prepare('UPDATE desk_pending SET status = ?, result = ? WHERE id = ?').run(result.partial ? 'PARTIAL' : 'ADDED', JSON.stringify(result), pending.id)
        this.db.prepare('UPDATE discovery_candidates SET status = ?, result = ? WHERE source_id = ?').run(result.partial ? 'PARTIAL' : 'ADDED', JSON.stringify(result), item.source_id)
        compare.results.push({ url: result.label, status: result.partial ? 'PARTIAL' : 'ADDED', ...result })
        recordEnrichment(this.db, channelId, { sources: 0, programmes: result.programmes - before.programmes, seconds: result.seconds - before.seconds }, this.now())
        if (visited === 'stopped' || signal.aborted) break
      }
    } catch (error) {
      crashed = error
      this.progress.lastError = error instanceof Error ? error.message : String(error)
      this.say('error', `SCAN SOURCES stopped on an error: ${this.progress.lastError}`)
    }
    this.finish(runId, crashed)
  }

  /**
   * A pasted or discovered source joins the channel: its row, its queue entry and a journal entry, in one
   * transaction. A discovered source carries the channel's rules and its discovery provenance.
   */
  private addDeskSource(runId: number, channel: { id: number; key: string }, row: { id: number }, identity: NonNullable<ReadResult['identity']>, pasted: string, candidateId: number | null = null): QueueRow {
    const at = this.now().toISOString()
    const candidate = candidateId === null ? undefined : (this.db.prepare('SELECT id, query, search_id, relevance, score, decided_at, decided_by, canonical FROM discovery_candidates WHERE id = ?').get(candidateId) as Record<string, unknown> | undefined)
    const rules = candidate ? channelRules(discoveryContext(this.db, channel.id)) : undefined
    const search = candidate ? (this.db.prepare('SELECT context_key, extra FROM discovery_searches WHERE id = ?').get(Number(candidate.search_id)) as { context_key: string; extra: string } | undefined) : undefined
    return transaction(this.db, () => {
      const position = ((this.db.prepare('SELECT MAX(position) AS p FROM sources WHERE channel_id = ?').get(channel.id) as { p: number | null }).p ?? -1) + 1
      const body: ExportSource = { sourceType: identity.sourceType, url: identity.url, ...(identity.providerId ? { providerId: identity.providerId } : {}), label: identity.label, enabled: true, deep: true, ...(rules ? { filter: rules } : {}) }
      const sourceId = Number(
        this.db
          .prepare(
            "INSERT INTO sources (channel_id, position, key, source_type, url, provider_id, label, enabled, reader, body, has_videos, provenance, added_run, added_at, discovery_id) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1, 'desk', ?, ?, ?)",
          )
          .run(channel.id, position, `${channel.key}#d:${row.id}`, identity.sourceType, identity.url, identity.providerId ?? null, identity.label, readerOf({ sourceType: identity.sourceType }), JSON.stringify(body), runId, at, candidateId).lastInsertRowid,
      )
      const seq = ((this.db.prepare('SELECT MAX(seq) AS s FROM run_queue WHERE run_id = ?').get(runId) as { s: number | null }).s ?? -1) + 1
      this.db.prepare("INSERT INTO run_queue (run_id, seq, channel_id, source_id, state, depth) VALUES (?, ?, ?, ?, 'pending', 'deep')").run(runId, seq, channel.id, sourceId)
      const discovered = candidate
        ? {
            discovered: {
              by: 'harvester',
              candidateId: candidate.id,
              canonical: candidate.canonical,
              query: candidate.query,
              context: search ? { key: search.context_key, ...(search.extra ? { extra: search.extra } : {}) } : null,
              relevance: candidate.relevance,
              score: candidate.score,
              approvedBy: candidate.decided_by,
              approvedAt: candidate.decided_at,
              ...(rules ? { rules } : {}),
            },
          }
        : {}
      this.db
        .prepare("INSERT INTO changes (run_id, channel_id, source_id, kind, video_id, detail, at, provenance) VALUES (?, ?, ?, 'source', NULL, ?, ?, 'desk')")
        .run(runId, channel.id, sourceId, JSON.stringify({ pasted, sourceType: identity.sourceType, url: identity.url, ...(identity.providerId ? { providerId: identity.providerId } : {}), label: identity.label, ...discovered }), at)
      this.say('info', `${this.where(channel.id)}: source added at the Source Desk${candidate ? ' from DISCOVER SOURCES' : ''}: ${identity.label} (${identity.sourceType})`)
      return { run_id: runId, seq, channel_id: channel.id, source_id: sourceId, state: 'pending', depth: 'deep' }
    })
  }

  /** What one source holds now: programmes, eligible (TVN's rules, and on 001–999 its default exclusions), hours, dates. */
  private sourceResult(sourceId: number, runId: number, central: boolean): SourceResult & { partial: boolean } {
    const row = this.db.prepare('SELECT body, label, refused, continuation, complete FROM sources WHERE id = ?').get(sourceId) as { body: string; label: string; refused: number | null; continuation: string | null; complete: number }
    const videos = programmesOf(this.db, sourceId)
    const body = JSON.parse(row.body) as ExportSource
    const made = channelSource({ ...body, videos }, 0)
    const eligible = eligibleOf(made.videos ? made : { ...made, videos }).filter((video) => !central || !excludedProgramme({ title: video.title, videoId: video.id }))
    void runId
    return {
      label: row.label,
      programmes: videos.length,
      eligible: eligible.length,
      seconds: eligible.reduce((sum, video) => sum + video.durationSec, 0),
      dated: videos.filter((video) => video.published).length,
      refused: row.refused ?? 0,
      ...(body.listed !== undefined ? { listed: body.listed } : {}),
      complete: row.complete === 1,
      partial: row.continuation !== null,
    }
  }

  /** Close the run: its state, health, additions, reports and a checkpoint snapshot. */
  private finish(runId: number, crashed: unknown): void {
    const now = this.now()
    const run = this.db.prepare('SELECT kind FROM runs WHERE id = ?').get(runId) as { kind: RunKind }
    const pending = (this.db.prepare("SELECT COUNT(*) AS n FROM run_queue WHERE run_id = ? AND state = 'pending'").get(runId) as { n: number }).n
    const status: RunStatus = pending === 0 && !crashed && !this.controller?.signal.aborted ? 'completed' : crashed ? 'interrupted' : 'stopped'
    this.refreshCounters(runId)
    this.db
      .prepare('UPDATE runs SET status = ?, ended_at = ?, heartbeat_at = ?, elapsed_ms = ?, note = ? WHERE id = ?')
      .run(status, status === 'completed' ? now.toISOString() : null, now.toISOString(), this.progress.elapsedMs, crashed ? String(crashed) : status === 'stopped' ? `Stopped with ${pending} sources to visit` : null, runId)
    try {
      let health: ChannelHealth[]
      if (run.kind === 'auto') health = computeHealth(this.db, this.workspace.config.health, now)
      else {
        const after = computeHealth(this.db, this.workspace.config.health, now, [(this.compare as ChannelCompare).channelId])[0]
        if (this.compare) this.compare.after = compareOf(after)
        health = storedHealth(this.db)
      }
      const files = [writeAdditions(this.workspace, runId, now), ...writeReports(this.workspace, health, runId, now)]
      if (run.kind === 'auto' || Date.now() - this.lastSnapshot >= this.workspace.config.snapshotMinutes * 60_000) files.push(snapshotDb(this.workspace, runId, status, now))
      const resumable = run.kind === 'auto' && pending > 0 ? ` (${pending} sources left: RESUME AUTO carries on)` : ''
      this.say('info', `Run ${runId} ${status.toUpperCase()}${resumable}. Written: ${files.map((file) => file.slice(this.workspace.dir.length + 1)).join(', ')}`)
    } catch (error) {
      this.say('error', `Outputs could not be written: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (this.compare && run.kind !== 'auto') setMeta(this.db, 'desk_compare', JSON.stringify(this.compare))
    this.progress = { ...this.progress, running: false, stopping: false }
  }
}
