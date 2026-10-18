/**
 * Dev/preview middleware mirroring /api/info/* without Netlify Blobs.
 * Reads and writes public/info/*.json so local INFO works offline.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { applyTmdbCredential, resolveTmdbCredential } from '../src/info/entertainment/tmdb-auth.ts'
import { asFootballSnapshot } from '../src/info/football/normalize.ts'
import { shouldWriteFootballBlob } from '../src/info/football/snapshot-safety.ts'
import { asNewsSnapshot } from '../src/info/news/normalize.ts'

const root = process.cwd()
const newsPath = join(root, 'public/info/news.json')
const footballPath = join(root, 'public/info/football.json')

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function infoNewsMiddleware(_request: IncomingMessage, res: ServerResponse): void {
  const snapshot = asNewsSnapshot(readJson(newsPath))
  if (!snapshot) {
    send(res, 404, { error: 'News snapshot not published yet', fallback: '/info/news.json' })
    return
  }
  send(res, 200, snapshot)
}

export function infoFootballMiddleware(_request: IncomingMessage, res: ServerResponse): void {
  const snapshot = asFootballSnapshot(readJson(footballPath))
  if (!snapshot) {
    send(res, 404, { error: 'Football snapshot not published yet', fallback: '/info/football.json' })
    return
  }
  send(res, 200, snapshot)
}

function readUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://localhost')
}

/** Dev proxy for TMDB — same allowlist and shape-based auth as netlify/functions/info-tmdb.ts */
export async function infoTmdbMiddleware(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    send(res, 405, { error: 'GET only' })
    return
  }
  const credential = resolveTmdbCredential({
    TMDB_API_TOKEN: process.env.TMDB_API_TOKEN,
    TMDB_READ_ACCESS_TOKEN: process.env.TMDB_READ_ACCESS_TOKEN,
  })
  if (!credential) {
    send(res, 503, { error: 'TMDB_API_TOKEN or TMDB_READ_ACCESS_TOKEN is not configured' })
    return
  }
  const url = readUrl(req)
  const path = url.searchParams.get('path') ?? ''
  const allow = [
    /^\/movie\/popular$/,
    /^\/movie\/now_playing$/,
    /^\/tv\/popular$/,
    /^\/tv\/on_the_air$/,
    /^\/trending\/all\/week$/,
    /^\/search\/multi$/,
    /^\/discover\/movie$/,
    /^\/discover\/tv$/,
    /^\/genre\/movie\/list$/,
    /^\/genre\/tv\/list$/,
  ]
  if (!allow.some((rule) => rule.test(path))) {
    send(res, 400, { error: 'Path not allowed' })
    return
  }
  const upstream = new URL(`https://api.themoviedb.org/3${path}`)
  const headers: Record<string, string> = { Accept: 'application/json' }
  applyTmdbCredential(upstream, headers, credential)
  for (const [key, value] of url.searchParams) {
    if (key === 'path' || key === 'api_key') continue
    upstream.searchParams.set(key, value)
  }
  try {
    const response = await fetch(upstream.toString(), { headers })
    const text = await response.text()
    res.statusCode = response.status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', response.status === 429 ? 'public, max-age=60' : 'public, max-age=900')
    res.end(text)
  } catch (caught) {
    send(res, 502, { error: caught instanceof Error ? caught.message : 'Upstream failed' })
  }
}

const financeCache = new Map<string, { expires: number; status: number; body: string }>()
const FINANCE_CACHE_TTL_MS = 30 * 60 * 1000

/** Dev proxy for Alpha Vantage — same secret + cache policy as netlify/functions/info-finance.ts */
export async function infoFinanceMiddleware(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    send(res, 405, { error: 'GET only' })
    return
  }
  const key = process.env.ALPHA_VANTAGE_API_KEY?.trim()
  if (!key) {
    send(res, 503, { error: 'ALPHA_VANTAGE_API_KEY is not configured' })
    return
  }
  const url = readUrl(req)
  const action = url.searchParams.get('action') ?? 'quote'
  const symbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase()
  const upstream = new URL('https://www.alphavantage.co/query')
  upstream.searchParams.set('apikey', key)
  let cacheKey = `${action}:${symbol}`
  if (action === 'quote') {
    if (!/^[A-Z0-9.^_-]{1,16}$/.test(symbol)) {
      send(res, 400, { error: 'Invalid symbol' })
      return
    }
    upstream.searchParams.set('function', 'GLOBAL_QUOTE')
    upstream.searchParams.set('symbol', symbol)
  } else if (action === 'search') {
    const keywords = (url.searchParams.get('keywords') ?? '').trim()
    if (keywords.length < 2) {
      send(res, 400, { error: 'Invalid keywords' })
      return
    }
    upstream.searchParams.set('function', 'SYMBOL_SEARCH')
    upstream.searchParams.set('keywords', keywords)
    cacheKey = `${action}:${keywords.toLowerCase()}`
  } else {
    send(res, 400, { error: 'Unknown action' })
    return
  }
  const hit = financeCache.get(cacheKey)
  if (hit && hit.expires > Date.now()) {
    res.statusCode = hit.status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'public, max-age=1800')
    res.setHeader('x-tvn-finance-cache', 'hit')
    res.end(hit.body)
    return
  }
  try {
    const response = await fetch(upstream.toString(), { headers: { Accept: 'application/json' } })
    const text = await response.text()
    if (response.status === 200) {
      financeCache.set(cacheKey, { expires: Date.now() + FINANCE_CACHE_TTL_MS, status: response.status, body: text })
    }
    res.statusCode = response.status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'public, max-age=1800')
    res.setHeader('x-tvn-finance-cache', 'miss')
    res.end(text)
  } catch (caught) {
    send(res, 502, { error: caught instanceof Error ? caught.message : 'Upstream failed' })
  }
}

export function infoPublishMiddleware(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'POST') {
    send(res, 405, { error: 'POST only' })
    return
  }
  const chunks: Buffer[] = []
  req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  req.on('end', () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
      const written: string[] = []
      mkdirSync(join(root, 'public/info'), { recursive: true })
      if ('news' in body) {
        const news = asNewsSnapshot(body.news)
        if (!news) throw new Error('news: invalid snapshot')
        writeFileSync(newsPath, `${JSON.stringify(news)}\n`, 'utf8')
        written.push('news')
      }
      if ('football' in body) {
        const football = asFootballSnapshot(body.football)
        if (!football) throw new Error('football: invalid snapshot')
        const existing = asFootballSnapshot(readJson(footballPath))
        const decision = shouldWriteFootballBlob(football, existing)
        if (!decision.write) throw new Error(decision.reason)
        writeFileSync(footballPath, `${JSON.stringify(football)}\n`, 'utf8')
        written.push('football')
      }
      if (!written.length) throw new Error('Provide news and/or football snapshots')
      send(res, 200, { ok: true, written, errors: [] })
    } catch (caught) {
      send(res, 400, { error: caught instanceof Error ? caught.message : 'Bad request' })
    }
  })
}
