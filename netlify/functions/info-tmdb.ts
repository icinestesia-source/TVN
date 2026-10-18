/**
 * GET /api/info/tmdb?path=/movie/popular&…
 * Proxies allowlisted TMDB paths.
 *
 * Credentials (never logged). Auth mode is chosen by secret *shape*, not env var name:
 * - JWT / Read Access Token → Authorization: Bearer
 * - Classic v3 API key → query api_key=
 *
 * Env vars (either may hold either type):
 * - TMDB_API_TOKEN (Netlify — often the Read Access Token)
 * - TMDB_READ_ACCESS_TOKEN (GitHub Actions / optional Netlify)
 */
import { applyTmdbCredential, resolveTmdbCredential } from '../../src/info/entertainment/tmdb-auth.ts'

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
  const credential = resolveTmdbCredential({
    TMDB_API_TOKEN: process.env.TMDB_API_TOKEN,
    TMDB_READ_ACCESS_TOKEN: process.env.TMDB_READ_ACCESS_TOKEN,
  })
  if (!credential) {
    return json({ error: 'TMDB_API_TOKEN or TMDB_READ_ACCESS_TOKEN is not configured' }, 503)
  }

  const url = new URL(request.url)
  const path = url.searchParams.get('path') ?? ''
  if (!ALLOW.some((rule) => rule.test(path))) return json({ error: 'Path not allowed' }, 400)

  const upstream = new URL(`${TMDB}${path}`)
  const headers: Record<string, string> = { Accept: 'application/json' }
  applyTmdbCredential(upstream, headers, credential)

  for (const [key, value] of url.searchParams) {
    if (key === 'path' || key === 'api_key') continue
    upstream.searchParams.set(key, value)
  }

  let response: Response
  try {
    response = await fetch(upstream.toString(), { headers })
  } catch {
    return json({ error: 'TMDB upstream unreachable' }, 502)
  }

  const text = await response.text()
  if (response.status === 429) {
    return new Response(text || JSON.stringify({ error: 'TMDB rate limit' }), {
      status: 429,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' },
    })
  }
  return new Response(text, {
    status: response.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=900' },
  })
}

export const config = { path: '/api/info/tmdb' }
