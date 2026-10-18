/**
 * League One is not on the football-data.org plan we use. ESPN publishes a public
 * scoreboard and table for English League One with no key. TVN reads it once per
 * London day. Scores are only kept when the provider marks the match in play or
 * finished — a scheduled 0–0 is not a result. liveReliable stays false.
 */
import { addDaysIso, buildFootballSnapshot, kickoffLocalDayIso } from './normalize.ts'
import type { FootballMatch, FootballSnapshot, LeagueTable, LeagueTableRow, MatchStatus } from './types.ts'

export const LEAGUE_ONE_CODE = 'EL1'
const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.3/scoreboard?dates='
const STANDINGS = 'https://site.api.espn.com/apis/v2/sports/soccer/eng.3/standings'
const ATTRIBUTION = 'League One fixtures and results from ESPN.'

type Json = Record<string, unknown>

function asJson(value: unknown): Json | null {
  return value && typeof value === 'object' ? (value as Json) : null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

export function londonFootballDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function leagueOneStatus(type: Json | null): MatchStatus {
  const name = typeof type?.name === 'string' ? type.name.toUpperCase() : ''
  const state = typeof type?.state === 'string' ? type.state : ''
  if (name.includes('POSTPON')) return 'postponed'
  if (name.includes('CANCEL')) return 'cancelled'
  if (state === 'in') return 'in-play'
  if (state === 'post' || type?.completed === true) return 'finished'
  return 'scheduled'
}

/** Full-time and in-play scores only. Scheduled events often send 0–0 before kickoff. */
function scoreOf(status: MatchStatus, home: unknown, away: unknown): FootballMatch['score'] | undefined {
  if (status !== 'finished' && status !== 'in-play') return undefined
  const homeScore = num(home)
  const awayScore = num(away)
  if (homeScore === null || awayScore === null) return undefined
  return { home: homeScore, away: awayScore }
}

export function matchesFromEspnScoreboard(payload: unknown): FootballMatch[] {
  const doc = asJson(payload)
  const events = Array.isArray(doc?.events) ? doc.events : []
  const out: FootballMatch[] = []
  for (const raw of events) {
    const event = asJson(raw)
    if (!event) continue
    const id = event.id
    const kickoff = event.date
    if ((typeof id !== 'string' && typeof id !== 'number') || typeof kickoff !== 'string') continue
    const competition = asJson(Array.isArray(event.competitions) ? event.competitions[0] : null)
    const status = leagueOneStatus(asJson(asJson(competition?.status)?.type))
    const competitors = Array.isArray(competition?.competitors) ? competition.competitors : []
    const side = (role: 'home' | 'away') => {
      const found = competitors.map(asJson).find((entry) => entry?.homeAway === role)
      const team = asJson(found?.team)
      return {
        name: typeof team?.displayName === 'string' ? team.displayName : role,
        id: typeof team?.id === 'string' || typeof team?.id === 'number' ? `espn-${team.id}` : undefined,
        score: found?.score,
      }
    }
    const home = side('home')
    const away = side('away')
    const score = scoreOf(status, home.score, away.score)
    out.push({
      id: `espn-${id}`,
      competitionId: LEAGUE_ONE_CODE,
      kickoffIso: new Date(kickoff).toISOString(),
      status,
      home: home.name,
      away: away.name,
      ...(home.id ? { homeTeamId: home.id } : {}),
      ...(away.id ? { awayTeamId: away.id } : {}),
      ...(score ? { score } : {}),
    })
  }
  return out
}

function stat(entry: Json, code: string): number {
  const stats = Array.isArray(entry.stats) ? entry.stats : []
  for (const raw of stats) {
    const item = asJson(raw)
    if (item?.abbreviation === code || item?.name === code) return num(item.value) ?? 0
  }
  return 0
}

export function tableFromEspnStandings(payload: unknown, updatedIso: string): LeagueTable | null {
  const doc = asJson(payload)
  const child = asJson(Array.isArray(doc?.children) ? doc.children[0] : null)
  const standings = asJson(child?.standings)
  const entries = Array.isArray(standings?.entries) ? standings.entries : []
  const rows: LeagueTableRow[] = []
  for (const raw of entries) {
    const entry = asJson(raw)
    if (!entry) continue
    const team = asJson(entry.team)
    const name = typeof team?.displayName === 'string' ? team.displayName : ''
    if (!name) continue
    const teamId = typeof team?.id === 'string' || typeof team?.id === 'number' ? `espn-${team.id}` : undefined
    rows.push({
      position: stat(entry, 'R') || rows.length + 1,
      team: name,
      ...(teamId ? { teamId } : {}),
      played: stat(entry, 'GP'),
      won: stat(entry, 'W'),
      drawn: stat(entry, 'D'),
      lost: stat(entry, 'L'),
      goalsFor: stat(entry, 'F'),
      goalsAgainst: stat(entry, 'A'),
      goalDifference: stat(entry, 'GD'),
      points: stat(entry, 'P'),
    })
  }
  if (!rows.length) return null
  rows.sort((a, b) => a.position - b.position)
  return { competitionId: LEAGUE_ONE_CODE, type: 'TOTAL', updatedIso, rows }
}

function daysBetween(fromIso: string, toIso: string): string[] {
  const days: string[] = []
  let day = fromIso
  while (day <= toIso && days.length < 40) {
    days.push(day)
    day = addDaysIso(day, 1)
  }
  return days
}

async function pause(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchLeagueOneSupplement(options: {
  dateFrom: string
  dateTo: string
  fetchImpl?: typeof fetch
  delayMs?: number
  nowIso?: string
}): Promise<{ matches: FootballMatch[]; tables: LeagueTable[]; errors: string[] }> {
  const fetchImpl = options.fetchImpl ?? fetch
  const delayMs = options.delayMs ?? 200
  const errors: string[] = []
  const matches: FootballMatch[] = []
  let calls = 0
  const get = async (url: string) => {
    if (calls > 0) await pause(delayMs)
    calls += 1
    const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`${response.status}`)
    return response.json() as Promise<unknown>
  }
  for (const day of daysBetween(options.dateFrom, options.dateTo)) {
    try {
      matches.push(...matchesFromEspnScoreboard(await get(`${SCOREBOARD}${day.replace(/-/g, '')}`)))
    } catch (caught) {
      errors.push(`EL1 matches ${day}: ${caught instanceof Error ? caught.message : 'failed'}`)
    }
  }
  const tables: LeagueTable[] = []
  try {
    const table = tableFromEspnStandings(await get(STANDINGS), options.nowIso ?? new Date().toISOString())
    if (table) tables.push(table)
  } catch (caught) {
    errors.push(`EL1 table: ${caught instanceof Error ? caught.message : 'failed'}`)
  }
  if (!matches.length && errors.some((entry) => entry.includes('matches'))) {
    errors.unshift('EL1 matches: daily public scoreboard returned no fixtures')
  }
  return { matches, tables, errors }
}

/**
 * Fold a daily League One supplement into the football snapshot.
 * Rows outside the fetched window are kept. Entitlement errors are dropped once real rows arrive.
 */
export function applyLeagueOneSupplement(
  snapshot: FootballSnapshot,
  supplement: { matches: FootballMatch[]; tables: LeagueTable[]; errors: string[] },
  window: { fromIso: string; toIso: string },
): FootballSnapshot {
  const gotRows = supplement.matches.length > 0 || supplement.tables.length > 0
  if (!gotRows) {
    const errors = [...(snapshot.errors ?? [])]
    for (const entry of supplement.errors) {
      if (!errors.includes(entry)) errors.push(entry)
    }
    return buildFootballSnapshot({ ...snapshot, errors })
  }
  const inWindow = (match: FootballMatch) => {
    const day = kickoffLocalDayIso(match.kickoffIso)
    return day >= window.fromIso && day <= window.toIso
  }
  const matches = [
    ...snapshot.matches.filter((match) => match.competitionId !== LEAGUE_ONE_CODE || !inWindow(match)),
    ...supplement.matches,
  ]
  const tables = [
    ...snapshot.tables.filter((table) => table.competitionId !== LEAGUE_ONE_CODE || supplement.tables.length === 0),
    ...supplement.tables,
  ]
  const errors = (snapshot.errors ?? []).filter((entry) => !entry.startsWith(`${LEAGUE_ONE_CODE} `) && !entry.startsWith(`${LEAGUE_ONE_CODE}:`))
  for (const entry of supplement.errors) {
    if (!errors.includes(entry)) errors.push(entry)
  }
  const hasLeague = matches.some((match) => match.competitionId === LEAGUE_ONE_CODE) || tables.some((table) => table.competitionId === LEAGUE_ONE_CODE)
  const competitions = snapshot.competitions.some((entry) => entry.id === LEAGUE_ONE_CODE)
    ? snapshot.competitions
    : [...snapshot.competitions, { id: LEAGUE_ONE_CODE, code: LEAGUE_ONE_CODE, name: 'League One', area: 'England' }]
  const attribution = snapshot.attribution.includes('ESPN') || !hasLeague ? snapshot.attribution : `${snapshot.attribution} ${ATTRIBUTION}`
  return buildFootballSnapshot({
    ...snapshot,
    attribution,
    competitions,
    matches,
    tables,
    errors,
    unavailableReason: matches.length || tables.length ? undefined : snapshot.unavailableReason,
  })
}
