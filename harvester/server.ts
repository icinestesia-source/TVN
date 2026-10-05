import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getMeta, setMeta } from './db.ts'
import { Harvester, type EngineDeps } from './engine.ts'
import {
  addPending,
  currentChannel,
  deskProgress,
  deskView,
  enrichmentOf,
  ensureBefore,
  goTo,
  goToNumber,
  markNeedsMore,
  markReviewed,
  next,
  previous,
  removePending,
  sessionReport,
  skip,
} from './desk.ts'
import { approveCandidates, autoApprovable, discover, discoveryView, liveDiscoveryDeps, PROVIDERS_NOT_SEARCHED, rejectCandidates, suitableIds, type DiscoveryDeps } from './discovery.ts'
import { computeHealth, gapSummary, healthSummary, storedHealth } from './health.ts'
import { JobQueue, type Job } from './jobs.ts'
import { exportCorpus, runTotals, writeAdditions, writeReports } from './outputs.ts'
import { createWorkspace, FOLDERS, isWorkspace, lockWorkspace, masterIntact, masterRecord, openWorkspace, unlockWorkspace, type Workspace } from './workspace.ts'

export interface OperatorDeps {
  engine?: EngineDeps
  /** Discovery's lookups (the public results pages and TVN's reader unless a test supplies its own). */
  discovery?: (workspace: Workspace, signal: AbortSignal) => DiscoveryDeps
  now?: () => Date
}

const flag = (value: string | null) => value === '1'

/**
 * The operator window's state lives here, in the one process that owns the workspace, never in a page. Every
 * piece of work is a job in its queue, so the window sees all of it and SQLite has a single writer.
 */
export class Operator {
  workspace: Workspace | null = null
  harvester: Harvester | null = null
  queue: JobQueue | null = null
  notice: string | null = null
  private readonly deps: OperatorDeps
  private readonly port: number | undefined

