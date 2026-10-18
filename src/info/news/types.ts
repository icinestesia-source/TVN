/** Normalised news snapshot published for INFO → News. */

export type NewsCategory = 'uk' | 'world' | 'technology' | 'culture' | 'entertainment' | 'business' | 'science'

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

export const NEWS_CATEGORIES: { id: NewsCategory; label: string }[] = [
  { id: 'uk', label: 'UK' },
  { id: 'world', label: 'World' },
  { id: 'technology', label: 'Technology' },
  { id: 'culture', label: 'Culture' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'business', label: 'Business' },
  { id: 'science', label: 'Science' },
]

export const NEWS_SNAPSHOT_URL = '/info/news.json'
export const NEWS_STALE_MINUTES = 120
