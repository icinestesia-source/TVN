import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FootballPanel } from './components/info/FootballPanel.tsx'
import { INFO_MODULES } from './components/InfoCentre.tsx'
import { FOOTBALL_COMPETITIONS } from './info/football/competitions.ts'
import { ingestFootballDataOrg } from './info/football/football-data-org.ts'
import { applyLeagueOneSupplement, matchesFromEspnScoreboard, tableFromEspnStandings } from './info/football/league-one-source.ts'
import { diagnoseFootballEmpty } from './info/football/empty-state.ts'
import { SAMPLE_EMPTY, SAMPLE_MATCHES, SAMPLE_MATCHES_ELC, SAMPLE_STANDINGS } from './info/football/fixtures/sample-responses.ts'
import { chronologicalMatches, fixtureMatches, matchesForCompetition, resultMatches } from './info/football/match-lists.ts'
import {
  addDaysIso,
  asFootballSnapshot,
  buildFootballSnapshot,
  emptyFootballSnapshot,
  kickoffLocalDayIso,
  localDayIso,
  matchStatusOf,
  matchesOnDay,
  statusLabel,
  todayIso,
} from './info/football/normalize.ts'
import {
  entitlementSkipCodes,
  mergeFootballSnapshots,
  shouldWriteFootballBlob,
} from './info/football/snapshot-safety.ts'
import { shiftSelectedDay } from './components/info/DayCalendar.tsx'
import { footballIngestForced, footballSlotDue } from './info/football/schedule.ts'
import type { FootballMatch } from './info/football/types.ts'

const read = (path: string) => readFileSync(path, 'utf8')

