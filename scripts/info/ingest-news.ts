/**
 * Fetch allowlisted RSS feeds and write public/info/news.json.
 * Run: npm run info:news
 * Scheduled CI commits the file so Netlify deploys an updated snapshot.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NEWS_FEEDS } from '../../src/info/news/feeds.ts'
import { buildNewsSnapshot, itemsFromFeedXml } from '../../src/info/news/normalize.ts'
import type { NewsItem, NewsSnapshot } from '../../src/info/news/types.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outPath = join(root, 'public/info/news.json')
const TIMEOUT_MS = 12_000
const MAX_BYTES = 1_500_000

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*', 'User-Agent': 'TVN-InfoIngest/1.0' },
    })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > MAX_BYTES) throw new Error(`feed larger than ${MAX_BYTES} bytes`)
    return buffer.toString('utf8')
  } finally {
    clearTimeout(timer)
  }
}

function previousSnapshot(): NewsSnapshot | null {
  try {
    const parsed = JSON.parse(readFileSync(outPath, 'utf8')) as NewsSnapshot
    return parsed.format === 'tvn-info-news-v1' && Array.isArray(parsed.items) ? parsed : null
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const errors: string[] = []
  const items: NewsItem[] = []
  for (const feed of NEWS_FEEDS) {
    try {
      const xml = await fetchText(feed.feedUrl)
      const found = itemsFromFeedXml(xml, feed)
      if (found.length === 0) errors.push(`${feed.id}: no items`)
      else items.push(...found)
    } catch (caught) {
      errors.push(`${feed.id}: ${caught instanceof Error ? caught.message : 'failed'}`)
    }
  }

  const prior = previousSnapshot()
  if (items.length === 0) {
    if (!prior?.items.length) throw new Error(`News ingest produced nothing · ${errors.join('; ')}`)
    console.error('News ingest failed; keeping previous snapshot.', errors.join('; '))
    process.exitCode = 0
    return
  }

  const snapshot = buildNewsSnapshot(
    items,
    NEWS_FEEDS.map(({ id, publisher, category, feedUrl }) => ({ id, publisher, category, feedUrl })),
    new Date().toISOString(),
    errors,
  )
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(snapshot)}\n`, 'utf8')
  console.log(`Wrote ${snapshot.items.length} headlines to ${outPath}${errors.length ? ` · ${errors.length} feed warnings` : ''}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
