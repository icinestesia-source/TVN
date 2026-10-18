import { jsonResponse, readNewsBlob } from '../../server/info-blobs.ts'

/** GET /api/info/news — live snapshot from Blobs (no site rebuild). */
export default async (): Promise<Response> => {
  const snapshot = await readNewsBlob()
  if (!snapshot) {
    return jsonResponse({ error: 'News snapshot not published yet', fallback: '/info/news.json' }, 404, 'no-store')
  }
  return jsonResponse(snapshot, 200, 'public, max-age=60, stale-while-revalidate=300')
}

export const config = { path: '/api/info/news' }
