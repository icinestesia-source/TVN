import { NEWS_CATEGORIES, type NewsCategory } from './news/types.ts'
import { FOOTBALL_COMPETITIONS } from './football/competitions.ts'
import { NEWS_FEEDS } from './news/feeds.ts'
import { DEFAULT_WEATHER_LOCATION, type WeatherLocation } from './weather/types.ts'

export const INFO_PREFS_KEY = 'tvn.info.preferences.v1'
export const INFO_PREFS_VERSION = 1 as const

export type FootballDefaultView = 'my-football' | 'favourite-team-league' | 'default-league' | 'today' | 'last-viewed'
export type WeatherProviderId = 'open-meteo' | 'met-norway'
export type TempUnit = 'celsius' | 'fahrenheit'
export type WindUnit = 'kmh' | 'mph'

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
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/** Migrate / sanitise stored prefs. Malformed data falls back to defaults for broken sections. */
export function normalizeInfoPreferences(raw: unknown): InfoPreferences {
  const defaults = defaultInfoPreferences()
  if (!isRecord(raw)) return defaults
  const news = isRecord(raw.news) ? raw.news : {}
  const football = isRecord(raw.football) ? raw.football : {}
  const weather = isRecord(raw.weather) ? raw.weather : {}

  const publishers = defaults.news.publisherOrder
  const enabled = asStringArray(news.enabledPublisherIds)
  const order = asStringArray(news.publisherOrder)
  const categoryOrder = asStringArray(news.categoryOrder).filter((id): id is NewsCategory =>
    NEWS_CATEGORIES.some((entry) => entry.id === id),
  )
  const hiddenCategories = asStringArray(news.hiddenCategories).filter((id): id is NewsCategory =>
    NEWS_CATEGORIES.some((entry) => entry.id === id),
  )
  const customFeeds = Array.isArray(news.customFeeds)
    ? news.customFeeds.filter(isCustomFeed)
    : []

  const favouriteTeams = Array.isArray(football.favouriteTeams)
    ? football.favouriteTeams.filter(isFavouriteTeam)
    : []
  const favouriteTeamIds = asStringArray(football.favouriteTeamIds)
  const mergedTeamIds = [...new Set([...favouriteTeamIds, ...favouriteTeams.map((team) => team.id)])]

  const locations = Array.isArray(weather.locations)
    ? weather.locations.filter(isWeatherLocation)
    : defaults.weather.locations
  const locationOrder = asStringArray(weather.locationOrder)
  const orderedLocations =
    locationOrder.length > 0
      ? [
          ...locationOrder.map((id) => locations.find((entry) => entry.id === id)).filter(Boolean) as WeatherLocation[],
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

  return {
    version: INFO_PREFS_VERSION,
    news: {
      enabledPublisherIds: enabled.length ? enabled : publishers,
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
        return stored.length ? [...stored.filter((code) => codes.includes(code as never)), ...codes.filter((code) => !stored.includes(code))] : codes
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

/** Pull B.2 localStorage keys into the unified model once. */
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

/** Portable slice for TvnExport.settings.info — excludes forecast caches. */
export type InfoPortablePrefs = InfoPreferences

export function infoPreferencesErrors(value: unknown, at = 'settings.info'): string[] {
  if (value === undefined) return []
  if (!isRecord(value)) return [`${at} is not an object`]
  if (value.version !== undefined && value.version !== INFO_PREFS_VERSION) return [`${at}.version is unsupported`]
  if (value.news !== undefined && !isRecord(value.news)) return [`${at}.news is not an object`]
  if (value.football !== undefined && !isRecord(value.football)) return [`${at}.football is not an object`]
  if (value.weather !== undefined && !isRecord(value.weather)) return [`${at}.weather is not an object`]
  return []
}

export function applyInfoPortablePrefs(value: unknown): void {
  if (value === undefined) return
  saveInfoPreferences(normalizeInfoPreferences(value))
}

/** Safe for export builders — returns defaults when localStorage is unavailable. */
export function loadInfoPreferencesForExport(): InfoPreferences {
  try {
    return loadInfoPreferences()
  } catch {
    return defaultInfoPreferences()
  }
}
