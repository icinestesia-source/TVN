import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { INFO_MODULES, InfoCentre } from './components/InfoCentre.tsx'
import { ShoppingPanel } from './components/info/ShoppingPanel.tsx'
import { RETAILERS } from './info/shopping/catalogue.ts'
import { DEFERRED_FOOTBALL_COMPETITIONS, FOOTBALL_COMPETITIONS } from './info/football/competitions.ts'
import { defaultInfoPreferences, normalizeInfoPreferences } from './info/preferences.ts'
import { commandFromKey } from './input/keyboard.ts'
import { readFileSync } from 'node:fs'

describe('INFO Phase E release candidate', () => {
  it('keeps all seven INFO modules and does not steal V or I', () => {
    expect(INFO_MODULES.map((module) => module.id)).toEqual([
      'news',
      'sports',
      'weather',
      'entertainment',
      'business',
      'on-this-day',
      'shopping',
    ])
    const markup = renderToStaticMarkup(createElement(InfoCentre))
    for (const label of ['News', 'Sports', 'Weather', 'Entertainment', 'Business', 'On this day', 'Shopping']) {
      expect(markup).toContain(label)
    }
    const plain = { meta: false, ctrl: false, alt: false }
    expect(commandFromKey('v', plain, true)).toEqual({ type: 'info' })
    expect(commandFromKey('i', plain, true)).toEqual({ type: 'guide-tool', tool: 'add' })
  })

  it('does not remount the player when INFO opens', () => {
    const screen = readFileSync('src/app/TvScreen.tsx', 'utf8')
    expect(screen).toContain('<PlayerStage')
    expect(screen).toContain('{guide ? <Guide')
    expect(screen).not.toMatch(/key=\{[^}]*guideTool/)
    expect(readFileSync('src/state/TvProvider.tsx', 'utf8')).toContain("held?.kind === 'infocentre'")
  })

  it('hides Official partners only until a verified partner exists and explains empty products', () => {
    expect(RETAILERS.every((entry) => entry.officialPartner === false)).toBe(true)
    const markup = renderToStaticMarkup(createElement(ShoppingPanel))
    expect(markup).not.toContain('Official partners only')
    expect(markup).toContain('Discover')
    expect(markup).toContain('Mall')
  })

  it('preserves deferred Primeira Liga alongside active League One without inventing data', () => {
    expect(FOOTBALL_COMPETITIONS.some((entry) => entry.code === 'EL1')).toBe(true)
    expect(FOOTBALL_COMPETITIONS.some((entry) => entry.code === 'PPL')).toBe(false)
    expect(DEFERRED_FOOTBALL_COMPETITIONS.some((entry) => entry.code === 'PPL')).toBe(true)
    expect(FOOTBALL_COMPETITIONS).toHaveLength(12)
  })

  it('migrates earlier INFO preference versions into shopping-aware v3', () => {
    const fromV1 = normalizeInfoPreferences({
      version: 1,
      news: defaultInfoPreferences().news,
      football: defaultInfoPreferences().football,
      weather: defaultInfoPreferences().weather,
    })
    expect(fromV1.version).toBe(3)
    expect(fromV1.shopping.userShops).toEqual([])
    expect(fromV1.entertainment.watchlist).toEqual([])
  })

  it('keeps TMDB and finance secrets server-side only', () => {
    const bundleHints = [
      readFileSync('src/info/entertainment/tmdb.ts', 'utf8'),
      readFileSync('src/info/business/alpha-vantage.ts', 'utf8'),
      readFileSync('netlify/functions/info-tmdb.ts', 'utf8'),
      readFileSync('netlify/functions/info-finance.ts', 'utf8'),
    ].join('\n')
    expect(bundleHints).toContain('/api/info/tmdb')
    expect(bundleHints).toContain('ALPHA_VANTAGE_API_KEY')
    expect(bundleHints).not.toMatch(/apikey=\{process\.env/)
    expect(readFileSync('netlify/functions/info-finance.ts', 'utf8')).toContain('CACHE_TTL_MS')
    expect(readFileSync('src/info/entertainment/tmdb-auth.ts', 'utf8')).toContain('isTmdbBearerToken')
  })
})
