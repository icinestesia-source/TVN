import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FootballPanel } from './components/info/FootballPanel.tsx'
import { INFO_MODULES } from './components/InfoCentre.tsx'
import { FOOTBALL_COMPETITIONS } from './info/football/competitions.ts'
import { matchStatusOf, statusLabel, buildFootballSnapshot, asFootballSnapshot, emptyFootballSnapshot } from './info/football/normalize.ts'
import type { FootballMatch } from './info/football/types.ts'

const read = (path: string) => readFileSync(path, 'utf8')

describe('INFO football', () => {
  it('maps provider statuses and never labels delayed in-play as Live', () => {
    expect(matchStatusOf('SCHEDULED')).toBe('scheduled')
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
    expect(FOOTBALL_COMPETITIONS.map((entry) => entry.code)).toEqual(expect.arrayContaining(['PL', 'ELC', 'CL']))
    expect(FOOTBALL_COMPETITIONS.some((entry) => entry.code === 'PL')).toBe(true)
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
  })
})
