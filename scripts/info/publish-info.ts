/**
 * Publish local public/info/*.json to the live INFO API (Netlify Blobs via /api/info/publish).
 * Does not commit to git and does not trigger a Netlify site rebuild.
 *
 *   INFO_PUBLISH_URL=https://<site>/api/info/publish \
 *   INFO_PUBLISH_SECRET=… \
 *   npm run info:publish
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function readOptional(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const url = process.env.INFO_PUBLISH_URL?.trim()
  const secret = process.env.INFO_PUBLISH_SECRET?.trim()
  if (!url || !secret) {
    throw new Error('Set INFO_PUBLISH_URL and INFO_PUBLISH_SECRET to publish INFO snapshots')
  }
  const news = readOptional(join(root, 'public/info/news.json'))
  const football = readOptional(join(root, 'public/info/football.json'))
  const publishFootball = process.env.INFO_PUBLISH_FOOTBALL
  const includeFootball = publishFootball == null || publishFootball === '' ? true : publishFootball === '1' || publishFootball === 'true'
  const body: Record<string, unknown> = {}
  if (news) body.news = news
  if (football && includeFootball) body.football = football
  if (!Object.keys(body).length) throw new Error('No public/info snapshots to publish')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Publish failed (${response.status}): ${text.slice(0, 400)}`)
  console.log(text)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