  constructor(deps: OperatorDeps = {}, port?: number) {
    this.deps = deps
    this.port = port
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  open(dir: string, master?: string): void {
    if (this.queue?.busy()) throw new Error('Stop the running jobs before changing workspace')
    const creating = Boolean(master && !isWorkspace(dir))
    if (!creating) lockWorkspace(dir, 'serve', this.port)
    let next: Workspace
    try {
      next = creating ? createWorkspace(dir, master as string).workspace : openWorkspace(dir)
      if (creating) lockWorkspace(next.dir, 'serve', this.port)
    } catch (error) {
      if (!creating) unlockWorkspace(dir)
      throw error
    }
    if (this.workspace && this.workspace.dir !== next.dir) {
      this.workspace.db.close()
      unlockWorkspace(this.workspace.dir)
    }
    this.workspace = next
    this.harvester = new Harvester(next, this.deps.engine)
    const harvester = this.harvester
    this.queue = new JobQueue(next.db, { run: (job, signal) => this.run(job, signal), stopEngine: () => harvester.stop() }, (level, message) => harvester.note(level, message), () => this.now())
    if (!getMeta(next.db, 'session_started_at')) setMeta(next.db, 'session_started_at', this.now().toISOString())
    this.notice = `Workspace ${next.dir}`
    try {
      this.harvester.baseline()
    } catch (error) {
      this.notice = `Workspace ${next.dir} · shipped 001–999 baseline not read: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  close(): void {
    if (!this.workspace) return
    this.workspace.db.close()
    unlockWorkspace(this.workspace.dir)
    this.workspace = null
    this.harvester = null
    this.queue = null
  }

  private need(): { workspace: Workspace; harvester: Harvester; queue: JobQueue } {
    if (!this.workspace || !this.harvester || !this.queue) throw new Error('Open or create a workspace first')
    return { workspace: this.workspace, harvester: this.harvester, queue: this.queue }
  }

  private where(channelId: number): string {
    const row = this.need().workspace.db.prepare('SELECT number, name FROM channels WHERE id = ?').get(channelId) as { number: number; name: string } | undefined
    return row ? `${String(row.number).padStart(3, '0')} ${row.name}` : `channel ${channelId}`
  }

  /** What each job does. The engine lane's jobs run one at a time; discovery runs beside them. */
  private async run(job: Job, signal: AbortSignal): Promise<string> {
    const { workspace, harvester, queue } = this.need()
    const db = workspace.db
    const channelId = job.channelId as number
    switch (job.kind) {
      case 'auto': {
        await harvester.start(job.params as { from?: number; to?: number })
        const last = harvester.lastRun()
        return last ? `run ${last.id} ${last.status}` : ''
      }
      case 'resume':
        await harvester.resume()
        return ''
      case 'refresh': {
        await harvester.refreshChannel(channelId)
        const compare = harvester.compare
        return compare?.after && compare.before ? `eligible ${compare.before.eligible} → ${compare.after.eligible}, ${compare.before.hours} h → ${compare.after.hours} h` : ''
      }
      case 'harvest': {
        await harvester.scanDesk(channelId)
        const results = harvester.compare?.results ?? []
        const programmes = results.reduce((sum, item) => sum + item.programmes, 0)
        const eligible = results.reduce((sum, item) => sum + item.eligible, 0)
        const left = (db.prepare("SELECT COUNT(*) AS n FROM desk_pending WHERE channel_id = ? AND status IN ('READY', 'SCANNING')").get(channelId) as { n: number }).n
        if (job.params.andNext === true && left === 0 && !signal.aborted && currentChannel(db).id === channelId) this.move(() => next(db, this.now()))
        return `${results.length} source(s): ${programmes} discovered, ${eligible} eligible, ${programmes - eligible} excluded by rules`
      }
      case 'discover': {
        const deps = this.deps.discovery?.(workspace, signal) ?? liveDiscoveryDeps(workspace.config.pacing, signal, (level, message) => harvester.note(level, message))
        const summary = await discover(db, channelId, workspace.config.discovery, deps, {
          now: this.now(),
          ...(typeof job.params.extra === 'string' && job.params.extra ? { extra: job.params.extra } : {}),
          includeRejected: job.params.includeRejected === true,
          force: job.params.force === true,
        })
        let auto = 0
        if (flag(getMeta(db, 'auto_add_high')) && !signal.aborted) {
          const chosen = discoveryView(db, channelId).candidates.filter((candidate) => autoApprovable(candidate, workspace.config.discovery))
          auto = approveCandidates(
            db,
            channelId,
            chosen.map((candidate) => candidate.id),
            'auto-high-confidence',
            this.now(),
          )
          if (auto > 0) {
            harvester.note('info', `${this.where(channelId)}: AUTO-ADD HIGH CONFIDENCE approved ${auto} candidate(s)`)
            queue.submit('harvest', {}, { channelId, label: `HARVEST APPROVED SOURCES ${this.where(channelId)}`, origin: 'auto-high-confidence' })
          }
        }
        return `${summary.cached ? 'cached · ' : ''}${summary.counts.shown} candidate(s) shown of ${summary.counts.found} found${auto ? `, ${auto} auto-approved` : ''}`
      }
      case 'export': {
        const made = exportCorpus(workspace)
        this.notice = `EXPORTED ${made.path}`
        return made.path
      }
      case 'report': {
        const files = this.writeReports()
        return `${files.length} files`
      }
    }
  }

  private writeReports(): string[] {
    const { workspace, harvester } = this.need()
    const health = computeHealth(workspace.db, workspace.config.health)
    const last = harvester.lastRun()
    const files = writeReports(workspace, health, last?.id ?? null)
    if (last) files.push(writeAdditions(workspace, last.id))
    files.push(this.writeSessionReport())
    this.notice = `REPORTS WRITTEN (${files.length} files)`
    return files
  }

  private writeSessionReport(): string {
    const { workspace } = this.need()
    const since = getMeta(workspace.db, 'session_started_at') ?? new Date(0).toISOString()
    const file = workspace.path('reports', `SESSION_${since.replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, `${JSON.stringify({ ...sessionReport(workspace.db, since), writtenAt: this.now().toISOString() }, null, 2)}\n`)
    return file
  }

  /** A desk move: the channel arrived at is measured BEFORE anything is done to it, and ASSIST starts its work. */
  private move(step: () => unknown): void {
    const { workspace } = this.need()
    step()
    const here = currentChannel(workspace.db)
    ensureBefore(workspace.db, here.id, this.now())
    if (flag(getMeta(workspace.db, 'assist_on'))) this.assist(here.id)
  }

  /** ENRICHMENT ASSIST: refresh the channel's own sources and look for more, then wait for the operator's approval. */
  private assist(channelId: number): void {
    const { queue } = this.need()
    queue.submit('refresh', {}, { channelId, label: `REFRESH CHANNEL ${this.where(channelId)}`, origin: 'assist' })
    queue.submit('discover', {}, { channelId, label: `DISCOVER SOURCES ${this.where(channelId)}`, origin: 'assist' })
  }

  start(range: { from?: number; to?: number }): void {
    const label = `AUTO REFRESH ${range.from ?? 1}–${range.to ?? 'ALL'}`
    this.need().queue.submit('auto', range, { label })
  }

  /** The Source Desk's actions, all on the channel it is on. */
  desk(action: string, input: Record<string, unknown>): void {
    const { workspace, queue } = this.need()
    const db = workspace.db
    const now = this.now()
    const here = currentChannel(db)
    const number = (value: unknown) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null)
    const ids = (value: unknown) => (Array.isArray(value) ? value.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [])
    switch (action) {
      case 'goto': {
        const wanted = number(input.number)
        if (input.channelId !== undefined) this.move(() => goTo(db, Number(input.channelId)))
        else if (wanted !== null) this.move(() => goToNumber(db, wanted))
        else throw new Error('GO TO needs a channel number')
        return
      }
      case 'next':
        this.move(() => next(db, now))
        return
      case 'previous':
        this.move(() => previous(db))
        return
      case 'skip':
        this.move(() => skip(db, now))
        return
      case 'needs-more':
        markNeedsMore(db, now, typeof input.note === 'string' ? input.note : undefined)
        return
      case 'reviewed':
        markReviewed(db, now)
        return
      case 'paste':
        addPending(db, here.id, String(input.text ?? '').slice(0, 50_000), now)
        return
      case 'remove':
        removePending(db, here.id, Number(input.id))
        return
      case 'refresh':
        queue.submit('refresh', {}, { channelId: here.id, label: `REFRESH CHANNEL ${this.where(here.id)}` })
        return
      case 'scan':
        queue.submit('harvest', input.andNext === true ? { andNext: true } : {}, { channelId: here.id, label: `HARVEST APPROVED SOURCES ${this.where(here.id)}` })
        return
      case 'discover': {
        const extra = typeof input.extra === 'string' ? input.extra.trim().slice(0, 200) : ''
        const params = { ...(extra ? { extra } : {}), ...(input.force === true || extra ? { force: true } : {}), ...(input.includeRejected === true ? { includeRejected: true } : {}) }
        queue.submit('discover', params, { channelId: here.id, label: `${params.force ? 'SEARCH AGAIN' : 'DISCOVER SOURCES'} ${this.where(here.id)}${extra ? ` + "${extra}"` : ''}` })
        return
      }
      case 'approve':
      case 'approve-suitable': {
        const chosen = action === 'approve' ? ids(input.ids) : suitableIds(discoveryView(db, here.id))
        const approved = approveCandidates(db, here.id, chosen, 'operator', now)
        if (approved === 0) throw new Error(action === 'approve' ? 'Choose candidates to add' : 'No suitable candidates to add')
        this.notice = `${approved} source(s) approved for ${this.where(here.id)}`
        queue.submit('harvest', {}, { channelId: here.id, label: `HARVEST APPROVED SOURCES ${this.where(here.id)}` })
        return
      }
      case 'reject': {
        const rejected = rejectCandidates(db, here.id, ids(input.ids), now)
        if (rejected === 0) throw new Error('Choose candidates to reject')
        this.notice = `${rejected} candidate(s) rejected; they stay hidden for this channel unless its description or filters change`
        return
      }
      case 'assist': {
        const on = input.on === true
        setMeta(db, 'assist_on', on ? '1' : '0')
        if (on) this.assist(here.id)
        return
      }
      case 'auto-add':
        setMeta(db, 'auto_add_high', input.on === true ? '1' : '0')
        return
      case 'new-session':
        this.writeSessionReport()
        setMeta(db, 'session_started_at', now.toISOString())
        this.notice = 'New enrichment session started; the last one was written to reports'
        return
      default:
        throw new Error('Not a Source Desk action')
    }
  }

  resume(): void {
    this.need().queue.submit('resume', {}, { label: 'RESUME AUTO' })
  }

  /** A job handed over by the command line while this window owns the workspace. */
  submit(kind: string, input: Record<string, unknown>): Job {
    const { workspace, queue } = this.need()
    const number = Number(input.channel)
    const channel = Number.isInteger(number) && number > 0 ? (workspace.db.prepare("SELECT id FROM channels WHERE number = ? ORDER BY CASE scope WHEN 'central' THEN 0 ELSE 1 END LIMIT 1").get(number) as { id: number } | undefined) : undefined
    const params = input.params && typeof input.params === 'object' ? (input.params as Record<string, unknown>) : {}
    switch (kind) {
      case 'auto':
        return queue.submit('auto', params, { label: `AUTO REFRESH ${params.from ?? 1}–${params.to ?? 'ALL'}`, origin: 'cli' })
      case 'resume':
      case 'export':
      case 'report':
        return queue.submit(kind, {}, { label: kind.toUpperCase(), origin: 'cli' })
      case 'refresh':
      case 'discover':
      case 'harvest':
        if (!channel) throw new Error(`There is no channel ${input.channel}`)
        return queue.submit(kind, params, { channelId: channel.id, label: `${{ refresh: 'REFRESH CHANNEL', discover: 'DISCOVER SOURCES', harvest: 'HARVEST APPROVED SOURCES' }[kind]} ${this.where(channel.id)}`, origin: 'cli' })
      default:
        throw new Error('Not a job the Harvester runs')
    }
  }

  stop(): void {
    this.need().queue.stopAll()
  }

  cancelJob(id: number): void {
    this.need().queue.cancel(id)
  }

  exportCorpus(): void {
    this.need().queue.submit('export', {}, { label: 'EXPORT CORPUS' })
  }

  report(): void {
    this.need().queue.submit('report', {}, { label: 'REPORT' })
  }

  openFolder(folder: string): void {
    const { workspace } = this.need()
    const target = (FOLDERS as readonly string[]).includes(folder) ? workspace.path(folder as (typeof FOLDERS)[number]) : workspace.dir
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], { detached: true, stdio: 'ignore' }).unref()
  }

  state(full = false): object {
    if (!this.workspace || !this.harvester || !this.queue) return { workspace: null, suggested: join(homedir(), 'Documents', 'TVN_Harvester'), notice: this.notice }
    const { workspace, harvester, queue } = this
    const db = workspace.db
    const last = harvester.lastRun()
    const unfinished = harvester.running ? null : harvester.unfinishedRun()
    const health = storedHealth(db)
    const here = currentChannel(db)
    ensureBefore(db, here.id, this.now())
    const compare = harvester.compare ?? (JSON.parse(getMeta(db, 'desk_compare') ?? 'null') as { channelId: number } | null)
    const since = getMeta(db, 'session_started_at') ?? new Date(0).toISOString()
    return {
      workspace: { dir: workspace.dir, id: getMeta(db, 'workspace_id'), schema: getMeta(db, 'schema_version'), created: getMeta(db, 'created_at') },
      master: { ...masterRecord(db), intact: masterIntact(db).ok },
      progress: { ...harvester.progress, elapsedMs: harvester.elapsed() },
      lastRun: last ? { ...last, totals: runTotals(db, last.id) } : null,
      unfinished,
      health: { summary: healthSummary(health), gaps: gapSummary(health), central: health.filter((item) => item.scope === 'central').length, user: health.filter((item) => item.scope === 'user').length, ...(full ? { channels: health } : {}) },
      desk: {
        view: deskView(db, here.id),
        progress: deskProgress(db),
        compare: compare && compare.channelId === here.id ? compare : null,
        enrichment: enrichmentOf(db, here.id, workspace.config.discovery.strongHours),
        discovery: { ...discoveryView(db, here.id), notSearched: PROVIDERS_NOT_SEARCHED },
        assist: flag(getMeta(db, 'assist_on')),
        autoAdd: flag(getMeta(db, 'auto_add_high')),
      },
      jobs: queue.list(),
      session: sessionReport(db, since),
      baseline: db.prepare('SELECT app_commit, app_build, imported_at, channels, sources, programmes FROM baseline WHERE id = 1').get() ?? null,
      log: harvester.log.slice(-200),
      thresholds: workspace.config.health,
      notice: this.notice,
    }
  }
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = ''
  for await (const chunk of request) {
    text += String(chunk)
    if (text.length > 100_000) throw new Error('Too large')
  }
  if (!text) return {}
  const parsed = JSON.parse(text) as unknown
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
}

