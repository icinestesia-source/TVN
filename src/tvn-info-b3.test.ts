import { describe, expect, it } from 'vitest'
import { FOOTBALL_COMPETITIONS, isKnockoutCompetition } from './info/football/competitions.ts'
import { ingestFootballDataOrg } from './info/football/football-data-org.ts'
import { SAMPLE_EMPTY, SAMPLE_MATCHES, SAMPLE_STANDINGS } from './info/football/fixtures/sample-responses.ts'
import { favouriteFromTeam, searchTeams, teamsFromSnapshot } from './info/football/teams.ts'
import { validateCustomFeedUrl } from './info/news/custom-feeds.ts'
import { personalizeNewsItems, selectPersonalized, visibleNewsCategories } from './info/news/personalize.ts'
import type { NewsItem } from './info/news/types.ts'
import {
  applyInfoPortablePrefs,
  defaultInfoPreferences,
  loadInfoPreferences,
  normalizeInfoPreferences,
  saveInfoPreferences,
} from './info/preferences.ts'
import { convertTemp, convertWindKmh, formatTemp, formatWind } from './info/weather/units.ts'
import { buildTvnExport, validateTvnExport, type PortableSettings } from './services/tvn-export.ts'
import { EMPTY_LIBRARY } from './services/viewing-guides.ts'
import { DEFAULT_TRANSITION_SETTINGS } from './state/transitions.ts'
import { DEFAULT_SHORTCUTS } from './view/info-shortcuts.ts'

const settingsBase = (): PortableSettings => ({
  volume: 40,
  muted: false,
  subtitles: false,
  sleepMinutes: 90,
  guideSplit: 0.45,
  infoShortcuts: { ...DEFAULT_SHORTCUTS },
  surfRange: { minSeconds: 5, maxSeconds: 20 },
  transition: 'instant',
  transitionStyle: { ...DEFAULT_TRANSITION_SETTINGS, id: 'instant' },
})

describe('INFO Phase B.3 preferences', () => {
  it('normalises malformed prefs and keeps safe defaults', () => {
    const defaults = defaultInfoPreferences()
    expect(normalizeInfoPreferences(null).version).toBe(1)
    expect(normalizeInfoPreferences({ version: 1, news: 'nope' }).news.enabledPublisherIds.length).toBeGreaterThan(0)
    expect(defaults.football.competitionOrder).toContain('EL1')
    expect(defaults.weather.tempUnit).toBe('celsius')
    const next = normalizeInfoPreferences({ ...defaults, weather: { ...defaults.weather, tempUnit: 'fahrenheit' } })
    expect(next.weather.tempUnit).toBe('fahrenheit')
    saveInfoPreferences(next)
    const loaded = loadInfoPreferences()
    expect(loaded.football.competitionOrder).toContain('EL1')
  })

  it('exports and restores INFO prefs inside tvn-export-v1 settings', () => {
    const info = defaultInfoPreferences()
    info.football.favouriteCompetitionIds = ['PL', 'EL1']
    info.news.enabledPublisherIds = info.news.enabledPublisherIds.slice(0, 3)
    const document = buildTvnExport({
      stored: [],
      users: [],
      favourites: [],
      settings: { ...settingsBase(), info },
      now: new Date('2026-10-18T12:00:00.000Z'),
      guides: EMPTY_LIBRARY,
    })
    const checked = validateTvnExport(document)
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.value.settings.info?.football.favouriteCompetitionIds).toEqual(['PL', 'EL1'])
    applyInfoPortablePrefs(checked.value.settings.info)
    expect(normalizeInfoPreferences(checked.value.settings.info).football.favouriteCompetitionIds).toEqual(['PL', 'EL1'])
  })

  it('rejects non-object settings.info', () => {
    const document = buildTvnExport({
      stored: [],
      users: [],
      favourites: [],
      settings: settingsBase(),
      now: new Date('2026-10-18T12:00:00.000Z'),
      guides: EMPTY_LIBRARY,
    })
    const broken = { ...document, settings: { ...document.settings, info: 'nope' } }
    const checked = validateTvnExport(broken)
    expect(checked.ok).toBe(false)
  })
})

