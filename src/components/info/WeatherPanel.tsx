import { useEffect, useState, type FormEvent } from 'react'
import { fetchMetNorwayForecast, MET_NORWAY_BROWSER_LIMITATION } from '../../info/weather/met-norway.ts'
import { fetchWeatherForecast, searchWeatherLocations, weatherConditionLabel, weatherSymbol } from '../../info/weather/open-meteo.ts'
import { readForecastCache, writeForecastCache } from '../../info/weather/storage.ts'
import type { WeatherForecast, WeatherLocation } from '../../info/weather/types.ts'
import { formatTemp, formatWind } from '../../info/weather/units.ts'
import {
  defaultInfoPreferences,
  loadInfoPreferences,
  saveInfoPreferences,
  type InfoPreferences,
  type WeatherProviderId,
} from '../../info/preferences.ts'
import { keepKey } from '../keep-key.ts'

type Section = 'today' | 'hourly' | 'week' | 'locations'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'hourly', label: 'Hourly' },
  { id: 'week', label: '7 days' },
  { id: 'locations', label: 'Locations' },
]

function formatWhen(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ms)
}

function formatHour(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(ms)
}

function formatDay(date: string): string {
  const ms = Date.parse(`${date}T12:00:00Z`)
  if (!Number.isFinite(ms)) return date
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(ms)
}

function locationLabel(location: WeatherLocation): string {
  return [location.name, location.admin1, location.country].filter(Boolean).join(', ')
}

function orderedLocations(prefs: InfoPreferences): WeatherLocation[] {
  const map = new Map(prefs.weather.locations.map((entry) => [entry.id, entry]))
  const ordered = prefs.weather.locationOrder.map((id) => map.get(id)).filter(Boolean) as WeatherLocation[]
  for (const entry of prefs.weather.locations) {
    if (!ordered.some((row) => row.id === entry.id)) ordered.push(entry)
  }
  return ordered
}

async function loadForecast(location: WeatherLocation, provider: WeatherProviderId): Promise<WeatherForecast> {
  if (provider === 'met-norway') return fetchMetNorwayForecast(location)
  return fetchWeatherForecast(location)
}

/**
 * INFO → Weather. Preferences (units, locations, provider) are local; forecasts are fetched per location.
 */
