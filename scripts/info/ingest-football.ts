/**
 * Fetch football-data.org (free tier) and write public/info/football.json.
 * Requires FOOTBALL_DATA_TOKEN in the environment (GitHub Actions secret or local export).
 * Run: npm run info:football
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ingestFootballDataOrg } from '../../src/info/football/football-data-org.ts'
import { addDaysIso, emptyFootballSnapshot, todayIso } from '../../src/info/football/normalize.ts'
import type { FootballSnapshot } from '../../src/info/football/types.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outPath = join(root, 'public/info/football.json')

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

async function main(): Promise<void> {
  const token = process.env.FOOTBALL_DATA_TOKEN?.trim()
  const prior = previousSnapshot()
  if (!token) {
    const snapshot =
      prior && (prior.matches.length || prior.tables.length)
        ? prior
        : emptyFootballSnapshot('Add FOOTBALL_DATA_TOKEN to run football ingest (free token from football-data.org).')
    if (!prior) writeSnapshot(snapshot)
    console.error(snapshot.unavailableReason ?? 'FOOTBALL_DATA_TOKEN missing; kept previous snapshot.')
    process.exitCode = prior ? 0 : 0
    return
  }

  const from = addDaysIso(todayIso(), -7)
  const to = addDaysIso(todayIso(), 21)
  try {
    const snapshot = await ingestFootballDataOrg({ token, dateFrom: from, dateTo: to })
    if (snapshot.matches.length === 0 && snapshot.tables.length === 0 && prior && (prior.matches.length || prior.tables.length)) {
      console.error('Football ingest empty; keeping previous snapshot.', snapshot.errors?.join('; '))
      process.exitCode = 0
      return
    }
    writeSnapshot(snapshot)
    console.log(
      `Wrote ${snapshot.matches.length} matches and ${snapshot.tables.length} tables to ${outPath}` +
        (snapshot.errors?.length ? ` · ${snapshot.errors.length} warnings` : ''),
    )
  } catch (caught) {
    if (prior && (prior.matches.length || prior.tables.length)) {
      console.error('Football ingest failed; keeping previous snapshot.', caught instanceof Error ? caught.message : caught)
      process.exitCode = 0
      return
    }
    writeSnapshot(emptyFootballSnapshot(caught instanceof Error ? caught.message : 'Football ingest failed'))
    console.error(caught instanceof Error ? caught.message : caught)
    process.exitCode = 1
  }
}

main()
