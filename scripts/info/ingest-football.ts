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
import {
  applyLeagueOneSupplement,
  fetchLeagueOneSupplement,
  LEAGUE_ONE_CODE,
  londonFootballDay,
} from '../../src/info/football/league-one-source.ts'
import { addDaysIso, emptyFootballSnapshot, todayIso } from '../../src/info/football/normalize.ts'
import { footballIngestForced, footballSlotDue } from '../../src/info/football/schedule.ts'
import {
  entitlementSkipCodes,
  footballSnapshotIsEmpty,
  mergeFootballSnapshots,
} from '../../src/info/football/snapshot-safety.ts'
import type { FootballSnapshot } from '../../src/info/football/types.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outPath = join(root, 'public/info/football.json')
const slotPath = join(root, '.cache/info-football-slot')
const leagueOneDayPath = join(root, '.cache/info-football-el1-day')

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

function lastLeagueOneDay(): string | null {
  try {
    return readFileSync(leagueOneDayPath, 'utf8').trim() || null
  } catch {
    return null
  }
}

function rememberLeagueOneDay(day: string): void {
  mkdirSync(dirname(leagueOneDayPath), { recursive: true })
  writeFileSync(leagueOneDayPath, `${day}\n`, 'utf8')
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

async function addDailyLeagueOne(snapshot: FootballSnapshot, from: string, to: string, due: boolean): Promise<FootballSnapshot> {
  if (!due) return snapshot
  const supplement = await fetchLeagueOneSupplement({ dateFrom: from, dateTo: to })
  rememberLeagueOneDay(londonFootballDay(new Date()))
  const leagueMatches = supplement.matches.filter((match) => match.competitionId === LEAGUE_ONE_CODE).length
  console.log(`League One daily scoreboard: ${leagueMatches} matches, ${supplement.tables.length} tables` + (supplement.errors.length ? ` · ${supplement.errors.length} warnings` : ''))
  return applyLeagueOneSupplement(snapshot, supplement, { fromIso: from, toIso: to })
}

async function main(): Promise<void> {
  const gate = shouldIngestNow()
  const today = todayIso()
  const from = addDaysIso(today, -7)
  const to = addDaysIso(today, 21)
  const forced = footballIngestForced(process.env)
  const leagueOneDue = forced || lastLeagueOneDay() !== londonFootballDay(new Date())
  const prior = previousSnapshot()

  if (!gate.run && !leagueOneDue) {
    console.log(`Football ingest skipped: ${gate.reason}`)
    emitWrote(false)
    process.exitCode = 0
    return
  }

  const token = process.env.FOOTBALL_DATA_TOKEN?.trim()
  if (!gate.run || !token) {
    const base =
      prior && (prior.matches.length || prior.tables.length)
        ? prior
        : emptyFootballSnapshot(
            'DATA NOT YET PUBLISHED — Add FOOTBALL_DATA_TOKEN to run football ingest (free token from football-data.org), then publish the snapshot.',
          )
    if (!token && gate.run) console.error(base.unavailableReason ?? 'FOOTBALL_DATA_TOKEN missing; kept previous snapshot.')
    if (!gate.run) console.log(`Football ingest skipped: ${gate.reason}`)
    if (!leagueOneDue) {
      if (!prior) writeSnapshot(base)
      emitWrote(false)
      process.exitCode = 0
      return
    }
    const snapshot = await addDailyLeagueOne(base, from, to, true)
    const gained = snapshot.matches.some((match) => match.competitionId === LEAGUE_ONE_CODE) || snapshot.tables.some((table) => table.competitionId === LEAGUE_ONE_CODE)
    if (!gained && prior) {
      emitWrote(false)
      process.exitCode = 0
      return
    }
    writeSnapshot(snapshot)
    emitWrote(true)
    console.log(`Wrote League One daily update to ${outPath}`)
    return
  }
  // Forced ingest retries every competition. Scheduled runs skip known entitlement failures.
  // League One is filled from the daily public scoreboard, so it is not requested here unless forced.
  const skipCodes = forced ? [] : [...new Set([...entitlementSkipCodes(prior), LEAGUE_ONE_CODE])]
  const skipErrorMessages =
    prior?.errors?.filter((entry) => skipCodes.some((code) => entry.startsWith(`${code} matches:`))) ?? []
  try {
    const fetched = await ingestFootballDataOrg({
      token,
      dateFrom: from,
      dateTo: to,
      skipCompetitionCodes: skipCodes,
      skipErrorMessages,
    })
    // Merge: failed comps + match-id dedupe + retain history outside the rolling window.
    let snapshot = mergeFootballSnapshots(prior, fetched, { fetchFromIso: from, fetchToIso: to, today })
    const providerHasLeagueOne = fetched.matches.some((match) => match.competitionId === LEAGUE_ONE_CODE)
    snapshot = await addDailyLeagueOne(snapshot, from, to, leagueOneDue && !providerHasLeagueOne)
    if (footballSnapshotIsEmpty(snapshot) && prior && !footballSnapshotIsEmpty(prior)) {
      console.error('Football ingest empty; keeping previous snapshot.', fetched.errors?.join('; '))
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
    if (prior && !footballSnapshotIsEmpty(prior)) {
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
