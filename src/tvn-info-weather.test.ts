import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WeatherPanel } from './components/info/WeatherPanel.tsx'
import { INFO_MODULES } from './components/InfoCentre.tsx'
import { forecastFromPayload, searchWeatherLocations, weatherConditionLabel } from './info/weather/open-meteo.ts'
import { pickActiveLocation } from './info/weather/storage.ts'
import { DEFAULT_WEATHER_LOCATION, type WeatherLocation } from './info/weather/types.ts'

const sampleLocation: WeatherLocation = {
  id: '1',
  name: 'Manchester',
  country: 'United Kingdom',
  latitude: 53.48,
  longitude: -2.24,
  timezone: 'Europe/London',
}

describe('INFO weather', () => {
  it('registers Weather in INFO and renders without crashing', () => {
    expect(INFO_MODULES.map((module) => module.id)).toContain('weather')
    const markup = renderToStaticMarkup(createElement(WeatherPanel))
    expect(markup).toMatch(/Weather|Loading weather|Open-Meteo/i)
  })

  it('parses Open-Meteo payloads and never invents temperatures', () => {
    const forecast = forecastFromPayload(sampleLocation, {
      current: {
        time: '2026-10-18T12:00',
        temperature_2m: 14.2,
        apparent_temperature: 12.1,
        weather_code: 61,
        wind_speed_10m: 18,
        precipitation_probability: 40,
      },
      hourly: {
        time: ['2026-10-18T12:00', '2026-10-18T13:00'],
        temperature_2m: [14.2, 15.0],
        weather_code: [61, 2],
        precipitation_probability: [40, 20],
      },
      daily: {
        time: ['2026-10-18', '2026-10-19'],
        temperature_2m_max: [16, 17],
        temperature_2m_min: [9, 8],
        weather_code: [61, 2],
        precipitation_probability_max: [60, 10],
      },
    })
    expect(forecast).not.toBeNull()
    expect(forecast!.current.temperatureC).toBe(14.2)
    expect(forecast!.hourly).toHaveLength(2)
    expect(forecast!.daily).toHaveLength(2)
    expect(forecast!.attribution.toLowerCase()).toContain('open-meteo')
    expect(weatherConditionLabel(61)).toMatch(/rain/i)
    expect(forecastFromPayload(sampleLocation, { current: { time: 'x' } })).toBeNull()
  })

  it('searches locations through the geocoding API shape', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          results: [
            { id: 2643743, name: 'London', latitude: 51.5, longitude: -0.12, country: 'United Kingdom', timezone: 'Europe/London', admin1: 'England' },
          ],
        }),
        { status: 200 },
      )
    const found = await searchWeatherLocations('London', fetchImpl)
    expect(found).toHaveLength(1)
    expect(found[0].name).toBe('London')
    expect(await searchWeatherLocations('x', fetchImpl)).toEqual([])
  })

  it('defaults to a neutral configured location and remembers saved picks', () => {
    expect(DEFAULT_WEATHER_LOCATION.name).toBe('London')
    expect(pickActiveLocation([], null).id).toBe(DEFAULT_WEATHER_LOCATION.id)
    expect(pickActiveLocation([sampleLocation], sampleLocation.id).name).toBe('Manchester')
    expect(pickActiveLocation([sampleLocation], 'missing').name).toBe('Manchester')
  })
})
