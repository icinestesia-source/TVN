import { channelCacheControl, handleChannelRequest } from '../../server/youtube-channel.ts'

export default async (request: Request): Promise<Response> => {
  const url = new URL(request.url)
  const { status, body } = await handleChannelRequest(url)
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': channelCacheControl(url, status),
    },
  })
}

export const config = { path: '/api/channel' }
