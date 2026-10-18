/**
 * Competitions used on the football-data.org free plan for TVN Phase B.2.
 * Priority seven listed first; Eredivisie and Primeira Liga added where free access allows.
 *
 * Not on the free plan (do not claim support without paid verification):
 * English League One/Two, Scottish Premiership, FA Cup, Europa League,
 * Conference League, and most women’s competitions.
 */
export const FOOTBALL_COMPETITIONS = [
  { code: 'PL', name: 'Premier League', area: 'England', region: 'United Kingdom' },
  { code: 'ELC', name: 'Championship', area: 'England', region: 'United Kingdom' },
  { code: 'CL', name: 'UEFA Champions League', area: 'Europe', region: 'Europe' },
  { code: 'BL1', name: 'Bundesliga', area: 'Germany', region: 'Europe' },
  { code: 'SA', name: 'Serie A', area: 'Italy', region: 'Europe' },
  { code: 'PD', name: 'La Liga', area: 'Spain', region: 'Europe' },
  { code: 'FL1', name: 'Ligue 1', area: 'France', region: 'Europe' },
  { code: 'DED', name: 'Eredivisie', area: 'Netherlands', region: 'Europe' },
  { code: 'PPL', name: 'Primeira Liga', area: 'Portugal', region: 'Europe' },
] as const

export type FootballCompetitionCode = (typeof FOOTBALL_COMPETITIONS)[number]['code']

export const FOOTBALL_REGIONS = ['United Kingdom', 'Europe'] as const

export function competitionsByRegion(): { region: string; competitions: (typeof FOOTBALL_COMPETITIONS)[number][] }[] {
  return FOOTBALL_REGIONS.map((region) => ({
    region,
    competitions: FOOTBALL_COMPETITIONS.filter((entry) => entry.region === region),
  })).filter((group) => group.competitions.length > 0)
}
