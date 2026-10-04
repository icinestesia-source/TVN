import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getMeta } from './db.ts'
import { Harvester } from './engine.ts'
import { deskQueue, healthSummary, type ChannelHealth } from './health.ts'
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
  }

  private need(): { workspace: Workspace; harvester: Harvester } {
    if (!this.workspace || !this.harvester) throw new Error('Open or create a workspace first')
    return { workspace: this.workspace, harvester: this.harvester }
  }

  start(): void {
    const { harvester } = this.need()
    void harvester.start().catch((error: unknown) => (this.notice = String(error)))
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

  state(): object {
    if (!this.workspace || !this.harvester) return { workspace: null, suggested: join(homedir(), 'Documents', 'TVN_Harvester'), notice: this.notice }
    const { workspace, harvester } = this
    const db = workspace.db
    const last = harvester.lastRun()
    const unfinished = harvester.running ? null : harvester.unfinishedRun()
    const health = (db.prepare('SELECT metrics FROM health').all() as { metrics: string }[]).map((row) => JSON.parse(row.metrics) as ChannelHealth)
    return {
      workspace: { dir: workspace.dir, id: getMeta(db, 'workspace_id'), schema: getMeta(db, 'schema_version'), created: getMeta(db, 'created_at') },
      master: { ...masterRecord(db), intact: masterIntact(db).ok },
      progress: { ...harvester.progress, elapsedMs: harvester.elapsed() },
      lastRun: last ? { ...last, totals: runTotals(db, last.id) } : null,
      unfinished,
      health: { summary: healthSummary(health), channels: deskQueue(health) },
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
      if (request.method === 'GET' && url.pathname === '/api/state') return send(response, 200, operator.state())
      // A page elsewhere cannot send this header without a preflight this server never grants.
      if (request.method !== 'POST' || request.headers['x-harvester'] !== '1') return send(response, 404, { error: 'Not found' })
      try {
        const input = await body(request)
        switch (url.pathname) {
          case '/api/workspace':
            operator.open(String(input.dir ?? ''), typeof input.master === 'string' && input.master ? input.master : undefined)
            break
          case '/api/start':
            operator.start()
            break
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
