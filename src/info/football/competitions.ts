/**
 * Configured football competitions for TVN INFO.
 *
 * Free-tier football-data.org allows 12 competitions. Product allocation (release prep):
 * League One (EL1) replaces Primeira Liga (PPL) so the UK ladder fits the free slot count.
 * Live availability of EL1 still depends on the token — verify via INFO football verify.
 *
 * The free-tier slot count is a provider limit, not a permanent TVN architecture cap.
 * DEFERRED_FOOTBALL_COMPETITIONS keeps PPL available to re-enable when entitlement allows.
 *
 * Post-deployment: run the football entitlement verify workflow and confirm EL1 (and any
 * restored competitions) appear in the published snapshot before treating them as live.
 */
export type CompetitionFormat = 'league' | 'cup'

export interface FootballCompetitionDef {
  code: string
  name: string
  area: string
  region: string
  format: CompetitionFormat
  /** Intended for the current free-plan allocation — still verify per token. */
  freePlanExpected: boolean
}

export const FOOTBALL_COMPETITIONS: readonly FootballCompetitionDef[] = [
  { code: 'PL', name: 'Premier League', area: 'England', region: 'United Kingdom', format: 'league', freePlanExpected: true },
  { code: 'ELC', name: 'Championship', area: 'England', region: 'United Kingdom', format: 'league', freePlanExpected: true },
  { code: 'EL1', name: 'League One', area: 'England', region: 'United Kingdom', format: 'league', freePlanExpected: true },
  { code: 'CL', name: 'UEFA Champions League', area: 'Europe', region: 'Europe', format: 'cup', freePlanExpected: true },
  { code: 'BL1', name: 'Bundesliga', area: 'Germany', region: 'Europe', format: 'league', freePlanExpected: true },
  { code: 'SA', name: 'Serie A', area: 'Italy', region: 'Europe', format: 'league', freePlanExpected: true },
  { code: 'PD', name: 'La Liga', area: 'Spain', region: 'Europe', format: 'league', freePlanExpected: true },
  { code: 'FL1', name: 'Ligue 1', area: 'France', region: 'Europe', format: 'league', freePlanExpected: true },
  { code: 'DED', name: 'Eredivisie', area: 'Netherlands', region: 'Europe', format: 'league', freePlanExpected: true },
  { code: 'BSA', name: 'Campeonato Brasileiro Série A', area: 'Brazil', region: 'Americas', format: 'league', freePlanExpected: true },
  { code: 'WC', name: 'FIFA World Cup', area: 'World', region: 'World', format: 'cup', freePlanExpected: true },
  { code: 'EC', name: 'UEFA European Championship', area: 'Europe', region: 'Europe', format: 'cup', freePlanExpected: true },
]

export type FootballCompetitionCode = (typeof FOOTBALL_COMPETITIONS)[number]['code']

export const FOOTBALL_REGIONS = ['United Kingdom', 'Europe', 'Americas', 'World'] as const

/** Held aside from the free-tier 12 so League One can take a slot (product choice). */
export const DEFERRED_FOOTBALL_COMPETITIONS: readonly FootballCompetitionDef[] = [
  { code: 'PPL', name: 'Primeira Liga', area: 'Portugal', region: 'Europe', format: 'league', freePlanExpected: true },
]

export function competitionDef(code: string): FootballCompetitionDef | undefined {
  return FOOTBALL_COMPETITIONS.find((entry) => entry.code === code) ?? DEFERRED_FOOTBALL_COMPETITIONS.find((entry) => entry.code === code)
}

export function competitionsByRegion(
  list: readonly FootballCompetitionDef[] = FOOTBALL_COMPETITIONS,
): { region: string; competitions: FootballCompetitionDef[] }[] {
  return FOOTBALL_REGIONS.map((region) => ({
    region,
    competitions: list.filter((entry) => entry.region === region),
  })).filter((group) => group.competitions.length > 0)
}

export function isKnockoutCompetition(code: string): boolean {
  return competitionDef(code)?.format === 'cup'
}
