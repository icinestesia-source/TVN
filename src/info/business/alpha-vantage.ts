import type { MarketQuote } from './types.ts'

type Json = Record<string, unknown>

/** Normalise Alpha Vantage GLOBAL_QUOTE payload. Never invents numbers. */
export function quoteFromAlphaGlobal(payload: unknown, meta: { id: string; name: string; kind: MarketQuote['kind'] }): MarketQuote | null {
  if (!payload || typeof payload !== 'object') return null
  const quote = (payload as Json)['Global Quote']
  if (!quote || typeof quote !== 'object') return null
  const row = quote as Record<string, unknown>
  const symbol = typeof row['01. symbol'] === 'string' ? row['01. symbol'] : meta.id
  const price = num(row['05. price'])
  const change = num(row['09. change'])
  const changePercentRaw = typeof row['10. change percent'] === 'string' ? row['10. change percent'].replace('%', '') : null
  const changePercent = changePercentRaw != null ? Number(changePercentRaw) : null
  const latestDay = typeof row['07. latest trading day'] === 'string' ? row['07. latest trading day'] : null
  if (price == null) return null
  return {
    id: meta.id,
    kind: meta.kind,
    name: meta.name,
    symbol,
    exchange: null,
    value: price,
    change,
    changePercent: Number.isFinite(changePercent) ? changePercent : null,
    currency: 'USD',
    updatedIso: latestDay ? `${latestDay}T21:00:00.000Z` : null,
    delayed: true,
    provider: 'Alpha Vantage',
  }
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

/** Browser calls TVN finance proxy — credentials stay server-side. */
export async function financeProxy(
  action: string,
  params: Record<string, string> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const query = new URLSearchParams({ action, ...params })
  const response = await fetchImpl(`/api/info/finance?${query}`, { headers: { Accept: 'application/json' } })
  if (response.status === 503) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? 'Finance API is not configured (set ALPHA_VANTAGE_API_KEY).')
  }
  if (!response.ok) throw new Error(`Finance service ${response.status}`)
  return response.json()
}
