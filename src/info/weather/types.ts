/** Client-side weather models for INFO → Weather (Open-Meteo). */

export interface WeatherLocation {
  id: string
  name: string
  country: string
  admin1?: string
  latitude: number
  longitude: number
  timezone: string
}

export interface WeatherCurrent {
  timeIso: string
  temperatureC: number
  feelsLikeC: number
  weatherCode: number
  windSpeedKmh: number
  precipitationProbability: number | null
}

export interface WeatherHourlyPoint {
  timeIso: string
  temperatureC: number
  weatherCode: number
  precipitationProbability: number | null
}

export interface WeatherDailyPoint {
  date: string
  weatherCode: number
  tempMaxC: number
  tempMinC: number
  precipitationProbabilityMax: number | null
}

export interface WeatherForecast {
  location: WeatherLocation
  updatedIso: string
  current: WeatherCurrent
  hourly: WeatherHourlyPoint[]
  daily: WeatherDailyPoint[]
  attribution: string
}

export const WEATHER_CACHE_TTL_MS = 2.5 * 60 * 60 * 1000
export const WEATHER_LOCATIONS_KEY = 'tvn.info.weather.locations.v1'
export const WEATHER_ACTIVE_KEY = 'tvn.info.weather.active.v1'
export const WEATHER_CACHE_PREFIX = 'tvn.info.weather.cache.v1:'

/** Neutral default — not a personal product-owner home. */
export const DEFAULT_WEATHER_LOCATION: WeatherLocation = {
  id: '2643743',
  name: 'London',
  country: 'United Kingdom',
  admin1: 'England',
  latitude: 51.5074,
  longitude: -0.1278,
  timezone: 'Europe/London',
}
