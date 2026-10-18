/** Provider-independent financial quotes for INFO → Business. */

export type InstrumentKind = 'index' | 'stock' | 'currency' | 'commodity'

export interface MarketQuote {
  id: string
  kind: InstrumentKind
  name: string
  symbol: string
  exchange: string | null
  value: number | null
  change: number | null
  changePercent: number | null
  currency: string | null
  updatedIso: string | null
  delayed: boolean
  provider: string
}

export interface CurrencyPair {
  base: string
  quote: string
  rate: number
  date: string
  provider: string
  delayed: boolean
}

export interface BusinessWatchEntry {
  id: string
  kind: InstrumentKind
  symbol: string
  name: string
}

/** Curated index symbols for Alpha Vantage when configured. Only request supported symbols. */
export const MARKET_INDEX_DEFS: { id: string; name: string; symbol: string }[] = [
  { id: 'ftse100', name: 'FTSE 100', symbol: 'UKX' },
  { id: 'sp500', name: 'S&P 500', symbol: 'SPX' },
  { id: 'nasdaq', name: 'NASDAQ Composite', symbol: 'IXIC' },
  { id: 'dji', name: 'Dow Jones', symbol: 'DJI' },
  { id: 'dax', name: 'DAX', symbol: 'GDAXI' },
  { id: 'cac40', name: 'CAC 40', symbol: 'FCHI' },
  { id: 'nikkei', name: 'Nikkei 225', symbol: 'N225' },
]

export const MAJOR_CURRENCIES = ['GBP', 'EUR', 'USD', 'JPY', 'CHF', 'CAD', 'AUD'] as const

export const COMMODITY_DEFS: { id: string; name: string; symbol: string }[] = [
  { id: 'gold', name: 'Gold', symbol: 'XAU' },
  { id: 'silver', name: 'Silver', symbol: 'XAG' },
  { id: 'oil', name: 'Crude oil (WTI)', symbol: 'WTI' },
  { id: 'gas', name: 'Natural gas', symbol: 'NATURAL_GAS' },
]

export const BUSINESS_DISCLAIMER =
  'Informational quotes only. Not investment advice. Values may be delayed. Not a trading platform.'
