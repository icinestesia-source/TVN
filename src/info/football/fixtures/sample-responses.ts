/** Recorded-shape fixtures for football-data.org adapter tests (not live data). */

export const SAMPLE_MATCHES = {
  matches: [
    {
      id: 1001,
      utcDate: '2026-10-18T14:00:00Z',
      status: 'TIMED',
      matchday: 8,
      homeTeam: { id: 57, shortName: 'Arsenal', name: 'Arsenal FC' },
      awayTeam: { id: 61, shortName: 'Chelsea', name: 'Chelsea FC' },
      score: { fullTime: { home: null, away: null } },
    },
    {
      id: 1002,
      utcDate: '2026-10-17T19:00:00Z',
      status: 'FINISHED',
      matchday: 8,
      homeTeam: { id: 64, shortName: 'Liverpool', name: 'Liverpool FC' },
      awayTeam: { id: 62, shortName: 'Everton', name: 'Everton FC' },
      score: { fullTime: { home: 2, away: 1 } },
    },
    {
      id: 1003,
      utcDate: '2026-10-18T16:30:00Z',
      status: 'IN_PLAY',
      matchday: 8,
      homeTeam: { id: 73, shortName: 'Spurs', name: 'Tottenham Hotspur FC' },
      awayTeam: { id: 563, shortName: 'West Ham', name: 'West Ham United FC' },
      score: { fullTime: { home: 1, away: 1 } },
    },
    {
      id: 1004,
      utcDate: '2026-10-19T12:00:00Z',
      status: 'POSTPONED',
      homeTeam: { id: 397, name: 'Brighton' },
      awayTeam: { id: 402, name: 'Brentford' },
      score: { fullTime: { home: null, away: null } },
    },
  ],
}

export const SAMPLE_STANDINGS = {
  lastUpdated: '2026-10-18T10:00:00Z',
  standings: [
    {
      type: 'TOTAL',
      table: [
        {
          position: 1,
          team: { id: 57, shortName: 'Arsenal' },
          playedGames: 8,
          won: 6,
          draw: 1,
          lost: 1,
          goalsFor: 18,
          goalsAgainst: 6,
          goalDifference: 12,
          points: 19,
          form: 'WWWDW',
        },
        {
          position: 2,
          team: { id: 64, shortName: 'Liverpool' },
          playedGames: 8,
          won: 5,
          draw: 2,
          lost: 1,
          goalsFor: 16,
          goalsAgainst: 8,
          goalDifference: 8,
          points: 17,
        },
      ],
    },
    {
      type: 'HOME',
      table: [{ position: 1, team: { shortName: 'Ignore' }, playedGames: 1, won: 1, draw: 0, lost: 0, goalsFor: 1, goalsAgainst: 0, goalDifference: 1, points: 3 }],
    },
  ],
}

export const SAMPLE_EMPTY = { matches: [] }
