import type { FootballMatch } from './types.ts'

/** Upcoming and in-progress matches, including postponed (still fixture-side). */
export function fixtureMatches(matches: readonly FootballMatch[]): FootballMatch[] {
  return matches
    .filter((match) => match.status === 'scheduled' || match.status === 'in-play' || match.status === 'postponed')
    .sort((a, b) => a.kickoffIso.localeCompare(b.kickoffIso))
}

/** Completed matches only — never invent scores for non-finished rows. */
export function resultMatches(matches: readonly FootballMatch[]): FootballMatch[] {
  return matches
    .filter((match) => match.status === 'finished')
    .sort((a, b) => b.kickoffIso.localeCompare(a.kickoffIso))
}

export function matchesForCompetition(matches: readonly FootballMatch[], competitionId: string): FootballMatch[] {
  if (competitionId === 'all') return [...matches]
  return matches.filter((match) => match.competitionId === competitionId)
}
