/**
 * NFL, NBA, NHL and cricket from ESPN's public scoreboards. No key.
 * A scheduled 0 is not stored as a score. In-progress lines use the provider's
 * current scoreboard text and are not labelled Live. Scoreboards are read by day
 * so the Sports panel can page through a calendar, as Football does.
 */

import { addDaysIso, kickoffLocalDayIso, todayIso } from '../football/normalize.ts'

export type ScoreboardStatus = 'scheduled' | 'in-play' | 'finished' | 'postponed' | 'cancelled'

export interface ScoreboardEvent {
  id: string
  competition: string
  startIso: string
  /** Multi-day cricket fixtures include an end date when ESPN sends one. */
  endIso?: string
  status: ScoreboardStatus
  detail: string
  home: string
  away: string
  homeScore?: string
  awayScore?: string
}

const NFL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
const NBA = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
const NHL = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard'
const CRICKET = 'https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket&region=gb&tz=Europe/London'

type Json = Record<string, unknown>

function asJson(value: unknown): Json | null {
  return value && typeof value === 'object' ? (value as Json) : null
}

export function scoreboardStatus(type: Json | string | null): ScoreboardStatus {
  if (typeof type === 'string') {
    if (type === 'in') return 'in-play'
    if (type === 'post') return 'finished'
    return 'scheduled'
  }
  const name = typeof type?.name === 'string' ? type.name.toUpperCase() : ''
  const state = typeof type?.state === 'string' ? type.state : ''
  if (name.includes('POSTPON')) return 'postponed'
  if (name.includes('CANCEL')) return 'cancelled'
  if (state === 'in') return 'in-play'
  if (state === 'post' || type?.completed === true) return 'finished'
  return 'scheduled'
}

export function statusText(status: ScoreboardStatus): string {
  if (status === 'finished') return 'FT'
  if (status === 'in-play') return 'In progress'
  if (status === 'postponed') return 'Postponed'
  if (status === 'cancelled') return 'Cancelled'
  return ''
}

/** Full-time and in-play lines only. */
function scoreText(status: ScoreboardStatus, value: unknown): string | undefined {
  if (status !== 'finished' && status !== 'in-play') return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}

function side(competitors: unknown, role: 'home' | 'away'): { name: string; score: unknown } {
  const list = Array.isArray(competitors) ? competitors : []
  const found = list.map(asJson).find((entry) => entry?.homeAway === role)
  const team = asJson(found?.team)
  const name =
    typeof team?.displayName === 'string'
      ? team.displayName
      : typeof found?.displayName === 'string'
        ? found.displayName
        : role
  return { name, score: found?.score }
}

export function eventsFromEspnScoreboard(payload: unknown, competition: string): ScoreboardEvent[] {
  const doc = asJson(payload)
  const events = Array.isArray(doc?.events) ? doc.events : []
  const out: ScoreboardEvent[] = []
  for (const raw of events) {
    const event = asJson(raw)
    if (!event) continue
    const id = event.id
    const start = event.date
    if ((typeof id !== 'string' && typeof id !== 'number') || typeof start !== 'string') continue
    const match = asJson(Array.isArray(event.competitions) ? event.competitions[0] : null)
    const type = asJson(asJson(match?.status)?.type)
    const status = scoreboardStatus(type)
    const detail = typeof type?.shortDetail === 'string' && type.shortDetail.trim() ? type.shortDetail.trim() : statusText(status)
    const home = side(match?.competitors, 'home')
    const away = side(match?.competitors, 'away')
    const homeScore = scoreText(status, home.score)
    const awayScore = scoreText(status, away.score)
    const end = typeof event.endDate === 'string' ? event.endDate : null
    out.push({
      id: `espn-${id}`,
      competition,
      startIso: new Date(start).toISOString(),
      ...(end ? { endIso: new Date(end).toISOString() } : {}),
      status,
      detail,
      home: home.name,
      away: away.name,
      ...(homeScore ? { homeScore } : {}),
      ...(awayScore ? { awayScore } : {}),
    })
  }
  return out
}

