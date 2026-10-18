import { useEffect, useMemo, useState } from 'react'
import { loadNewsSnapshot, type NewsLoadState } from '../../info/news/load.ts'
import { expandedLimitFor, initialLimitFor, populatedCategories, selectHeadlines } from '../../info/news/select.ts'
import { NEWS_CATEGORIES, type NewsCategory, type NewsItem } from '../../info/news/types.ts'
import { keepKey } from '../keep-key.ts'

function formatWhen(iso: string | null): string {
  if (!iso) return 'Time unknown'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return 'Time unknown'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ms)
}

function HeadlineList({ items }: { items: readonly NewsItem[] }) {
  return (
    <ul className="info-list">
      {items.map((item) => (
        <li key={item.id} className="info-item">
          <a className="info-item-title" href={item.url} target="_blank" rel="noopener noreferrer">
            {item.title}
          </a>
          {item.description ? <p className="info-item-desc">{item.description}</p> : null}
          <span className="info-item-meta">
            {item.publisher} · {formatWhen(item.publishedAt)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * INFO → News: headlines from the published snapshot. Failures stay inside this panel.
 */
export function NewsPanel() {
  const [state, setState] = useState<NewsLoadState>({ status: 'loading' })
  const [category, setCategory] = useState<NewsCategory>('top')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let live = true
    void loadNewsSnapshot().then((next) => {
      if (live) setState(next)
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    setExpanded(false)
  }, [category])

  const ready = state.status === 'ready' ? state : null
  const categories = useMemo(() => {
    if (!ready) return []
    const present = new Set(populatedCategories(ready.snapshot.items))
    return NEWS_CATEGORIES.filter((entry) => present.has(entry.id))
  }, [ready])

  useEffect(() => {
    if (!categories.length) return
    if (!categories.some((entry) => entry.id === category)) {
      setCategory(categories[0].id)
    }
  }, [categories, category])

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
  const pool = snapshot.items.filter((item) => item.category === category)
  const limit = expanded ? expandedLimitFor(category) : initialLimitFor(category)
  const items = selectHeadlines(pool, { limit })
  const canExpand = pool.length > initialLimitFor(category)

  return (
    <div className="info-panel">
      <p className={stale || fromCache ? 'info-panel-meta is-stale' : 'info-panel-meta'} role="status">
        Updated {formatWhen(snapshot.updatedIso)}
        {stale ? ' · stale' : ''}
        {fromCache ? ' · last good copy' : ''}
        {snapshot.errors?.length ? ` · ${snapshot.errors.length} feed ${snapshot.errors.length === 1 ? 'warning' : 'warnings'}` : ''}
      </p>
      <div className="tabs" role="tablist" aria-label="News categories">
        {categories.map((entry) => (
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
        <>
          <HeadlineList items={items} />
          {canExpand ? (
            <button
              type="button"
              className="tab info-more-stories"
              onKeyDown={keepKey}
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded ? 'Show fewer' : 'More stories'}
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}
