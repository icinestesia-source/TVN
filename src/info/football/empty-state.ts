import type { FootballSnapshot } from './types.ts'

export type FootballEmptyKind = 'not-published' | 'competition-unavailable' | 'no-matches' | 'provider-error'

export type FootballMatchSection = 'fixtures' | 'results' | 'today'

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
}): FootballEmptyDiagnosis {
  const { section, competitionId, snapshot, loadStatus } = options
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
        message: `${competitionId} is unavailable from the provider (${compError.replace(/^[^:]+:\s*/, '').slice(0, 120)}).`,
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
        'Football fixtures and results have not been published yet. After FOOTBALL_DATA_TOKEN is configured, run INFO ingest and publish to Netlify Blobs.',
    }
  }

  if (loadStatus === 'unavailable' || (noData && reason)) {
    return {
      kind: 'provider-error',
      message: reason || 'Football provider error. The last valid snapshot was not available.',
    }
  }

  if (errors.length && noData) {
    return {
      kind: 'provider-error',
      message: errors[0] ?? 'Football provider error.',
    }
  }

  if (section === 'today') {
    return { kind: 'no-matches', message: 'No matches today in this selection.' }
  }
  if (section === 'results') {
    return { kind: 'no-matches', message: 'No completed results in the published window for this selection.' }
  }
  return { kind: 'no-matches', message: 'No fixtures in the published window for this selection.' }
}
