/**
 * GET /api/info/finance?action=quote&symbol=IBM
 * Proxies Alpha Vantage GLOBAL_QUOTE / commodity endpoints.
 * Secret: ALPHA_VANTAGE_API_KEY (never logged).
 *
 * Free-tier Alpha Vantage is severely rate-limited. Responses are cached in-process
 * so multiple viewers do not each trigger a fresh upstream call.
 */
const AV = 'https://www.alphavantage.co/query'
const CACHE_TTL_MS = 30 * 60 * 1000

type CacheEntry = { expires: number; status: number; body: string }

const cache = new Map<string, CacheEntry>()

function json(data: unknown, status = 200, maxAge = 1800): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
    },
  })
}

function cachedResponse(entry: CacheEntry): Response {
  return new Response(entry.body, {
    status: entry.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=1800',
      'x-tvn-finance-cache': 'hit',
    },
  })
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'GET') return json({ error: 'GET only' }, 405)
  const key = process.env.ALPHA_VANTAGE_API_KEY?.trim()
  if (!key) return json({ error: 'ALPHA_VANTAGE_API_KEY is not configured' }, 503)

  const url = new URL(request.url)
  const action = url.searchParams.get('action') ?? 'quote'
  const symbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9.^_-]{1,16}$/.test(symbol) && action !== 'commodity') {
    return json({ error: 'Invalid symbol' }, 400)
  }

  const upstream = new URL(AV)
  upstream.searchParams.set('apikey', key)
  let cacheKey = `${action}:${symbol}`
  if (action === 'quote') {
    upstream.searchParams.set('function', 'GLOBAL_QUOTE')
    upstream.searchParams.set('symbol', symbol)
  } else if (action === 'commodity') {
    const fn = url.searchParams.get('function') ?? 'WTI'
    if (!['WTI', 'BRENT', 'NATURAL_GAS', 'COPPER', 'ALUMINUM'].includes(fn)) return json({ error: 'Unsupported commodity' }, 400)
    upstream.searchParams.set('function', fn)
    upstream.searchParams.set('interval', 'daily')
    cacheKey = `${action}:${fn}`
  } else if (action === 'search') {
    const keywords = (url.searchParams.get('keywords') ?? '').trim()
    if (keywords.length < 2 || keywords.length > 40) return json({ error: 'Invalid keywords' }, 400)
    upstream.searchParams.set('function', 'SYMBOL_SEARCH')
    upstream.searchParams.set('keywords', keywords)
    cacheKey = `${action}:${keywords.toLowerCase()}`
  } else {
    return json({ error: 'Unknown action' }, 400)
  }

  const hit = cache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return cachedResponse(hit)

  let response: Response
  try {
    response = await fetch(upstream.toString(), { headers: { Accept: 'application/json' } })
  } catch {
    return json({ error: 'Finance upstream unreachable' }, 502, 60)
  }
  const text = await response.text()
  // Cache successful and empty-but-valid responses; do not cache hard auth failures.
  if (response.status === 200) {
    cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, status: response.status, body: text })
  }
  return new Response(text, {
    status: response.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=1800',
      'x-tvn-finance-cache': 'miss',
    },
  })
}

export const config = { path: '/api/info/finance' }

/** Test helper — clears the in-process quote cache. */
export function clearFinanceCacheForTests(): void {
  cache.clear()
}
