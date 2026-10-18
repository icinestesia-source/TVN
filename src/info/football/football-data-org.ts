import { FOOTBALL_COMPETITIONS } from './competitions.ts'
import { buildFootballSnapshot, matchStatusOf } from './normalize.ts'
import type { FootballCompetition, FootballMatch, FootballSnapshot, LeagueTable, LeagueTableRow } from './types.ts'

const API = 'https://api.football-data.org/v4'

type Json = Record<string, unknown>

async function apiGet(path: string, token: string, timeoutMs = 12_000, fetchImpl: typeof fetch = fetch): Promise<Json> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(`${API}${path}`, {
      signal: controller.signal,
      headers: { 'X-Auth-Token': token, Accept: 'application/json' },
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`${response.status} ${response.statusText}${body ? `: ${body.slice(0, 160)}` : ''}`)
    }
    return (await response.json()) as Json
  } finally {
    clearTimeout(timer)
  }
}

function teamName(value: unknown): string {
  if (!value || typeof value !== 'object') return 'Unknown'
  const name = (value as Json).shortName ?? (value as Json).name ?? (value as Json).tla
  return typeof name === 'string' && name.trim() ? name.trim() : 'Unknown'
}

function teamIdOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const id = (value as Json).id
  if (typeof id === 'number' || typeof id === 'string') return String(id)
  return undefined
}

function scoreOf(match: Json): FootballMatch['score'] | undefined {
  const score = match.score as Json | undefined
  const full = score?.fullTime as Json | undefined
  const home = full?.home
  const away = full?.away
  if (typeof home !== 'number' || typeof away !== 'number') return undefined
  return { home, away }
}

function matchesFromPayload(payload: Json, competitionId: string): FootballMatch[] {
  const list = Array.isArray(payload.matches) ? payload.matches : []
  const out: FootballMatch[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const match = raw as Json
    const id = match.id
    const utc = match.utcDate
    if (typeof id !== 'number' && typeof id !== 'string') continue
    if (typeof utc !== 'string') continue
    const homeTeamId = teamIdOf(match.homeTeam)
    const awayTeamId = teamIdOf(match.awayTeam)
    out.push({
      id: String(id),
      competitionId,
      kickoffIso: new Date(utc).toISOString(),
      status: matchStatusOf(typeof match.status === 'string' ? match.status : null),
      home: teamName(match.homeTeam),
      away: teamName(match.awayTeam),
      ...(homeTeamId ? { homeTeamId } : {}),
      ...(awayTeamId ? { awayTeamId } : {}),
      score: scoreOf(match),
      ...(typeof match.matchday === 'number' ? { matchday: match.matchday } : {}),
    })
  }
  return out
}

function tablesFromPayload(payload: Json, competitionId: string): LeagueTable[] {
  const standings = Array.isArray(payload.standings) ? payload.standings : []
  const out: LeagueTable[] = []
  for (const block of standings) {
    if (!block || typeof block !== 'object') continue
    const group = block as Json
    const type = typeof group.type === 'string' ? group.type : 'TOTAL'
    // Prefer the overall table; skip home/away splits for the first release.
    if (type !== 'TOTAL') continue
    const table = Array.isArray(group.table) ? group.table : []
    const rows: LeagueTableRow[] = []
    for (const row of table) {
      if (!row || typeof row !== 'object') continue
      const entry = row as Json
      const tid = teamIdOf(entry.team)
      const form = typeof entry.form === 'string' ? entry.form : undefined
      rows.push({
        position: Number(entry.position) || rows.length + 1,
        team: teamName(entry.team),
        ...(tid ? { teamId: tid } : {}),
        played: Number(entry.playedGames) || 0,
        won: Number(entry.won) || 0,
        drawn: Number(entry.draw) || 0,
        lost: Number(entry.lost) || 0,
        goalsFor: Number(entry.goalsFor) || 0,
        goalsAgainst: Number(entry.goalsAgainst) || 0,
        goalDifference: Number(entry.goalDifference) || 0,
        points: Number(entry.points) || 0,
        ...(form ? { form } : {}),
      })
    }
    if (rows.length) {
      out.push({
        competitionId,
        type,
        updatedIso: typeof payload.lastUpdated === 'string' ? payload.lastUpdated : null,
        rows,
      })
    }
  }
  return out
}

export interface FootballIngestOptions {
  token: string
  /** Inclusive dateFrom YYYY-MM-DD */
  dateFrom: string
  /** Inclusive dateTo YYYY-MM-DD */
  dateTo: string
  nowIso?: string
  /**
   * Pause between upstream calls. Free tier allows 10 calls/minute; default 6500ms stays under that.
   * Tests pass `0`.
   */
  delayMs?: number
  fetchImpl?: typeof fetch
}

const pause = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve())

/** Pull free-tier competitions from football-data.org into a TVN snapshot. */
export async function ingestFootballDataOrg(options: FootballIngestOptions): Promise<FootballSnapshot> {
  const errors: string[] = []
  const competitions: FootballCompetition[] = []
  const matches: FootballMatch[] = []
  const tables: LeagueTable[] = []
  const delayMs = options.delayMs ?? 6500
  const fetchImpl = options.fetchImpl ?? fetch
  let calls = 0

  const get = async (path: string) => {
    if (calls > 0) await pause(delayMs)
    calls += 1
    return apiGet(path, options.token, 12_000, fetchImpl)
  }

  for (const entry of FOOTBALL_COMPETITIONS) {
    const competitionId = entry.code
    competitions.push({ id: competitionId, code: entry.code, name: entry.name, area: entry.area })
    try {
      const matchPayload = await get(`/competitions/${entry.code}/matches?dateFrom=${options.dateFrom}&dateTo=${options.dateTo}`)
      matches.push(...matchesFromPayload(matchPayload, competitionId))
    } catch (caught) {
      errors.push(`${entry.code} matches: ${caught instanceof Error ? caught.message : 'failed'}`)
    }
    try {
      const tablePayload = await get(`/competitions/${entry.code}/standings`)
      tables.push(...tablesFromPayload(tablePayload, competitionId))
    } catch (caught) {
      errors.push(`${entry.code} table: ${caught instanceof Error ? caught.message : 'failed'}`)
    }
  }

  return buildFootballSnapshot({
    updatedIso: options.nowIso ?? new Date().toISOString(),
    provider: 'football-data.org',
    attribution: 'Football data provided by football-data.org',
    liveReliable: false,
    competitions,
    matches,
    tables,
    errors,
    ...(matches.length === 0 && tables.length === 0
      ? { unavailableReason: errors[0] ?? 'No football data returned' }
      : {}),
  })
}
