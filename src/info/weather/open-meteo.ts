import type { WeatherCurrent, WeatherDailyPoint, WeatherForecast, WeatherHourlyPoint, WeatherLocation } from './types.ts'
import { DEFAULT_WEATHER_LOCATION } from './types.ts'

const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'

const ATTRIBUTION = 'Weather data by Open-Meteo.com'

type Json = Record<string, unknown>

async function getJson(url: string, timeoutMs = 12_000, fetchImpl: typeof fetch = fetch): Promise<Json> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return (await response.json()) as Json
  } finally {
    clearTimeout(timer)
  }
}

export function weatherConditionLabel(code: number): string {
  if (code === 0) return 'Clear'
  if (code === 1) return 'Mainly clear'
  if (code === 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if (code === 45 || code === 48) return 'Fog'
  if (code >= 51 && code <= 57) return 'Drizzle'
  if (code >= 61 && code <= 67) return 'Rain'
  if (code >= 71 && code <= 77) return 'Snow'
  if (code >= 80 && code <= 82) return 'Rain showers'
  if (code >= 85 && code <= 86) return 'Snow showers'
  if (code >= 95) return 'Thunderstorm'
  return 'Conditions unavailable'
}

/** Compact symbol for TVN rows — Unicode weather glyphs, no external widget. */
export function weatherSymbol(code: number): string {
  if (code === 0 || code === 1) return '☀'
  if (code === 2) return '⛅'
  if (code === 3) return '☁'
  if (code === 45 || code === 48) return '〰'
  if (code >= 51 && code <= 67) return '🌧'
  if (code >= 71 && code <= 77) return '❄'
  if (code >= 80 && code <= 82) return '🌦'
  if (code >= 85 && code <= 86) return '🌨'
  if (code >= 95) return '⛈'
  return '·'
}

export function locationIdOf(latitude: number, longitude: number, name: string): string {
  return `${name.toLowerCase().replace(/\s+/g, '-')}-${latitude.toFixed(2)}_${longitude.toFixed(2)}`
}

export async function searchWeatherLocations(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherLocation[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []
  const url = `${GEOCODE}?name=${encodeURIComponent(trimmed)}&count=8&language=en&format=json`
  const payload = await getJson(url, 12_000, fetchImpl)
  const results = Array.isArray(payload.results) ? payload.results : []
  const out: WeatherLocation[] = []
  for (const raw of results) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Json
    const name = typeof row.name === 'string' ? row.name : null
    const latitude = typeof row.latitude === 'number' ? row.latitude : null
    const longitude = typeof row.longitude === 'number' ? row.longitude : null
    const timezone = typeof row.timezone === 'string' ? row.timezone : 'UTC'
    const country = typeof row.country === 'string' ? row.country : ''
    if (!name || latitude == null || longitude == null) continue
    out.push({
      id: typeof row.id === 'number' ? String(row.id) : locationIdOf(latitude, longitude, name),
      name,
      country,
      ...(typeof row.admin1 === 'string' ? { admin1: row.admin1 } : {}),
      latitude,
      longitude,
      timezone,
    })
  }
  return out
}

function numAt(list: unknown, index: number): number | null {
  if (!Array.isArray(list)) return null
  const value = list[index]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function strAt(list: unknown, index: number): string | null {
  if (!Array.isArray(list)) return null
  const value = list[index]
  return typeof value === 'string' ? value : null
}

export function forecastFromPayload(location: WeatherLocation, payload: Json, updatedIso = new Date().toISOString()): WeatherForecast | null {
  const current = payload.current as Json | undefined
  const hourly = payload.hourly as Json | undefined
  const daily = payload.daily as Json | undefined
  if (!current || typeof current.time !== 'string') return null
  const temperatureC = typeof current.temperature_2m === 'number' ? current.temperature_2m : null
  const feelsLikeC = typeof current.apparent_temperature === 'number' ? current.apparent_temperature : temperatureC
  const weatherCode = typeof current.weather_code === 'number' ? current.weather_code : 0
  const windSpeedKmh = typeof current.wind_speed_10m === 'number' ? current.wind_speed_10m : 0
  if (temperatureC == null || feelsLikeC == null) return null

  const currentBlock: WeatherCurrent = {
    timeIso: new Date(current.time).toISOString(),
    temperatureC,
    feelsLikeC,
    weatherCode,
    windSpeedKmh,
    precipitationProbability: typeof current.precipitation_probability === 'number' ? current.precipitation_probability : null,
  }

  const hours: WeatherHourlyPoint[] = []
  const hourTimes = Array.isArray(hourly?.time) ? hourly.time : []
  for (let i = 0; i < hourTimes.length && hours.length < 24; i++) {
    const time = strAt(hourTimes, i)
    const temp = numAt(hourly?.temperature_2m, i)
    const code = numAt(hourly?.weather_code, i)
    if (!time || temp == null || code == null) continue
    hours.push({
      timeIso: new Date(time).toISOString(),
      temperatureC: temp,
      weatherCode: code,
      precipitationProbability: numAt(hourly?.precipitation_probability, i),
    })
  }

  const days: WeatherDailyPoint[] = []
  const dayTimes = Array.isArray(daily?.time) ? daily.time : []
  for (let i = 0; i < dayTimes.length && days.length < 7; i++) {
    const date = strAt(dayTimes, i)
    const max = numAt(daily?.temperature_2m_max, i)
    const min = numAt(daily?.temperature_2m_min, i)
    const code = numAt(daily?.weather_code, i)
    if (!date || max == null || min == null || code == null) continue
    days.push({
      date,
      weatherCode: code,
      tempMaxC: max,
      tempMinC: min,
      precipitationProbabilityMax: numAt(daily?.precipitation_probability_max, i),
    })
  }

  if (!days.length) return null

  return {
    location,
    updatedIso,
    current: currentBlock,
    hourly: hours,
    daily: days,
    attribution: ATTRIBUTION,
  }
}

export async function fetchWeatherForecast(
  location: WeatherLocation,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherForecast> {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    timezone: location.timezone || 'auto',
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation_probability',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days: '7',
    wind_speed_unit: 'kmh',
  })
  const payload = await getJson(`${FORECAST}?${params}`, 12_000, fetchImpl)
  const forecast = forecastFromPayload(location, payload)
  if (!forecast) throw new Error('Forecast incomplete')
  return forecast
}

export function resolveDefaultLocation(configured?: WeatherLocation | null): WeatherLocation {
  return configured ?? DEFAULT_WEATHER_LOCATION
}
