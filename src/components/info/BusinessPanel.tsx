import { useEffect, useState } from 'react'
import { financeProxy, quoteFromAlphaGlobal } from '../../info/business/alpha-vantage.ts'
import { fetchCurrencyPairs } from '../../info/business/frankfurter.ts'
import {
  BUSINESS_DISCLAIMER,
  COMMODITY_DEFS,
  MAJOR_CURRENCIES,
  MARKET_INDEX_DEFS,
  type CurrencyPair,
  type MarketQuote,
} from '../../info/business/types.ts'
import { loadNewsSnapshot } from '../../info/news/load.ts'
import type { NewsItem } from '../../info/news/types.ts'
import { defaultInfoPreferences, loadInfoPreferences, saveInfoPreferences, type InfoPreferences } from '../../info/preferences.ts'
import { keepKey } from '../keep-key.ts'

type Section = 'markets' | 'stocks' | 'currencies' | 'commodities' | 'news' | 'watchlist'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'markets', label: 'Markets' },
  { id: 'stocks', label: 'Stocks' },
  { id: 'currencies', label: 'Currencies' },
  { id: 'commodities', label: 'Commodities' },
  { id: 'news', label: 'News' },
  { id: 'watchlist', label: 'Watchlist' },
]

function formatQuote(quote: MarketQuote): string {
  if (quote.value == null) return '—'
  const change =
    quote.change != null && quote.changePercent != null
      ? ` · ${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)} (${quote.changePercent.toFixed(2)}%)`
      : ''
  return `${quote.value.toFixed(2)}${quote.currency ? ` ${quote.currency}` : ''}${change}`
}

