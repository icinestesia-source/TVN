import { useEffect, useState } from 'react'
import { fetchNationalMap, NATIONAL_MAPS, projectPlace, type MapReading, type NationalMapRegion } from '../../info/weather/national-maps.ts'
import { weatherSymbol } from '../../info/weather/open-meteo.ts'
import { formatTemp } from '../../info/weather/units.ts'
import type { TempUnit } from '../../info/preferences.ts'
import { keepKey } from '../keep-key.ts'

function tempColour(celsius: number | null): string {
  if (celsius == null) return 'rgba(180, 186, 194, 0.35)'
  if (celsius <= 0) return '#7eb6ff'
  if (celsius <= 8) return '#8fd4c8'
  if (celsius <= 15) return '#d7e38a'
  if (celsius <= 22) return '#f0c14b'
  if (celsius <= 28) return '#e08a3c'
  return '#d45d4a'
}

/**
 * Current conditions at named places, plotted on the country's bounds.
 * Not a radar image: each mark is a verified Open-Meteo reading.
 */
export function WeatherMap({ tempUnit }: { tempUnit: TempUnit }) {
  const [regionId, setRegionId] = useState(NATIONAL_MAPS[0].id)
  const region = NATIONAL_MAPS.find((entry) => entry.id === regionId) ?? NATIONAL_MAPS[0]
  const [readings, setReadings] = useState<MapReading[] | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setStatus('loading')
    setMessage(null)
    void fetchNationalMap(region)
      .then((next) => {
        if (!live) return
        setReadings(next)
        setStatus('ready')
      })
      .catch((caught) => {
        if (!live) return
        setReadings(null)
        setStatus('error')
        setMessage(caught instanceof Error ? caught.message : 'Weather map unavailable')
      })
    return () => {
      live = false
    }
  }, [region])

  return (
    <div className="info-weather-map">
      <div className="tabs" role="tablist" aria-label="National weather maps">
        {NATIONAL_MAPS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={entry.id === region.id}
            className={entry.id === region.id ? 'tab is-on' : 'tab'}
            onKeyDown={keepKey}
            onClick={() => setRegionId(entry.id)}
          >
            {entry.name}
          </button>
        ))}
      </div>
      <p className="info-panel-meta">Current temperature · Weather data by Open-Meteo.com · Coastline by Natural Earth</p>
      {status === 'loading' ? <p className="options-note">Loading map…</p> : null}
      {status === 'error' ? (
        <p className="options-note" role="status">
          {message ?? 'Weather map unavailable'}
        </p>
      ) : null}
      {status === 'ready' && readings ? <MapPlot region={region} readings={readings} tempUnit={tempUnit} /> : null}
    </div>
  )
}

function MapPlot({ region, readings, tempUnit }: { region: NationalMapRegion; readings: MapReading[]; tempUnit: TempUnit }) {
  return (
    <svg className="info-weather-map-plot" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${region.name} weather map`}>
      <rect className="info-weather-map-field" x="0" y="0" width="100" height="100" rx="1.5" />
      <path className="info-weather-map-land" fillRule="evenodd" d={region.shape} />
      {readings.map((reading) => {
        const point = projectPlace(region, reading)
        const label = reading.temperatureC == null ? '—' : formatTemp(reading.temperatureC, tempUnit)
        return (
          <g key={reading.name} transform={`translate(${point.x} ${point.y})`}>
            <circle r="1.6" fill={tempColour(reading.temperatureC)} stroke="rgba(8, 12, 18, 0.8)" strokeWidth="0.25" />
            <text className="info-weather-map-name" y="-2.4" textAnchor="middle" fontSize="2.6">
              {reading.name}
            </text>
            <text className="info-weather-map-temp" y="3.8" textAnchor="middle" fontSize="2.3">
              {reading.weatherCode == null ? '' : `${weatherSymbol(reading.weatherCode)} `}
              {label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
