import type { WeatherForecast, WeatherLocation } from './types.ts'
import { DEFAULT_WEATHER_LOCATION, WEATHER_ACTIVE_KEY, WEATHER_CACHE_PREFIX, WEATHER_CACHE_TTL_MS, WEATHER_LOCATIONS_KEY } from './types.ts'

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export function loadSavedLocations(): WeatherLocation[] {
  const raw = storage()?.getItem(WEATHER_LOCATIONS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isLocation)
  } catch {
    return []
  }
}

export function saveLocations(locations: readonly WeatherLocation[]): void {
  storage()?.setItem(WEATHER_LOCATIONS_KEY, JSON.stringify(locations))
}

export function loadActiveLocationId(): string | null {
  return storage()?.getItem(WEATHER_ACTIVE_KEY) ?? null
}

export function saveActiveLocationId(id: string): void {
  storage()?.setItem(WEATHER_ACTIVE_KEY, id)
}

function isLocation(value: unknown): value is WeatherLocation {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    typeof row.latitude === 'number' &&
    typeof row.longitude === 'number' &&
    typeof row.timezone === 'string'
  )
}

interface CacheEntry {
  savedAt: number
  forecast: WeatherForecast
}

export function readForecastCache(locationId: string, nowMs = Date.now()): WeatherForecast | null {
  const raw = storage()?.getItem(`${WEATHER_CACHE_PREFIX}${locationId}`)
  if (!raw) return null
  try {
    const entry = JSON.parse(raw) as CacheEntry
    if (!entry?.forecast || typeof entry.savedAt !== 'number') return null
    if (nowMs - entry.savedAt > WEATHER_CACHE_TTL_MS) return null
    return entry.forecast
  } catch {
    return null
  }
}

export function writeForecastCache(forecast: WeatherForecast, nowMs = Date.now()): void {
  const entry: CacheEntry = { savedAt: nowMs, forecast }
  storage()?.setItem(`${WEATHER_CACHE_PREFIX}${forecast.location.id}`, JSON.stringify(entry))
}

export function pickActiveLocation(saved: readonly WeatherLocation[], activeId: string | null): WeatherLocation {
  if (activeId) {
    const found = saved.find((entry) => entry.id === activeId)
    if (found) return found
  }
  return saved[0] ?? DEFAULT_WEATHER_LOCATION
}