export function BusinessPanel() {
  const [prefs, setPrefs] = useState<InfoPreferences>(() => {
    try {
      return loadInfoPreferences()
    } catch {
      return defaultInfoPreferences()
    }
  })
  const [section, setSection] = useState<Section>(prefs.business.defaultView === 'currencies' ? 'currencies' : prefs.business.defaultView === 'watchlist' ? 'watchlist' : 'markets')
  const [quotes, setQuotes] = useState<MarketQuote[]>([])
  const [pairs, setPairs] = useState<CurrencyPair[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [symbol, setSymbol] = useState('IBM')
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [marketsLoaded, setMarketsLoaded] = useState(false)

  const persist = (next: InfoPreferences) => {
    saveInfoPreferences(next)
    setPrefs(next)
  }

  useEffect(() => {
    if (section === 'currencies') {
      setLoading(true)
      void fetchCurrencyPairs(prefs.business.baseCurrency)
        .then((list) => {
          setPairs(list)
          setStatus(null)
        })
        .catch((caught) => setStatus(caught instanceof Error ? caught.message : 'Currency rates unavailable'))
        .finally(() => setLoading(false))
    }
    if (section === 'news') {
      void loadNewsSnapshot().then((state) => {
        if (state.status === 'ready') setNews(state.snapshot.items.filter((item) => item.category === 'business'))
      })
    }
  }, [section, prefs.business.baseCurrency])

  const loadStock = async () => {
    setLoading(true)
    setStatus(null)
    try {
      const payload = await financeProxy('quote', { symbol })
      const quote = quoteFromAlphaGlobal(payload, { id: symbol, name: symbol, kind: 'stock' })
      setQuotes(quote ? [quote] : [])
      if (!quote) setStatus('No quote returned for that symbol (or API not configured).')
    } catch (caught) {
      setQuotes([])
      setStatus(caught instanceof Error ? caught.message : 'Quote unavailable')
    } finally {
      setLoading(false)
    }
  }

  const loadMarkets = async () => {
    setLoading(true)
    setStatus(null)
    const out: MarketQuote[] = []
    const errors: string[] = []
    for (const def of MARKET_INDEX_DEFS.slice(0, 4)) {
      try {
        const payload = await financeProxy('quote', { symbol: def.symbol })
        const quote = quoteFromAlphaGlobal(payload, { id: def.id, name: def.name, kind: 'index' })
        if (quote) out.push(quote)
        else errors.push(`${def.name}: empty`)
      } catch (caught) {
        errors.push(`${def.name}: ${caught instanceof Error ? caught.message : 'failed'}`)
        break
      }
    }
    setQuotes(out)
    setMarketsLoaded(true)
    setStatus(
      errors[0] ??
        (out.length
          ? null
          : 'No market quotes returned. Indices need ALPHA_VANTAGE_API_KEY; free-tier symbols are limited and may be unsupported.'),
    )
    setLoading(false)
  }

  useEffect(() => {
    // Load markets once per panel session to conserve the Alpha Vantage free quota.
    if (section === 'markets' && !marketsLoaded && !loading) void loadMarkets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, marketsLoaded, loading])

  const addWatch = (kind: 'index' | 'stock' | 'currency' | 'commodity', symbolValue: string, name: string) => {
    const id = `${kind}:${symbolValue}`
    if (prefs.business.watchlist.some((entry) => entry.id === id)) return
    persist({
      ...prefs,
      business: {
        ...prefs.business,
        watchlist: [...prefs.business.watchlist, { id, kind, symbol: symbolValue, name }],
      },
    })
  }

  return (
    <div className="info-panel">
      <p className="info-panel-meta" role="status">
        {BUSINESS_DISCLAIMER}
        {status ? ` · ${status}` : ''}
      </p>
      <div className="tabs" role="tablist" aria-label="Business sections">
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={section === entry.id}
            className={section === entry.id ? 'tab is-on' : 'tab'}
            onKeyDown={keepKey}
            onClick={() => {
              setSection(entry.id)
              if (entry.id === 'markets' || entry.id === 'currencies' || entry.id === 'watchlist') {
                persist({ ...prefs, business: { ...prefs.business, defaultView: entry.id } })
              }
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {section === 'currencies' ? (
        <>
          <div className="tabs" role="tablist" aria-label="Base currency">
            {MAJOR_CURRENCIES.map((code) => (
              <button
                key={code}
                type="button"
                className={prefs.business.baseCurrency === code ? 'tab is-on' : 'tab'}
                onKeyDown={keepKey}
                onClick={() => persist({ ...prefs, business: { ...prefs.business, baseCurrency: code } })}
              >
                {code}
              </button>
            ))}
          </div>
          {loading ? (
            <p className="options-note">Loading rates…</p>
          ) : (
            <ul className="info-list">
              {pairs.map((pair) => (
                <li key={`${pair.base}-${pair.quote}`} className="info-item info-league-row">
                  <span className="info-item-title">
                    1 {pair.base} = {pair.rate} {pair.quote}
                  </span>
                  <span className="info-item-meta">
                    {pair.date} · delayed daily reference · {pair.provider}
                  </span>
                  <button type="button" className="tab" onKeyDown={keepKey} onClick={() => addWatch('currency', `${pair.base}/${pair.quote}`, `${pair.base}/${pair.quote}`)}>
                    Watch
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : section === 'stocks' ? (
        <>
          <div className="info-weather-search-row">
            <input className="info-weather-input" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="Ticker" />
            <button type="button" className="tab" onKeyDown={keepKey} onClick={() => void loadStock()}>
              Quote
            </button>
          </div>
          {loading ? <p className="options-note">Loading…</p> : null}
          <ul className="info-list">
            {quotes.map((quote) => (
              <li key={quote.id} className="info-item">
                <span className="info-item-title">
                  {quote.name} ({quote.symbol})
                </span>
                <span className="info-item-meta">
                  {formatQuote(quote)} · {quote.delayed ? 'Delayed' : 'Live'} · {quote.updatedIso ?? 'time unknown'} · {quote.provider}
                </span>
                <button type="button" className="tab" onKeyDown={keepKey} onClick={() => addWatch('stock', quote.symbol, quote.name)}>
                  Watch
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : section === 'commodities' ? (
        <ul className="info-list">
          {COMMODITY_DEFS.map((entry) => (
            <li key={entry.id} className="info-item">
              <span className="info-item-title">{entry.name}</span>
              <span className="info-item-meta">
                Symbol {entry.symbol} · requires Alpha Vantage commodity entitlement · not shown without a verified quote
              </span>
              <button type="button" className="tab" onKeyDown={keepKey} onClick={() => addWatch('commodity', entry.symbol, entry.name)}>
                Watch
              </button>
            </li>
          ))}
        </ul>
      ) : section === 'news' ? (
        news.length === 0 ? (
          <p className="options-note">No business headlines in the current news snapshot.</p>
        ) : (
          <ul className="info-list">
            {news.slice(0, 20).map((item) => (
              <li key={item.id} className="info-item">
                <a className="info-item-title" href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.title}
                </a>
                <span className="info-item-meta">{item.publisher}</span>
              </li>
            ))}
          </ul>
        )
      ) : section === 'watchlist' ? (
        prefs.business.watchlist.length === 0 ? (
          <p className="options-note">Business watchlist is empty.</p>
        ) : (
          <ul className="info-list">
            {prefs.business.watchlist.map((entry, index) => (
              <li key={entry.id} className="info-item info-league-row">
                <span className="info-item-title">
                  {entry.name} · {entry.kind}
                </span>
                <div className="info-weather-search-row">
                  <button
                    type="button"
                    className="tab"
                    onKeyDown={keepKey}
                    onClick={() => {
                      const list = [...prefs.business.watchlist]
                      if (index <= 0) return
                      ;[list[index - 1], list[index]] = [list[index], list[index - 1]]
                      persist({ ...prefs, business: { ...prefs.business, watchlist: list } })
                    }}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    className="tab"
                    onKeyDown={keepKey}
                    onClick={() =>
                      persist({
                        ...prefs,
                        business: { ...prefs.business, watchlist: prefs.business.watchlist.filter((row) => row.id !== entry.id) },
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : loading ? (
        <p className="options-note">Loading markets…</p>
      ) : quotes.length === 0 ? (
        <p className="options-note">{status ?? 'No market quotes. Indices need ALPHA_VANTAGE_API_KEY; only symbols that return data are shown.'}</p>
      ) : (
        <ul className="info-list">
          {quotes.map((quote) => (
            <li key={quote.id} className="info-item">
              <span className="info-item-title">{quote.name}</span>
              <span className="info-item-meta">
                {formatQuote(quote)} · {quote.delayed ? 'Delayed' : 'Live'} · {quote.updatedIso ?? 'time unknown'} · {quote.provider}
              </span>
              <button type="button" className="tab" onKeyDown={keepKey} onClick={() => addWatch('index', quote.symbol, quote.name)}>
                Watch
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="info-panel-meta">Prioritised indices without provider data are omitted — never fabricated.</p>
    </div>
  )
}