describe('INFO football', () => {
  it('maps provider statuses and never labels delayed in-play as Live', () => {
    expect(matchStatusOf('SCHEDULED')).toBe('scheduled')
    expect(matchStatusOf('TIMED')).toBe('scheduled')
    expect(matchStatusOf('FINISHED')).toBe('finished')
    expect(matchStatusOf('POSTPONED')).toBe('postponed')
    expect(matchStatusOf('CANCELLED')).toBe('cancelled')
    expect(matchStatusOf('IN_PLAY')).toBe('in-play')
    expect(statusLabel('in-play', false)).toBe('Delayed')
    expect(statusLabel('in-play', true)).toBe('Live')
    expect(statusLabel('finished', false)).toBe('Finished')
  })

  it('builds snapshots, keeps empty failure states, and rejects bad documents', () => {
    const matches: FootballMatch[] = [
      {
        id: '1',
        competitionId: 'PL',
        kickoffIso: '2026-10-18T15:00:00.000Z',
        status: 'scheduled',
        home: 'Home',
        away: 'Away',
      },
    ]
    const snapshot = buildFootballSnapshot({
      updatedIso: '2026-10-18T12:00:00.000Z',
      provider: 'football-data.org',
      attribution: 'Football data provided by football-data.org',
      liveReliable: false,
      competitions: [{ id: 'PL', code: 'PL', name: 'Premier League' }],
      matches,
      tables: [
        {
          competitionId: 'PL',
          type: 'TOTAL',
          updatedIso: null,
          rows: [
            {
              position: 1,
              team: 'Home',
              played: 1,
              won: 1,
              drawn: 0,
              lost: 0,
              goalsFor: 2,
              goalsAgainst: 0,
              goalDifference: 2,
              points: 3,
            },
          ],
        },
      ],
    })
    expect(snapshot.format).toBe('tvn-info-football-v1')
    expect(snapshot.liveReliable).toBe(false)
    expect(asFootballSnapshot(snapshot)?.matches).toHaveLength(1)
    expect(asFootballSnapshot({ format: 'nope' })).toBeNull()
    expect(emptyFootballSnapshot('no token').unavailableReason).toBe('no token')
  })

  it('covers free-tier competitions and keeps API tokens out of client files', () => {
    expect(FOOTBALL_COMPETITIONS.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['PL', 'ELC', 'EL1', 'CL', 'BL1', 'SA', 'PD', 'FL1', 'DED']),
    )
    expect(FOOTBALL_COMPETITIONS.map((entry) => entry.code)).toContain('EL1')
    expect(FOOTBALL_COMPETITIONS.map((entry) => entry.code)).not.toContain('PPL')
    expect(INFO_MODULES.some((module) => module.id === 'sports')).toBe(true)
    for (const path of [
      'src/components/info/FootballPanel.tsx',
      'src/info/football/load.ts',
      'src/info/football/types.ts',
      'public/info/football.json',
    ]) {
      const text = read(path)
      expect(text).not.toMatch(/X-Auth-Token\s*[:=]\s*['"][a-zA-Z0-9]{8,}/)
      expect(text).not.toMatch(/FOOTBALL_DATA_TOKEN\s*=\s*['"][^'"]+['"]/)
    }
    const markup = renderToStaticMarkup(createElement(FootballPanel))
    expect(markup).toMatch(/Loading football|Football/)
    expect(read('src/components/info/FootballPanel.tsx')).toContain("label: 'Matches'")
    expect(read('src/components/info/FootballPanel.tsx')).not.toContain("label: 'Fixtures'")
    expect(read('src/components/info/FootballPanel.tsx')).not.toContain("label: 'Results'")
    expect(read('src/components/info/DayCalendar.tsx')).toContain('role="dialog"')
    expect(read('src/styles/guide.css')).toContain('.info-competition-tabs')
    expect(read('src/styles/guide.css')).toContain('.info-day-nav')
  })

  it('documents the secret for CI and never embeds a token in the ingest script default', () => {
    const ingest = read('scripts/info/ingest-football.ts')
    expect(ingest).toContain('FOOTBALL_DATA_TOKEN')
    expect(ingest).toContain('process.env.FOOTBALL_DATA_TOKEN')
    expect(ingest).not.toMatch(/X-Auth-Token['"]\s*:\s*['"][a-f0-9]{10,}/i)
    expect(read('.github/workflows/info-ingest.yml')).toContain('secrets.FOOTBALL_DATA_TOKEN')
    expect(read('.github/workflows/info-ingest.yml')).toContain('info:publish')
    expect(read('.github/workflows/info-ingest.yml')).toContain('workflow_dispatch')
    expect(read('.github/workflows/info-ingest.yml')).toContain('FOOTBALL_INGEST_FORCE')
    expect(read('.github/workflows/info-ingest.yml')).not.toContain('git push')
  })

  it('gates scheduled refresh in Europe/London including weekend match windows', () => {
    // Monday 22:05 BST (2026-10-19 is a Monday; BST ends 25 Oct 2026)
    const monday = footballSlotDue(new Date('2026-10-19T21:05:00.000Z'))
    expect(monday?.key).toContain('T22:00')
    // Same half hour is one publish, so a second run does not call the provider again.
    expect(footballSlotDue(new Date('2026-10-19T21:20:00.000Z'))?.key).toBe(monday?.key)
    // Saturday 17:10 BST
    const satAfternoon = footballSlotDue(new Date('2026-10-17T16:10:00.000Z'))
    expect(satAfternoon?.key).toContain('T17:00')
    // Saturday 19:40 BST — 17:30 kick-offs are full time
    const satEvening = footballSlotDue(new Date('2026-10-17T18:40:00.000Z'))
    expect(satEvening?.key).toContain('T19:30')
    // Sunday 18:05 BST (2026-10-18)
    const sundaySix = footballSlotDue(new Date('2026-10-18T17:05:00.000Z'))
    expect(sundaySix?.key).toContain('T18:00')
    // Weekday midday — not due
    expect(footballSlotDue(new Date('2026-10-19T12:00:00.000Z'))).toBeNull()
    // Weekend midday is due (La Liga and Premier League kick-offs)
    expect(footballSlotDue(new Date('2026-10-18T12:10:00.000Z'))?.key).toContain('T13:00')
    // GMT winter: Sunday 18:05 GMT = 18:05Z on 2026-11-01
    const winterSunday = footballSlotDue(new Date('2026-11-01T18:05:00.000Z'))
    expect(winterSunday?.key).toContain('T18:00')
    const winter = footballSlotDue(new Date('2026-11-02T22:05:00.000Z'))
    expect(winter?.key).toContain('T22:00')
    expect(footballIngestForced({ FOOTBALL_INGEST_FORCE: '1' })).toBe(true)
    expect(footballIngestForced({})).toBe(false)
    expect(read('.github/workflows/info-ingest.yml')).toContain('Blobs only')
    expect(read('src/components/info/FootballPanel.tsx')).toContain('Next matches')
    expect(read('src/components/info/FootballPanel.tsx')).toContain('aria-label="Previous day"')
    expect(read('src/info/football/competitions.ts')).toContain("code: 'PD'")
  })

  it('normalises mocked provider fixtures, including empty competitions and delayed in-play', async () => {
    const tokens: string[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      const headers = init?.headers as Record<string, string> | undefined
      if (headers?.['X-Auth-Token']) tokens.push(headers['X-Auth-Token'])
      if (url.includes('/competitions/PL/matches')) {
        return new Response(JSON.stringify(SAMPLE_MATCHES), { status: 200 })
      }
      if (url.includes('/competitions/PL/standings')) {
        return new Response(JSON.stringify(SAMPLE_STANDINGS), { status: 200 })
      }
      if (url.includes('/matches')) return new Response(JSON.stringify(SAMPLE_EMPTY), { status: 200 })
      if (url.includes('/standings')) return new Response(JSON.stringify({ standings: [] }), { status: 200 })
      return new Response('nope', { status: 404 })
    }

    const snapshot = await ingestFootballDataOrg({
      token: 'test-token',
      dateFrom: '2026-10-11',
      dateTo: '2026-11-08',
      nowIso: '2026-10-18T12:00:00.000Z',
      delayMs: 0,
      fetchImpl,
    })
    expect(snapshot.liveReliable).toBe(false)
    expect(snapshot.attribution.toLowerCase()).toContain('football-data.org')
    expect(snapshot.competitions.map((entry) => entry.code)).toEqual(FOOTBALL_COMPETITIONS.map((entry) => entry.code))
    expect(snapshot.matches.some((match) => match.home === 'Arsenal' && match.status === 'scheduled')).toBe(true)
    expect(snapshot.matches.some((match) => match.status === 'finished' && match.score?.home === 2)).toBe(true)
    expect(snapshot.matches.some((match) => match.status === 'in-play')).toBe(true)
    expect(snapshot.matches.some((match) => match.status === 'postponed')).toBe(true)
    expect(statusLabel('in-play', snapshot.liveReliable)).toBe('Delayed')
    expect(snapshot.tables).toHaveLength(1)
    expect(snapshot.tables[0].rows).toHaveLength(2)
    expect(snapshot.tables[0].rows[0]).toMatchObject({ team: 'Arsenal', points: 19, goalDifference: 12 })
    expect(tokens[0]).toBe('test-token')
  })

  it('splits fixtures and results from representative provider payloads across competitions', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('/competitions/PL/matches')) return new Response(JSON.stringify(SAMPLE_MATCHES), { status: 200 })
      if (url.includes('/competitions/ELC/matches')) return new Response(JSON.stringify(SAMPLE_MATCHES_ELC), { status: 200 })
      if (url.includes('/competitions/PL/standings')) return new Response(JSON.stringify(SAMPLE_STANDINGS), { status: 200 })
      if (url.includes('/matches')) return new Response(JSON.stringify(SAMPLE_EMPTY), { status: 200 })
      if (url.includes('/standings')) return new Response(JSON.stringify({ standings: [] }), { status: 200 })
      return new Response('nope', { status: 404 })
    }
    const snapshot = await ingestFootballDataOrg({
      token: 'test-token',
      dateFrom: '2026-10-11',
      dateTo: '2026-11-08',
      nowIso: '2026-10-18T12:00:00.000Z',
      delayMs: 0,
      fetchImpl,
    })
    const pl = matchesForCompetition(snapshot.matches, 'PL')
    const elc = matchesForCompetition(snapshot.matches, 'ELC')
    expect(fixtureMatches(pl).map((match) => match.status).sort()).toEqual(['in-play', 'postponed', 'scheduled', 'scheduled'])
    expect(resultMatches(pl)).toHaveLength(1)
    expect(resultMatches(pl)[0]?.score).toEqual({ home: 2, away: 1 })
    expect(fixtureMatches(elc)).toHaveLength(1)
    expect(resultMatches(elc)).toHaveLength(1)
    expect(matchesForCompetition(snapshot.matches, 'BL1')).toEqual([])
    expect(
      diagnoseFootballEmpty({
        section: 'matches',
        competitionId: 'BL1',
        snapshot: { ...snapshot, errors: ['BL1 matches: 403 Forbidden'] },
        loadStatus: 'ready',
      }).kind,
    ).toBe('competition-unavailable')
    expect(
      diagnoseFootballEmpty({
        section: 'matches',
        competitionId: 'BL1',
        snapshot: { ...snapshot, errors: ['BL1 matches: 403 Forbidden'] },
        loadStatus: 'ready',
      }).message,
    ).toMatch(/COMPETITION NOT INCLUDED IN CURRENT API PLAN/)
  })

  it('does not treat unpublished snapshots as “no matches in selection”', () => {
    const empty = emptyFootballSnapshot('DATA NOT YET PUBLISHED — waiting for ingest')
    expect(
      diagnoseFootballEmpty({
        section: 'matches',
        competitionId: 'PL',
        snapshot: empty,
        loadStatus: 'unavailable',
      }).kind,
    ).toBe('not-published')
    expect(
      diagnoseFootballEmpty({
        section: 'matches',
        competitionId: 'all',
        snapshot: empty,
        loadStatus: 'unavailable',
      }).message,
    ).toMatch(/NOT YET PUBLISHED|ingest|publish/i)
    const readyEmpty = buildFootballSnapshot({
      updatedIso: '2026-10-18T12:00:00.000Z',
      provider: 'football-data.org',
      attribution: 'Football data provided by football-data.org',
      liveReliable: false,
      competitions: [{ id: 'PL', code: 'PL', name: 'Premier League' }],
      matches: [],
      tables: [],
    })
    expect(
      diagnoseFootballEmpty({
        section: 'matches',
        competitionId: 'PL',
        snapshot: readyEmpty,
        loadStatus: 'ready',
        selectedDayIso: '2026-10-18',
      }).kind,
    ).toBe('no-matches')
    expect(
      diagnoseFootballEmpty({
        section: 'matches',
        competitionId: 'PL',
        snapshot: readyEmpty,
        loadStatus: 'ready',
        selectedDayIso: '2026-10-18',
      }).message,
    ).toMatch(/NO MATCHES ON THIS DATE/)
  })

  it('keeps prior competition data when another competition fails, and refuses empty blob overwrites', () => {
    const prior = buildFootballSnapshot({
      updatedIso: '2026-10-17T12:00:00.000Z',
      provider: 'football-data.org',
      attribution: 'Football data provided by football-data.org',
      liveReliable: false,
      competitions: [
        { id: 'PL', code: 'PL', name: 'Premier League' },
        { id: 'ELC', code: 'ELC', name: 'Championship' },
      ],
      matches: [
        {
          id: 'pl1',
          competitionId: 'PL',
          kickoffIso: '2026-10-18T14:00:00.000Z',
          status: 'scheduled',
          home: 'Arsenal',
          away: 'Chelsea',
        },
        {
          id: 'elc1',
          competitionId: 'ELC',
          kickoffIso: '2026-10-18T15:00:00.000Z',
          status: 'finished',
          home: 'Burnley',
          away: 'Leeds',
          score: { home: 1, away: 0 },
        },
      ],
      tables: [
        {
          competitionId: 'ELC',
          type: 'TOTAL',
          updatedIso: null,
          rows: [
            {
              position: 1,
              team: 'Burnley',
              played: 1,
              won: 1,
              drawn: 0,
              lost: 0,
              goalsFor: 1,
              goalsAgainst: 0,
              goalDifference: 1,
              points: 3,
            },
          ],
        },
      ],
    })
    const next = buildFootballSnapshot({
      updatedIso: '2026-10-18T12:00:00.000Z',
      provider: 'football-data.org',
      attribution: 'Football data provided by football-data.org',
      liveReliable: false,
      competitions: [
        { id: 'PL', code: 'PL', name: 'Premier League' },
        { id: 'ELC', code: 'ELC', name: 'Championship' },
      ],
      matches: [
        {
          id: 'pl2',
          competitionId: 'PL',
          kickoffIso: '2026-10-19T14:00:00.000Z',
          status: 'scheduled',
          home: 'Liverpool',
          away: 'Everton',
        },
      ],
      tables: [],
      errors: ['ELC matches: 403 Forbidden', 'ELC table: 403 Forbidden'],
    })
    const merged = mergeFootballSnapshots(prior, next)
    expect(merged.matches.some((match) => match.id === 'pl2')).toBe(true)
    expect(merged.matches.some((match) => match.id === 'elc1')).toBe(true)
    expect(merged.tables.some((table) => table.competitionId === 'ELC')).toBe(true)
    expect(shouldWriteFootballBlob(emptyFootballSnapshot('failed'), prior)).toEqual({
      write: false,
      reason: 'football: refused to replace last valid snapshot with empty data',
    })
    expect(shouldWriteFootballBlob(merged, prior).write).toBe(true)
  })

  it('keeps unsupported competitions empty without inventing fixtures', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('/competitions/EL1/matches')) {
        return new Response(JSON.stringify({ message: 'The resource you are looking for is restricted' }), { status: 403 })
      }
      if (url.includes('/matches')) return new Response(JSON.stringify(SAMPLE_EMPTY), { status: 200 })
      if (url.includes('/standings')) return new Response(JSON.stringify({ standings: [] }), { status: 200 })
      return new Response('nope', { status: 404 })
    }
    const snapshot = await ingestFootballDataOrg({
      token: 'test-token',
      dateFrom: '2026-10-11',
      dateTo: '2026-11-08',
      delayMs: 0,
      fetchImpl,
    })
    expect(snapshot.matches.filter((match) => match.competitionId === 'EL1')).toHaveLength(0)
    expect(snapshot.errors?.some((entry) => entry.startsWith('EL1 matches:'))).toBe(true)
    expect(
      diagnoseFootballEmpty({
        section: 'matches',
        competitionId: 'EL1',
        snapshot,
        loadStatus: 'ready',
      }).kind,
    ).toBe('competition-unavailable')
    expect(entitlementSkipCodes(snapshot)).toContain('EL1')
  })

  it('uses local calendar days for navigation and match day filtering', () => {
    expect(todayIso()).toBe(localDayIso())
    expect(shiftSelectedDay('2026-10-18', -1)).toBe('2026-10-17')
    expect(shiftSelectedDay('2026-10-18', 1)).toBe('2026-10-19')
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
    const lateUtc = '2026-10-18T01:30:00.000Z'
    const localDay = kickoffLocalDayIso(lateUtc)
    expect(localDay).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const matches: FootballMatch[] = [
      {
        id: 'a',
        competitionId: 'PL',
        kickoffIso: lateUtc,
        status: 'scheduled',
        home: 'A',
        away: 'B',
      },
      {
        id: 'b',
        competitionId: 'PL',
        kickoffIso: '2026-10-19T15:00:00.000Z',
        status: 'cancelled',
        home: 'C',
        away: 'D',
      },
    ]
    expect(matchesOnDay(matches, localDay).map((match) => match.id)).toContain('a')
    expect(chronologicalMatches(matches).map((match) => match.id)).toEqual(['a', 'b'])
  })

  it('retains historical matches outside the rolling fetch window and dedupes by id', () => {
    const prior = buildFootballSnapshot({
      updatedIso: '2026-10-10T12:00:00.000Z',
      provider: 'football-data.org',
      attribution: 'Football data provided by football-data.org',
      liveReliable: false,
      competitions: [{ id: 'PL', code: 'PL', name: 'Premier League' }],
      matches: [
        {
          id: 'old',
          competitionId: 'PL',
          kickoffIso: '2026-10-05T14:00:00.000Z',
          status: 'finished',
          home: 'Arsenal',
          away: 'Fulham',
          score: { home: 1, away: 0 },
        },
        {
          id: 'same',
          competitionId: 'PL',
          kickoffIso: '2026-10-18T14:00:00.000Z',
          status: 'scheduled',
          home: 'Chelsea',
          away: 'Spurs',
        },
      ],
      tables: [],
    })
    const next = buildFootballSnapshot({
      updatedIso: '2026-10-18T12:00:00.000Z',
      provider: 'football-data.org',
      attribution: 'Football data provided by football-data.org',
      liveReliable: false,
      competitions: [{ id: 'PL', code: 'PL', name: 'Premier League' }],
      matches: [
        {
          id: 'same',
          competitionId: 'PL',
          kickoffIso: '2026-10-18T14:00:00.000Z',
          status: 'finished',
          home: 'Chelsea',
          away: 'Spurs',
          score: { home: 2, away: 2 },
        },
        {
          id: 'new',
          competitionId: 'PL',
          kickoffIso: '2026-10-20T14:00:00.000Z',
          status: 'scheduled',
          home: 'Liverpool',
          away: 'Everton',
        },
      ],
      tables: [],
    })
    const merged = mergeFootballSnapshots(prior, next, {
      fetchFromIso: '2026-10-11',
      fetchToIso: '2026-11-08',
      today: '2026-10-18',
    })
    expect(merged.matches.some((match) => match.id === 'old' && match.score?.home === 1)).toBe(true)
    expect(merged.matches.find((match) => match.id === 'same')?.status).toBe('finished')
    expect(merged.matches.find((match) => match.id === 'same')?.score).toEqual({ home: 2, away: 2 })
    expect(merged.matches.some((match) => match.id === 'new')).toBe(true)
    expect(
      diagnoseFootballEmpty({
        section: 'matches',
        competitionId: 'PL',
        snapshot: merged,
        loadStatus: 'ready',
        selectedDayIso: '2026-09-01',
      }).kind,
    ).toBe('historical-unavailable')
    expect(
      diagnoseFootballEmpty({
        section: 'matches',
        competitionId: 'PL',
        snapshot: merged,
        loadStatus: 'ready',
        selectedDayIso: '2026-12-01',
      }).kind,
    ).toBe('out-of-range')
  })
})