export function WeatherPanel() {
  const [prefs, setPrefs] = useState<InfoPreferences>(() => {
    try {
      return loadInfoPreferences()
    } catch {
      return defaultInfoPreferences()
    }
  })
  const [section, setSection] = useState<Section>('today')
  const [forecast, setForecast] = useState<WeatherForecast | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WeatherLocation[]>([])
  const [searching, setSearching] = useState(false)

  const locations = orderedLocations(prefs)
  const activeId = prefs.weather.defaultLocationId ?? locations[0]?.id
  const active = locations.find((entry) => entry.id === activeId) ?? locations[0] ?? defaultInfoPreferences().weather.locations[0]

  const persist = (next: InfoPreferences) => {
    saveInfoPreferences(next)
    setPrefs(next)
  }

  useEffect(() => {
    let live = true
    const cached = readForecastCache(active.id)
    if (cached) {
      setForecast(cached)
      setStatus('ready')
    } else {
      setStatus('loading')
    }
    void loadForecast(active, prefs.weather.provider)
      .then((next) => {
        if (!live) return
        writeForecastCache(next)
        setForecast(next)
        setStatus('ready')
        setMessage(null)
      })
      .catch((caught) => {
        if (!live) return
        const detail = caught instanceof Error ? caught.message : 'Weather unavailable'
        if (prefs.weather.provider === 'met-norway') {
          setMessage(`${detail}. ${MET_NORWAY_BROWSER_LIMITATION}`)
        } else {
          setMessage(detail)
        }
        if (cached) {
          setForecast(cached)
          setStatus('ready')
        } else {
          setStatus('error')
        }
      })
    return () => {
      live = false
    }
  }, [active.id, active.latitude, active.longitude, active.timezone, prefs.weather.provider])

  const onSearch = async (event: FormEvent) => {
    event.preventDefault()
    setSearching(true)
    setMessage(null)
    try {
      const found = await searchWeatherLocations(query)
      setResults(found)
      if (!found.length) setMessage('No matching towns or cities.')
    } catch (caught) {
      setResults([])
      setMessage(caught instanceof Error ? caught.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  const selectLocation = (location: WeatherLocation) => {
    const nextLocations = locations.some((entry) => entry.id === location.id) ? locations : [...locations, location].slice(0, 12)
    persist({
      ...prefs,
      weather: {
        ...prefs.weather,
        locations: nextLocations,
        locationOrder: nextLocations.map((entry) => entry.id),
        defaultLocationId: location.id,
      },
    })
    setSection('today')
    setResults([])
    setQuery('')
  }

  const removeLocation = (id: string) => {
    const nextLocations = locations.filter((entry) => entry.id !== id)
    const nextOrder = nextLocations.map((entry) => entry.id)
    persist({
      ...prefs,
      weather: {
        ...prefs.weather,
        locations: nextLocations.length ? nextLocations : defaultInfoPreferences().weather.locations,
        locationOrder: nextOrder.length ? nextOrder : defaultInfoPreferences().weather.locationOrder,
        defaultLocationId: activeId === id ? nextOrder[0] ?? defaultInfoPreferences().weather.defaultLocationId : prefs.weather.defaultLocationId,
      },
    })
  }

  const moveLocation = (id: string, dir: -1 | 1) => {
    const order = [...prefs.weather.locationOrder]
    const index = order.indexOf(id)
    if (index < 0) return
    const next = index + dir
    if (next < 0 || next >= order.length) return
    ;[order[index], order[next]] = [order[next], order[index]]
    persist({ ...prefs, weather: { ...prefs.weather, locationOrder: order } })
  }

  const todayMax = forecast?.daily[0]?.tempMaxC
  const tonightMin = forecast?.daily[0]?.tempMinC
  const { tempUnit, windUnit } = prefs.weather

  return (
    <div className="info-panel">
      <p className={message ? 'info-panel-meta is-stale' : 'info-panel-meta'} role="status">
        {locationLabel(active)}
        {forecast ? ` · Updated ${formatWhen(forecast.updatedIso)}` : ''}
        {message ? ` · ${message}` : ''}
        {forecast ? ` · ${forecast.attribution}` : ' · Weather data by Open-Meteo.com'}
        {' · '}
        Provider: {prefs.weather.provider === 'met-norway' ? 'MET Norway' : 'Open-Meteo'}
      </p>
      <div className="tabs" role="tablist" aria-label="Weather sections">
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={section === entry.id}
            className={section === entry.id ? 'tab is-on' : 'tab'}
            onKeyDown={keepKey}
            onClick={() => setSection(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {section === 'locations' ? (
        <div className="info-weather-locations">
          <p className="info-item-meta">Units</p>
          <div className="tabs" role="tablist" aria-label="Temperature unit">
            <button type="button" className={tempUnit === 'celsius' ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={() => persist({ ...prefs, weather: { ...prefs.weather, tempUnit: 'celsius' } })}>
              °C
            </button>
            <button type="button" className={tempUnit === 'fahrenheit' ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={() => persist({ ...prefs, weather: { ...prefs.weather, tempUnit: 'fahrenheit' } })}>
              °F
            </button>
          </div>
          <div className="tabs" role="tablist" aria-label="Wind unit">
            <button type="button" className={windUnit === 'kmh' ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={() => persist({ ...prefs, weather: { ...prefs.weather, windUnit: 'kmh' } })}>
              km/h
            </button>
            <button type="button" className={windUnit === 'mph' ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={() => persist({ ...prefs, weather: { ...prefs.weather, windUnit: 'mph' } })}>
              mph
            </button>
          </div>
          <p className="info-item-meta">Provider</p>
          <div className="tabs" role="tablist" aria-label="Weather provider">
            <button type="button" className={prefs.weather.provider === 'open-meteo' ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={() => persist({ ...prefs, weather: { ...prefs.weather, provider: 'open-meteo' } })}>
              Open-Meteo
            </button>
            <button type="button" className={prefs.weather.provider === 'met-norway' ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={() => persist({ ...prefs, weather: { ...prefs.weather, provider: 'met-norway' } })}>
              MET Norway
            </button>
          </div>
          <p className="info-panel-meta">{MET_NORWAY_BROWSER_LIMITATION}</p>
          <form className="info-weather-search" onSubmit={onSearch}>
            <label className="info-item-meta" htmlFor="weather-search">
              Search town or city
            </label>
            <div className="info-weather-search-row">
              <input id="weather-search" className="info-weather-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Manchester" autoComplete="off" />
              <button type="submit" className="tab" disabled={searching || query.trim().length < 2} onKeyDown={keepKey}>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>
          </form>
          {results.length ? (
            <ul className="info-list">
              {results.map((location) => (
                <li key={location.id} className="info-item">
                  <button type="button" className="info-item-title info-weather-pick" onKeyDown={keepKey} onClick={() => selectLocation(location)}>
                    {locationLabel(location)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="info-item-meta">Saved locations</p>
          <ul className="info-list">
            {locations.map((location) => (
              <li key={location.id} className="info-item info-weather-saved">
                <button
                  type="button"
                  className={location.id === active.id ? 'info-item-title is-active' : 'info-item-title'}
                  onKeyDown={keepKey}
                  onClick={() => persist({ ...prefs, weather: { ...prefs.weather, defaultLocationId: location.id } })}
                >
                  {locationLabel(location)}
                  {location.id === prefs.weather.defaultLocationId ? ' · default' : ''}
                </button>
                <div className="info-weather-search-row">
                  <button type="button" className="tab" onKeyDown={keepKey} onClick={() => moveLocation(location.id, -1)}>
                    Up
                  </button>
                  <button type="button" className="tab" onKeyDown={keepKey} onClick={() => moveLocation(location.id, 1)}>
                    Down
                  </button>
                  <button type="button" className="tab" onKeyDown={keepKey} onClick={() => removeLocation(location.id)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="tab" onKeyDown={keepKey} onClick={() => persist({ ...prefs, weather: defaultInfoPreferences().weather })}>
            Reset weather preferences
          </button>
          <p className="info-panel-meta">Precise device location is never requested automatically.</p>
        </div>
      ) : status === 'loading' && !forecast ? (
        <p className="options-note">Loading weather…</p>
      ) : status === 'error' || !forecast ? (
        <p className="options-note" role="status">
          {message ?? 'Weather unavailable'}
        </p>
      ) : section === 'today' ? (
        <div className="info-weather-today">
          <p className="info-weather-temp">
            <span className="info-weather-symbol" aria-hidden>
              {weatherSymbol(forecast.current.weatherCode)}
            </span>
            {formatTemp(forecast.current.temperatureC, tempUnit)}
          </p>
          <p className="info-item-desc">{weatherConditionLabel(forecast.current.weatherCode)}</p>
          <ul className="info-list">
            <li className="info-item">
              <span className="info-item-meta">Feels like</span>
              <span className="info-item-title">{formatTemp(forecast.current.feelsLikeC, tempUnit)}</span>
            </li>
            <li className="info-item">
              <span className="info-item-meta">Wind</span>
              <span className="info-item-title">{formatWind(forecast.current.windSpeedKmh, windUnit)}</span>
            </li>
            <li className="info-item">
              <span className="info-item-meta">Precipitation chance</span>
              <span className="info-item-title">
                {forecast.current.precipitationProbability == null ? '—' : `${Math.round(forecast.current.precipitationProbability)}%`}
              </span>
            </li>
            <li className="info-item">
              <span className="info-item-meta">Today’s high</span>
              <span className="info-item-title">{todayMax == null ? '—' : formatTemp(todayMax, tempUnit)}</span>
            </li>
            <li className="info-item">
              <span className="info-item-meta">Tonight’s low</span>
              <span className="info-item-title">{tonightMin == null ? '—' : formatTemp(tonightMin, tempUnit)}</span>
            </li>
          </ul>
        </div>
      ) : section === 'hourly' ? (
        forecast.hourly.length === 0 ? (
          <p className="options-note">Hourly forecast unavailable.</p>
        ) : (
          <ul className="info-list">
            {forecast.hourly.map((point) => (
              <li key={point.timeIso} className="info-item info-weather-row">
                <span className="info-item-meta">{formatHour(point.timeIso)}</span>
                <span className="info-item-title">
                  <span aria-hidden>{weatherSymbol(point.weatherCode)} </span>
                  {formatTemp(point.temperatureC, tempUnit)}
                  {point.precipitationProbability != null ? ` · ${Math.round(point.precipitationProbability)}%` : ''}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : forecast.daily.length === 0 ? (
        <p className="options-note">Seven-day forecast unavailable.</p>
      ) : (
        <ul className="info-list">
          {forecast.daily.map((day) => (
            <li key={day.date} className="info-item info-weather-row">
              <span className="info-item-meta">{formatDay(day.date)}</span>
              <span className="info-item-title">
                <span aria-hidden>{weatherSymbol(day.weatherCode)} </span>
                {formatTemp(day.tempMaxC, tempUnit)} / {formatTemp(day.tempMinC, tempUnit)}
                {day.precipitationProbabilityMax != null ? ` · ${Math.round(day.precipitationProbabilityMax)}%` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
