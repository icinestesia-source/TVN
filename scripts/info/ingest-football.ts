/**
 * Fetch football-data.org (free tier) and write public/info/football.json.
 * Requires FOOTBALL_DATA_TOKEN in the environment (GitHub Actions secret or local export).
 *
 * Scheduled runs honour Europe/London slots (see src/info/football/schedule.ts).
 * Manual / forced runs: FOOTBALL_INGEST_FORCE=1 (workflow_dispatch sets this).
 *
 * Run: npm run info:football
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ingestFootballDataOrg } from '../../src/info/football/football-data-org.ts'
import { addDaysIso, emptyFootballSnapshot, todayIso } from '../../src/info/football/normalize.ts'
import { footballIngestForced, footballSlotDue } from '../../src/info/football/schedule.ts'
import type { FootballSnapshot } from '../../src/info/football/types.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outPath = join(root, 'public/info/football.json')
const slotPath = join(root, '.cache/info-football-slot')

function previousSnapshot(): FootballSnapshot | null {
  try {
    const parsed = JSON.parse(readFileSync(outPath, 'utf8')) as FootballSnapshot
    return parsed.format === 'tvn-info-football-v1' ? parsed : null
  } catch {
    return null
  }
}

function writeSnapshot(snapshot: FootballSnapshot): void {
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(snapshot)}\n`, 'utf8')
}

function lastSlotKey(): string | null {
  try {
    return readFileSync(slotPath, 'utf8').trim() || null
  } catch {
    return null
  }
}

function rememberSlotKey(key: string): void {
  mkdirSync(dirname(slotPath), { recursive: true })
  writeFileSync(slotPath, `${key}\n`, 'utf8')
}

function emitWrote(wrote: boolean): void {
  const marker = join(root, '.cache/info-football-wrote')
  mkdirSync(dirname(marker), { recursive: true })
  writeFileSync(marker, wrote ? '1\n' : '0\n', 'utf8')
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `wrote=${wrote ? 'true' : 'false'}\n`, { flag: 'a' })
  }
}

function shouldIngestNow(): { run: boolean; reason: string; slotKey?: string } {
  if (footballIngestForced(process.env)) {
    return { run: true, reason: 'forced' }
  }
  const due = footballSlotDue(new Date())
  if (!due) {
    return { run: false, reason: 'outside Europe/London football schedule window' }
  }
  if (lastSlotKey() === due.key) {
    return { run: false, reason: `slot ${due.key} already ingested` }
  }
  return { run: true, reason: `schedule ${due.key}`, slotKey: due.key }
}

async function main(): Promise<void> {
  const gate = shouldIngestNow()
  if (!gate.run) {
    console.log(`Football ingest skipped: ${gate.reason}`)
    emitWrote(false)
    process.exitCode = 0
    return
  }

  const token = process.env.FOOTBALL_DATA_TOKEN?.trim()
  const prior = previousSnapshot()
  if (!token) {
    const snapshot =
      prior && (prior.matches.length || prior.tables.length)
        ? prior
        : emptyFootballSnapshot(
            'DATA NOT YET PUBLISHED — Add FOOTBALL_DATA_TOKEN to run football ingest (free token from football-data.org), then publish the snapshot.',
          )
    if (!prior) writeSnapshot(snapshot)
    console.error(snapshot.unavailableReason ?? 'FOOTBALL_DATA_TOKEN missing; kept previous snapshot.')
    emitWrote(false)
    process.exitCode = 0
    return
  }

  const from = addDaysIso(todayIso(), -7)
  const to = addDaysIso(todayIso(), 21)
  try {
    const snapshot = await ingestFootballDataOrg({ token, dateFrom: from, dateTo: to })
    if (snapshot.matches.length === 0 && snapshot.tables.length === 0 && prior && (prior.matches.length || prior.tables.length)) {
      console.error('Football ingest empty; keeping previous snapshot.', snapshot.errors?.join('; '))
      emitWrote(false)
      process.exitCode = 0
      return
    }
    writeSnapshot(snapshot)
    if (gate.slotKey) rememberSlotKey(gate.slotKey)
    emitWrote(true)
    console.log(
      `Wrote ${snapshot.matches.length} matches and ${snapshot.tables.length} tables to ${outPath}` +
        (snapshot.errors?.length ? ` · ${snapshot.errors.length} warnings` : '') +
        ` · ${gate.reason}`,
    )
  } catch (caught) {
    if (prior && (prior.matches.length || prior.tables.length)) {
      console.error('Football ingest failed; keeping previous snapshot.', caught instanceof Error ? caught.message : caught)
      emitWrote(false)
      process.exitCode = 0
      return
    }
    writeSnapshot(emptyFootballSnapshot(caught instanceof Error ? caught.message : 'Football ingest failed'))
    emitWrote(true)
    console.error(caught instanceof Error ? caught.message : caught)
    process.exitCode = 1
  }
}

main()
