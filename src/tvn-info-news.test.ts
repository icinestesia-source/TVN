import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { INFO_MODULES, InfoCentre } from './components/InfoCentre.tsx'
import { NEWS_FEEDS } from './info/news/feeds.ts'
import {
  asNewsSnapshot,
  buildNewsSnapshot,
  dedupeNewsItems,
  freshNewsItems,
  itemsFromFeedXml,
  newsIsStale,
  stripMarkup,
} from './info/news/normalize.ts'
import { selectHeadlines, titleSimilarity } from './info/news/select.ts'
import type { NewsItem } from './info/news/types.ts'
import { NEWS_CATEGORIES, NEWS_TOP_LIMIT } from './info/news/types.ts'

const sampleRss = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>Sample</title>
<item>
  <title><![CDATA[First headline]]></title>
  <link>https://example.com/a</link>
  <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
  <description><![CDATA[A short <b>description</b>.]]></description>
</item>
<item>
  <title>Second headline</title>
  <link>https://example.com/b</link>
  <pubDate>Tue, 02 Jan 2024 12:00:00 GMT</pubDate>
</item>
</channel></rss>`

function item(partial: Partial<NewsItem> & Pick<NewsItem, 'id' | 'title' | 'publisher' | 'url'>): NewsItem {
  return {
    publishedAt: '2026-10-18T12:00:00.000Z',
    description: null,
    category: 'uk',
    sourceId: 's',
    ...partial,
  }
}

describe('INFO news', () => {
  it('parses RSS items, strips markup, and deduplicates by URL', () => {
    const items = itemsFromFeedXml(sampleRss, { sourceId: 'sample', publisher: 'Sample', category: 'uk' })
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      title: 'First headline',
      publisher: 'Sample',
      category: 'uk',
      url: 'https://example.com/a',
      description: 'A short description.',
    })
    expect(items[0].publishedAt).toBe('2024-01-01T12:00:00.000Z')
    expect(stripMarkup('A &amp; B')).toBe('A & B')
    const duped = dedupeNewsItems([
      items[0],
      { ...items[0], id: 'other', title: 'Copy' },
      items[1],
    ])
    expect(duped).toHaveLength(2)
  })

  it('builds a snapshot, marks stale data, and rejects bad documents', () => {
    const items = itemsFromFeedXml(sampleRss, { sourceId: 'sample', publisher: 'Sample', category: 'world' })
    const snapshot = buildNewsSnapshot(items, [], '2024-01-02T00:00:00.000Z')
    expect(snapshot.format).toBe('tvn-info-news-v1')
    expect(snapshot.items[0].title).toBe('Second headline')
    expect(newsIsStale(snapshot, Date.parse('2024-01-02T03:00:00.000Z'))).toBe(true)
    expect(newsIsStale(snapshot, Date.parse('2024-01-02T00:30:00.000Z'))).toBe(false)
    expect(asNewsSnapshot({ format: 'nope' })).toBeNull()
    expect(asNewsSnapshot(snapshot)?.items).toHaveLength(2)
  })

  it('handles an empty or invalid feed without inventing headlines', () => {
    expect(itemsFromFeedXml('<rss><channel></channel></rss>', { sourceId: 'x', publisher: 'X', category: 'uk' })).toEqual([])
    expect(itemsFromFeedXml('not xml', { sourceId: 'x', publisher: 'X', category: 'uk' })).toEqual([])
    const empty: NewsItem[] = []
    expect(buildNewsSnapshot(empty, [], '2024-01-01T00:00:00.000Z').items).toEqual([])
  })

  it('drops headlines older than fourteen days and keeps undated ones', () => {
    const now = Date.parse('2026-10-18T12:00:00.000Z')
    const kept = freshNewsItems(
      [
        { id: '1', title: 'New', publisher: 'P', publishedAt: '2026-10-17T00:00:00.000Z', description: null, category: 'uk', url: 'https://a.test/1', sourceId: 's' },
        { id: '2', title: 'Old', publisher: 'P', publishedAt: '2026-09-01T00:00:00.000Z', description: null, category: 'uk', url: 'https://a.test/2', sourceId: 's' },
        { id: '3', title: 'Undated', publisher: 'P', publishedAt: null, description: null, category: 'uk', url: 'https://a.test/3', sourceId: 's' },
      ],
      now,
    )
    expect(kept.map((row) => row.title)).toEqual(['New', 'Undated'])
  })

  it('selects diverse Top Stories and reduces near-duplicates', () => {
    const pool = [
      item({ id: '1', title: 'Parliament votes on budget plan today', publisher: 'BBC News', url: 'https://a/1', category: 'top', publishedAt: '2026-10-18T11:00:00.000Z' }),
      item({ id: '2', title: 'Parliament votes on budget plan', publisher: 'Sky News', url: 'https://a/2', category: 'top', publishedAt: '2026-10-18T10:55:00.000Z' }),
      item({ id: '3', title: 'Markets rally after rate decision', publisher: 'BBC News', url: 'https://a/3', category: 'top', publishedAt: '2026-10-18T10:50:00.000Z' }),
      item({ id: '4', title: 'Storm hits northern coastline', publisher: 'The Guardian', url: 'https://a/4', category: 'top', publishedAt: '2026-10-18T10:40:00.000Z' }),
      item({ id: '5', title: 'Tech firms report quarterly results', publisher: 'Ars Technica', url: 'https://a/5', category: 'top', publishedAt: '2026-10-18T10:30:00.000Z' }),
      item({ id: '6', title: 'Another BBC exclusive on local roads', publisher: 'BBC News', url: 'https://a/6', category: 'top', publishedAt: '2026-10-18T10:20:00.000Z' }),
      item({ id: '7', title: 'Independent investigation into rail delays', publisher: 'The Independent', url: 'https://a/7', category: 'top', publishedAt: '2026-10-18T10:10:00.000Z' }),
    ]
    expect(titleSimilarity(pool[0].title, pool[1].title)).toBeGreaterThan(0.7)
    const selected = selectHeadlines(pool, { limit: NEWS_TOP_LIMIT, maxPerPublisher: 2 })
    expect(selected.length).toBeGreaterThanOrEqual(5)
    expect(selected.some((row) => row.id === '2')).toBe(false)
    const bbc = selected.filter((row) => row.publisher === 'BBC News').length
    expect(bbc).toBeLessThanOrEqual(2)
    expect(new Set(selected.map((row) => row.publisher)).size).toBeGreaterThanOrEqual(3)
  })

  it('expands the allowlist across categories with publisher attribution fields', () => {
    expect(NEWS_FEEDS.length).toBeGreaterThanOrEqual(20)
    const categories = new Set(NEWS_FEEDS.map((feed) => feed.category))
    for (const required of ['top', 'uk', 'world', 'europe', 'technology', 'science', 'business', 'culture', 'entertainment']) {
      expect(categories.has(required as NewsItem['category'])).toBe(true)
    }
    expect(NEWS_CATEGORIES.some((entry) => entry.id === 'top')).toBe(true)
    const publishers = new Set(NEWS_FEEDS.map((feed) => feed.publisher))
    for (const name of ['BBC News', 'The Guardian', 'Sky News', 'The Independent', 'Al Jazeera English', 'France 24', 'Deutsche Welle', 'Ars Technica', 'The Register', 'New Scientist']) {
      expect(publishers.has(name)).toBe(true)
    }
    expect([...publishers].some((name) => /reuters/i.test(name))).toBe(false)
    for (const feed of NEWS_FEEDS) {
      expect(feed.feedUrl.startsWith('https://')).toBe(true)
    }
    expect(INFO_MODULES.map((module) => module.id)).toEqual(['news', 'sports', 'weather'])
    const markup = renderToStaticMarkup(createElement(InfoCentre))
    expect(markup).toContain('News')
    expect(markup).toContain('Sports')
    expect(markup).toContain('Weather')
  })
})
