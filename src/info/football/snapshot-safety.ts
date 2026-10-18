import { addDaysIso, buildFootballSnapshot, kickoffLocalDayIso, todayIso } from './normalize.ts'
import type { FootballMatch, FootballSnapshot, LeagueTable } from './types.ts'

/** How long to keep historical matches that fall outside the rolling fetch window. */
export const FOOTBALL_HISTORY_RETAIN_DAYS = 120

/** True when the snapshot carries no usable match or table rows. */
export function footballSnapshotIsEmpty(snapshot: FootballSnapshot): boolean {
  return snapshot.matches.length === 0 && snapshot.tables.length === 0
}

/**
 * Refuse to replace a valid published football snapshot with an empty one.
 * Used by /api/info/publish so a failed ingest cannot wipe Netlify Blobs.
 */
export function shouldWriteFootballBlob(
  incoming: FootballSnapshot,
  existing: FootballSnapshot | null,
): { write: true } | { write: false; reason: string } {
  if (!footballSnapshotIsEmpty(incoming)) return { write: true }
  if (existing && !footballSnapshotIsEmpty(existing)) {
    return { write: false, reason: 'football: refused to replace last valid snapshot with empty data' }
  }
  return { write: true }
}

function failedCompetitionCodes(errors: readonly string[] | undefined, kind: 'matches' | 'table'): Set<string> {
  const needle = kind === 'matches' ? /\smatches:/ : /\stable:/
  return new Set(
    (errors ?? [])
      .filter((entry) => needle.test(entry))
      .map((entry) => entry.split(/\s/)[0]!)
      .filter(Boolean),
  )
}

/** Provider entitlement / plan restriction — skip re-fetching until a forced ingest. */
export function isFootballEntitlementError(message: string): boolean {
  return /403|restricted|not\s+authorized|subscription|plan|entitlement|permission/i.test(message)
}

/** Competition codes that previously returned entitlement errors and still have no rows. */
export function entitlementSkipCodes(prior: FootballSnapshot | null): string[] {
  if (!prior?.errors?.length) return []
  const out: string[] = []
  for (const entry of prior.errors) {
    if (!/\smatches:/.test(entry)) continue
    if (!isFootballEntitlementError(entry)) continue
    const code = entry.split(/\s/)[0]
    if (!code) continue
    // Only League One is held back after an entitlement error. La Liga, Premier League and the
    // other free-plan competitions are always requested again so one refusal cannot hide them.
    if (code !== 'EL1') continue
    if (prior.matches.some((match) => match.competitionId === code)) continue
    if (prior.tables.some((table) => table.competitionId === code)) continue
    out.push(code)
  }
  return out
}

function dedupeMatchesById(matches: readonly FootballMatch[]): FootballMatch[] {
  const byId = new Map<string, FootballMatch>()
  for (const match of matches) byId.set(match.id, match)
  return [...byId.values()]
}

function pruneOldMatches(matches: readonly FootballMatch[], retainFromIso: string): FootballMatch[] {
  return matches.filter((match) => kickoffLocalDayIso(match.kickoffIso) >= retainFromIso)
}

export interface MergeFootballOptions {
  /** Inclusive fetch window start (YYYY-MM-DD). Outside this, prior matches are retained. */
  fetchFromIso?: string
  /** Inclusive fetch window end (YYYY-MM-DD). */
  fetchToIso?: string
  /** Drop retained history older than this many days before today. */
  retainDays?: number
  /** Local "today" for retention pruning. */
  today?: string
}

/**
 * Merge a fresh ingest with the previous snapshot:
 * - Keep prior rows for competitions whose match/table requests failed.
 * - Deduplicate by provider match id (incoming wins).
 * - Retain prior matches outside the rolling fetch window so history is not wiped.
 */
export function mergeFootballSnapshots(
  prior: FootballSnapshot | null,
  next: FootballSnapshot,
  options: MergeFootballOptions = {},
): FootballSnapshot {
  if (!prior || footballSnapshotIsEmpty(prior)) return next

  const failedMatchComps = failedCompetitionCodes(next.errors, 'matches')
  const failedTableComps = failedCompetitionCodes(next.errors, 'table')
  const fetchFromIso = options.fetchFromIso
  const fetchToIso = options.fetchToIso
  const retainDays = options.retainDays ?? FOOTBALL_HISTORY_RETAIN_DAYS
  const today = options.today ?? todayIso()
  const retainFromIso = addDaysIso(today, -retainDays)

  const nextMatchIds = new Set(next.matches.map((match) => match.id))
  const retainedHistory = prior.matches.filter((match) => {
    if (nextMatchIds.has(match.id)) return false
    if (failedMatchComps.has(match.competitionId)) return true
    if (!fetchFromIso || !fetchToIso) {
      // Without a window, keep prior rows only for failed competitions (legacy behaviour).
      return false
    }
    const day = kickoffLocalDayIso(match.kickoffIso)
    return day < fetchFromIso || day > fetchToIso
  })

  const matches = pruneOldMatches(
    dedupeMatchesById([
      ...next.matches.filter((match) => !failedMatchComps.has(match.competitionId)),
      ...prior.matches.filter((match) => failedMatchComps.has(match.competitionId)),
      ...retainedHistory,
    ]),
    retainFromIso,
  )

  const tables: LeagueTable[] = [
    ...next.tables.filter((table) => !failedTableComps.has(table.competitionId)),
    ...prior.tables.filter((table) => failedTableComps.has(table.competitionId)),
  ]

  const competitionIds = new Set<string>([
    ...next.competitions.map((entry) => entry.id),
    ...prior.competitions.map((entry) => entry.id),
    ...matches.map((match) => match.competitionId),
    ...tables.map((table) => table.competitionId),
  ])
  const competitions = [...competitionIds].map((id) => {
    return (
      next.competitions.find((entry) => entry.id === id) ??
      prior.competitions.find((entry) => entry.id === id) ?? {
        id,
        code: id,
        name: id,
      }
    )
  })

  const errors = [...(next.errors ?? [])]
  for (const code of entitlementSkipCodes(prior)) {
    if (!errors.some((entry) => entry.startsWith(`${code} `) || entry.startsWith(`${code}:`))) {
      const priorError = prior.errors?.find((entry) => entry.startsWith(`${code} matches:`))
      if (priorError) errors.push(priorError)
    }
  }

  const merged = buildFootballSnapshot({
    updatedIso: next.updatedIso,
    provider: next.provider,
    attribution: next.attribution,
    liveReliable: next.liveReliable,
    competitions,
    matches,
    tables,
    errors,
  })

  if (footballSnapshotIsEmpty(next) && !footballSnapshotIsEmpty(merged)) {
    return { ...merged, updatedIso: prior.updatedIso }
  }
  return merged
}
