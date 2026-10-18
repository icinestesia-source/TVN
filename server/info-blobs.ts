/**
 * Site-wide Netlify Blobs store for INFO snapshots.
 * Written by /api/info/publish (from CI); read by /api/info/news and /api/info/football.
 * Local filesystem is not durable across function invocations — never rely on /tmp alone in production.
 */
import { getStore } from '@netlify/blobs'
import type { FootballSnapshot } from '../src/info/football/types.ts'
import { asFootballSnapshot } from '../src/info/football/normalize.ts'
import type { NewsSnapshot } from '../src/info/news/types.ts'
import { asNewsSnapshot } from '../src/info/news/normalize.ts'

export const INFO_BLOB_STORE = 'tvn-info'
export const NEWS_BLOB_KEY = 'news'
export const FOOTBALL_BLOB_KEY = 'football'

function infoStore() {
  return getStore({ name: INFO_BLOB_STORE, consistency: 'strong' })
}

export async function readNewsBlob(): Promise<NewsSnapshot | null> {
  try {
    const raw = await infoStore().get(NEWS_BLOB_KEY, { type: 'json' })
    return asNewsSnapshot(raw)
  } catch {
    return null
  }
}

export async function readFootballBlob(): Promise<FootballSnapshot | null> {
  try {
    const raw = await infoStore().get(FOOTBALL_BLOB_KEY, { type: 'json' })
    return asFootballSnapshot(raw)
  } catch {
    return null
  }
}

export async function writeNewsBlob(snapshot: NewsSnapshot): Promise<void> {
  await infoStore().setJSON(NEWS_BLOB_KEY, snapshot)
}

export async function writeFootballBlob(snapshot: FootballSnapshot): Promise<void> {
  await infoStore().setJSON(FOOTBALL_BLOB_KEY, snapshot)
}

export function jsonResponse(body: unknown, status = 200, cacheControl = 'public, max-age=60'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
    },
  })
}
