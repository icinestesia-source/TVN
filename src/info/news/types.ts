/** Normalised news snapshot published for INFO → News. */

export type NewsCategory =
  | 'top'
  | 'uk'
  | 'world'
  | 'europe'
  | 'technology'
  | 'science'
  | 'business'
  | 'culture'
  | 'entertainment'
  | 'local'

export interface NewsItem {
  id: string
  title: string
  publisher: string
  publishedAt: string | null
  description: string | null
  category: NewsCategory
  url: string
  sourceId: string
}

export interface NewsSnapshot {
  format: 'tvn-info-news-v1'
  updatedIso: string
  staleAfterMinutes: number
  items: NewsItem[]
  sources: { id: string; publisher: string; category: NewsCategory; feedUrl: string }[]
  errors?: string[]
}

/** Visible category tabs, in order. Empty categories are hidden in the UI. */
export const NEWS_CATEGORIES: { id: NewsCategory; label: string }[] = [
  { id: 'top', label: 'Top stories' },
  { id: 'uk', label: 'UK' },
  { id: 'world', label: 'World' },
  { id: 'europe', label: 'Europe' },
  { id: 'technology', label: 'Technology' },
  { id: 'science', label: 'Science' },
  { id: 'business', label: 'Business' },
  { id: 'culture', label: 'Culture' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'local', label: 'Local' },
]

export const NEWS_SNAPSHOT_URL = '/info/news.json'
export const NEWS_STALE_MINUTES = 120
export const NEWS_TOP_LIMIT = 12
export const NEWS_CATEGORY_LIMIT = 6
export const NEWS_EXPANDED_LIMIT = 24
