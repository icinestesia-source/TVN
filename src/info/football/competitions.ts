/**
 * Free-tier competitions on football-data.org (as of the Phase B plan).
 * League One, League Two, FA Cup and Scottish Premiership need a paid plan — not included.
 */
export const FOOTBALL_COMPETITIONS = [
  { code: 'PL', name: 'Premier League', area: 'England' },
  { code: 'ELC', name: 'Championship', area: 'England' },
  { code: 'CL', name: 'UEFA Champions League', area: 'Europe' },
  { code: 'BL1', name: 'Bundesliga', area: 'Germany' },
  { code: 'SA', name: 'Serie A', area: 'Italy' },
  { code: 'PD', name: 'La Liga', area: 'Spain' },
  { code: 'FL1', name: 'Ligue 1', area: 'France' },
] as const

export type FootballCompetitionCode = (typeof FOOTBALL_COMPETITIONS)[number]['code']
