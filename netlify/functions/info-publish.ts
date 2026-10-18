import { asFootballSnapshot } from '../../src/info/football/normalize.ts'
import { shouldWriteFootballBlob } from '../../src/info/football/snapshot-safety.ts'
import { asNewsSnapshot } from '../../src/info/news/normalize.ts'
import { jsonResponse, readFootballBlob, writeFootballBlob, writeNewsBlob } from '../../server/info-blobs.ts'

/**
 * POST /api/info/publish — CI writes INFO snapshots into Netlify Blobs.
 * Auth: Authorization: Bearer <INFO_PUBLISH_SECRET> (Netlify env + GitHub secret).
 * Does not rebuild the site and never exposes football/news provider tokens to the browser.
 */
export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'POST only' }, 405, 'no-store')
  }
  const secret = process.env.INFO_PUBLISH_SECRET?.trim()
  if (!secret) {
    return jsonResponse({ error: 'INFO_PUBLISH_SECRET is not configured' }, 503, 'no-store')
  }
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token || token !== secret) {
    return jsonResponse({ error: 'Unauthorised' }, 401, 'no-store')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'JSON body required' }, 400, 'no-store')
  }
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'JSON object required' }, 400, 'no-store')
  }
  const doc = body as Record<string, unknown>
  const written: string[] = []
  const errors: string[] = []

  if ('news' in doc) {
    const news = asNewsSnapshot(doc.news)
    if (!news) errors.push('news: invalid snapshot')
    else {
      await writeNewsBlob(news)
      written.push('news')
    }
  }
  if ('football' in doc) {
    const football = asFootballSnapshot(doc.football)
    if (!football) errors.push('football: invalid snapshot')
    else {
      const existing = await readFootballBlob()
      const decision = shouldWriteFootballBlob(football, existing)
      if (!decision.write) errors.push(decision.reason)
      else {
        await writeFootballBlob(football)
        written.push('football')
      }
    }
  }
  if (!written.length && !errors.length) {
    return jsonResponse({ error: 'Provide news and/or football snapshots' }, 400, 'no-store')
  }
  if (errors.length && !written.length) {
    return jsonResponse({ error: errors.join('; ') }, 400, 'no-store')
  }
  return jsonResponse({ ok: true, written, errors }, 200, 'no-store')
}

export const config = { path: '/api/info/publish' }
