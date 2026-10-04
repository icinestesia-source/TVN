import { computeHealth, healthSummary } from './health.ts'
import { Harvester, type EngineDeps } from './engine.ts'
import { exportCorpus, runTotals, snapshotDb, writeAdditions, writeReports } from './outputs.ts'
import { createWorkspace, masterIntact, masterRecord, openWorkspace, type Workspace } from './workspace.ts'
import { serve } from './server.ts'
import { SCHEMA_VERSION, getMeta } from './db.ts'

const USAGE = `TVN Harvester 2.0 (operator tool)

  harvester init <workspace> <complete-export.json>   create a workspace from a Complete Export (copied, never edited)
  harvester status <workspace>                        master, database, runs and health at a glance
  harvester auto <workspace> [--channels FROM-TO] [--stop-after SECONDS]
                                                      START AUTO: a new run of whatever is due (Ctrl-C = STOP)
  harvester resume <workspace> [--stop-after SECONDS] RESUME AUTO: carry the stopped run on
  harvester export <workspace>                        EXPORT CORPUS to exports/
  harvester report <workspace>                        health CSV and summary to reports/
  harvester snapshot <workspace>                      a database checkpoint to checkpoints/
  harvester serve [workspace] [--port 5190]           the operator window, at http://127.0.0.1:5190
`

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}

function describe(workspace: Workspace, harvester: Harvester): string {
  const master = masterRecord(workspace.db)
  const intact = masterIntact(workspace.db)
  const last = harvester.lastRun()
  const unfinished = harvester.unfinishedRun()
  const lines = [
    `Workspace ${workspace.dir}`,
    `  id ${getMeta(workspace.db, 'workspace_id')} · schema ${getMeta(workspace.db, 'schema_version')} (this Harvester ${SCHEMA_VERSION}) · created ${getMeta(workspace.db, 'created_at')}`,
    `Master ${master.filename} · ${master.format} v${master.version} · app ${master.app_commit ?? '?'} / ${master.app_build ?? '?'}`,
    `  ${master.channels} user channels · ${master.central} overrides · ${master.sources} sources · ${master.programmes} programmes (${master.dated} dated) · ${master.bytes} bytes`,
    `  sha256 ${master.sha256} · ${intact.ok ? 'UNCHANGED' : 'CHANGED OR MISSING'}`,
    last ? `Last run ${last.id} (${last.mode}) ${last.status.toUpperCase()} · started ${last.started_at}` : 'No runs yet',
  ]
  if (last) {
    const totals = runTotals(workspace.db, last.id)
    lines.push(`  sources ${totals.sourcesDone} done · ${totals.sourcesFailed} failed · ${totals.sourcesSkipped} skipped · ${totals.sourcesPending} to visit · +${totals.added} programmes · +${totals.datesAdded} dates · ${totals.requests} requests`)
  }
  if (unfinished) lines.push(`RESUME AUTO available for run ${unfinished.id}`)
  return lines.join('\n')
}

async function runAuto(workspace: Workspace, args: string[], resume: boolean): Promise<void> {
  const range = option(args, '--channels')?.match(/^(\d+)-(\d+)$/)
  const deps: EngineDeps = {
    onLog: (line) => console.log(`${line.at.slice(11, 19)} ${line.level === 'info' ? '' : `${line.level.toUpperCase()} `}${line.message}`),
    ...(range ? { numbers: { from: Number(range[1]), to: Number(range[2]) } } : {}),
  }
  const harvester = new Harvester(workspace, deps)
  const stopAfter = Number(option(args, '--stop-after') ?? 0)
  const stop = () => harvester.stop()
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  const timer = stopAfter > 0 ? setTimeout(stop, stopAfter * 1000) : null
  try {
    await (resume ? harvester.resume() : harvester.start())
  } finally {
    if (timer) clearTimeout(timer)
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
  console.log(describe(workspace, harvester))
}

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
    console.log(describe(workspace, new Harvester(workspace)))
    return
  }
  const workspace = openWorkspace(dir)
  switch (command) {
    case 'status':
      console.log(describe(workspace, new Harvester(workspace)))
      return
    case 'auto':
      return runAuto(workspace, rest, false)
    case 'resume':
      return runAuto(workspace, rest, true)
    case 'export': {
      const made = exportCorpus(workspace)
      console.log(`Exported ${made.path} (${made.bytes} bytes)`)
      return
    }
    case 'report': {
      const health = computeHealth(workspace.db, workspace.config.health)
      const last = new Harvester(workspace).lastRun()
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
