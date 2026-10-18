import type { CurrencyPair } from './types.ts'
import { MAJOR_CURRENCIES } from './types.ts'

type Json = Record<string, unknown>

const API = 'https://api.frankfurter.dev/v1'

export function pairsFromFrankfurter(payload: unknown, base: string): CurrencyPair[] {
  if (!payload || typeof payload !== 'object') return []
  const doc = payload as Json
  const date = typeof doc.date === 'string' ? doc.date : ''
  const rates = doc.rates && typeof doc.rates === 'object' ? (doc.rates as Record<string, unknown>) : {}
  const out: CurrencyPair[] = []
  for (const quote of MAJOR_CURRENCIES) {
    if (quote === base) continue
    const rate = rates[quote]
    if (typeof rate !== 'number' || !Number.isFinite(rate)) continue
    out.push({
      base,
      quote,
      rate,
      date,
      provider: 'Frankfurter (ECB reference)',
      delayed: true,
    })
  }
  return out
}

export async function fetchCurrencyPairs(base: string, fetchImpl: typeof fetch = fetch): Promise<CurrencyPair[]> {
  const quotes = MAJOR_CURRENCIES.filter((code) => code !== base).join(',')
  const response = await fetchImpl(`${API}/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quotes)}`, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Frankfurter ${response.status}`)
  return pairsFromFrankfurter(await response.json(), base)
}
