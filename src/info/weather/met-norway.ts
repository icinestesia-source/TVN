import type { WeatherForecast, WeatherLocation } from './types.ts'
import { weatherConditionLabel } from './open-meteo.ts'

/**
 * MET Norway Locationforecast 2.0 compact.
 * Requires an identifying User-Agent (set by Netlify proxy or rejected in bare browsers).
 * Browser CORS often blocks direct calls — prefer Open-Meteo unless a fixed-host proxy is used.
 */
const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact'

type Json = Record<string, unknown>

function symbolToCode(symbol: string | undefined): number {
  if (!symbol) return 3
  if (/clearsky|fair/i.test(symbol)) return 0
  if (/partlycloudy/i.test(symbol)) return 2
  if (/cloudy|fog/i.test(symbol)) return /fog/i.test(symbol) ? 45 : 3
  if (/rain|sleet|shower/i.test(symbol)) return 61
  if (/snow/i.test(symbol)) return 71
  if (/thunder/i.test(symbol)) return 95
  return 3
}

export async function fetchMetNorwayForecast(
  location: WeatherLocation,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherForecast> {
  const url = `${MET_URL}?lat=${location.latitude}&lon=${location.longitude}`
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'TVN-InfoWeather/1.0 (https://tvn.lol; weather)',
    },
  })
  if (!response.ok) throw new Error(`MET Norway ${response.status}`)
  const payload = (await response.json()) as Json
  const properties = payload.properties as Json | undefined
  const timeseries = Array.isArray(properties?.timeseries) ? properties.timeseries : []
  if (!timeseries.length) throw new Error('MET Norway returned no timeseries')

  const first = timeseries[0] as Json
  const instant = (first.data as Json | undefined)?.instant as Json | undefined
  const details = (instant?.details as Json | undefined) ?? {}
  const next1 = ((first.data as Json | undefined)?.next_1_hours as Json | undefined)?.summary as Json | undefined
  const symbol = typeof next1?.symbol_code === 'string' ? next1.symbol_code : undefined
  const temp = typeof details.air_temperature === 'number' ? details.air_temperature : null
  if (temp == null) throw new Error('MET Norway missing temperature')
  const windMs = typeof details.wind_speed === 'number' ? details.wind_speed : 0
  const code = symbolToCode(symbol)

  const hourly = []
  for (let i = 0; i < timeseries.length && hourly.length < 24; i++) {
    const row = timeseries[i] as Json
    const time = typeof row.time === 'string' ? row.time : null
    const d = ((row.data as Json | undefined)?.instant as Json | undefined)?.details as Json | undefined
    const t = typeof d?.air_temperature === 'number' ? d.air_temperature : null
    const sym = ((row.data as Json | undefined)?.next_1_hours as Json | undefined)?.summary as Json | undefined
    if (!time || t == null) continue
    hourly.push({
      timeIso: new Date(time).toISOString(),
      temperatureC: t,
      weatherCode: symbolToCode(typeof sym?.symbol_code === 'string' ? sym.symbol_code : undefined),
      precipitationProbability: null as number | null,
    })
  }

  const byDay = new Map<string, { max: number; min: number; code: number }>()
  for (const row of timeseries) {
    const entry = row as Json
    const time = typeof entry.time === 'string' ? entry.time : null
    const d = ((entry.data as Json | undefined)?.instant as Json | undefined)?.details as Json | undefined
    const t = typeof d?.air_temperature === 'number' ? d.air_temperature : null
    if (!time || t == null) continue
    const day = time.slice(0, 10)
    const sym = ((entry.data as Json | undefined)?.next_6_hours as Json | undefined)?.summary as Json | undefined
    const existing = byDay.get(day)
    if (!existing) byDay.set(day, { max: t, min: t, code: symbolToCode(typeof sym?.symbol_code === 'string' ? sym.symbol_code : undefined) })
    else {
      existing.max = Math.max(existing.max, t)
      existing.min = Math.min(existing.min, t)
    }
  }
  const daily = [...byDay.entries()].slice(0, 7).map(([date, values]) => ({
    date,
    weatherCode: values.code,
    tempMaxC: values.max,
    tempMinC: values.min,
    precipitationProbabilityMax: null as number | null,
  }))

  void weatherConditionLabel
  return {
    location,
    updatedIso: new Date().toISOString(),
    current: {
      timeIso: typeof first.time === 'string' ? new Date(first.time).toISOString() : new Date().toISOString(),
      temperatureC: temp,
      feelsLikeC: temp,
      weatherCode: code,
      windSpeedKmh: windMs * 3.6,
      precipitationProbability: null,
    },
    hourly,
    daily,
    attribution: 'Weather data from MET Norway (api.met.no)',
  }
}

export const MET_NORWAY_BROWSER_LIMITATION =
  'MET Norway requires an identifying User-Agent and often blocks browser CORS. Open-Meteo remains the reliable default in the viewer; MET Norway may fail until a fixed-host proxy is deployed.'
