import { useEffect, useMemo, useState } from 'react'
import { filterHistory, fetchOnThisDay, localMonthDay } from '../../info/history/wikimedia.ts'
import { HISTORY_ATTRIBUTION, HISTORY_CATEGORIES, type HistoryCategory, type HistoryEvent } from '../../info/history/types.ts'
import { defaultInfoPreferences, loadInfoPreferences, saveInfoPreferences, type InfoPreferences } from '../../info/preferences.ts'
import { keepKey } from '../keep-key.ts'

export function OnThisDayPanel({ entertainmentOnly = false }: { entertainmentOnly?: boolean }) {
  const [prefs, setPrefs] = useState<InfoPreferences>(() => {
    try {
      return loadInfoPreferences()
    } catch {
      return defaultInfoPreferences()
    }
  })
  const today = localMonthDay()
  const [month, setMonth] = useState(prefs.history.lastMonth ?? today.month)
  const [day, setDay] = useState(prefs.history.lastDay ?? today.day)
  const [events, setEvents] = useState<HistoryEvent[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [category, setCategory] = useState<HistoryCategory | 'all'>('all')

  useEffect(() => {
    let live = true
    setStatus('loading')
    void fetchOnThisDay(month, day)
      .then((list) => {
        if (!live) return
        setEvents(list)
        setStatus('ready')
        setMessage(null)
        const next = loadInfoPreferences()
        saveInfoPreferences({ ...next, history: { ...next.history, lastMonth: month, lastDay: day } })
        setPrefs(loadInfoPreferences())
      })
      .catch((caught) => {
        if (!live) return
        setStatus('error')
        setMessage(caught instanceof Error ? caught.message : 'Historical data unavailable')
      })
    return () => {
      live = false
    }
  }, [month, day, entertainmentOnly])

  const shiftDay = (delta: number) => {
    const date = new Date(2000, month - 1, day)
    date.setDate(date.getDate() + delta)
    setMonth(date.getMonth() + 1)
    setDay(date.getDate())
  }

  const visible = useMemo(() => {
    const preferred = prefs.history.preferredCategories
    const base = filterHistory(events, {
      entertainmentOnly,
      categories: category === 'all' ? preferred : [category],
    })
    return base
  }, [events, category, entertainmentOnly, prefs.history.preferredCategories])

  const categories = entertainmentOnly
    ? HISTORY_CATEGORIES.filter((entry) => ['film-television', 'music', 'broadcasting'].includes(entry.id))
    : HISTORY_CATEGORIES.filter((entry) => prefs.history.preferredCategories.includes(entry.id) || entry.id === category)

  return (
    <div className="info-panel">
      <p className={message ? 'info-panel-meta is-stale' : 'info-panel-meta'} role="status">
        {String(day).padStart(2, '0')}/{String(month).padStart(2, '0')} · {HISTORY_ATTRIBUTION}
        {message ? ` · ${message}` : ''}
      </p>
      <div className="info-weather-search-row">
        <button type="button" className="tab" onKeyDown={keepKey} onClick={() => shiftDay(-1)}>
          Previous day
        </button>
        <button
          type="button"
          className="tab"
          onKeyDown={keepKey}
          onClick={() => {
            setMonth(today.month)
            setDay(today.day)
          }}
        >
          Today
        </button>
        <button type="button" className="tab" onKeyDown={keepKey} onClick={() => shiftDay(1)}>
          Next day
        </button>
        <label className="info-item-meta" htmlFor="otd-date">
          Date
        </label>
        <input
          id="otd-date"
          className="info-weather-input"
          type="date"
          value={`2000-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`}
          onChange={(event) => {
            const value = event.target.value
            if (!value) return
            const [, m, d] = value.split('-').map(Number)
            if (m && d) {
              setMonth(m)
              setDay(d)
            }
          }}
        />
      </div>
      <div className="tabs" role="tablist" aria-label="History categories">
        <button type="button" role="tab" className={category === 'all' ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={() => setCategory('all')}>
          All
        </button>
        {categories.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            className={category === entry.id ? 'tab is-on' : 'tab'}
            onKeyDown={keepKey}
            onClick={() => setCategory(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {status === 'loading' ? (
        <p className="options-note">Loading events…</p>
      ) : status === 'error' ? (
        <p className="options-note" role="status">
          {message}
        </p>
      ) : visible.length === 0 ? (
        <p className="options-note">No events in this selection.</p>
      ) : (
        <ul className="info-list">
          {visible.map((event) => (
            <li key={event.id} className="info-item">
              <span className="info-item-title">
                {event.year} · {event.title}
              </span>
              {event.description !== event.title ? <p className="info-item-desc">{event.description}</p> : null}
              <span className="info-item-meta">
                {HISTORY_CATEGORIES.find((entry) => entry.id === event.category)?.label ?? event.category}
                {event.uncertain ? ' · date uncertain' : ''}
                {event.url ? (
                  <>
                    {' · '}
                    <a href={event.url} target="_blank" rel="noopener noreferrer">
                      Source
                    </a>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
