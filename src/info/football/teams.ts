import type { FavouriteTeam } from '../preferences.ts'
import type { FootballMatch, FootballSnapshot, LeagueTableRow } from './types.ts'

export interface SnapshotTeam {
  id: string
  name: string
  competitionIds: string[]
}

/** Collect clubs from matches and tables using provider team ids. */
export function teamsFromSnapshot(snapshot: FootballSnapshot): SnapshotTeam[] {
  const map = new Map<string, SnapshotTeam>()
  const add = (id: string | undefined, name: string, competitionId: string) => {
    if (!id || !name) return
    const existing = map.get(id)
    if (existing) {
      if (!existing.competitionIds.includes(competitionId)) existing.competitionIds.push(competitionId)
      return
    }
    map.set(id, { id, name, competitionIds: [competitionId] })
  }
  for (const match of snapshot.matches) {
    add(match.homeTeamId, match.home, match.competitionId)
    add(match.awayTeamId, match.away, match.competitionId)
  }
  for (const table of snapshot.tables) {
    for (const row of table.rows) {
      add(row.teamId, row.team, table.competitionId)
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function searchTeams(teams: readonly SnapshotTeam[], query: string): SnapshotTeam[] {
  const q = query.trim().toLowerCase()
  if (q.length < 1) return [...teams].slice(0, 40)
  return teams.filter((team) => team.name.toLowerCase().includes(q)).slice(0, 40)
}

export function matchesForTeam(matches: readonly FootballMatch[], teamId: string): FootballMatch[] {
  return matches.filter((match) => match.homeTeamId === teamId || match.awayTeamId === teamId)
}

export function latestResult(matches: readonly FootballMatch[], teamId: string): FootballMatch | null {
  const finished = matchesForTeam(matches, teamId)
    .filter((match) => match.status === 'finished')
    .sort((a, b) => b.kickoffIso.localeCompare(a.kickoffIso))
  return finished[0] ?? null
}

export function nextFixture(matches: readonly FootballMatch[], teamId: string): FootballMatch | null {
  const upcoming = matchesForTeam(matches, teamId)
    .filter((match) => match.status === 'scheduled' || match.status === 'in-play')
    .sort((a, b) => a.kickoffIso.localeCompare(b.kickoffIso))
  return upcoming[0] ?? null
}

export function favouriteFromTeam(team: SnapshotTeam): FavouriteTeam {
  return { id: team.id, name: team.name, competitionId: team.competitionIds[0] ?? '' }
}

export function rowHasGoals(row: LeagueTableRow): boolean {
  return typeof row.goalsFor === 'number' && typeof row.goalsAgainst === 'number'
}
