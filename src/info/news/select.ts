import type { NewsCategory, NewsItem } from './types.ts'
import { NEWS_CATEGORY_LIMIT, NEWS_EXPANDED_LIMIT, NEWS_TOP_LIMIT } from './types.ts'

/** Normalise a headline for near-duplicate checks. */
export function headlineKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Token overlap Jaccard-ish score for near-duplicate detection. */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(headlineKey(a).split(' ').filter((word) => word.length > 2))
  const tb = new Set(headlineKey(b).split(' ').filter((word) => word.length > 2))
  if (ta.size === 0 || tb.size === 0) return 0
  let overlap = 0
  for (const word of ta) if (tb.has(word)) overlap += 1
  return overlap / Math.max(ta.size, tb.size)
}

function publishedMs(item: NewsItem): number {
  if (!item.publishedAt) return 0
  const ms = Date.parse(item.publishedAt)
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Deterministic selection: recent first, skip URL/id dupes and near-duplicate titles,
 * and round-robin publishers so one outlet cannot dominate a category list.
 */
export function selectHeadlines(
  items: readonly NewsItem[],
  options: { limit: number; maxPerPublisher?: number },
): NewsItem[] {
  const maxPerPublisher = options.maxPerPublisher ?? Math.max(2, Math.ceil(options.limit / 3))
  const sorted = [...items].sort((a, b) => {
    const byTime = publishedMs(b) - publishedMs(a)
    if (byTime !== 0) return byTime
    return a.id.localeCompare(b.id)
  })

  const byPublisher = new Map<string, NewsItem[]>()
  for (const item of sorted) {
    const list = byPublisher.get(item.publisher) ?? []
    list.push(item)
    byPublisher.set(item.publisher, list)
  }

  const publishers = [...byPublisher.keys()].sort((a, b) => a.localeCompare(b))
  const indices = new Map(publishers.map((name) => [name, 0]))
  const selected: NewsItem[] = []
  const usedUrls = new Set<string>()
  const usedIds = new Set<string>()
  const perPublisher = new Map<string, number>()

  const isNearDuplicate = (candidate: NewsItem) =>
    selected.some((item) => titleSimilarity(item.title, candidate.title) >= 0.72)

  let progress = true
  while (selected.length < options.limit && progress) {
    progress = false
    for (const publisher of publishers) {
      if (selected.length >= options.limit) break
      const count = perPublisher.get(publisher) ?? 0
      if (count >= maxPerPublisher) continue
      const queue = byPublisher.get(publisher) ?? []
      let index = indices.get(publisher) ?? 0
      while (index < queue.length) {
        const candidate = queue[index]
        index += 1
        indices.set(publisher, index)
        const urlKey = candidate.url.replace(/\/$/, '').toLowerCase()
        if (usedUrls.has(urlKey) || usedIds.has(candidate.id)) continue
        if (isNearDuplicate(candidate)) continue
        usedUrls.add(urlKey)
        usedIds.add(candidate.id)
        perPublisher.set(publisher, count + 1)
        selected.push(candidate)
        progress = true
        break
      }
    }
  }

  return selected
}

export function initialLimitFor(category: NewsCategory | 'all'): number {
  if (category === 'top' || category === 'all') return NEWS_TOP_LIMIT
  return NEWS_CATEGORY_LIMIT
}

export function expandedLimitFor(_category: NewsCategory | 'all'): number {
  return NEWS_EXPANDED_LIMIT
}

/** Categories that currently have at least one item (for hiding empty tabs). */
export function populatedCategories(items: readonly NewsItem[]): NewsCategory[] {
  const present = new Set(items.map((item) => item.category))
  return [...present]
}
