import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SportsPanel } from './components/info/SportsPanel.tsx'
import { eventsFromCricketHeader, eventsFromEspnScoreboard, statusText } from './info/sports/scoreboard.ts'

describe('INFO sports scoreboards', () => {
  it('lists NFL, NBA, NHL and cricket beside football', () => {
    const markup = renderToStaticMarkup(createElement(SportsPanel))
    for (const label of ['Football', 'NFL', 'NBA', 'NHL', 'Cricket']) expect(markup).toContain(`>${label}<`)
    expect(readFileSync('src/info/football/load.ts', 'utf8')).toContain('fetchEspnFallback')
  })

  it('keeps a finished NFL score and drops a scheduled zero', () => {
    const events = eventsFromEspnScoreboard(
      {
        events: [
          {
            id: '1',
            date: '2026-10-18T20:25:00Z',
            competitions: [
              {
                status: { type: { state: 'post', completed: true, shortDetail: 'Final' } },
                competitors: [
                  { homeAway: 'home', score: '22', team: { displayName: 'Kansas City Chiefs' } },
                  { homeAway: 'away', score: '6', team: { displayName: 'Los Angeles Chargers' } },
                ],
              },
            ],
          },
          {
            id: '2',
            date: '2026-10-20T19:00:00Z',
            competitions: [
              {
                status: { type: { state: 'pre', shortDetail: 'Scheduled' } },
                competitors: [
                  { homeAway: 'home', score: '0', team: { displayName: 'Detroit Pistons' } },
                  { homeAway: 'away', score: '0', team: { displayName: 'Boston Celtics' } },
                ],
              },
            ],
          },
        ],
      },
      'NFL',
    )
    expect(events[0]).toMatchObject({ status: 'finished', homeScore: '22', awayScore: '6', detail: 'Final' })
    expect(events[1]?.homeScore).toBeUndefined()
    expect(events[1]?.status).toBe('scheduled')
    expect(statusText('finished')).toBe('FT')
    expect(statusText('scheduled')).toBe('')
  })

  it('reads cricket scores from the series header', () => {
    const events = eventsFromCricketHeader({
      sports: [
        {
          leagues: [
            {
              name: 'Australia tour of South Africa 2026/27',
              events: [
                {
                  id: '1525660',
                  date: '2026-10-18T07:45:00Z',
                  status: 'in',
                  competitors: [
                    { homeAway: 'home', displayName: 'South Africa', score: '20/2 (12.2 ov)' },
                    { homeAway: 'away', displayName: 'Australia', score: '' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      competition: 'Australia tour of South Africa 2026/27',
      status: 'in-play',
      home: 'South Africa',
      homeScore: '20/2 (12.2 ov)',
    })
    expect(events[0]?.awayScore).toBeUndefined()
  })
})
