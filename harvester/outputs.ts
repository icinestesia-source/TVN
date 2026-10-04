import { existsSync, renameSync, rmSync } from 'node:fs'
import { serialiseTvnExport } from '../src/services/tvn-export.ts'
import { checkedCorpus } from './corpus.ts'
import { getMeta, type Db } from './db.ts'
import { stamp, writeAtomic } from './files.ts'
import type { ChannelHealth } from './health.ts'
import { crossChannelDuplicates, gapSummary, healthSummary } from './health.ts'
import type { Workspace } from './workspace.ts'

export const ADDITIONS_FORMAT = 'tvn-harvester-additions-v1'

interface ChangeRow {
  kind: 'added' | 'date' | 'metadata' | 'unavailable' | 'status' | 'source'
  provenance: string
  video_id: string | null
  detail: string | null
  at: string
  channel_key: string
  scope: string
  number: number
  channel_name: string
  stable_id: string | null
  layer: string
  source_key: string
  source_provenance: string
  source_type: string
  url: string
  provider_id: string | null
  label: string
}

export interface RunTotals {
  sourcesQueued: number
  sourcesDone: number
  sourcesFailed: number
  sourcesSkipped: number
  sourcesPending: number
  channelsProcessed: number
  added: number
  enriched: number
  datesAdded: number
  refused: number
  unavailable: number
  requests: number
}

