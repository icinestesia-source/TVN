import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { INFO_MODULES, InfoCentre } from './components/InfoCentre.tsx'
import { NEWS_FEEDS } from './info/news/feeds.ts'
import {
  asNewsSnapshot,
  buildNewsSnapshot,
  dedupeNewsItems,
  itemsFromFeedXml,
  newsIsStale,
  stripMarkup,
} from './info/news/normalize.ts'
import type { NewsItem } from './info/news/types.ts'

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

  it('lists allowlisted feeds and shows News in INFO without unfinished modules', () => {
    expect(NEWS_FEEDS.length).toBeGreaterThanOrEqual(7)
    expect(new Set(NEWS_FEEDS.map((feed) => feed.category)).size).toBe(7)
    for (const feed of NEWS_FEEDS) {
      expect(feed.feedUrl.startsWith('https://')).toBe(true)
    }
    expect(INFO_MODULES.map((module) => module.id)).toEqual(['news', 'sports'])
    const markup = renderToStaticMarkup(createElement(InfoCentre))
    expect(markup).toContain('News')
    expect(markup).toContain('Sports')
    expect(markup).not.toMatch(/Chat|Games|Weather|Events/)
  })
})
