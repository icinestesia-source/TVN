import { computeHealth, gapSummary, healthSummary, storedHealth } from './health.ts'
import { deskChannels, deskProgress, deskView, enrichmentOf } from './desk.ts'
import { discover, discoveryView, liveDiscoveryDeps } from './discovery.ts'
import { Harvester, lastRunOf, unfinishedRunOf, type EngineDeps } from './engine.ts'
import { exportCorpus, runTotals, snapshotDb, writeAdditions, writeReports } from './outputs.ts'
import { createWorkspace, lockWorkspace, masterIntact, masterRecord, openWorkspace, workspaceOwner, WorkspaceInUse, type Workspace } from './workspace.ts'
import { serve } from './server.ts'
import { SCHEMA_VERSION, getMeta } from './db.ts'

const USAGE = `TVN Harvester 2.0 (operator tool)

  harvester init <workspace> <complete-export.json>   create a workspace from a Complete Export (copied, never edited)
  harvester status <workspace>                        master, database, runs and health at a glance (read-only)
  harvester auto <workspace> [--from N] [--to M] [--stop-after SECONDS]
                                                      START AUTO: a new run of whatever is due from channel N (default 001) to M (default all) (Ctrl-C = STOP)
  harvester resume <workspace> [--stop-after SECONDS] RESUME AUTO: carry the stopped run on from its saved queue
  harvester refresh <workspace> <channel-number> [--stop-after SECONDS]
                                                      AUTO REFRESH CHANNEL: read one channel's existing sources now
  harvester discover <workspace> <channel-number> [--extra "terms"] [--again]
                                                      DISCOVER SOURCES: candidates for the channel, for approval in the operator window
  harvester baseline <workspace>                      read the shipped 001–999 network (once), matched to the master's TVN build
  harvester desk <workspace>                          Source Desk progress and the channel it is on (read-only)
  harvester export <workspace>                        EXPORT CORPUS to exports/
  harvester report <workspace>                        health CSV and summary to reports/
  harvester snapshot <workspace>                      a database checkpoint to checkpoints/
  harvester serve [workspace] [--port 5190]           the operator window, at http://127.0.0.1:5190

  One process owns a workspace's database. While the operator window has it open, auto, resume, refresh,
  discover, export and report are handed to the window's job queue (and shown there); status and desk read it.
`

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}

function describe(workspace: Workspace): string {
  const master = masterRecord(workspace.db)
  const intact = masterIntact(workspace.db)
  const last = lastRunOf(workspace.db)
  const unfinished = unfinishedRunOf(workspace.db)
  const lines = [
    `Workspace ${workspace.dir}`,
    `  id ${getMeta(workspace.db, 'workspace_id')} · schema ${getMeta(workspace.db, 'schema_version')} (this Harvester ${SCHEMA_VERSION}) · created ${getMeta(workspace.db, 'created_at')}`,
    `Master ${master.filename} · ${master.format} v${master.version} · app ${master.app_commit ?? '?'} / ${master.app_build ?? '?'}`,
    `  ${master.channels} user channels · ${master.central} overrides · ${master.sources} sources · ${master.programmes} programmes (${master.dated} dated) · ${master.bytes} bytes`,
    `  sha256 ${master.sha256} · ${intact.ok ? 'UNCHANGED' : 'CHANGED OR MISSING'}`,
    last ? `Last AUTO run ${last.id} (${last.mode}${last.range_from !== null ? `, channels ${last.range_from}–${last.range_to ?? 'ALL'}` : ''}) ${last.status.toUpperCase()} · started ${last.started_at}` : 'No runs yet',
  ]
  if (last) {
    const totals = runTotals(workspace.db, last.id)
    lines.push(`  sources ${totals.sourcesDone} done · ${totals.sourcesFailed} failed · ${totals.sourcesSkipped} skipped · ${totals.sourcesPending} to visit · +${totals.added} programmes · +${totals.datesAdded} dates · ${totals.requests} requests`)
  }
  if (unfinished) lines.push(`RESUME AUTO available for run ${unfinished.id}`)
  const baseline = workspace.db.prepare('SELECT app_commit, app_build, channels, sources, programmes FROM baseline WHERE id = 1').get() as { app_commit: string; app_build: string | null; channels: number; sources: number; programmes: number } | undefined
  lines.push(baseline ? `Shipped baseline TVN ${baseline.app_commit} / ${baseline.app_build ?? '?'}: ${baseline.channels} channels · ${baseline.sources} original sources · ${baseline.programmes} programmes` : 'Shipped 001–999 baseline not read yet')
  const owner = workspaceOwner(workspace.dir)
  if (owner) lines.push(`In use by ${owner.role === 'serve' ? `the operator window${owner.port ? ` (http://127.0.0.1:${owner.port})` : ''}` : 'a command'} · pid ${owner.pid} since ${owner.since}`)
  return lines.join('\n')
}

