import { NEWS_CATEGORIES, type NewsCategory } from './news/types.ts'
import { FOOTBALL_COMPETITIONS } from './football/competitions.ts'
import { NEWS_FEEDS } from './news/feeds.ts'
import { DEFAULT_WEATHER_LOCATION, type WeatherLocation } from './weather/types.ts'
import type { DiscoveryMood, WatchlistEntry } from './entertainment/types.ts'
import type { BusinessWatchEntry } from './business/types.ts'
import type { HistoryCategory } from './history/types.ts'
import { HISTORY_CATEGORIES } from './history/types.ts'
import {
  SHOPPING_DEPARTMENTS,
  type ShoppingDepartmentId,
  type ShoppingPreferences,
  type UserShop,
} from './shopping/types.ts'

export const INFO_PREFS_KEY = 'tvn.info.preferences.v1'
export const INFO_PREFS_VERSION = 3 as const

export type FootballDefaultView = 'my-football' | 'favourite-team-league' | 'default-league' | 'today' | 'last-viewed'
export type WeatherProviderId = 'open-meteo' | 'met-norway'
export type TempUnit = 'celsius' | 'fahrenheit'
export type WindUnit = 'kmh' | 'mph'
export type BusinessDefaultView = 'markets' | 'currencies' | 'watchlist'

export interface FavouriteTeam {
  id: string
  name: string
  competitionId: string
}

export interface CustomNewsFeed {
  id: string
  title: string
  publisher: string
  feedUrl: string
  category: NewsCategory
  enabled: boolean
  addedIso: string
}

export interface InfoPreferences {
  version: typeof INFO_PREFS_VERSION
  news: {
    enabledPublisherIds: string[]
    publisherOrder: string[]
    categoryOrder: NewsCategory[]
    hiddenCategories: NewsCategory[]
    customFeeds: CustomNewsFeed[]
  }
  football: {
    favouriteTeamIds: string[]
    favouriteTeams: FavouriteTeam[]
    primaryTeamId: string | null
    favouriteCompetitionIds: string[]
    competitionOrder: string[]
    hiddenCompetitionIds: string[]
    defaultCompetitionId: string | null
    defaultView: FootballDefaultView
    lastViewedCompetitionId: string | null
  }
  weather: {
    locations: WeatherLocation[]
    defaultLocationId: string | null
    locationOrder: string[]
    tempUnit: TempUnit
    windUnit: WindUnit
    provider: WeatherProviderId
  }
  entertainment: {
    watchlist: WatchlistEntry[]
    favouriteGenres: string[]
    preferredDiscovery: DiscoveryMood[]
  }
  business: {
    watchlist: BusinessWatchEntry[]
    defaultView: BusinessDefaultView
    baseCurrency: string
    defaultMarketId: string | null
  }
  history: {
    preferredCategories: HistoryCategory[]
    lastMonth: number | null
    lastDay: number | null
  }
  shopping: ShoppingPreferences
}

