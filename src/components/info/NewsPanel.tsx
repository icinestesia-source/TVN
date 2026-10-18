import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { customFeedId, loadCustomFeedItems, previewCustomFeed, validateCustomFeedUrl } from '../../info/news/custom-feeds.ts'
import { NEWS_FEEDS } from '../../info/news/feeds.ts'
import { loadNewsSnapshot, type NewsLoadState } from '../../info/news/load.ts'
import { mergeCustomItems, selectPersonalized, visibleNewsCategories } from '../../info/news/personalize.ts'
import { populatedCategories } from '../../info/news/select.ts'
import { NEWS_CATEGORIES, type NewsCategory, type NewsItem } from '../../info/news/types.ts'
import { defaultInfoPreferences, loadInfoPreferences, saveInfoPreferences, type InfoPreferences } from '../../info/preferences.ts'
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
        <li key={`${item.sourceId}-${item.id}`} className="info-item">
          <a className="info-item-title" href={item.url} target="_blank" rel="noopener noreferrer">
            {item.title}
          </a>
          {item.description ? <p className="info-item-desc">{item.description}</p> : null}
          <span className="info-item-meta">
            {item.publisher}
            {item.sourceId.startsWith('custom:') ? ' · your source' : ''}
            {' · '}
            {formatWhen(item.publishedAt)}
          </span>
        </li>
      ))}
    </ul>
  )
}

const PUBLISHERS = [...new Set(NEWS_FEEDS.map((feed) => feed.publisher))]

/**
 * INFO → News: central snapshot + viewer preferences and optional custom feeds.
 */
