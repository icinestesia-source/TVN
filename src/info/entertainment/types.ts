/** Provider-independent entertainment titles for INFO → Entertainment. */

export type MediaKind = 'film' | 'television'

export interface EntertainmentTitle {
  id: string
  kind: MediaKind
  title: string
  year: number | null
  overview: string | null
  posterUrl: string | null
  genres: string[]
  rating: number | null
  runtimeMinutes: number | null
  cast: string[]
  trailerUrl: string | null
  provider: string
  providerId: string
}

export interface EntertainmentList {
  id: string
  label: string
  titles: EntertainmentTitle[]
  updatedIso: string
  attribution: string
}

export type DiscoveryMood =
  | 'comedy'
  | 'drama'
  | 'horror'
  | 'scifi'
  | 'documentary'
  | 'classic'
  | 'animation'
  | 'mystery'
  | 'surprise'

export interface WatchlistEntry {
  id: string
  kind: MediaKind
  title: string
  year: number | null
  posterUrl: string | null
  providerId: string
  favourite: boolean
  watched: boolean
  addedIso: string
}

export const TMDB_ATTRIBUTION =
  'This product uses the TMDB API but is not endorsed or certified by TMDB.'

export const DISCOVERY_MOODS: { id: DiscoveryMood; label: string; genreIds: number[] }[] = [
  { id: 'comedy', label: 'Comedy', genreIds: [35] },
  { id: 'drama', label: 'Drama', genreIds: [18] },
  { id: 'horror', label: 'Horror', genreIds: [27] },
  { id: 'scifi', label: 'Science fiction', genreIds: [878, 10765] },
  { id: 'documentary', label: 'Documentary', genreIds: [99] },
  { id: 'classic', label: 'Classic cinema', genreIds: [18] },
  { id: 'animation', label: 'Animation', genreIds: [16] },
  { id: 'mystery', label: 'Mystery', genreIds: [9648] },
  { id: 'surprise', label: 'Surprise me', genreIds: [] },
]
