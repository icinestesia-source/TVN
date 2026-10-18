/** Normalised football snapshot for INFO → Sports → Football. */

export type MatchStatus = 'scheduled' | 'in-play' | 'finished' | 'postponed' | 'cancelled'

export interface FootballCompetition {
  id: string
  code: string
  name: string
  area?: string
}

export interface FootballMatch {
  id: string
  competitionId: string
  kickoffIso: string
  status: MatchStatus
  home: string
  away: string
  score?: { home: number; away: number }
  matchday?: number
}

export interface LeagueTableRow {
  position: number
  team: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
}

export interface LeagueTable {
  competitionId: string
  type: string
  updatedIso: string | null
  rows: LeagueTableRow[]
}

export interface FootballSnapshot {
  format: 'tvn-info-football-v1'
  updatedIso: string
  staleAfterMinutes: number
  provider: string
  attribution: string
  /** False on the free delayed tier — UI must not show LIVE. */
  liveReliable: boolean
  competitions: FootballCompetition[]
  matches: FootballMatch[]
  tables: LeagueTable[]
  errors?: string[]
  unavailableReason?: string
}

export const FOOTBALL_SNAPSHOT_URL = '/info/football.json'
export const FOOTBALL_STALE_MINUTES = 180