export function defaultInfoPreferences(): InfoPreferences {
  const publisherIds = NEWS_FEEDS.map((feed) => feed.publisher)
  const uniquePublishers = [...new Set(publisherIds)]
  return {
    version: INFO_PREFS_VERSION,
    news: {
      enabledPublisherIds: uniquePublishers,
      publisherOrder: uniquePublishers,
      categoryOrder: NEWS_CATEGORIES.map((entry) => entry.id),
      hiddenCategories: [],
      customFeeds: [],
    },
    football: {
      favouriteTeamIds: [],
      favouriteTeams: [],
      primaryTeamId: null,
      favouriteCompetitionIds: [],
      competitionOrder: FOOTBALL_COMPETITIONS.map((entry) => entry.code),
      hiddenCompetitionIds: [],
      defaultCompetitionId: 'PL',
      defaultView: 'today',
      lastViewedCompetitionId: null,
    },
    weather: {
      locations: [DEFAULT_WEATHER_LOCATION],
      defaultLocationId: DEFAULT_WEATHER_LOCATION.id,
      locationOrder: [DEFAULT_WEATHER_LOCATION.id],
      tempUnit: 'celsius',
      windUnit: 'kmh',
      provider: 'open-meteo',
    },
    entertainment: {
      watchlist: [],
      favouriteGenres: [],
      preferredDiscovery: ['comedy', 'drama', 'surprise'],
    },
    business: {
      watchlist: [],
      defaultView: 'markets',
      baseCurrency: 'GBP',
      defaultMarketId: 'ftse100',
    },
    history: {
      preferredCategories: HISTORY_CATEGORIES.map((entry) => entry.id),
      lastMonth: null,
      lastDay: null,
    },
    shopping: {
      favouriteShopIds: [],
      favouriteProductIds: [],
      favouriteDepartments: [],
      userShops: [],
      departmentOrder: SHOPPING_DEPARTMENTS.map((entry) => entry.id),
      showOfficialOnly: false,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function isWatchlistEntry(value: unknown): value is WatchlistEntry {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.title === 'string' && (value.kind === 'film' || value.kind === 'television')
}

function isBusinessWatch(value: unknown): value is BusinessWatchEntry {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.symbol === 'string' && typeof value.name === 'string'
}

/** Migrate / sanitise stored prefs. Malformed data falls back to defaults for broken sections. */
export function normalizeInfoPreferences(raw: unknown): InfoPreferences {
  const defaults = defaultInfoPreferences()
  if (!isRecord(raw)) return defaults
  const news = isRecord(raw.news) ? raw.news : {}
  const football = isRecord(raw.football) ? raw.football : {}
  const weather = isRecord(raw.weather) ? raw.weather : {}
  const entertainment = isRecord(raw.entertainment) ? raw.entertainment : {}
  const business = isRecord(raw.business) ? raw.business : {}
  const history = isRecord(raw.history) ? raw.history : {}
  const shopping = isRecord(raw.shopping) ? raw.shopping : {}

  const publishers = defaults.news.publisherOrder
  const enabled = asStringArray(news.enabledPublisherIds)
  const order = asStringArray(news.publisherOrder)
  const newlyListed = order.length ? publishers.filter((id) => !order.includes(id)) : []
  const categoryOrder = asStringArray(news.categoryOrder).filter((id): id is NewsCategory =>
    NEWS_CATEGORIES.some((entry) => entry.id === id),
  )
  const hiddenCategories = asStringArray(news.hiddenCategories).filter((id): id is NewsCategory =>
    NEWS_CATEGORIES.some((entry) => entry.id === id),
  )
  const customFeeds = Array.isArray(news.customFeeds) ? news.customFeeds.filter(isCustomFeed) : []

  const favouriteTeams = Array.isArray(football.favouriteTeams) ? football.favouriteTeams.filter(isFavouriteTeam) : []
  const favouriteTeamIds = asStringArray(football.favouriteTeamIds)
  const mergedTeamIds = [...new Set([...favouriteTeamIds, ...favouriteTeams.map((team) => team.id)])]

  const locations = Array.isArray(weather.locations) ? weather.locations.filter(isWeatherLocation) : defaults.weather.locations
  const locationOrder = asStringArray(weather.locationOrder)
  const orderedLocations =
    locationOrder.length > 0
      ? [
          ...(locationOrder.map((id) => locations.find((entry) => entry.id === id)).filter(Boolean) as WeatherLocation[]),
          ...locations.filter((entry) => !locationOrder.includes(entry.id)),
        ]
      : locations

  const defaultView = football.defaultView
  const viewOk =
    defaultView === 'my-football' ||
    defaultView === 'favourite-team-league' ||
    defaultView === 'default-league' ||
    defaultView === 'today' ||
    defaultView === 'last-viewed'

  const bizView = business.defaultView
  const bizViewOk = bizView === 'markets' || bizView === 'currencies' || bizView === 'watchlist'

  const preferredCategories = asStringArray(history.preferredCategories).filter((id): id is HistoryCategory =>
    HISTORY_CATEGORIES.some((entry) => entry.id === id),
  )

  return {
    version: INFO_PREFS_VERSION,
    news: {
      enabledPublisherIds: enabled.length ? [...new Set([...enabled, ...newlyListed])] : publishers,
      publisherOrder: order.length ? [...order, ...publishers.filter((id) => !order.includes(id))] : publishers,
      categoryOrder: categoryOrder.length
        ? [...categoryOrder, ...defaults.news.categoryOrder.filter((id) => !categoryOrder.includes(id))]
        : defaults.news.categoryOrder,
      hiddenCategories,
      customFeeds,
    },
    football: {
      favouriteTeamIds: mergedTeamIds,
      favouriteTeams,
      primaryTeamId: typeof football.primaryTeamId === 'string' ? football.primaryTeamId : mergedTeamIds[0] ?? null,
      favouriteCompetitionIds: asStringArray(football.favouriteCompetitionIds),
      competitionOrder: (() => {
        const codes = FOOTBALL_COMPETITIONS.map((entry) => entry.code)
        const stored = asStringArray(football.competitionOrder)
        return stored.length ? [...stored.filter((code) => (codes as string[]).includes(code)), ...codes.filter((code) => !stored.includes(code))] : codes
      })(),
      hiddenCompetitionIds: asStringArray(football.hiddenCompetitionIds),
      defaultCompetitionId: typeof football.defaultCompetitionId === 'string' ? football.defaultCompetitionId : 'PL',
      defaultView: viewOk ? defaultView : 'today',
      lastViewedCompetitionId: typeof football.lastViewedCompetitionId === 'string' ? football.lastViewedCompetitionId : null,
    },
    weather: {
      locations: orderedLocations.length ? orderedLocations : defaults.weather.locations,
      defaultLocationId:
        typeof weather.defaultLocationId === 'string'
          ? weather.defaultLocationId
          : orderedLocations[0]?.id ?? DEFAULT_WEATHER_LOCATION.id,
      locationOrder: orderedLocations.map((entry) => entry.id),
      tempUnit: weather.tempUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
      windUnit: weather.windUnit === 'mph' ? 'mph' : 'kmh',
      provider: weather.provider === 'met-norway' ? 'met-norway' : 'open-meteo',
    },
    entertainment: {
      watchlist: Array.isArray(entertainment.watchlist) ? entertainment.watchlist.filter(isWatchlistEntry) : [],
      favouriteGenres: asStringArray(entertainment.favouriteGenres),
      preferredDiscovery: asStringArray(entertainment.preferredDiscovery).filter(Boolean) as DiscoveryMood[],
    },
    business: {
      watchlist: Array.isArray(business.watchlist) ? business.watchlist.filter(isBusinessWatch) : [],
      defaultView: bizViewOk ? bizView : 'markets',
      baseCurrency: typeof business.baseCurrency === 'string' ? business.baseCurrency.toUpperCase() : 'GBP',
      defaultMarketId: typeof business.defaultMarketId === 'string' ? business.defaultMarketId : 'ftse100',
    },
    history: {
      preferredCategories: preferredCategories.length ? preferredCategories : defaults.history.preferredCategories,
      lastMonth: typeof history.lastMonth === 'number' ? history.lastMonth : null,
      lastDay: typeof history.lastDay === 'number' ? history.lastDay : null,
    },
    shopping: normalizeShoppingPreferences(shopping, defaults.shopping),
  }
}

function isShoppingDepartmentId(value: unknown): value is ShoppingDepartmentId {
  return typeof value === 'string' && SHOPPING_DEPARTMENTS.some((entry) => entry.id === value)
}

function isUserShop(value: unknown): value is UserShop {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.websiteUrl === 'string' &&
    isShoppingDepartmentId(value.department) &&
    typeof value.description === 'string' &&
    typeof value.favourite === 'boolean' &&
    /^https?:\/\//i.test(value.websiteUrl)
  )
}

function normalizeShoppingPreferences(raw: Record<string, unknown>, defaults: ShoppingPreferences): ShoppingPreferences {
  const departmentIds = SHOPPING_DEPARTMENTS.map((entry) => entry.id)
  const storedOrder = asStringArray(raw.departmentOrder).filter(isShoppingDepartmentId)
  const departmentOrder = storedOrder.length
    ? [...storedOrder, ...departmentIds.filter((id) => !storedOrder.includes(id))]
    : defaults.departmentOrder
  const favouriteDepartments = asStringArray(raw.favouriteDepartments).filter(isShoppingDepartmentId)
  const userShops = Array.isArray(raw.userShops) ? raw.userShops.filter(isUserShop) : []
  return {
    favouriteShopIds: asStringArray(raw.favouriteShopIds),
    favouriteProductIds: asStringArray(raw.favouriteProductIds),
    favouriteDepartments,
    userShops,
    departmentOrder,
    showOfficialOnly: raw.showOfficialOnly === true,
  }
}

function isCustomFeed(value: unknown): value is CustomNewsFeed {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.publisher === 'string' &&
    typeof value.feedUrl === 'string' &&
    typeof value.category === 'string' &&
    typeof value.enabled === 'boolean' &&
    typeof value.addedIso === 'string' &&
    /^https?:\/\//i.test(value.feedUrl)
  )
}

function isFavouriteTeam(value: unknown): value is FavouriteTeam {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.name === 'string' && typeof value.competitionId === 'string'
}

function isWeatherLocation(value: unknown): value is WeatherLocation {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number' &&
    typeof value.timezone === 'string'
  )
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export function loadInfoPreferences(): InfoPreferences {
  try {
    const raw = storage()?.getItem(INFO_PREFS_KEY)
    if (!raw) return migrateLegacyInfoPreferences()
    return normalizeInfoPreferences(JSON.parse(raw))
  } catch {
    return defaultInfoPreferences()
  }
}

export function migrateLegacyInfoPreferences(): InfoPreferences {
  const prefs = defaultInfoPreferences()
  const store = storage()
  if (!store) return prefs
  try {
    const competition = store.getItem('tvn.info.football.competition.v1')
    if (competition && competition !== 'all') {
      prefs.football.lastViewedCompetitionId = competition
      prefs.football.defaultCompetitionId = competition
    }
    const locationsRaw = store.getItem('tvn.info.weather.locations.v1')
    const active = store.getItem('tvn.info.weather.active.v1')
    if (locationsRaw) {
      const parsed = JSON.parse(locationsRaw) as unknown
      if (Array.isArray(parsed)) {
        const locations = parsed.filter(isWeatherLocation)
        if (locations.length) {
          prefs.weather.locations = locations
          prefs.weather.locationOrder = locations.map((entry) => entry.id)
          prefs.weather.defaultLocationId = active && locations.some((entry) => entry.id === active) ? active : locations[0].id
        }
      }
    }
  } catch {
    /* keep defaults */
  }
  saveInfoPreferences(prefs)
  return prefs
}

export function saveInfoPreferences(prefs: InfoPreferences): void {
  storage()?.setItem(INFO_PREFS_KEY, JSON.stringify(normalizeInfoPreferences(prefs)))
}

export type InfoPortablePrefs = InfoPreferences

export function infoPreferencesErrors(value: unknown, at = 'settings.info'): string[] {
  if (value === undefined) return []
  if (!isRecord(value)) return [`${at} is not an object`]
  if (
    value.version !== undefined &&
    value.version !== 1 &&
    value.version !== 2 &&
    value.version !== INFO_PREFS_VERSION
  ) {
    return [`${at}.version is unsupported`]
  }
  if (value.news !== undefined && !isRecord(value.news)) return [`${at}.news is not an object`]
  if (value.football !== undefined && !isRecord(value.football)) return [`${at}.football is not an object`]
  if (value.weather !== undefined && !isRecord(value.weather)) return [`${at}.weather is not an object`]
  if (value.shopping !== undefined && !isRecord(value.shopping)) return [`${at}.shopping is not an object`]
  return []
}

export function applyInfoPortablePrefs(value: unknown): void {
  if (value === undefined) return
  saveInfoPreferences(normalizeInfoPreferences(value))
}

export function loadInfoPreferencesForExport(): InfoPreferences {
  try {
    return loadInfoPreferences()
  } catch {
    return defaultInfoPreferences()
  }
}
