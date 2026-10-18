/**
 * GET /api/info/finance?action=quote&symbol=IBM
 * Proxies Alpha Vantage GLOBAL_QUOTE / commodity endpoints.
 * Secret: ALPHA_VANTAGE_API_KEY
 */
const AV = 'https://www.alphavantage.co/query'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=1800' },
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
  if (action === 'quote') {
    upstream.searchParams.set('function', 'GLOBAL_QUOTE')
    upstream.searchParams.set('symbol', symbol)
  } else if (action === 'commodity') {
    const fn = url.searchParams.get('function') ?? 'WTI'
    if (!['WTI', 'BRENT', 'NATURAL_GAS', 'COPPER', 'ALUMINUM'].includes(fn)) return json({ error: 'Unsupported commodity' }, 400)
    upstream.searchParams.set('function', fn)
    upstream.searchParams.set('interval', 'daily')
  } else if (action === 'search') {
    const keywords = (url.searchParams.get('keywords') ?? '').trim()
    if (keywords.length < 2 || keywords.length > 40) return json({ error: 'Invalid keywords' }, 400)
    upstream.searchParams.set('function', 'SYMBOL_SEARCH')
    upstream.searchParams.set('keywords', keywords)
  } else {
    return json({ error: 'Unknown action' }, 400)
  }

  const response = await fetch(upstream.toString(), { headers: { Accept: 'application/json' } })
  const text = await response.text()
  return new Response(text, {
    status: response.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=1800' },
  })
}

export const config = { path: '/api/info/finance' }