export function runTotals(db: Db, runId: number): RunTotals {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS queued,
        SUM(state = 'done') AS done, SUM(state = 'failed') AS failed, SUM(state = 'skipped') AS skipped, SUM(state = 'pending') AS pending,
        COUNT(DISTINCT CASE WHEN state IN ('done', 'failed') THEN channel_id END) AS channels,
        COALESCE(SUM(added), 0) AS added, COALESCE(SUM(enriched), 0) AS enriched, COALESCE(SUM(dates_added), 0) AS dates,
        COALESCE(SUM(refused), 0) AS refused, COALESCE(SUM(unavailable), 0) AS unavailable
       FROM run_queue WHERE run_id = ?`,
    )
    .get(runId) as Record<string, number | null>
  const requests = Number(getMeta(db, `run_${runId}_requests`) ?? 0)
  return {
    sourcesQueued: row.queued ?? 0,
    sourcesDone: row.done ?? 0,
    sourcesFailed: row.failed ?? 0,
    sourcesSkipped: row.skipped ?? 0,
    sourcesPending: row.pending ?? 0,
    channelsProcessed: row.channels ?? 0,
    added: row.added ?? 0,
    enriched: row.enriched ?? 0,
    datesAdded: row.dates ?? 0,
    refused: row.refused ?? 0,
    unavailable: row.unavailable ?? 0,
    requests,
  }
}

/**
 * A run's additions: only what changed, grouped by channel and source, each change attributable to the run.
 * New programmes carry everything the corpus now holds for them; enrichments carry only the fields added.
 */
export function additionsDocument(db: Db, runId: number, now: Date): object {
  const run = db.prepare('SELECT id, kind, mode, status, range_from, range_to, started_at, ended_at FROM runs WHERE id = ?').get(runId) as Record<string, unknown>
  const rows = db
    .prepare(
      `SELECT c.kind, c.provenance, c.video_id, c.detail, c.at, ch.key AS channel_key, ch.scope, ch.number, ch.name AS channel_name, ch.stable_id, ch.layer,
        s.key AS source_key, s.provenance AS source_provenance, s.source_type, s.url, s.provider_id, s.label
       FROM changes c JOIN channels ch ON ch.id = c.channel_id JOIN sources s ON s.id = c.source_id
       WHERE c.run_id = ? ORDER BY ch.number, s.position, c.id`,
    )
    .all(runId) as unknown as ChangeRow[]
  const channels = new Map<string, { channel: object; sources: Map<string, Record<string, unknown>> }>()
  for (const row of rows) {
    let channel = channels.get(row.channel_key)
    if (!channel) {
      channel = { channel: { key: row.channel_key, ...(row.stable_id ? { stableId: row.stable_id } : {}), scope: row.scope, layer: row.layer, number: row.number, name: row.channel_name }, sources: new Map() }
      channels.set(row.channel_key, channel)
    }
    let source = channel.sources.get(row.source_key)
    if (!source) {
      source = { key: row.source_key, provenance: row.source_provenance, sourceType: row.source_type, url: row.url, ...(row.provider_id ? { providerId: row.provider_id } : {}), label: row.label, sourceAdded: [], added: [], dates: [], metadata: [], unavailable: [], status: [] }
      channel.sources.set(row.source_key, source)
    }
    const detail = row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : {}
    const by = { provenance: row.provenance, at: row.at }
    const list = {
      added: () => (source.added as unknown[]).push({ ...detail, ...by }),
      date: () => (source.dates as unknown[]).push({ id: row.video_id, published: detail.published, ...by }),
      metadata: () => (source.metadata as unknown[]).push({ id: row.video_id, fields: detail, ...by }),
      unavailable: () => (source.unavailable as unknown[]).push({ id: row.video_id, ...by }),
      status: () => (source.status as unknown[]).push({ ...detail, ...by }),
      source: () => (source.sourceAdded as unknown[]).push({ ...detail, ...by }),
    }
    list[row.kind]()
  }
  return {
    format: ADDITIONS_FORMAT,
    workspaceId: getMeta(db, 'workspace_id'),
    masterSha256: getMeta(db, 'master_sha256'),
    generatedAt: now.toISOString(),
    run: { ...run, totals: runTotals(db, runId) },
    channels: [...channels.values()].map(({ channel, sources }) => ({
      ...channel,
      sources: [...sources.values()].map((source) => Object.fromEntries(Object.entries(source).filter(([, value]) => !Array.isArray(value) || value.length > 0))),
    })),
  }
}

export function writeAdditions(workspace: Workspace, runId: number, now: Date = new Date()): string {
  const path = workspace.path('additions', `RUN_${runId}_additions.json`)
  writeAtomic(path, `${JSON.stringify(additionsDocument(workspace.db, runId, now), null, 2)}\n`)
  return path
}

const CSV_COLUMNS: (keyof ChannelHealth)[] = [
  'number', 'name', 'scope', 'layer', 'class', 'gap', 'sourcesConfigured', 'sourcesEnabled', 'sourcesRefreshable', 'creators', 'available', 'eligible', 'filteredOut', 'editorialExcluded', 'scheduled', 'playable', 'hours',
  'knownDates', 'knownDatePct', 'unknownDates', 'held', 'excluded', 'deadRefused', 'duplicates', 'newLatestRun', 'brokenSources', 'shipped', 'fromMaster', 'fromAuto', 'fromDesk', 'lastSuccess', 'lastAttempt', 'stableId', 'key',
]

const cell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) || /^[=+\-@]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function healthCsv(health: readonly ChannelHealth[]): string {
  return [CSV_COLUMNS.join(','), ...health.map((item) => CSV_COLUMNS.map((column) => cell(item[column])).join(','))].join('\n') + '\n'
}

export function writeReports(workspace: Workspace, health: readonly ChannelHealth[], runId: number | null, now: Date = new Date()): string[] {
  const csv = workspace.path('reports', 'channel_health.csv')
  writeAtomic(csv, healthCsv(health))
  const written = [csv]
  if (runId) {
    const kept = workspace.path('reports', `RUN_${runId}_channel_health.csv`)
    writeAtomic(kept, healthCsv(health))
    written.push(kept)
  }
  const summary = {
    generatedAt: now.toISOString(),
    workspaceId: getMeta(workspace.db, 'workspace_id'),
    run: runId ? { ...(workspace.db.prepare('SELECT id, kind, mode, status, range_from, range_to, started_at, ended_at, elapsed_ms FROM runs WHERE id = ?').get(runId) as object), totals: runTotals(workspace.db, runId) } : null,
    channels: health.length,
    centralChannels: health.filter((item) => item.scope === 'central').length,
    userChannels: health.filter((item) => item.scope === 'user').length,
    health: healthSummary(health),
    gaps: gapSummary(health),
    programmes: health.reduce((sum, item) => sum + item.available, 0),
    knownDates: health.reduce((sum, item) => sum + item.knownDates, 0),
    crossChannelDuplicates: crossChannelDuplicates(workspace.db),
    sourceOutcomes: Object.fromEntries((workspace.db.prepare('SELECT COALESCE(status, \'NOT YET VISITED\') AS status, COUNT(*) AS n FROM sources GROUP BY 1 ORDER BY 1').all() as { status: string; n: number }[]).map((row) => [row.status, row.n])),
  }
  const named = runId ? workspace.path('reports', `RUN_${runId}_summary.json`) : workspace.path('reports', 'summary.json')
  writeAtomic(named, `${JSON.stringify(summary, null, 2)}\n`)
  written.push(named)
  return written
}

/** A consistent copy of the working database in checkpoints/, made by SQLite itself while the run goes on. */
export function snapshotDb(workspace: Workspace, runId: number | null, kind: string, now: Date = new Date()): string {
  let name = `harvester_${stamp(now)}.db`
  for (let n = 2; existsSync(workspace.path('checkpoints', name)); n += 1) name = `harvester_${stamp(now)}_${n}.db`
  const path = workspace.path('checkpoints', name)
  const temp = `${path}.tmp`
  rmSync(temp, { force: true })
  workspace.db.prepare('VACUUM INTO ?').run(temp)
  renameSync(temp, path)
  workspace.db.prepare('INSERT INTO checkpoints (run_id, at, kind, path) VALUES (?, ?, ?, ?)').run(runId, now.toISOString(), kind, path)
  return path
}

/** EXPORT CORPUS: the whole harvested corpus as a Complete Export TVN can restore, checked before it is written. */
export function exportCorpus(workspace: Workspace, now: Date = new Date()): { path: string; bytes: number } {
  const lastRun = (workspace.db.prepare('SELECT MAX(id) AS id FROM runs').get() as { id: number | null }).id
  const doc = checkedCorpus(workspace.db, now, lastRun)
  const pad = (value: number) => String(value).padStart(2, '0')
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  let path = workspace.path('exports', `TVN_Master_Corpus_Harvested_${day}.json`)
  for (let n = 1; existsSync(path); n += 1) path = workspace.path('exports', `TVN_Master_Corpus_Harvested_${stamp(now)}${n > 1 ? `_${n}` : ''}.json`)
  const text = serialiseTvnExport(doc)
  writeAtomic(path, text)
  return { path, bytes: Buffer.byteLength(text) }
}