export function eventsFromCricketHeader(payload: unknown): ScoreboardEvent[] {
  const doc = asJson(payload)
  const sports = Array.isArray(doc?.sports) ? doc.sports : []
  const out: ScoreboardEvent[] = []
  for (const sportRaw of sports) {
    const sport = asJson(sportRaw)
    const leagues = Array.isArray(sport?.leagues) ? sport.leagues : []
    for (const leagueRaw of leagues) {
      const league = asJson(leagueRaw)
      const competition = typeof league?.name === 'string' && league.name.trim() ? league.name.trim() : 'Cricket'
      const events = Array.isArray(league?.events) ? league.events : []
      for (const raw of events) {
        const event = asJson(raw)
        if (!event) continue
        const id = event.id
        const start = event.date
        if ((typeof id !== 'string' && typeof id !== 'number') || typeof start !== 'string') continue
        const status = scoreboardStatus(typeof event.status === 'string' ? event.status : asJson(event.status))
        const home = side(event.competitors, 'home')
        const away = side(event.competitors, 'away')
        const homeScore = scoreText(status, home.score)
        const awayScore = scoreText(status, away.score)
        const end = typeof event.endDate === 'string' ? event.endDate : null
        out.push({
          id: `espn-${id}`,
          competition,
          startIso: new Date(start).toISOString(),
          ...(end ? { endIso: new Date(end).toISOString() } : {}),
          status,
          detail: statusText(status),
          home: home.name,
          away: away.name,
          ...(homeScore ? { homeScore } : {}),
          ...(awayScore ? { awayScore } : {}),
        })
      }
    }
  }
  return out
}

/** True when the fixture falls on this local calendar day (multi-day cricket spans inclusive). */
export function eventOnDay(event: ScoreboardEvent, dayIso: string): boolean {
  const start = kickoffLocalDayIso(event.startIso)
  const end = event.endIso ? kickoffLocalDayIso(event.endIso) : start
  return dayIso >= start && dayIso <= end
}

export function daysWithEvents(events: readonly ScoreboardEvent[]): Set<string> {
  const days = new Set<string>()
  for (const event of events) {
    let day = kickoffLocalDayIso(event.startIso)
    const end = event.endIso ? kickoffLocalDayIso(event.endIso) : day
    while (day <= end && days.size < 120) {
      days.add(day)
      day = addDaysIso(day, 1)
    }
  }
  return days
}

export function nextDayWithEvents(days: ReadonlySet<string>, fromIso: string): string | null {
  let next: string | null = null
  for (const day of days) {
    if (day <= fromIso) continue
    if (next === null || day < next) next = day
  }
  return next
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

async function readJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${response.status}`)
  return response.json() as Promise<unknown>
}

async function fetchScoreboardDays(baseUrl: string, competition: string, dateFrom: string, dateTo: string, fetchImpl: typeof fetch): Promise<ScoreboardEvent[]> {
  const byId = new Map<string, ScoreboardEvent>()
  const days = daysBetween(dateFrom, dateTo)
  const batch = 6
  for (let index = 0; index < days.length; index += batch) {
    await Promise.all(
      days.slice(index, index + batch).map(async (day) => {
        const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}dates=${day.replace(/-/g, '')}`
        for (const event of eventsFromEspnScoreboard(await readJson(url, fetchImpl), competition)) {
          byId.set(event.id, event)
        }
      }),
    )
  }
  return [...byId.values()].sort((a, b) => a.startIso.localeCompare(b.startIso))
}

/** Default window matching Football: past week through the next fortnight. */
export function scoreboardWindow(now = new Date()): { fromIso: string; toIso: string } {
  const today = todayIso(now)
  return { fromIso: addDaysIso(today, -7), toIso: addDaysIso(today, 14) }
}

export async function fetchNflScoreboard(fetchImpl: typeof fetch = fetch, window = scoreboardWindow()): Promise<ScoreboardEvent[]> {
  return fetchScoreboardDays(NFL, 'NFL', window.fromIso, window.toIso, fetchImpl)
}

export async function fetchNbaScoreboard(fetchImpl: typeof fetch = fetch, window = scoreboardWindow()): Promise<ScoreboardEvent[]> {
  return fetchScoreboardDays(NBA, 'NBA', window.fromIso, window.toIso, fetchImpl)
}

export async function fetchNhlScoreboard(fetchImpl: typeof fetch = fetch, window = scoreboardWindow()): Promise<ScoreboardEvent[]> {
  return fetchScoreboardDays(NHL, 'NHL', window.fromIso, window.toIso, fetchImpl)
}

export async function fetchCricketScoreboard(fetchImpl: typeof fetch = fetch): Promise<ScoreboardEvent[]> {
  return eventsFromCricketHeader(await readJson(CRICKET, fetchImpl))
}
