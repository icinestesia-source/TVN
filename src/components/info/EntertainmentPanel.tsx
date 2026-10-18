import { useEffect, useState } from 'react'
import { matchTitleToTvn } from '../../info/entertainment/match-tvn.ts'
import {
  discoverByMood,
  loadPopularFilms,
  loadPopularTv,
  loadTrending,
  searchTitles,
  TMDB_ATTRIBUTION,
} from '../../info/entertainment/tmdb.ts'
import { DISCOVERY_MOODS, type DiscoveryMood, type EntertainmentTitle, type WatchlistEntry } from '../../info/entertainment/types.ts'
import { loadNewsSnapshot } from '../../info/news/load.ts'
import type { NewsItem } from '../../info/news/types.ts'
import { defaultInfoPreferences, loadInfoPreferences, saveInfoPreferences, type InfoPreferences } from '../../info/preferences.ts'
import { keepKey } from '../keep-key.ts'
import { OnThisDayPanel } from './OnThisDayPanel.tsx'

type Section = 'discover' | 'popular' | 'films' | 'television' | 'news' | 'on-this-day' | 'watchlist'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'discover', label: 'Discover' },
  { id: 'popular', label: 'Popular' },
  { id: 'films', label: 'Films' },
  { id: 'television', label: 'Television' },
  { id: 'news', label: 'News' },
  { id: 'on-this-day', label: 'On this day' },
  { id: 'watchlist', label: 'Watchlist' },
]

function TitleCard({
  title,
  onWatchlist,
  inList,
}: {
  title: EntertainmentTitle
  onWatchlist: () => void
  inList: boolean
}) {
  const match = matchTitleToTvn(title)
  return (
    <li className="info-item">
      <span className="info-item-title">
        {title.title}
        {title.year ? ` (${title.year})` : ''}
      </span>
      {title.overview ? <p className="info-item-desc">{title.overview.slice(0, 220)}</p> : null}
      <span className="info-item-meta">
        {title.kind} · {title.genres.slice(0, 3).join(', ') || 'Genre unknown'}
        {title.rating != null ? ` · ★ ${title.rating.toFixed(1)}` : ''}
        {title.runtimeMinutes != null ? ` · ${title.runtimeMinutes} min` : ''}
        {title.cast.length ? ` · ${title.cast.slice(0, 3).join(', ')}` : ''}
      </span>
      <div className="info-weather-search-row">
        <button type="button" className="tab" onKeyDown={keepKey} onClick={onWatchlist}>
          {inList ? 'On watchlist' : 'Add to watchlist'}
        </button>
        {title.trailerUrl ? (
          <a className="tab" href={title.trailerUrl} target="_blank" rel="noopener noreferrer">
            Trailer
          </a>
        ) : null}
        {match ? (
          <span className="info-item-meta">
            Watch on TVN · ch {match.channelNumber} {match.channelName}
          </span>
        ) : null}
      </div>
    </li>
  )
}

