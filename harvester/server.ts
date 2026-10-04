import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getMeta } from './db.ts'
import { Harvester } from './engine.ts'
import { addPending, currentChannel, deskProgress, deskView, goTo, goToNumber, markNeedsMore, markReviewed, next, previous, removePending, skip } from './desk.ts'
import { gapSummary, healthSummary, storedHealth } from './health.ts'
import { exportCorpus, runTotals, writeAdditions, writeReports } from './outputs.ts'
import { computeHealth } from './health.ts'
import { createWorkspace, FOLDERS, isWorkspace, masterIntact, masterRecord, openWorkspace, type Workspace } from './workspace.ts'

/** The operator window's state lives here, in the engine's process, never in a page. */
class Operator {
  workspace: Workspace | null = null
  harvester: Harvester | null = null
  notice: string | null = null

  open(dir: string, master?: string): void {
    if (this.harvester?.running) throw new Error('Stop the run before changing workspace')
    const next = master && !isWorkspace(dir) ? createWorkspace(dir, master).workspace : openWorkspace(dir)
    this.workspace?.db.close()
    this.workspace = next
    this.harvester = new Harvester(next)
    this.notice = `Workspace ${next.dir}`
    try {
      this.harvester.baseline()
    } catch (error) {
      this.notice = `Workspace ${next.dir} · shipped 001–999 baseline not read: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private need(): { workspace: Workspace; harvester: Harvester } {
    if (!this.workspace || !this.harvester) throw new Error('Open or create a workspace first')
    return { workspace: this.workspace, harvester: this.harvester }
  }

  start(range: { from?: number; to?: number }): void {
    const { harvester } = this.need()
    void harvester.start(range).catch((error: unknown) => (this.notice = String(error)))
  }

  /** The Source Desk's actions, all on the channel it is on. */
  desk(action: string, input: Record<string, unknown>): void {
    const { workspace, harvester } = this.need()
    const db = workspace.db
    const now = new Date()
    const here = currentChannel(db)
    const number = (value: unknown) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null)
    switch (action) {
      case 'goto': {
        const wanted = number(input.number)
        if (input.channelId !== undefined) goTo(db, Number(input.channelId))
        else if (wanted !== null) goToNumber(db, wanted)
        else throw new Error('GO TO needs a channel number')
        return
      }
      case 'next':
        next(db, now)
        return
      case 'previous':
        previous(db)
        return
      case 'skip':
        skip(db, now)
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
        void harvester.refreshChannel(here.id).catch((error: unknown) => (this.notice = String(error)))
        return
      case 'scan': {
        const scanning = harvester.scanDesk(here.id)
        void scanning
          .then(() => {
            const left = (db.prepare("SELECT COUNT(*) AS n FROM desk_pending WHERE channel_id = ? AND status IN ('READY', 'SCANNING')").get(here.id) as { n: number }).n
            if (input.andNext === true && left === 0 && !harvester.progress.stopping && currentChannel(db).id === here.id) next(db, new Date())
          })
          .catch((error: unknown) => (this.notice = String(error)))
        return
      }
      default:
        throw new Error('Not a Source Desk action')
    }
  }

  resume(): void {
    const { harvester } = this.need()
    void harvester.resume().catch((error: unknown) => (this.notice = String(error)))
  }

  stop(): void {
    this.need().harvester.stop()
  }

  exportCorpus(): string {
    const { workspace } = this.need()
    const made = exportCorpus(workspace)
    this.notice = `EXPORTED ${made.path}`
    return made.path
  }

  report(): string[] {
    const { workspace, harvester } = this.need()
    const health = computeHealth(workspace.db, workspace.config.health)
    const last = harvester.lastRun()
    const files = writeReports(workspace, health, last?.id ?? null)
    if (last) files.push(writeAdditions(workspace, last.id))
    this.notice = `REPORTS WRITTEN (${files.length} files)`
    return files
  }

  openFolder(folder: string): void {
    const { workspace } = this.need()
    const target = (FOLDERS as readonly string[]).includes(folder) ? workspace.path(folder as (typeof FOLDERS)[number]) : workspace.dir
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], { detached: true, stdio: 'ignore' }).unref()
  }

  state(full = false): object {
    if (!this.workspace || !this.harvester) return { workspace: null, suggested: join(homedir(), 'Documents', 'TVN_Harvester'), notice: this.notice }
    const { workspace, harvester } = this
    const db = workspace.db
    const last = harvester.lastRun()
    const unfinished = harvester.running ? null : harvester.unfinishedRun()
    const health = storedHealth(db)
    const here = currentChannel(db)
    const compare = harvester.compare ?? (JSON.parse(getMeta(db, 'desk_compare') ?? 'null') as { channelId: number } | null)
    return {
      workspace: { dir: workspace.dir, id: getMeta(db, 'workspace_id'), schema: getMeta(db, 'schema_version'), created: getMeta(db, 'created_at') },
      master: { ...masterRecord(db), intact: masterIntact(db).ok },
      progress: { ...harvester.progress, elapsedMs: harvester.elapsed() },
      lastRun: last ? { ...last, totals: runTotals(db, last.id) } : null,
      unfinished,
      health: { summary: healthSummary(health), gaps: gapSummary(health), central: health.filter((item) => item.scope === 'central').length, user: health.filter((item) => item.scope === 'user').length, ...(full ? { channels: health } : {}) },
      desk: { view: deskView(db, here.id), progress: deskProgress(db), compare: compare && compare.channelId === here.id ? compare : null },
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
  const operator = new Operator()
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
    operator.harvester?.stop()
    void (operator.harvester?.settled() ?? Promise.resolve()).then(() => {
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