export function NewsPanel() {
  const [state, setState] = useState<NewsLoadState>({ status: 'loading' })
  const [prefs, setPrefs] = useState<InfoPreferences>(() => {
    try {
      return loadInfoPreferences()
    } catch {
      return defaultInfoPreferences()
    }
  })
  const [mode, setMode] = useState<'stories' | 'sources'>('stories')
  const [category, setCategory] = useState<NewsCategory>('top')
  const [expanded, setExpanded] = useState(false)
  const [customItems, setCustomItems] = useState<NewsItem[]>([])
  const [feedUrl, setFeedUrl] = useState('')
  const [feedCategory, setFeedCategory] = useState<NewsCategory>('top')
  const [previewNote, setPreviewNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    let live = true
    void Promise.all(prefs.news.customFeeds.map((feed) => loadCustomFeedItems(feed))).then((lists) => {
      if (live) setCustomItems(lists.flat())
    })
    return () => {
      live = false
    }
  }, [prefs.news.customFeeds])

  useEffect(() => {
    setExpanded(false)
  }, [category])

  const persist = (next: InfoPreferences) => {
    saveInfoPreferences(next)
    setPrefs(next)
  }

  const ready = state.status === 'ready' ? state : null
  const allItems = useMemo(() => {
    if (!ready) return customItems
    return mergeCustomItems(ready.snapshot.items, customItems)
  }, [ready, customItems])

  const categories = useMemo(() => {
    const present = new Set(populatedCategories(allItems))
    return visibleNewsCategories(prefs, present)
  }, [allItems, prefs])

  useEffect(() => {
    if (!categories.length) return
    if (!categories.includes(category)) setCategory(categories[0])
  }, [categories, category])

  if (state.status === 'loading' && !customItems.length) {
    return (
      <div className="info-panel">
        <p className="options-note">Loading news…</p>
      </div>
    )
  }

  if (state.status === 'unavailable' && !customItems.length) {
    return (
      <div className="info-panel">
        <p className="options-note" role="status">
          {state.message}
        </p>
      </div>
    )
  }

  const items = selectPersonalized(allItems, prefs, category, expanded)
  const poolCount = allItems.filter((item) => item.category === category).length

  const movePublisher = (publisher: string, dir: -1 | 1) => {
    const order = [...prefs.news.publisherOrder]
    const index = order.indexOf(publisher)
    if (index < 0) return
    const next = index + dir
    if (next < 0 || next >= order.length) return
    ;[order[index], order[next]] = [order[next], order[index]]
    persist({ ...prefs, news: { ...prefs.news, publisherOrder: order } })
  }

  const togglePublisher = (publisher: string) => {
    const enabled = new Set(prefs.news.enabledPublisherIds)
    if (enabled.has(publisher)) enabled.delete(publisher)
    else enabled.add(publisher)
    persist({ ...prefs, news: { ...prefs.news, enabledPublisherIds: [...enabled] } })
  }

  const moveCategory = (id: NewsCategory, dir: -1 | 1) => {
    const order = [...prefs.news.categoryOrder]
    const index = order.indexOf(id)
    if (index < 0) return
    const next = index + dir
    if (next < 0 || next >= order.length) return
    ;[order[index], order[next]] = [order[next], order[index]]
    persist({ ...prefs, news: { ...prefs.news, categoryOrder: order } })
  }

  const toggleCategoryHidden = (id: NewsCategory) => {
    const hidden = new Set(prefs.news.hiddenCategories)
    if (hidden.has(id)) hidden.delete(id)
    else hidden.add(id)
    persist({ ...prefs, news: { ...prefs.news, hiddenCategories: [...hidden] } })
  }

  const onAddFeed = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setPreviewNote(null)
    const checked = validateCustomFeedUrl(feedUrl)
    if (!checked.ok) {
      setPreviewNote(checked.error)
      setBusy(false)
      return
    }
    const result = await previewCustomFeed(feedUrl, feedCategory)
    if (!result.ok) {
      setPreviewNote(result.error)
      setBusy(false)
      return
    }
    const id = customFeedId(result.feed.feedUrl)
    const customFeeds = [
      ...prefs.news.customFeeds.filter((feed) => feed.id !== id),
      { ...result.feed, id, enabled: true, addedIso: new Date().toISOString() },
    ]
    persist({ ...prefs, news: { ...prefs.news, customFeeds } })
    setFeedUrl('')
    setPreviewNote(`Saved ${result.preview.title} (${result.preview.items.length} sample headlines).`)
    setBusy(false)
  }

  return (
    <div className="info-panel">
      {ready ? (
        <p className={ready.stale || ready.fromCache ? 'info-panel-meta is-stale' : 'info-panel-meta'} role="status">
          Updated {formatWhen(ready.snapshot.updatedIso)}
          {ready.stale ? ' · stale' : ''}
          {ready.fromCache ? ' · last good copy' : ''}
          {ready.snapshot.errors?.length ? ` · ${ready.snapshot.errors.length} feed warnings` : ''}
        </p>
      ) : (
        <p className="info-panel-meta is-stale">Central news unavailable · custom sources only</p>
      )}
      <div className="tabs" role="tablist" aria-label="News mode">
        <button type="button" role="tab" className={mode === 'stories' ? 'tab is-on' : 'tab'} aria-selected={mode === 'stories'} onKeyDown={keepKey} onClick={() => setMode('stories')}>
          Stories
        </button>
        <button type="button" role="tab" className={mode === 'sources' ? 'tab is-on' : 'tab'} aria-selected={mode === 'sources'} onKeyDown={keepKey} onClick={() => setMode('sources')}>
          Sources
        </button>
      </div>

      {mode === 'sources' ? (
        <div className="info-news-sources">
          <p className="info-item-meta">Publishers</p>
          <ul className="info-list">
            {PUBLISHERS.map((publisher) => (
              <li key={publisher} className="info-item info-league-row">
                <span className="info-item-title">{publisher}</span>
                <div className="info-weather-search-row">
                  <button type="button" className="tab" onKeyDown={keepKey} onClick={() => togglePublisher(publisher)}>
                    {prefs.news.enabledPublisherIds.includes(publisher) ? 'On' : 'Off'}
                  </button>
                  <button type="button" className="tab" onKeyDown={keepKey} onClick={() => movePublisher(publisher, -1)}>
                    Up
                  </button>
                  <button type="button" className="tab" onKeyDown={keepKey} onClick={() => movePublisher(publisher, 1)}>
                    Down
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="info-item-meta">Categories</p>
          <ul className="info-list">
            {NEWS_CATEGORIES.map((entry) => (
              <li key={entry.id} className="info-item info-league-row">
                <span className="info-item-title">{entry.label}</span>
                <div className="info-weather-search-row">
                  <button type="button" className="tab" onKeyDown={keepKey} onClick={() => toggleCategoryHidden(entry.id)}>
                    {prefs.news.hiddenCategories.includes(entry.id) ? 'Hidden' : 'Shown'}
                  </button>
                  <button type="button" className="tab" onKeyDown={keepKey} onClick={() => moveCategory(entry.id, -1)}>
                    Up
                  </button>
                  <button type="button" className="tab" onKeyDown={keepKey} onClick={() => moveCategory(entry.id, 1)}>
                    Down
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="info-item-meta">Your RSS / Atom feeds</p>
          <form className="info-weather-search" onSubmit={onAddFeed}>
            <input className="info-weather-input" value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} placeholder="https://example.com/feed.xml" />
            <select className="info-weather-input" value={feedCategory} onChange={(event) => setFeedCategory(event.target.value as NewsCategory)}>
              {NEWS_CATEGORIES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <button type="submit" className="tab" disabled={busy} onKeyDown={keepKey}>
              {busy ? 'Checking…' : 'Validate & save'}
            </button>
          </form>
          {previewNote ? <p className="options-note">{previewNote}</p> : null}
          <ul className="info-list">
            {prefs.news.customFeeds.map((feed) => (
              <li key={feed.id} className="info-item info-league-row">
                <span className="info-item-title">
                  {feed.title} · your source
                </span>
                <span className="info-item-meta">{feed.feedUrl}</span>
                <div className="info-weather-search-row">
                  <button
                    type="button"
                    className="tab"
                    onKeyDown={keepKey}
                    onClick={() =>
                      persist({
                        ...prefs,
                        news: {
                          ...prefs.news,
                          customFeeds: prefs.news.customFeeds.map((entry) => (entry.id === feed.id ? { ...entry, enabled: !entry.enabled } : entry)),
                        },
                      })
                    }
                  >
                    {feed.enabled ? 'On' : 'Off'}
                  </button>
                  <button
                    type="button"
                    className="tab"
                    onKeyDown={keepKey}
                    onClick={() =>
                      persist({
                        ...prefs,
                        news: { ...prefs.news, customFeeds: prefs.news.customFeeds.filter((entry) => entry.id !== feed.id) },
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="tab"
            onKeyDown={keepKey}
            onClick={() => persist({ ...prefs, news: defaultInfoPreferences().news })}
          >
            Restore news defaults
          </button>
        </div>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="News categories">
            {categories.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={category === id}
                className={category === id ? 'tab is-on' : 'tab'}
                onKeyDown={keepKey}
                onClick={() => setCategory(id)}
              >
                {NEWS_CATEGORIES.find((entry) => entry.id === id)?.label ?? id}
              </button>
            ))}
          </div>
          {items.length === 0 ? (
            <p className="options-note">No headlines in this category for your enabled sources.</p>
          ) : (
            <>
              <HeadlineList items={items} />
              {poolCount > items.length || expanded ? (
                <button type="button" className="tab info-more-stories" onKeyDown={keepKey} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
                  {expanded ? 'Show fewer' : 'More stories'}
                </button>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  )
}