export function EntertainmentPanel() {
  const [prefs, setPrefs] = useState<InfoPreferences>(() => {
    try {
      return loadInfoPreferences()
    } catch {
      return defaultInfoPreferences()
    }
  })
  const [section, setSection] = useState<Section>('discover')
  const [mood, setMood] = useState<DiscoveryMood>('comedy')
  const [titles, setTitles] = useState<EntertainmentTitle[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const persist = (next: InfoPreferences) => {
    saveInfoPreferences(next)
    setPrefs(next)
  }

  const load = async (loader: () => Promise<EntertainmentTitle[]>) => {
    setLoading(true)
    setStatus(null)
    try {
      setTitles(await loader())
    } catch (caught) {
      setTitles([])
      setStatus(caught instanceof Error ? caught.message : 'Entertainment unavailable')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (section === 'popular' || section === 'films') void load(loadPopularFilms)
    if (section === 'television') void load(loadPopularTv)
    if (section === 'discover') void load(() => discoverByMood(mood))
    if (section === 'news') {
      void loadNewsSnapshot().then((state) => {
        if (state.status === 'ready') {
          setNews(state.snapshot.items.filter((item) => item.category === 'entertainment' || item.category === 'culture'))
        }
      })
    }
  }, [section, mood])

  const addWatch = (title: EntertainmentTitle) => {
    if (prefs.entertainment.watchlist.some((entry) => entry.id === title.id)) return
    const entry: WatchlistEntry = {
      id: title.id,
      kind: title.kind,
      title: title.title,
      year: title.year,
      posterUrl: title.posterUrl,
      providerId: title.providerId,
      favourite: false,
      watched: false,
      addedIso: new Date().toISOString(),
    }
    persist({ ...prefs, entertainment: { ...prefs.entertainment, watchlist: [...prefs.entertainment.watchlist, entry] } })
  }

  return (
    <div className="info-panel">
      <p className="info-panel-meta" role="status">
        {TMDB_ATTRIBUTION}
        {status ? ` · ${status}` : ''}
      </p>
      <div className="tabs" role="tablist" aria-label="Entertainment sections">
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={section === entry.id}
            className={section === entry.id ? 'tab is-on' : 'tab'}
            onKeyDown={keepKey}
            onClick={() => setSection(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {section === 'on-this-day' ? (
        <OnThisDayPanel entertainmentOnly />
      ) : section === 'watchlist' ? (
        prefs.entertainment.watchlist.length === 0 ? (
          <p className="options-note">Watchlist is empty.</p>
        ) : (
          <ul className="info-list">
            {prefs.entertainment.watchlist.map((entry) => (
              <li key={entry.id} className="info-item info-league-row">
                <span className="info-item-title">
                  {entry.title}
                  {entry.year ? ` (${entry.year})` : ''} · {entry.kind}
                  {entry.watched ? ' · watched' : ''}
                  {entry.favourite ? ' · favourite' : ''}
                </span>
                <div className="info-weather-search-row">
                  <button
                    type="button"
                    className="tab"
                    onKeyDown={keepKey}
                    onClick={() =>
                      persist({
                        ...prefs,
                        entertainment: {
                          ...prefs.entertainment,
                          watchlist: prefs.entertainment.watchlist.map((row) => (row.id === entry.id ? { ...row, watched: !row.watched } : row)),
                        },
                      })
                    }
                  >
                    Watched
                  </button>
                  <button
                    type="button"
                    className="tab"
                    onKeyDown={keepKey}
                    onClick={() =>
                      persist({
                        ...prefs,
                        entertainment: {
                          ...prefs.entertainment,
                          watchlist: prefs.entertainment.watchlist.map((row) => (row.id === entry.id ? { ...row, favourite: !row.favourite } : row)),
                        },
                      })
                    }
                  >
                    Favourite
                  </button>
                  <button
                    type="button"
                    className="tab"
                    onKeyDown={keepKey}
                    onClick={() =>
                      persist({
                        ...prefs,
                        entertainment: {
                          ...prefs.entertainment,
                          watchlist: prefs.entertainment.watchlist.filter((row) => row.id !== entry.id),
                        },
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
      ) : section === 'news' ? (
        news.length === 0 ? (
          <p className="options-note">No entertainment headlines in the current news snapshot.</p>
        ) : (
          <ul className="info-list">
            {news.slice(0, 20).map((item) => (
              <li key={item.id} className="info-item">
                <a className="info-item-title" href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.title}
                </a>
                <span className="info-item-meta">
                  {item.publisher} · {item.category}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          {section === 'discover' ? (
            <div className="tabs" role="tablist" aria-label="What should I watch">
              {DISCOVERY_MOODS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  className={mood === entry.id ? 'tab is-on' : 'tab'}
                  onKeyDown={keepKey}
                  onClick={() => setMood(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          ) : null}
          {section === 'popular' ? (
            <div className="info-weather-search-row">
              <button type="button" className="tab" onKeyDown={keepKey} onClick={() => void load(loadTrending)}>
                Trending
              </button>
              <button type="button" className="tab" onKeyDown={keepKey} onClick={() => void load(loadPopularFilms)}>
                New / popular films
              </button>
              <input
                className="info-weather-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search titles"
              />
              <button type="button" className="tab" onKeyDown={keepKey} onClick={() => void load(() => searchTitles(query))}>
                Search
              </button>
            </div>
          ) : null}
          {loading ? (
            <p className="options-note">Loading titles…</p>
          ) : titles.length === 0 ? (
            <p className="options-note">{status ?? 'No titles to show. Configure TMDB_API_TOKEN on the server to load live catalogues.'}</p>
          ) : (
            <ul className="info-list">
              {titles.map((title) => (
                <TitleCard
                  key={title.id}
                  title={title}
                  inList={prefs.entertainment.watchlist.some((entry) => entry.id === title.id)}
                  onWatchlist={() => addWatch(title)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
