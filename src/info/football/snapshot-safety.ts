import { buildFootballSnapshot } from './normalize.ts'
import type { FootballSnapshot } from './types.ts'

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

/**
 * When a competition's matches or table request fails, keep that competition's
 * rows from the previous snapshot so other competitions are not erased.
 */
export function mergeFootballSnapshots(prior: FootballSnapshot | null, next: FootballSnapshot): FootballSnapshot {
  if (!prior || footballSnapshotIsEmpty(prior)) return next

  const failedMatchComps = new Set(
    (next.errors ?? [])
      .filter((entry) => /\smatches:/.test(entry))
      .map((entry) => entry.split(/\s/)[0]!)
      .filter(Boolean),
  )
  const failedTableComps = new Set(
    (next.errors ?? [])
      .filter((entry) => /\stable:/.test(entry))
      .map((entry) => entry.split(/\s/)[0]!)
      .filter(Boolean),
  )

  if (failedMatchComps.size === 0 && failedTableComps.size === 0) return next

  const matches = [
    ...next.matches.filter((match) => !failedMatchComps.has(match.competitionId)),
    ...prior.matches.filter((match) => failedMatchComps.has(match.competitionId)),
  ]
  const tables = [
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

  const merged = buildFootballSnapshot({
    updatedIso: next.updatedIso,
    provider: next.provider,
    attribution: next.attribution,
    liveReliable: next.liveReliable,
    competitions,
    matches,
    tables,
    errors: next.errors,
  })

  // If everything failed and merge restored prior data, prefer prior updatedIso as last success.
  if (footballSnapshotIsEmpty(next) && !footballSnapshotIsEmpty(merged)) {
    return { ...merged, updatedIso: prior.updatedIso }
  }
  return merged
}
