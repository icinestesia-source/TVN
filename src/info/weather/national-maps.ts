/**
 * National weather maps: a few real places on a simple geographic plot.
 * One Open-Meteo request per country. No tile server and no extra dependency.
 */

export interface MapPlace {
  name: string
  latitude: number
  longitude: number
}

export interface NationalMapRegion {
  id: string
  name: string
  north: number
  south: number
  west: number
  east: number
  places: readonly MapPlace[]
}

export interface MapReading {
  name: string
  latitude: number
  longitude: number
  temperatureC: number | null
  weatherCode: number | null
}

export const NATIONAL_MAPS: readonly NationalMapRegion[] = [
  {
    id: 'uk',
    name: 'United Kingdom',
    north: 59.5,
    south: 49.5,
    west: -8.5,
    east: 2.2,
    places: [
      { name: 'Lerwick', latitude: 60.15, longitude: -1.15 },
      { name: 'Inverness', latitude: 57.48, longitude: -4.22 },
      { name: 'Glasgow', latitude: 55.86, longitude: -4.25 },
      { name: 'Edinburgh', latitude: 55.95, longitude: -3.19 },
      { name: 'Belfast', latitude: 54.6, longitude: -5.93 },
      { name: 'Newcastle', latitude: 54.98, longitude: -1.61 },
      { name: 'Manchester', latitude: 53.48, longitude: -2.24 },
      { name: 'Cardiff', latitude: 51.48, longitude: -3.18 },
      { name: 'London', latitude: 51.51, longitude: -0.13 },
      { name: 'Plymouth', latitude: 50.37, longitude: -4.14 },
    ],
  },
  {
    id: 'ireland',
    name: 'Ireland',
    north: 55.6,
    south: 51.3,
    west: -10.6,
    east: -5.4,
    places: [
      { name: 'Letterkenny', latitude: 54.95, longitude: -7.73 },
      { name: 'Galway', latitude: 53.27, longitude: -9.05 },
      { name: 'Dublin', latitude: 53.35, longitude: -6.26 },
      { name: 'Limerick', latitude: 52.66, longitude: -8.63 },
      { name: 'Cork', latitude: 51.9, longitude: -8.47 },
    ],
  },
  {
    id: 'france',
    name: 'France',
    north: 51.4,
    south: 42.2,
    west: -5.2,
    east: 8.4,
    places: [
      { name: 'Lille', latitude: 50.63, longitude: 3.06 },
      { name: 'Brest', latitude: 48.39, longitude: -4.49 },
      { name: 'Paris', latitude: 48.86, longitude: 2.35 },
      { name: 'Strasbourg', latitude: 48.57, longitude: 7.75 },
      { name: 'Nantes', latitude: 47.22, longitude: -1.55 },
      { name: 'Lyon', latitude: 45.76, longitude: 4.84 },
      { name: 'Bordeaux', latitude: 44.84, longitude: -0.58 },
      { name: 'Toulouse', latitude: 43.6, longitude: 1.44 },
      { name: 'Marseille', latitude: 43.3, longitude: 5.37 },
    ],
  },
  {
    id: 'germany',
    name: 'Germany',
    north: 55.2,
    south: 47.2,
    west: 5.8,
    east: 15.2,
    places: [
      { name: 'Hamburg', latitude: 53.55, longitude: 9.99 },
      { name: 'Berlin', latitude: 52.52, longitude: 13.4 },
      { name: 'Cologne', latitude: 50.94, longitude: 6.96 },
      { name: 'Frankfurt', latitude: 50.11, longitude: 8.68 },
      { name: 'Dresden', latitude: 51.05, longitude: 13.74 },
      { name: 'Munich', latitude: 48.14, longitude: 11.58 },
    ],
  },
  {
    id: 'spain',
    name: 'Spain',
    north: 43.9,
    south: 36.0,
    west: -9.4,
    east: 3.4,
    places: [
      { name: 'A Coruña', latitude: 43.37, longitude: -8.4 },
      { name: 'Bilbao', latitude: 43.26, longitude: -2.92 },
      { name: 'Madrid', latitude: 40.42, longitude: -3.7 },
      { name: 'Barcelona', latitude: 41.39, longitude: 2.17 },
      { name: 'Valencia', latitude: 39.47, longitude: -0.38 },
      { name: 'Seville', latitude: 37.39, longitude: -5.98 },
      { name: 'Málaga', latitude: 36.72, longitude: -4.42 },
    ],
  },
  {
    id: 'italy',
    name: 'Italy',
    north: 47.1,
    south: 36.6,
    west: 6.6,
    east: 18.6,
    places: [
      { name: 'Milan', latitude: 45.46, longitude: 9.19 },
      { name: 'Venice', latitude: 45.44, longitude: 12.32 },
      { name: 'Florence', latitude: 43.77, longitude: 11.26 },
      { name: 'Rome', latitude: 41.9, longitude: 12.5 },
      { name: 'Naples', latitude: 40.85, longitude: 14.27 },
      { name: 'Bari', latitude: 41.12, longitude: 16.87 },
      { name: 'Palermo', latitude: 38.12, longitude: 13.36 },
    ],
  },
  {
    id: 'europe',
    name: 'Europe',
    north: 71,
    south: 35,
    west: -12,
    east: 32,
    places: [
      { name: 'Reykjavík', latitude: 64.15, longitude: -21.94 },
      { name: 'Oslo', latitude: 59.91, longitude: 10.75 },
      { name: 'Stockholm', latitude: 59.33, longitude: 18.07 },
      { name: 'Dublin', latitude: 53.35, longitude: -6.26 },
      { name: 'London', latitude: 51.51, longitude: -0.13 },
      { name: 'Amsterdam', latitude: 52.37, longitude: 4.9 },
      { name: 'Berlin', latitude: 52.52, longitude: 13.4 },
      { name: 'Warsaw', latitude: 52.23, longitude: 21.01 },
      { name: 'Paris', latitude: 48.86, longitude: 2.35 },
      { name: 'Vienna', latitude: 48.21, longitude: 16.37 },
      { name: 'Madrid', latitude: 40.42, longitude: -3.7 },
      { name: 'Rome', latitude: 41.9, longitude: 12.5 },
      { name: 'Athens', latitude: 37.98, longitude: 23.73 },
    ],
  },
  {
    id: 'usa',
    name: 'United States',
    north: 49.5,
    south: 24.5,
    west: -125,
    east: -66,
    places: [
      { name: 'Seattle', latitude: 47.61, longitude: -122.33 },
      { name: 'Denver', latitude: 39.74, longitude: -104.99 },
      { name: 'Chicago', latitude: 41.88, longitude: -87.63 },
      { name: 'New York', latitude: 40.71, longitude: -74.01 },
      { name: 'San Francisco', latitude: 37.77, longitude: -122.42 },
      { name: 'Dallas', latitude: 32.78, longitude: -96.8 },
      { name: 'Atlanta', latitude: 33.75, longitude: -84.39 },
      { name: 'Miami', latitude: 25.76, longitude: -80.19 },
    ],
  },
]

