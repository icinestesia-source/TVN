import type { InfoPreferences } from '../preferences.ts'
import { selectHeadlines } from './select.ts'
import type { NewsCategory, NewsItem } from './types.ts'
import {
  NEWS_CATEGORY_LIMIT,
  NEWS_EXPANDED_LIMIT,
  NEWS_TOP_LIMIT,
  NEWS_TOP_PER_PUBLISHER,
  NEWS_TOP_PER_PUBLISHER_EXPANDED,
} from './types.ts'

/** Filter and order central snapshot items by viewer news preferences. */
export function personalizeNewsItems(items: readonly NewsItem[], prefs: InfoPreferences): NewsItem[] {
  const enabled = new Set(prefs.news.enabledPublisherIds)
  const order = prefs.news.publisherOrder
  const rank = (publisher: string) => {
    const index = order.indexOf(publisher)
    return index === -1 ? 999 : index
  }
  return [...items]
    .filter((item) => enabled.has(item.publisher) || item.sourceId.startsWith('custom:'))
    .sort((a, b) => {
      const byPub = rank(a.publisher) - rank(b.publisher)
      if (byPub !== 0) return byPub
      const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0
      const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0
      return bTime - aTime
    })
}

export function visibleNewsCategories(prefs: InfoPreferences, present: ReadonlySet<NewsCategory>): NewsCategory[] {
  const hidden = new Set(prefs.news.hiddenCategories)
  return prefs.news.categoryOrder.filter((id) => present.has(id) && !hidden.has(id))
}

export function selectPersonalized(
  items: readonly NewsItem[],
  prefs: InfoPreferences,
  category: NewsCategory,
  expanded: boolean,
): NewsItem[] {
  const personalized = personalizeNewsItems(items, prefs)
  // Top stories: use the dedicated top feeds, and fill from UK / World so the list is not stuck at one lead per outlet.
  const pool =
    category === 'top'
      ? personalized.filter((item) => item.category === 'top' || item.category === 'uk' || item.category === 'world')
      : personalized.filter((item) => item.category === category)
  const limit = expanded ? NEWS_EXPANDED_LIMIT : category === 'top' ? NEWS_TOP_LIMIT : NEWS_CATEGORY_LIMIT
  // Other tabs: one lead per publisher first; Top stories shows several from each so the first screen is full.
  const maxPer =
    category === 'top'
      ? expanded
        ? NEWS_TOP_PER_PUBLISHER_EXPANDED
        : NEWS_TOP_PER_PUBLISHER
      : expanded
        ? 2
        : 1
  return selectHeadlines(pool, { limit, maxPerPublisher: maxPer })
}

export function mergeCustomItems(central: readonly NewsItem[], custom: readonly NewsItem[]): NewsItem[] {
  return [...central, ...custom]
}