const logLine = (line: { at: string; level: string; message: string }) => console.log(`${line.at.slice(11, 19)} ${line.level === 'info' ? '' : `${line.level.toUpperCase()} `}${line.message}`)

function rangeOf(args: string[]): { from?: number; to?: number } {
  const legacy = option(args, '--channels')?.match(/^(\d+)-(\d+)$/)
  const from = option(args, '--from') ?? legacy?.[1]
  const to = option(args, '--to') ?? legacy?.[2]
  const range = { ...(from !== undefined ? { from: Number(from) } : {}), ...(to !== undefined && to.toUpperCase() !== 'ALL' ? { to: Number(to) } : {}) }
  if (Object.values(range).some((value) => !Number.isInteger(value) || value < 1)) throw new Error('--from and --to take channel numbers')
  return range
}

async function runAuto(workspace: Workspace, args: string[], how: 'start' | 'resume' | 'refresh', channel?: number): Promise<void> {
  const deps: EngineDeps = { onLog: logLine }
  const harvester = new Harvester(workspace, deps)
  const range = rangeOf(args)
  const stopAfter = Number(option(args, '--stop-after') ?? 0)
  const stop = () => harvester.stop()
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  const timer = stopAfter > 0 ? setTimeout(stop, stopAfter * 1000) : null
  try {
    if (how === 'refresh') {
      const found = deskChannels(workspace.db).find((item) => item.number === channel)
      if (!found) throw new Error(`There is no channel ${channel}`)
      await harvester.refreshChannel(found.id)
    } else await (how === 'resume' ? harvester.resume() : harvester.start(range))
  } finally {
    if (timer) clearTimeout(timer)
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
  console.log(describe(workspace))
}

async function runDiscover(workspace: Workspace, args: string[], number: number): Promise<void> {
  const found = deskChannels(workspace.db).find((item) => item.number === number)
  if (!found) throw new Error(`There is no channel ${number}`)
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.on('SIGINT', stop)
  try {
    const extra = option(args, '--extra')
    const summary = await discover(workspace.db, found.id, workspace.config.discovery, liveDiscoveryDeps(workspace.config.pacing, controller.signal, (level, message) => logLine({ at: new Date().toISOString(), level, message })), {
      now: new Date(),
      ...(extra ? { extra } : {}),
      force: args.includes('--again') || Boolean(extra),
    })
    console.log(`${summary.cached ? 'Cached search' : 'Search'} ${summary.id}: ${summary.counts.shown} candidates shown of ${summary.counts.found} found`)
    for (const candidate of discoveryView(workspace.db, found.id).candidates) {
      console.log(`  [${candidate.id}] ${candidate.relevance} ${candidate.label} · ${candidate.sourceType}${candidate.usedBy ? ` · ${candidate.usedBy}` : ''}`)
    }
    console.log('Approve or reject them in the operator window (harvester serve).')
  } finally {
    process.off('SIGINT', stop)
  }
}

/** The operator window owns the workspace: hand the job to its queue and follow it there until it ends. */
async function handOff(port: number, kind: string, body: Record<string, unknown>): Promise<void> {
  const base = `http://127.0.0.1:${port}`
  const post = async (path: string, value: Record<string, unknown>) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-harvester': '1' }, body: JSON.stringify(value) })
    const answer = (await response.json()) as { error?: string; job?: { id: number; label: string } }
    if (!response.ok) throw new Error(answer.error ?? `The operator window answered ${response.status}`)
    return answer
  }
  const { job } = await post('/api/jobs/submit', { kind, ...body })
  if (!job) throw new Error('The operator window did not queue the job')
  console.log(`The operator window (${base}) owns this workspace: job ${job.id} queued there: ${job.label}`)
  let seen = new Date().toISOString()
  const cancel = () => void post('/api/jobs/cancel', { id: job.id }).catch(() => undefined)
  process.on('SIGINT', cancel)
  try {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const state = (await (await fetch(`${base}/api/state`)).json()) as { log: { at: string; level: string; message: string }[]; jobs: { id: number; state: string; result: string | null }[] }
      for (const line of state.log.filter((item) => item.at > seen)) logLine(line)
      seen = state.log.at(-1)?.at ?? seen
      const mine = state.jobs.find((item) => item.id === job.id)
      if (!mine || !['queued', 'running'].includes(mine.state)) {
        console.log(`Job ${job.id} ${mine?.state ?? 'gone'}${mine?.result ? ` · ${mine.result}` : ''}`)
        return
      }
    }
  } finally {
    process.off('SIGINT', cancel)
  }
}

