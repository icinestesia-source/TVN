import { useEffect, useState } from 'react'
import { loadNewsSnapshot, type NewsLoadState } from '../../info/news/load.ts'
import { NEWS_CATEGORIES, type NewsCategory } from '../../info/news/types.ts'
import { keepKey } from '../keep-key.ts'

function formatWhen(iso: string | null): string {
  if (!iso) return 'Time unknown'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return 'Time unknown'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ms)
}

/**
 * INFO → News: headlines from the published snapshot. Failures stay inside this panel.
 */
export function NewsPanel() {
  const [state, setState] = useState<NewsLoadState>({ status: 'loading' })
  const [category, setCategory] = useState<NewsCategory | 'all'>('all')

  useEffect(() => {
    let live = true
    void loadNewsSnapshot().then((next) => {
      if (live) setState(next)
    })
    return () => {
      live = false
    }
  }, [])

  if (state.status === 'loading') {
    return (
      <div className="info-panel">
        <p className="options-note">Loading news…</p>
      </div>
    )
  }

  if (state.status === 'unavailable') {
    return (
      <div className="info-panel">
        <p className="options-note" role="status">
          {state.message}
        </p>
      </div>
    )
  }

  const { snapshot, stale, fromCache } = state
  const items = category === 'all' ? snapshot.items : snapshot.items.filter((item) => item.category === category)

  return (
    <div className="info-panel">
      <p className={stale || fromCache ? 'info-panel-meta is-stale' : 'info-panel-meta'} role="status">
        Updated {formatWhen(snapshot.updatedIso)}
        {stale ? ' · stale' : ''}
        {fromCache ? ' · last good copy' : ''}
        {snapshot.errors?.length ? ` · ${snapshot.errors.length} feed ${snapshot.errors.length === 1 ? 'warning' : 'warnings'}` : ''}
      </p>
      <div className="tabs" role="tablist" aria-label="News categories">
        <button type="button" role="tab" aria-selected={category === 'all'} className={category === 'all' ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={() => setCategory('all')}>
          All
        </button>
        {NEWS_CATEGORIES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={category === entry.id}
            className={category === entry.id ? 'tab is-on' : 'tab'}
            onKeyDown={keepKey}
            onClick={() => setCategory(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="options-note">No headlines in this category.</p>
      ) : (
        <ul className="info-list">
          {items.map((item) => (
            <li key={item.id} className="info-item">
              <a className="info-item-title" href={item.url} target="_blank" rel="noopener noreferrer">
                {item.title}
              </a>
              {item.description ? <p className="info-item-desc">{item.description}</p> : null}
              <span className="info-item-meta">
                {item.publisher} · {NEWS_CATEGORIES.find((entry) => entry.id === item.category)?.label ?? item.category} · {formatWhen(item.publishedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
