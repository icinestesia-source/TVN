/**
 * Dev/preview middleware mirroring /api/info/* without Netlify Blobs.
 * Reads and writes public/info/*.json so local INFO works offline.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { asFootballSnapshot } from '../src/info/football/normalize.ts'
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
