import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { INFO_MODULES, InfoCentre } from './components/InfoCentre.tsx'
import { pairsFromFrankfurter } from './info/business/frankfurter.ts'
import { quoteFromAlphaGlobal } from './info/business/alpha-vantage.ts'
import { titleFromTmdb, titlesFromTmdbList } from './info/entertainment/tmdb.ts'
import { eventsFromWikimediaPayload, filterHistory } from './info/history/wikimedia.ts'
import { defaultInfoPreferences, normalizeInfoPreferences } from './info/preferences.ts'
import { commandFromKey } from './input/keyboard.ts'

describe('INFO Phase C', () => {
  it('registers Entertainment, Business and On this day without stealing V or I', () => {
    expect(INFO_MODULES.map((module) => module.id)).toEqual([
      'news',
      'sports',
      'weather',
      'entertainment',
      'business',
      'on-this-day',
    ])
    const markup = renderToStaticMarkup(createElement(InfoCentre))
    expect(markup).toContain('Entertainment')
    expect(markup).toContain('Business')
    expect(markup).toContain('On this day')
    const plain = { meta: false, ctrl: false, alt: false }
    expect(commandFromKey('v', plain, true)).toEqual({ type: 'info' })
    expect(commandFromKey('i', plain, true)).toEqual({ type: 'guide-tool', tool: 'add' })
  })

  it('parses TMDB list payloads without inventing titles', () => {
    const titles = titlesFromTmdbList(
      {
        results: [
          { id: 1, title: 'Example Film', release_date: '2024-01-02', overview: 'A plot.', vote_average: 7.2, poster_path: '/x.jpg', genre_ids: [18] },
          { id: 2, name: 'Example Show', first_air_date: '2023-05-01', overview: '', vote_average: 8.1, media_type: 'tv' },
        ],
      },
      'film',
    )
    expect(titles).toHaveLength(1)
    expect(titles[0].title).toBe('Example Film')
    expect(titles[0].year).toBe(2024)
    expect(titleFromTmdb({ id: 9 }, 'film')).toBeNull()
  })

  it('normalises Alpha Vantage quotes and Frankfurter FX pairs', () => {
    const quote = quoteFromAlphaGlobal(
      {
        'Global Quote': {
          '01. symbol': 'IBM',
          '05. price': '100.5',
          '09. change': '1.25',
          '10. change percent': '1.25%',
          '07. latest trading day': '2026-10-17',
        },
      },
      { id: 'ibm', name: 'IBM', kind: 'stock' },
    )
    expect(quote).toMatchObject({ value: 100.5, change: 1.25, delayed: true, provider: 'Alpha Vantage' })
    expect(quoteFromAlphaGlobal({}, { id: 'x', name: 'X', kind: 'stock' })).toBeNull()
    const pairs = pairsFromFrankfurter({ date: '2026-10-16', rates: { EUR: 1.18, USD: 1.33, JPY: 200 } }, 'GBP')
    expect(pairs.some((pair) => pair.quote === 'EUR' && pair.rate === 1.18 && pair.delayed)).toBe(true)
  })

  it('parses Wikimedia on-this-day events, dedupes, and filters entertainment', () => {
    const events = eventsFromWikimediaPayload({
      selected: [{ year: 1922, text: 'The British Broadcasting Company begins radio broadcasts.', pages: [] }],
      events: [
        { year: 1922, text: 'The British Broadcasting Company begins radio broadcasts.', pages: [] },
        { year: 1968, text: 'A science team invents a new computer technique.', pages: [] },
      ],
      births: [{ year: 1956, text: 'A noted film actor is born.', pages: [] }],
      deaths: [{ year: 1900, text: 'Someone dies.', pages: [] }],
    })
    expect(events.filter((event) => event.year === 1922)).toHaveLength(1)
    expect(events.some((event) => /dies/i.test(event.title))).toBe(false)
    expect(filterHistory(events, { entertainmentOnly: true }).every((event) =>
      ['film-television', 'music', 'broadcasting'].includes(event.category),
    )).toBe(true)
  })

  it('migrates Phase B prefs into Phase C entertainment/business/history defaults', () => {
    const legacy = normalizeInfoPreferences({
      version: 1,
      news: defaultInfoPreferences().news,
      football: defaultInfoPreferences().football,
      weather: defaultInfoPreferences().weather,
    })
    expect(legacy.version).toBe(2)
    expect(legacy.entertainment.watchlist).toEqual([])
    expect(legacy.business.baseCurrency).toBe('GBP')
    expect(legacy.history.preferredCategories.length).toBeGreaterThan(3)
  })
})
