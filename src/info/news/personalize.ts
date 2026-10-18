import type { InfoPreferences } from '../preferences.ts'
import { selectHeadlines } from './select.ts'
import type { NewsCategory, NewsItem } from './types.ts'
import { NEWS_CATEGORY_LIMIT, NEWS_EXPANDED_LIMIT, NEWS_TOP_LIMIT } from './types.ts'

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
  const pool = personalizeNewsItems(items, prefs).filter((item) => item.category === category)
  const limit = expanded ? NEWS_EXPANDED_LIMIT : category === 'top' ? NEWS_TOP_LIMIT : NEWS_CATEGORY_LIMIT
  // The first screen is one lead headline per publisher. More can add a second from each.
  const maxPer = expanded ? 2 : 1
  return selectHeadlines(pool, { limit, maxPerPublisher: maxPer })
}

export function mergeCustomItems(central: readonly NewsItem[], custom: readonly NewsItem[]): NewsItem[] {
  return [...central, ...custom]
}