const HANDED = new Set(['auto', 'resume', 'refresh', 'discover', 'export', 'report'])

async function main(argv: string[]): Promise<void> {
  const [command, dir, ...rest] = argv
  if (command === 'serve') {
    const port = Number(option(argv, '--port') ?? 5190)
    await serve(dir && !dir.startsWith('--') ? dir : null, port)
    return
  }
  if (!command || !dir || command === 'help') {
    console.log(USAGE)
    return
  }
  if (command === 'init') {
    const master = rest[0]
    if (!master) throw new Error('Name the Complete Export to import')
    const { workspace, counts } = createWorkspace(dir, master)
    console.log(`Imported ${counts.channels} user channels, ${counts.central} overrides, ${counts.sources} sources, ${counts.programmes} programmes (${counts.dated} dated)`)
    console.log(describe(workspace))
    return
  }
  if (command === 'status' || command === 'desk') {
    const workspace = openWorkspace(dir, { readOnly: true })
    if (command === 'status') {
      console.log(describe(workspace))
      return
    }
    const progress = deskProgress(workspace.db)
    const view = deskView(workspace.db, deskChannels(workspace.db)[progress.channel.position - 1].id)
    const enrichment = enrichmentOf(workspace.db, view.channel.id, workspace.config.discovery.strongHours)
    console.log(`Source Desk on ${String(view.channel.number).padStart(3, '0')} ${view.channel.name} (${view.state}${enrichment.standing ? ` · ${enrichment.standing}` : ''}) · channel ${progress.channel.position} of ${progress.channel.total}`)
    console.log(`  reviewed ${progress.reviewed} · enriched ${progress.enriched} · skipped ${progress.skipped} · needs more ${progress.needsMore} · +${progress.newSources} sources · +${progress.newProgrammes} programmes · +${progress.newPlayableHours} h`)
    console.log(`  gaps ${JSON.stringify(gapSummary(storedHealth(workspace.db)))}`)
    return
  }
  const owner = workspaceOwner(dir)
  if (owner && owner.role === 'serve' && owner.port && HANDED.has(command)) {
    const channel = command === 'refresh' || command === 'discover' ? Number(rest[0]) : undefined
    const args = channel !== undefined ? rest.slice(1) : rest
    const extra = option(args, '--extra')
    const params = command === 'auto' ? rangeOf(args) : command === 'discover' ? { ...(extra ? { extra, force: true } : {}), ...(args.includes('--again') ? { force: true } : {}) } : {}
    return handOff(owner.port, command, { ...(channel !== undefined ? { channel } : {}), params })
  }
  if (owner) throw new WorkspaceInUse(owner)
  lockWorkspace(dir, 'cli')
  const workspace = openWorkspace(dir)
  switch (command) {
    case 'auto':
      return runAuto(workspace, rest, 'start')
    case 'resume':
      return runAuto(workspace, rest, 'resume')
    case 'refresh':
      return runAuto(workspace, rest.slice(1), 'refresh', Number(rest[0]))
    case 'discover':
      return runDiscover(workspace, rest.slice(1), Number(rest[0]))
    case 'baseline': {
      const harvester = new Harvester(workspace, { onLog: (line) => console.log(line.message) })
      harvester.baseline()
      console.log(describe(workspace))
      return
    }
    case 'export': {
      const made = exportCorpus(workspace)
      console.log(`Exported ${made.path} (${made.bytes} bytes)`)
      return
    }
    case 'report': {
      const health = computeHealth(workspace.db, workspace.config.health)
      const last = lastRunOf(workspace.db)
      const files = writeReports(workspace, health, last?.id ?? null)
      if (last) files.push(writeAdditions(workspace, last.id))
      console.log(files.join('\n'))
      console.log(healthSummary(health))
      return
    }
    case 'snapshot':
      console.log(snapshotDb(workspace, null, 'manual'))
      return
    default:
      console.log(USAGE)
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
