import { handleChannelRequest } from '../../server/youtube-channel.ts'

export default async (request: Request): Promise<Response> => {
  const { status, body } = await handleChannelRequest(new URL(request.url))
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': status === 200 ? 'public, max-age=900' : 'no-store',
    },
  })
}

export const config = { path: '/api/channel' }
