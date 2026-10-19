/**
 * Leagues the football-data.org snapshot did not return are read from ESPN's public
 * soccer scoreboard and table. A competition that already has matches or a table is left alone.
 */
import { matchesFromEspnScoreboard, tableFromEspnStandings } from './league-one-source.ts'
import { addDaysIso, buildFootballSnapshot, kickoffLocalDayIso } from './normalize.ts'
import type { FootballMatch, FootballSnapshot, LeagueTable } from './types.ts'

export interface EspnLeague {
  code: string
  slug: string
  name: string
  area: string
}

export const ESPN_LEAGUES: readonly EspnLeague[] = [
  { code: 'PL', slug: 'eng.1', name: 'Premier League', area: 'England' },
  { code: 'ELC', slug: 'eng.2', name: 'Championship', area: 'England' },
  { code: 'EL1', slug: 'eng.3', name: 'League One', area: 'England' },
  { code: 'CL', slug: 'uefa.champions', name: 'UEFA Champions League', area: 'Europe' },
  { code: 'BL1', slug: 'ger.1', name: 'Bundesliga', area: 'Germany' },
  { code: 'SA', slug: 'ita.1', name: 'Serie A', area: 'Italy' },
  { code: 'PD', slug: 'esp.1', name: 'La Liga', area: 'Spain' },
  { code: 'FL1', slug: 'fra.1', name: 'Ligue 1', area: 'France' },
  { code: 'DED', slug: 'ned.1', name: 'Eredivisie', area: 'Netherlands' },
  { code: 'BSA', slug: 'bra.1', name: 'Campeonato Brasileiro Série A', area: 'Brazil' },
  { code: 'WC', slug: 'fifa.world', name: 'FIFA World Cup', area: 'World' },
  { code: 'EC', slug: 'uefa.euro', name: 'UEFA European Championship', area: 'Europe' },
]

const ATTRIBUTION = 'Leagues missing from football-data.org are filled from ESPN.'

export function competitionHasRows(snapshot: FootballSnapshot, code: string): boolean {
  return snapshot.matches.some((match) => match.competitionId === code) || snapshot.tables.some((table) => table.competitionId === code)
}

export function leaguesMissingFromSnapshot(snapshot: FootballSnapshot): EspnLeague[] {
  return ESPN_LEAGUES.filter((league) => !competitionHasRows(snapshot, league.code))
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

async function pool<T>(items: readonly T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let index = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index]
      index += 1
      await run(current)
    }
  })
  await Promise.all(workers)
}

export async function fetchEspnFallback(options: {
  leagues: readonly EspnLeague[]
  dateFrom: string
  dateTo: string
  fetchImpl?: typeof fetch
  nowIso?: string
}): Promise<{ matches: FootballMatch[]; tables: LeagueTable[]; errors: string[] }> {
  const fetchImpl = options.fetchImpl ?? fetch
  const nowIso = options.nowIso ?? new Date().toISOString()
  const matches: FootballMatch[] = []
  const tables: LeagueTable[] = []
  const errors: string[] = []
  const jobs: { url: string; note: string; take: (payload: unknown) => void }[] = []
  for (const league of options.leagues) {
    jobs.push({
      url: `https://site.api.espn.com/apis/v2/sports/soccer/${league.slug}/standings`,
      note: `${league.code} table`,
      take: (payload) => {
        const table = tableFromEspnStandings(payload, nowIso, league.code)
        if (table) tables.push(table)
      },
    })
    for (const day of daysBetween(options.dateFrom, options.dateTo)) {
      jobs.push({
        url: `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.slug}/scoreboard?dates=${day.replace(/-/g, '')}`,
        note: `${league.code} matches ${day}`,
        take: (payload) => {
          matches.push(...matchesFromEspnScoreboard(payload, league.code))
        },
      })
    }
  }
  await pool(jobs, 8, async (job) => {
    try {
      job.take(await readJson(job.url, fetchImpl))
    } catch (caught) {
      errors.push(`${job.note}: ${caught instanceof Error ? caught.message : 'failed'}`)
    }
  })
  return { matches, tables, errors }
}

/** Insert ESPN rows for leagues that were empty. Leagues already in the snapshot stay as they were. */
export function applyEspnFallback(
  snapshot: FootballSnapshot,
  supplement: { matches: FootballMatch[]; tables: LeagueTable[]; errors: string[] },
  leagues: readonly EspnLeague[],
  window: { fromIso: string; toIso: string },
): FootballSnapshot {
  const codes = new Set(leagues.map((league) => league.code))
  const got = new Set<string>()
  for (const match of supplement.matches) if (codes.has(match.competitionId)) got.add(match.competitionId)
  for (const table of supplement.tables) if (codes.has(table.competitionId)) got.add(table.competitionId)
  if (!got.size) {
    const errors = [...(snapshot.errors ?? [])]
    for (const entry of supplement.errors) if (!errors.includes(entry)) errors.push(entry)
    return buildFootballSnapshot({ ...snapshot, errors })
  }
  const inWindow = (match: FootballMatch) => {
    const day = kickoffLocalDayIso(match.kickoffIso)
    return day >= window.fromIso && day <= window.toIso
  }
  const matches = [
    ...snapshot.matches.filter((match) => !got.has(match.competitionId) || !inWindow(match)),
    ...supplement.matches.filter((match) => got.has(match.competitionId)),
  ]
  const tables = [
    ...snapshot.tables.filter((table) => !got.has(table.competitionId)),
    ...supplement.tables.filter((table) => got.has(table.competitionId)),
  ]
  const errors = (snapshot.errors ?? []).filter((entry) => ![...got].some((code) => entry.startsWith(`${code} `) || entry.startsWith(`${code}:`)))
  for (const entry of supplement.errors) if (!errors.includes(entry)) errors.push(entry)
  const known = new Set(snapshot.competitions.map((entry) => entry.id))
  const competitions = [...snapshot.competitions]
  for (const league of leagues) {
    if (!got.has(league.code) || known.has(league.code)) continue
    competitions.push({ id: league.code, code: league.code, name: league.name, area: league.area })
  }
  const attribution = snapshot.attribution.includes('ESPN') ? snapshot.attribution : `${snapshot.attribution} ${ATTRIBUTION}`
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
