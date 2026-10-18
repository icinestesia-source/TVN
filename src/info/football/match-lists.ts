import { kickoffLocalDayIso } from './normalize.ts'
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

/** Chronological unified list: fixtures, live, finished, postponed, cancelled. */
export function chronologicalMatches(matches: readonly FootballMatch[]): FootballMatch[] {
  return [...matches].sort((a, b) => a.kickoffIso.localeCompare(b.kickoffIso) || a.home.localeCompare(b.home))
}

export function matchesForCompetition(matches: readonly FootballMatch[], competitionId: string): FootballMatch[] {
  if (competitionId === 'all') return [...matches]
  return matches.filter((match) => match.competitionId === competitionId)
}

/** Days in the filtered set that have at least one match (local calendar days). */
export function daysWithMatches(matches: readonly FootballMatch[]): Set<string> {
  const days = new Set<string>()
  for (const match of matches) days.add(kickoffLocalDayIso(match.kickoffIso))
  return days
}
