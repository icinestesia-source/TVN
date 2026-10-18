import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { INFO_MODULES, InfoCentre } from './components/InfoCentre.tsx'
import { ShoppingPanel } from './components/info/ShoppingPanel.tsx'
import { CATALOGUE_PRODUCTS, RETAILERS, searchRetailers } from './info/shopping/catalogue.ts'
import { MALL_STATUS_NOTE, mallDepartmentZones } from './info/shopping/mall.ts'
import { shoppingTvLink } from './info/shopping/tvn-link.ts'
import { SHOPPING_DEPARTMENTS } from './info/shopping/types.ts'
import { userShopId, validateShopUrl } from './info/shopping/validate.ts'
import {
  applyInfoPortablePrefs,
  defaultInfoPreferences,
  loadInfoPreferences,
  normalizeInfoPreferences,
  saveInfoPreferences,
} from './info/preferences.ts'
import { buildTvnExport, validateTvnExport, type PortableSettings } from './services/tvn-export.ts'
import { EMPTY_LIBRARY } from './services/viewing-guides.ts'
import { DEFAULT_TRANSITION_SETTINGS } from './state/transitions.ts'
import { DEFAULT_SHORTCUTS } from './view/info-shortcuts.ts'
import { commandFromKey } from './input/keyboard.ts'

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

describe('INFO Phase D.1 Shopping', () => {
  it('registers Shopping as the seventh INFO module without stealing V or I', () => {
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
    expect(markup).toContain('Shopping')
    expect(markup).toContain('News')
    expect(markup).toContain('On this day')
    const plain = { meta: false, ctrl: false, alt: false }
    expect(commandFromKey('v', plain, true)).toEqual({ type: 'info' })
    expect(commandFromKey('i', plain, true)).toEqual({ type: 'guide-tool', tool: 'add' })
  })

  it('renders Shopping navigation sections and keeps the product catalogue empty until authorised', () => {
    const markup = renderToStaticMarkup(createElement(ShoppingPanel))
    for (const label of ['Discover', 'Departments', 'Shops', 'Products', 'Favourites', 'Shopping TV', 'Mall']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('(external)')
    expect(markup).toContain('Directory listing only')
    expect(CATALOGUE_PRODUCTS).toHaveLength(0)
  })

  it('exposes a curated retailer directory without inventing partners or products', () => {
    expect(RETAILERS.length).toBeGreaterThan(5)
    expect(RETAILERS.every((entry) => entry.officialPartner === false)).toBe(true)
    expect(RETAILERS.every((entry) => /^https?:\/\//i.test(entry.websiteUrl))).toBe(true)
    expect(SHOPPING_DEPARTMENTS.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['electronics', 'books', 'gaming', 'food-drink', 'other']),
    )
    expect(searchRetailers('waterstones').some((entry) => entry.id === 'waterstones')).toBe(true)
    expect(shoppingTvLink({ channelNumber: null })).toBeNull()
    expect(shoppingTvLink({ channelNumber: 999999 })).toBeNull()
  })

  it('validates user shop URLs and rejects private hosts', () => {
    expect(validateShopUrl('https://shop.example.com/path').ok).toBe(true)
    expect(validateShopUrl('example.com').ok).toBe(true)
    expect(validateShopUrl('http://localhost/shop').ok).toBe(false)
    expect(validateShopUrl('http://127.0.0.1/').ok).toBe(false)
    expect(validateShopUrl('ftp://files.example.com').ok).toBe(false)
    expect(userShopId('Acme', 'https://acme.example/')).toMatch(/^us[0-9a-f]+$/)
  })

  it('builds Virtual Mall department zones from the same catalogue without claiming 3D', () => {
    const zones = mallDepartmentZones()
    expect(zones.length).toBeGreaterThan(0)
    expect(zones.every((zone) => zone.shopfronts.every((shop) => shop.catalogueRetailerId))).toBe(true)
    expect(MALL_STATUS_NOTE).toMatch(/not a 3D experience/i)
    expect(MALL_STATUS_NOTE).toMatch(/immersive/i)
  })

  it('persists shopping favourites and user shops; migrates older INFO prefs', () => {
    const store = new Map<string, string>()
    const memory = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    }
    const original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true })
    try {
      const legacy = normalizeInfoPreferences({
        version: 2,
        news: defaultInfoPreferences().news,
        football: defaultInfoPreferences().football,
        weather: defaultInfoPreferences().weather,
        entertainment: defaultInfoPreferences().entertainment,
        business: defaultInfoPreferences().business,
        history: defaultInfoPreferences().history,
      })
      expect(legacy.version).toBe(3)
      expect(legacy.shopping.userShops).toEqual([])
      expect(legacy.shopping.departmentOrder).toContain('electronics')

      const next = {
        ...legacy,
        shopping: {
          ...legacy.shopping,
          favouriteShopIds: ['waterstones'],
          favouriteDepartments: ['books' as const],
          userShops: [
            {
              id: 'usdemo',
              name: 'Demo Shop',
              websiteUrl: 'https://demo.example/',
              department: 'hobbies' as const,
              description: 'Local favourite',
              favourite: true,
            },
          ],
        },
      }
      saveInfoPreferences(next)
      const loaded = loadInfoPreferences()
      expect(loaded.shopping.favouriteShopIds).toEqual(['waterstones'])
      expect(loaded.shopping.userShops[0]?.name).toBe('Demo Shop')

      const document = buildTvnExport({
        stored: [],
        users: [],
        favourites: [],
        settings: { ...settingsBase(), info: loaded },
        now: new Date('2026-10-18T12:00:00.000Z'),
        guides: EMPTY_LIBRARY,
      })
      const checked = validateTvnExport(document)
      expect(checked.ok).toBe(true)
      if (!checked.ok) return
      applyInfoPortablePrefs(checked.value.settings.info)
      expect(loadInfoPreferences().shopping.favouriteDepartments).toEqual(['books'])
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
    }
  })
})
