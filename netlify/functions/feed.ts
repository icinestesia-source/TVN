import { feedCacheControl, handleFeedRequest } from '../../server/podcast-feed.ts'

export default async (request: Request): Promise<Response> => {
  const url = new URL(request.url)
  const { status, body } = await handleFeedRequest(url)
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': feedCacheControl(url, status),
    },
  })
}

export const config = { path: '/api/feed' }
