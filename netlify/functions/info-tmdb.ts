/**
 * GET /api/info/tmdb?path=/movie/popular&…
 * Proxies allowlisted TMDB paths. Secret: TMDB_API_TOKEN (v3 API key).
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
  const token = process.env.TMDB_API_TOKEN?.trim()
  if (!token) return json({ error: 'TMDB_API_TOKEN is not configured' }, 503)

  const url = new URL(request.url)
  const path = url.searchParams.get('path') ?? ''
  if (!ALLOW.some((rule) => rule.test(path))) return json({ error: 'Path not allowed' }, 400)

  const upstream = new URL(`${TMDB}${path}`)
  upstream.searchParams.set('api_key', token)
  for (const [key, value] of url.searchParams) {
    if (key === 'path' || key === 'api_key') continue
    upstream.searchParams.set(key, value)
  }

  const response = await fetch(upstream.toString(), { headers: { Accept: 'application/json' } })
  const text = await response.text()
  return new Response(text, {
    status: response.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=900' },
  })
}

export const config = { path: '/api/info/tmdb' }
