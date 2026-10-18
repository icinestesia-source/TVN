/**
 * Configured football competitions for TVN INFO.
 * Free-tier football-data.org entitlement (as documented): typically 12 codes including
 * PL, ELC, CL, BL1, SA, PD, FL1, DED, PPL, BSA, WC, EC.
 * EL1 (League One) is shown as a product option; live data depends on token entitlement.
 */
export type CompetitionFormat = 'league' | 'cup'

export interface FootballCompetitionDef {
  code: string
  name: string
  area: string
  region: string
  format: CompetitionFormat
  /** Expected on the free plan per provider docs — still verify per token. */
  freePlanExpected: boolean
}

export const FOOTBALL_COMPETITIONS: readonly FootballCompetitionDef[] = [
  { code: 'PL', name: 'Premier League', area: 'England', region: 'United Kingdom', format: 'league', freePlanExpected: true },
  { code: 'ELC', name: 'Championship', area: 'England', region: 'United Kingdom', format: 'league', freePlanExpected: true },
  { code: 'EL1', name: 'League One', area: 'England', region: 'United Kingdom', format: 'league', freePlanExpected: false },
  { code: 'CL', name: 'UEFA Champions League', area: 'Europe', region: 'Europe', format: 'cup', freePlanExpected: true },
  { code: 'BL1', name: 'Bundesliga', area: 'Germany', region: 'Europe', format: 'league', freePlanExpected: true },
  { code: 'SA', name: 'Serie A', area: 'Italy', region: 'Europe', format: 'league', freePlanExpected: true },
  { code: 'PD', name: 'La Liga', area: 'Spain', region: 'Europe', format: 'league', freePlanExpected: true },
  { code: 'FL1', name: 'Ligue 1', area: 'France', region: 'Europe', format: 'league', freePlanExpected: true },
  { code: 'DED', name: 'Eredivisie', area: 'Netherlands', region: 'Europe', format: 'league', freePlanExpected: true },
  { code: 'PPL', name: 'Primeira Liga', area: 'Portugal', region: 'Europe', format: 'league', freePlanExpected: true },
  { code: 'BSA', name: 'Campeonato Brasileiro Série A', area: 'Brazil', region: 'Americas', format: 'league', freePlanExpected: true },
  { code: 'WC', name: 'FIFA World Cup', area: 'World', region: 'World', format: 'cup', freePlanExpected: true },
  { code: 'EC', name: 'UEFA European Championship', area: 'Europe', region: 'Europe', format: 'cup', freePlanExpected: true },
]

export type FootballCompetitionCode = (typeof FOOTBALL_COMPETITIONS)[number]['code']

export const FOOTBALL_REGIONS = ['United Kingdom', 'Europe', 'Americas', 'World'] as const

export function competitionDef(code: string): FootballCompetitionDef | undefined {
  return FOOTBALL_COMPETITIONS.find((entry) => entry.code === code)
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