describe('League One daily scoreboard', () => {
  it('keeps a full-time score and ignores a scheduled 0–0', () => {
    const matches = matchesFromEspnScoreboard({
      events: [
        {
          id: '1',
          date: '2026-10-17T11:30:00Z',
          competitions: [
            {
              status: { type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true } },
              competitors: [
                { homeAway: 'home', score: '2', team: { id: '390', displayName: 'Milton Keynes Dons' } },
                { homeAway: 'away', score: '1', team: { id: '301', displayName: 'Luton Town' } },
              ],
            },
          ],
        },
        {
          id: '2',
          date: '2026-10-24T11:30:00Z',
          competitions: [
            {
              status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
              competitors: [
                { homeAway: 'home', score: '0', team: { id: '1', displayName: 'Huddersfield Town' } },
                { homeAway: 'away', score: '0', team: { id: '2', displayName: 'Wigan Athletic' } },
              ],
            },
          ],
        },
      ],
    })
    expect(matches[0]).toMatchObject({ id: 'espn-1', competitionId: 'EL1', status: 'finished', score: { home: 2, away: 1 } })
    expect(matches[1]?.status).toBe('scheduled')
    expect(matches[1]?.score).toBeUndefined()
  })

  it('reads the League One table and clears the entitlement error once rows arrive', () => {
    const table = tableFromEspnStandings(
      {
        children: [
          {
            standings: {
              entries: [
                {
                  team: { id: '387', displayName: 'Bradford City' },
                  stats: [
                    { abbreviation: 'R', value: 1 },
                    { abbreviation: 'GP', value: 10 },
                    { abbreviation: 'W', value: 6 },
                    { abbreviation: 'D', value: 2 },
                    { abbreviation: 'L', value: 2 },
                    { abbreviation: 'F', value: 10 },
                    { abbreviation: 'A', value: 5 },
                    { abbreviation: 'GD', value: 5 },
                    { abbreviation: 'P', value: 20 },
                  ],
                },
              ],
            },
          },
        ],
      },
      '2026-10-18T18:00:00.000Z',
    )
    expect(table?.rows[0]).toMatchObject({ team: 'Bradford City', points: 20, played: 10 })
    const prior = buildFootballSnapshot({
      updatedIso: '2026-10-18T12:00:00.000Z',
      provider: 'football-data.org',
      attribution: 'Football data provided by football-data.org',
      liveReliable: false,
      competitions: [{ id: 'PL', code: 'PL', name: 'Premier League' }],
      matches: [],
      tables: [],
      errors: ['EL1 matches: 403 restricted'],
    })
    const merged = applyLeagueOneSupplement(prior, { matches: [], tables: table ? [table] : [], errors: [] }, { fromIso: '2026-10-11', toIso: '2026-11-08' })
    expect(merged.tables[0]?.competitionId).toBe('EL1')
    expect(merged.errors ?? []).not.toEqual(expect.arrayContaining([expect.stringContaining('EL1')]))
    expect(merged.attribution).toContain('ESPN')
    expect(merged.liveReliable).toBe(false)
  })
})
