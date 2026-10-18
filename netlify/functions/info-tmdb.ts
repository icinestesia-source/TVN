/**
 * GET /api/info/tmdb?path=/movie/popular&…
 * Proxies allowlisted TMDB paths.
 *
 * Credentials (never logged):
 * - TMDB_API_TOKEN — v3 API key (Netlify) → query api_key=
 * - TMDB_READ_ACCESS_TOKEN — v4 read access token (GitHub / optional Netlify) → Authorization: Bearer
 * Prefers TMDB_API_TOKEN when both are set.
 */
const TMDB = 'https://api.themoviedb.org/3'

const ALLOW = [
  /^\/movie\/popular$/,
  /^\/movie\/now_playing$/,
  /^\/tv\/popular$/,
  /^\/tv\/on_the_air$/,
  /^\/trending\/all\/week$/,
  /^\/search\/multi$/,
  /^\/discover\/movie$/,
  /^\/discover\/tv$/,
  /^\/genre\/movie\/list$/,
  /^\/genre\/tv\/list$/,
]

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=900' },
  })
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'GET') return json({ error: 'GET only' }, 405)
  const apiKey = process.env.TMDB_API_TOKEN?.trim()
  const bearer = process.env.TMDB_READ_ACCESS_TOKEN?.trim()
  if (!apiKey && !bearer) {
    return json({ error: 'TMDB_API_TOKEN or TMDB_READ_ACCESS_TOKEN is not configured' }, 503)
  }

  const url = new URL(request.url)
  const path = url.searchParams.get('path') ?? ''
  if (!ALLOW.some((rule) => rule.test(path))) return json({ error: 'Path not allowed' }, 400)

  const upstream = new URL(`${TMDB}${path}`)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) upstream.searchParams.set('api_key', apiKey)
  else if (bearer) headers.Authorization = `Bearer ${bearer}`

  for (const [key, value] of url.searchParams) {
    if (key === 'path' || key === 'api_key') continue
    upstream.searchParams.set(key, value)
  }

  const response = await fetch(upstream.toString(), { headers })
  const text = await response.text()
  return new Response(text, {
    status: response.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=900' },
  })
}

export const config = { path: '/api/info/tmdb' }
