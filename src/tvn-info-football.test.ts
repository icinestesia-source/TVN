import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FootballPanel } from './components/info/FootballPanel.tsx'
import { INFO_MODULES } from './components/InfoCentre.tsx'
import { FOOTBALL_COMPETITIONS } from './info/football/competitions.ts'
import { ingestFootballDataOrg } from './info/football/football-data-org.ts'
import { diagnoseFootballEmpty } from './info/football/empty-state.ts'
import { SAMPLE_EMPTY, SAMPLE_MATCHES, SAMPLE_MATCHES_ELC, SAMPLE_STANDINGS } from './info/football/fixtures/sample-responses.ts'
import { fixtureMatches, matchesForCompetition, resultMatches } from './info/football/match-lists.ts'
import { matchStatusOf, statusLabel, buildFootballSnapshot, asFootballSnapshot, emptyFootballSnapshot } from './info/football/normalize.ts'
import { footballIngestForced, footballSlotDue, FOOTBALL_SCHEDULE_SLOTS } from './info/football/schedule.ts'
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

  it('gates scheduled refresh in Europe/London including Saturday dual slots', () => {
    expect(FOOTBALL_SCHEDULE_SLOTS).toHaveLength(8)
    // Monday 22:05 BST (2026-10-19 is a Monday; BST ends 25 Oct 2026)
    const monday = footballSlotDue(new Date('2026-10-19T21:05:00.000Z'))
    expect(monday?.key).toContain('T22:00')
    // Saturday 17:10 BST
    const satAfternoon = footballSlotDue(new Date('2026-10-17T16:10:00.000Z'))
    expect(satAfternoon?.key).toContain('T17:00')
    // Saturday 22:40 BST
    const satEvening = footballSlotDue(new Date('2026-10-17T21:40:00.000Z'))
    expect(satEvening?.key).toContain('T22:30')
    // Midday — not due
    expect(footballSlotDue(new Date('2026-10-19T12:00:00.000Z'))).toBeNull()
    // GMT winter: Monday 22:05 GMT = 22:05Z on 2026-11-02
    const winter = footballSlotDue(new Date('2026-11-02T22:05:00.000Z'))
    expect(winter?.key).toContain('T22:00')
    expect(footballIngestForced({ FOOTBALL_INGEST_FORCE: '1' })).toBe(true)
    expect(footballIngestForced({})).toBe(false)
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
        section: 'fixtures',
        competitionId: 'BL1',
        snapshot: { ...snapshot, errors: ['BL1 matches: 403 Forbidden'] },
        loadStatus: 'ready',
      }).kind,
    ).toBe('competition-unavailable')
  })

  it('does not treat unpublished snapshots as “no matches in selection”', () => {
    const empty = emptyFootballSnapshot('DATA NOT YET PUBLISHED — waiting for ingest')
    expect(
      diagnoseFootballEmpty({
        section: 'fixtures',
        competitionId: 'PL',
        snapshot: empty,
        loadStatus: 'unavailable',
      }).kind,
    ).toBe('not-published')
    expect(
      diagnoseFootballEmpty({
        section: 'results',
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
        section: 'fixtures',
        competitionId: 'PL',
        snapshot: readyEmpty,
        loadStatus: 'ready',
      }).kind,
    ).toBe('no-matches')
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
        section: 'fixtures',
        competitionId: 'EL1',
        snapshot,
        loadStatus: 'ready',
      }).kind,
    ).toBe('competition-unavailable')
  })
})