function send(response: ServerResponse, status: number, value: unknown, type = 'application/json'): void {
  response.statusCode = status
  response.setHeader('content-type', type)
  response.setHeader('cache-control', 'no-store')
  response.end(type === 'application/json' ? JSON.stringify(value) : String(value))
}

export function serve(dir: string | null, port: number): Promise<void> {
  const operator = new Operator({}, port)
  if (dir) operator.open(dir)
  const page = readFileSync(new URL('./ui.html', import.meta.url), 'utf8')
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
      const host = request.headers.host ?? ''
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(response, 403, { error: 'Local only' })
      if (request.method === 'GET' && url.pathname === '/') return send(response, 200, page, 'text/html; charset=utf-8')
      if (request.method === 'GET' && url.pathname === '/api/state') return send(response, 200, operator.state(url.searchParams.get('health') === '1'))
      // A page elsewhere cannot send this header without a preflight this server never grants.
      if (request.method !== 'POST' || request.headers['x-harvester'] !== '1') return send(response, 404, { error: 'Not found' })
      try {
        const input = await body(request)
        switch (url.pathname) {
          case '/api/workspace':
            operator.open(String(input.dir ?? ''), typeof input.master === 'string' && input.master ? input.master : undefined)
            break
          case '/api/start': {
            const bound = (value: unknown) => (value === undefined || value === null || value === '' || String(value).toUpperCase() === 'ALL' ? undefined : Number(value))
            const from = bound(input.from)
            const to = bound(input.to)
            if ((from !== undefined && !(from >= 1)) || (to !== undefined && !(to >= (from ?? 1)))) throw new Error('AUTO FROM/TO must be channel numbers, FROM no later than TO')
            operator.start({ ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) })
            break
          }
          case '/api/resume':
            operator.resume()
            break
          case '/api/stop':
            operator.stop()
            break
          case '/api/export':
            operator.exportCorpus()
            break
          case '/api/report':
            operator.report()
            break
          case '/api/open':
            operator.openFolder(String(input.folder ?? ''))
            break
          case '/api/jobs/cancel':
            operator.cancelJob(Number(input.id))
            break
          case '/api/jobs/submit':
            return send(response, 200, { job: operator.submit(String(input.kind ?? ''), input) })
          default:
            if (url.pathname.startsWith('/api/desk/')) {
              operator.desk(url.pathname.slice('/api/desk/'.length), input)
              break
            }
            return send(response, 404, { error: 'Not found' })
        }
        send(response, 200, operator.state())
      } catch (error) {
        operator.notice = error instanceof Error ? error.message : String(error)
        send(response, 400, { error: operator.notice })
      }
    })()
  })
  const shutdown = () => {
    operator.queue?.stopAll()
    void (operator.queue?.idle() ?? Promise.resolve()).then(() => {
      operator.close()
      server.close()
      process.exit(0)
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`TVN Harvester at http://127.0.0.1:${port}`)
      resolve()
    })
  })
}
