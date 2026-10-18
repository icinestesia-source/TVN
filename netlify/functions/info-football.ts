import { jsonResponse, readFootballBlob } from '../../server/info-blobs.ts'

/** GET /api/info/football — live snapshot from Blobs (no site rebuild). */
export default async (): Promise<Response> => {
  const snapshot = await readFootballBlob()
  if (!snapshot) {
    return jsonResponse({ error: 'Football snapshot not published yet', fallback: '/info/football.json' }, 404, 'no-store')
  }
  return jsonResponse(snapshot, 200, 'public, max-age=60, stale-while-revalidate=300')
}

export const config = { path: '/api/info/football' }
