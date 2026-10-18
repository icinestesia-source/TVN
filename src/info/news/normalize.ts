import type { NewsCategory, NewsItem, NewsSnapshot } from './types.ts'
import { NEWS_STALE_MINUTES } from './types.ts'

export function newsItemId(url: string, title: string): string {
  const key = `${url.trim().toLowerCase()}|${title.trim().toLowerCase()}`
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `n${(hash >>> 0).toString(16)}`
}

export function stripMarkup(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,:;!?])/g, '$1')
    .trim()
}

function tagContent(block: string, tag: string): string | null {
  const cdata = block.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'))
  if (cdata) return cdata[1].trim()
  const plain = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return plain ? plain[1].trim() : null
}

function linkFromItem(block: string): string | null {
  const atom = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)
  if (atom?.[1]) return atom[1].trim()
  const rss = tagContent(block, 'link')
  return rss ? stripMarkup(rss) : null
}

function publishedFromItem(block: string): string | null {
  const raw = tagContent(block, 'pubDate') ?? tagContent(block, 'published') ?? tagContent(block, 'updated') ?? tagContent(block, 'dc:date')
  if (!raw) return null
  const cleaned = stripMarkup(raw)
  const ms = Date.parse(cleaned)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** Pull RSS 2.0 / Atom entries from a feed document. */
export function itemsFromFeedXml(
  xml: string,
  meta: { sourceId: string; publisher: string; category: NewsCategory },
): NewsItem[] {
  const chunks = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi)].map((match) => match[0])
  const items: NewsItem[] = []
  for (const block of chunks) {
    const titleRaw = tagContent(block, 'title')
    const url = linkFromItem(block)
    if (!titleRaw || !url) continue
    if (!/^https?:\/\//i.test(url)) continue
    const title = stripMarkup(titleRaw)
    if (!title) continue
    const descriptionRaw = tagContent(block, 'description') ?? tagContent(block, 'summary') ?? tagContent(block, 'content')
    const description = descriptionRaw ? stripMarkup(descriptionRaw).slice(0, 280) || null : null
    items.push({
      id: newsItemId(url, title),
      title,
      publisher: meta.publisher,
      publishedAt: publishedFromItem(block),
      description,
      category: meta.category,
      url,
      sourceId: meta.sourceId,
    })
  }
  return items
}

export function dedupeNewsItems(items: readonly NewsItem[]): NewsItem[] {
  const seen = new Set<string>()
  const out: NewsItem[] = []
  for (const item of items) {
    const key = item.url.replace(/\/$/, '').toLowerCase()
    if (seen.has(key) || seen.has(item.id)) continue
    seen.add(key)
    seen.add(item.id)
    out.push(item)
  }
  return out
}

export function sortNewsItems(items: readonly NewsItem[]): NewsItem[] {
  return [...items].sort((a, b) => {
    const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0
    const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0
    return bTime - aTime
  })
}

export function buildNewsSnapshot(
  items: readonly NewsItem[],
  sources: NewsSnapshot['sources'],
  updatedIso: string,
  errors: string[] = [],
): NewsSnapshot {
  return {
    format: 'tvn-info-news-v1',
    updatedIso,
    staleAfterMinutes: NEWS_STALE_MINUTES,
    items: sortNewsItems(dedupeNewsItems(items)),
    sources,
    ...(errors.length ? { errors } : {}),
  }
}

export function asNewsSnapshot(value: unknown): NewsSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const doc = value as Record<string, unknown>
  if (doc.format !== 'tvn-info-news-v1' || typeof doc.updatedIso !== 'string' || !Array.isArray(doc.items)) return null
  return value as NewsSnapshot
}

export function newsIsStale(snapshot: NewsSnapshot, nowMs = Date.now()): boolean {
  const updated = Date.parse(snapshot.updatedIso)
  if (!Number.isFinite(updated)) return true
  const minutes = snapshot.staleAfterMinutes > 0 ? snapshot.staleAfterMinutes : NEWS_STALE_MINUTES
  return nowMs - updated > minutes * 60_000
}
