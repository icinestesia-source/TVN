import type { DiscoveryMood, EntertainmentTitle, MediaKind } from './types.ts'
import { DISCOVERY_MOODS, TMDB_ATTRIBUTION } from './types.ts'

type Json = Record<string, unknown>

const IMG = 'https://image.tmdb.org/t/p/w342'

export function titleFromTmdb(raw: unknown, kind: MediaKind): EntertainmentTitle | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Json
  const providerId = typeof row.id === 'number' || typeof row.id === 'string' ? String(row.id) : null
  const title =
    kind === 'film'
      ? typeof row.title === 'string'
        ? row.title
        : null
      : typeof row.name === 'string'
        ? row.name
        : null
  if (!providerId || !title) return null
  const date = kind === 'film' ? row.release_date : row.first_air_date
  const year =
    typeof date === 'string' && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null
  const poster = typeof row.poster_path === 'string' && row.poster_path ? `${IMG}${row.poster_path}` : null
  const genres = Array.isArray(row.genre_ids)
    ? []
    : Array.isArray(row.genres)
      ? (row.genres as Json[]).map((g) => (typeof g.name === 'string' ? g.name : '')).filter(Boolean)
      : []
  const rating = typeof row.vote_average === 'number' ? row.vote_average : null
  const overview = typeof row.overview === 'string' && row.overview.trim() ? row.overview.trim() : null
  const runtime =
    typeof row.runtime === 'number' ? row.runtime : typeof row.episode_run_time === 'object' && Array.isArray(row.episode_run_time) ? Number(row.episode_run_time[0]) || null : null
  const cast = Array.isArray((row.credits as Json | undefined)?.cast)
    ? ((row.credits as Json).cast as Json[])
        .slice(0, 5)
        .map((person) => (typeof person.name === 'string' ? person.name : ''))
        .filter(Boolean)
    : []
  let trailerUrl: string | null = null
  const videos = (row.videos as Json | undefined)?.results
  if (Array.isArray(videos)) {
    const trailer = videos.find((v) => {
      const entry = v as Json
      return entry.site === 'YouTube' && (entry.type === 'Trailer' || entry.type === 'Teaser') && typeof entry.key === 'string'
    }) as Json | undefined
    if (trailer?.key) trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`
  }
  return {
    id: `${kind}:${providerId}`,
    kind,
    title,
    year,
    overview,
    posterUrl: poster,
    genres,
    rating,
    runtimeMinutes: runtime,
    cast,
    trailerUrl,
    provider: 'tmdb',
    providerId,
  }
}

export function titlesFromTmdbList(payload: unknown, kind: MediaKind): EntertainmentTitle[] {
  if (!payload || typeof payload !== 'object') return []
  const results = Array.isArray((payload as Json).results) ? ((payload as Json).results as unknown[]) : []
  const out: EntertainmentTitle[] = []
  for (const raw of results) {
    const title = titleFromTmdb(raw, kind)
    if (title) out.push(title)
  }
  return out
}

export function discoveryGenreQuery(mood: DiscoveryMood): { media: MediaKind; withGenres: string; sort: string } {
  const def = DISCOVERY_MOODS.find((entry) => entry.id === mood) ?? DISCOVERY_MOODS[DISCOVERY_MOODS.length - 1]
  if (mood === 'surprise') {
    return { media: 'film', withGenres: '', sort: 'popularity.desc' }
  }
  if (mood === 'classic') {
    return { media: 'film', withGenres: '18', sort: 'vote_average.desc' }
  }
  const media: MediaKind = mood === 'scifi' ? 'television' : 'film'
  return { media, withGenres: def.genreIds.filter((id) => (media === 'film' ? id < 1000 : true)).join('|'), sort: 'popularity.desc' }
}

/** Browser/dev calls TVN proxy — never embeds TMDB credentials. */
export async function tmdbProxy(
  path: string,
  params: Record<string, string> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const query = new URLSearchParams({ path, ...params })
  const response = await fetchImpl(`/api/info/tmdb?${query}`, { headers: { Accept: 'application/json' } })
  if (response.status === 503) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? 'TMDB is not configured (set TMDB_API_TOKEN for the API proxy).')
  }
  if (!response.ok) throw new Error(`Entertainment service ${response.status}`)
  return response.json()
}

export async function loadPopularFilms(fetchImpl: typeof fetch = fetch): Promise<EntertainmentTitle[]> {
  const payload = await tmdbProxy('/movie/popular', {}, fetchImpl)
  return titlesFromTmdbList(payload, 'film')
}

export async function loadPopularTv(fetchImpl: typeof fetch = fetch): Promise<EntertainmentTitle[]> {
  const payload = await tmdbProxy('/tv/popular', {}, fetchImpl)
  return titlesFromTmdbList(payload, 'television')
}

export async function loadTrending(fetchImpl: typeof fetch = fetch): Promise<EntertainmentTitle[]> {
  const payload = await tmdbProxy('/trending/all/week', {}, fetchImpl)
  if (!payload || typeof payload !== 'object') return []
  const results = Array.isArray((payload as Json).results) ? ((payload as Json).results as unknown[]) : []
  const out: EntertainmentTitle[] = []
  for (const raw of results) {
    if (!raw || typeof raw !== 'object') continue
    const media = (raw as Json).media_type === 'tv' ? 'television' : 'film'
    if ((raw as Json).media_type === 'person') continue
    const title = titleFromTmdb(raw, media)
    if (title) out.push(title)
  }
  return out
}

export async function searchTitles(query: string, fetchImpl: typeof fetch = fetch): Promise<EntertainmentTitle[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const payload = await tmdbProxy('/search/multi', { query: q }, fetchImpl)
  if (!payload || typeof payload !== 'object') return []
  const results = Array.isArray((payload as Json).results) ? ((payload as Json).results as unknown[]) : []
  const out: EntertainmentTitle[] = []
  for (const raw of results) {
    if (!raw || typeof raw !== 'object') continue
    const type = (raw as Json).media_type
    if (type !== 'movie' && type !== 'tv') continue
    const title = titleFromTmdb(raw, type === 'tv' ? 'television' : 'film')
    if (title) out.push(title)
  }
  return out
}

export async function discoverByMood(mood: DiscoveryMood, fetchImpl: typeof fetch = fetch): Promise<EntertainmentTitle[]> {
  const spec = discoveryGenreQuery(mood)
  const path = spec.media === 'film' ? '/discover/movie' : '/discover/tv'
  const params: Record<string, string> = { sort_by: spec.sort }
  if (spec.withGenres) params.with_genres = spec.withGenres
  if (mood === 'classic') {
    params['primary_release_date.lte'] = '1985-12-31'
    params['vote_count.gte'] = '200'
  }
  const payload = await tmdbProxy(path, params, fetchImpl)
  return titlesFromTmdbList(payload, spec.media).slice(0, 12)
}

export { TMDB_ATTRIBUTION }
