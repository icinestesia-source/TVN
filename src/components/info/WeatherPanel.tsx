import { useEffect, useState, type FormEvent } from 'react'
import { fetchWeatherForecast, searchWeatherLocations, weatherConditionLabel, weatherSymbol } from '../../info/weather/open-meteo.ts'
import {
  loadActiveLocationId,
  loadSavedLocations,
  pickActiveLocation,
  readForecastCache,
  saveActiveLocationId,
  saveLocations,
  writeForecastCache,
} from '../../info/weather/storage.ts'
import type { WeatherForecast, WeatherLocation } from '../../info/weather/types.ts'
import { keepKey } from '../keep-key.ts'

type Section = 'today' | 'hourly' | 'week' | 'locations'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'hourly', label: 'Hourly' },
  { id: 'week', label: '7 days' },
  { id: 'locations', label: 'Locations' },
]

function formatTemp(value: number): string {
  return `${Math.round(value)}°`
}

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
  const parts = [location.name, location.admin1, location.country].filter(Boolean)
  return parts.join(', ')
}

/**
 * INFO → Weather. Open-Meteo is queried from the browser for the selected location only.
 * Failures stay inside this panel and never touch television playback.
 */
export function WeatherPanel() {
  const [section, setSection] = useState<Section>('today')
  const [saved, setSaved] = useState<WeatherLocation[]>(() => loadSavedLocations())
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveLocationId())
  const [forecast, setForecast] = useState<WeatherForecast | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WeatherLocation[]>([])
  const [searching, setSearching] = useState(false)

  const active = pickActiveLocation(saved, activeId)

  useEffect(() => {
    let live = true
    const cached = readForecastCache(active.id)
    if (cached) {
      setForecast(cached)
      setStatus('ready')
      setMessage(null)
    } else {
      setStatus('loading')
    }
    void fetchWeatherForecast(active)
      .then((next) => {
        if (!live) return
        writeForecastCache(next)
        setForecast(next)
        setStatus('ready')
        setMessage(null)
      })
      .catch((caught) => {
        if (!live) return
        if (cached) {
          setForecast(cached)
          setStatus('ready')
          setMessage('Showing cached forecast · live update failed')
        } else {
          setStatus('error')
          setMessage(caught instanceof Error ? caught.message : 'Weather unavailable')
        }
      })
    return () => {
      live = false
    }
  }, [active.id, active.latitude, active.longitude, active.timezone])

  const persistSaved = (next: WeatherLocation[], nextActive: string) => {
    setSaved(next)
    setActiveId(nextActive)
    saveLocations(next)
    saveActiveLocationId(nextActive)
  }

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
    const next = saved.some((entry) => entry.id === location.id) ? saved : [...saved, location].slice(0, 12)
    persistSaved(next, location.id)
    setSection('today')
    setResults([])
    setQuery('')
  }

  const removeLocation = (id: string) => {
    const next = saved.filter((entry) => entry.id !== id)
    const nextActive = activeId === id ? (next[0]?.id ?? '') : (activeId ?? '')
    persistSaved(next, nextActive)
  }

  const todayMax = forecast?.daily[0]?.tempMaxC
  const tonightMin = forecast?.daily[0]?.tempMinC

  return (
    <div className="info-panel">
      <p className={message ? 'info-panel-meta is-stale' : 'info-panel-meta'} role="status">
        {locationLabel(active)}
        {forecast ? ` · Updated ${formatWhen(forecast.updatedIso)}` : ''}
        {message ? ` · ${message}` : ''}
        {forecast ? ` · ${forecast.attribution}` : ' · Weather data by Open-Meteo.com'}
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
          <form className="info-weather-search" onSubmit={onSearch}>
            <label className="info-item-meta" htmlFor="weather-search">
              Search town or city
            </label>
            <div className="info-weather-search-row">
              <input
                id="weather-search"
                className="info-weather-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="e.g. Manchester"
                autoComplete="off"
              />
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
          {saved.length === 0 ? (
            <p className="options-note">No saved locations yet. Search above, or use the default ({DEFAULT_LABEL}).</p>
          ) : (
            <ul className="info-list">
              {saved.map((location) => (
                <li key={location.id} className="info-item info-weather-saved">
                  <button
                    type="button"
                    className={location.id === active.id ? 'info-item-title is-active' : 'info-item-title'}
                    onKeyDown={keepKey}
                    onClick={() => persistSaved(saved, location.id)}
                  >
                    {locationLabel(location)}
                  </button>
                  <button type="button" className="tab" onKeyDown={keepKey} onClick={() => removeLocation(location.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
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
            {formatTemp(forecast.current.temperatureC)}
          </p>
          <p className="info-item-desc">{weatherConditionLabel(forecast.current.weatherCode)}</p>
          <ul className="info-list">
            <li className="info-item">
              <span className="info-item-meta">Feels like</span>
              <span className="info-item-title">{formatTemp(forecast.current.feelsLikeC)}</span>
            </li>
            <li className="info-item">
              <span className="info-item-meta">Wind</span>
              <span className="info-item-title">{Math.round(forecast.current.windSpeedKmh)} km/h</span>
            </li>
            <li className="info-item">
              <span className="info-item-meta">Precipitation chance</span>
              <span className="info-item-title">
                {forecast.current.precipitationProbability == null ? '—' : `${Math.round(forecast.current.precipitationProbability)}%`}
              </span>
            </li>
            <li className="info-item">
              <span className="info-item-meta">Today’s high</span>
              <span className="info-item-title">{todayMax == null ? '—' : formatTemp(todayMax)}</span>
            </li>
            <li className="info-item">
              <span className="info-item-meta">Tonight’s low</span>
              <span className="info-item-title">{tonightMin == null ? '—' : formatTemp(tonightMin)}</span>
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
                  {formatTemp(point.temperatureC)}
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
                {formatTemp(day.tempMaxC)} / {formatTemp(day.tempMinC)}
                {day.precipitationProbabilityMax != null ? ` · ${Math.round(day.precipitationProbabilityMax)}%` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const DEFAULT_LABEL = 'London, United Kingdom'