describe('INFO Phase B.3 football', () => {
  it('lists every configured competition including League One and does not invent knockout tables', () => {
    expect(FOOTBALL_COMPETITIONS.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['PL', 'ELC', 'EL1', 'CL', 'BL1', 'SA', 'PD', 'FL1', 'DED', 'BSA', 'WC', 'EC']),
    )
    expect(FOOTBALL_COMPETITIONS.map((entry) => entry.code)).not.toContain('PPL')
    expect(FOOTBALL_COMPETITIONS).toHaveLength(12)
    expect(FOOTBALL_COMPETITIONS.find((entry) => entry.code === 'EL1')?.name).toBe('League One')
    expect(isKnockoutCompetition('CL')).toBe(true)
    expect(isKnockoutCompetition('PL')).toBe(false)
  })

  it('extracts team ids from fixtures for favourites', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('/competitions/PL/matches')) return new Response(JSON.stringify(SAMPLE_MATCHES), { status: 200 })
      if (url.includes('/competitions/PL/standings')) return new Response(JSON.stringify(SAMPLE_STANDINGS), { status: 200 })
      if (url.includes('/matches')) return new Response(JSON.stringify(SAMPLE_EMPTY), { status: 200 })
      if (url.includes('/standings')) return new Response(JSON.stringify({ standings: [] }), { status: 200 })
      return new Response('nope', { status: 404 })
    }
    const snapshot = await ingestFootballDataOrg({
      token: 'test',
      dateFrom: '2026-10-11',
      dateTo: '2026-11-08',
      delayMs: 0,
      fetchImpl,
    })
    expect(snapshot.competitions.map((entry) => entry.code)).toEqual(FOOTBALL_COMPETITIONS.map((entry) => entry.code))
    const teams = teamsFromSnapshot(snapshot)
    expect(teams.some((team) => team.id === '57' && team.name === 'Arsenal')).toBe(true)
    const found = searchTeams(teams, 'arse')
    expect(found[0]?.id).toBe('57')
    expect(favouriteFromTeam(found[0]!).id).toBe('57')
    expect(snapshot.matches.find((match) => match.id === '1001')?.homeTeamId).toBe('57')
    expect(snapshot.tables[0].rows[0].teamId).toBe('57')
  })
})

describe('INFO Phase B.3 news', () => {
  it('personalises publishers/categories and validates custom feed URLs', () => {
    const prefs = defaultInfoPreferences()
    prefs.news.enabledPublisherIds = ['BBC News']
    prefs.news.hiddenCategories = ['science']
    const items: NewsItem[] = [
      { id: '1', title: 'A', publisher: 'BBC News', publishedAt: '2026-10-18T12:00:00.000Z', description: null, category: 'top', url: 'https://a.test/1', sourceId: 'bbc' },
      { id: '2', title: 'B', publisher: 'Sky News', publishedAt: '2026-10-18T11:00:00.000Z', description: null, category: 'top', url: 'https://a.test/2', sourceId: 'sky' },
      { id: '3', title: 'C', publisher: 'BBC News', publishedAt: '2026-10-18T10:00:00.000Z', description: null, category: 'science', url: 'https://a.test/3', sourceId: 'bbc' },
      { id: '4', title: 'D', publisher: 'Custom · Mine', publishedAt: '2026-10-18T09:00:00.000Z', description: null, category: 'top', url: 'https://a.test/4', sourceId: 'custom:1' },
    ]
    expect(personalizeNewsItems(items, prefs).map((item) => item.id)).toEqual(['1', '3', '4'])
    expect(visibleNewsCategories(prefs, new Set(['top', 'science', 'uk']))).toEqual(expect.arrayContaining(['top', 'uk']))
    expect(visibleNewsCategories(prefs, new Set(['top', 'science', 'uk']))).not.toContain('science')
    expect(selectPersonalized(items, prefs, 'top', false).map((item) => item.id).sort()).toEqual(['1', '4'])
    expect(selectPersonalized(items, prefs, 'top', false).some((item) => item.publisher === 'Sky News')).toBe(false)
    expect(validateCustomFeedUrl('https://example.com/rss.xml').ok).toBe(true)
    expect(validateCustomFeedUrl('http://127.0.0.1/feed').ok).toBe(false)
    expect(validateCustomFeedUrl('https://user:pass@evil.test/feed').ok).toBe(false)
  })
})

describe('INFO Phase B.3 weather units', () => {
  it('converts temperature and wind units without inventing readings', () => {
    expect(convertTemp(0, 'fahrenheit')).toBe(32)
    expect(formatTemp(10, 'celsius')).toBe('10°C')
    expect(formatTemp(10, 'fahrenheit')).toBe('50°F')
    expect(Math.round(convertWindKmh(16.0934, 'mph'))).toBe(10)
    expect(formatWind(36, 'kmh')).toBe('36 km/h')
  })
})
