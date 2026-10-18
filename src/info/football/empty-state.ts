import { snapshotLocalDayRange } from './normalize.ts'
import type { FootballSnapshot } from './types.ts'

export type FootballEmptyKind =
  | 'not-published'
  | 'competition-unavailable'
  | 'no-matches'
  | 'historical-unavailable'
  | 'out-of-range'
  | 'provider-error'

export type FootballMatchSection = 'fixtures' | 'results' | 'today' | 'matches'

export interface FootballEmptyDiagnosis {
  kind: FootballEmptyKind
  message: string
}

/**
 * Distinguish empty Sports lists. League navigation is config-driven and can appear
 * healthy while the published snapshot still has no matches.
 */
export function diagnoseFootballEmpty(options: {
  section: FootballMatchSection
  competitionId: string
  snapshot: FootballSnapshot
  loadStatus: 'ready' | 'unavailable'
  /** Selected local calendar day for Matches / Today. */
  selectedDayIso?: string
}): FootballEmptyDiagnosis {
  const { section, competitionId, snapshot, loadStatus, selectedDayIso } = options
  const reason = (snapshot.unavailableReason ?? '').trim()
  const errors = snapshot.errors ?? []
  const noData = snapshot.matches.length === 0 && snapshot.tables.length === 0

  if (competitionId !== 'all') {
    const compError = errors.find((entry) => entry.startsWith(`${competitionId} `) || entry.startsWith(`${competitionId}:`))
    const hasCompMatches = snapshot.matches.some((match) => match.competitionId === competitionId)
    const hasCompTable = snapshot.tables.some((table) => table.competitionId === competitionId)
    if (compError && !hasCompMatches && !hasCompTable) {
      return {
        kind: 'competition-unavailable',
        message: `COMPETITION NOT INCLUDED IN CURRENT API PLAN — ${competitionId} is unavailable from the provider (${compError.replace(/^[^:]+:\s*/, '').slice(0, 120)}).`,
      }
    }
  }

  const unpublished =
    /token|publish|not published|blob|DATA NOT YET PUBLISHED/i.test(reason) ||
    (loadStatus === 'unavailable' && noData) ||
    (noData && /FOOTBALL_DATA_TOKEN|not been published/i.test(reason))

  if (unpublished) {
    return {
      kind: 'not-published',
      message:
        reason ||
        'DATA NOT YET PUBLISHED — Football fixtures and results have not been published yet. After FOOTBALL_DATA_TOKEN is configured, run INFO ingest and publish to Netlify Blobs.',
    }
  }

  if (loadStatus === 'unavailable' || (noData && reason)) {
    return {
      kind: 'provider-error',
      message: reason ? `PROVIDER TEMPORARILY UNAVAILABLE — ${reason}` : 'PROVIDER TEMPORARILY UNAVAILABLE — The last valid snapshot was not available.',
    }
  }

  if (errors.length && noData) {
    return {
      kind: 'provider-error',
      message: `PROVIDER TEMPORARILY UNAVAILABLE — ${errors[0] ?? 'Football provider error.'}`,
    }
  }

  if ((section === 'matches' || section === 'today') && selectedDayIso) {
    const range = snapshotLocalDayRange(
      competitionId === 'all' ? snapshot.matches : snapshot.matches.filter((match) => match.competitionId === competitionId),
    )
    if (range && selectedDayIso < range.fromIso) {
      return {
        kind: 'historical-unavailable',
        message: `HISTORICAL DATA NOT AVAILABLE — ${selectedDayIso} is before the retained snapshot range (${range.fromIso}–${range.toIso}).`,
      }
    }
    if (range && selectedDayIso > range.toIso) {
      return {
        kind: 'out-of-range',
        message: `DATA NOT YET PUBLISHED — ${selectedDayIso} is after the published fixture window (${range.fromIso}–${range.toIso}).`,
      }
    }
    return { kind: 'no-matches', message: `NO MATCHES ON THIS DATE — No matches on ${selectedDayIso} in this selection.` }
  }

  if (section === 'today') {
    return { kind: 'no-matches', message: 'NO MATCHES ON THIS DATE — No matches today in this selection.' }
  }
  if (section === 'results') {
    return { kind: 'no-matches', message: 'No completed results in the published window for this selection.' }
  }
  if (section === 'fixtures') {
    return { kind: 'no-matches', message: 'No fixtures in the published window for this selection.' }
  }
  return { kind: 'no-matches', message: 'NO MATCHES ON THIS DATE — No matches in this selection.' }
}