const FORECAST = 'https://api.open-meteo.com/v1/forecast'

export function nationalMapById(id: string): NationalMapRegion {
  return NATIONAL_MAPS.find((region) => region.id === id) ?? NATIONAL_MAPS[0]
}

/** Position on a 0–100 plot. North is up. */
export function projectPlace(region: NationalMapRegion, place: Pick<MapPlace, 'latitude' | 'longitude'>): { x: number; y: number } {
  const width = region.east - region.west
  const height = region.north - region.south
  const x = width === 0 ? 50 : ((place.longitude - region.west) / width) * 100
  const y = height === 0 ? 50 : ((region.north - place.latitude) / height) * 100
  return { x: Math.min(96, Math.max(4, x)), y: Math.min(94, Math.max(8, y)) }
}

export function nationalMapUrl(region: NationalMapRegion): string {
  const latitude = region.places.map((place) => place.latitude).join(',')
  const longitude = region.places.map((place) => place.longitude).join(',')
  return `${FORECAST}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=UTC`
}

function readingFrom(place: MapPlace, row: unknown): MapReading {
  const current = row && typeof row === 'object' ? (row as { current?: Record<string, unknown> }).current : undefined
  const temperature = current && typeof current.temperature_2m === 'number' ? current.temperature_2m : null
  const code = current && typeof current.weather_code === 'number' ? current.weather_code : null
  return { name: place.name, latitude: place.latitude, longitude: place.longitude, temperatureC: temperature, weatherCode: code }
}

/** Open-Meteo returns one object for a single place and an array for several. Missing numbers stay empty. */
export function readingsFromPayload(region: NationalMapRegion, payload: unknown): MapReading[] {
  const rows = Array.isArray(payload) ? payload : [payload]
  return region.places.map((place, index) => readingFrom(place, rows[index]))
}

export async function fetchNationalMap(region: NationalMapRegion, fetchImpl: typeof fetch = fetch): Promise<MapReading[]> {
  const response = await fetchImpl(nationalMapUrl(region), { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return readingsFromPayload(region, await response.json())
}
