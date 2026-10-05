/**
 * Builds one central channel made from public podcast feeds into src/data/central-edits.json: each source is read
 * through TVN's own keyless feed reader on this machine, every free episode it lists is kept, and the channel is
 * given a random running order. A deliberate editorial change, run by hand: `node scripts/central-edits.ts 776`.
 *
 * Only public feeds: a members', subscribers' or paid feed is never a source, and nothing here signs in. The
 * episodes ship as read today; running the script again picks up what the publisher has added since.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { handleFeedRequest } from '../server/podcast-feed.ts'
import { mulberry32 } from '../src/director/prng.ts'
import { lookUpFeed } from '../src/services/podcast-source.ts'
import { MAX_SOURCE_VIDEOS } from '../src/services/channel-curation.ts'
import type { CentralEdits } from '../src/data/central-edits.ts'
import { shuffledVideos } from '../src/view/programme-order.ts'

const FILE = 'src/data/central-edits.json'
const number = Number(process.argv[2])
const doc = JSON.parse(readFileSync(FILE, 'utf8')) as CentralEdits
const channel = doc.channels[String(number)]
if (!channel) throw new Error(`No central edit for channel ${number} in ${FILE}`)

/** TVN's /api/feed, answered here by the same server code the site runs. */
const local = (async (input: string | URL) => {
  const url = new URL(String(input), 'http://tvn.local')
  const { status, body } = await handleFeedRequest(url)
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

for (const source of channel.sources) {
  if (source.kind !== 'podcast') continue
  process.stdout.write(`${number} ${source.label}: reading ${source.url}\n`)
  const found = await lookUpFeed(source.url, local, { fresh: true, mode: 'all', onProgress: (text) => process.stdout.write(`  ${text}\r`) })
  source.ref = found.feedUrl
  source.videos = found.episodes.slice(0, MAX_SOURCE_VIDEOS).map((episode) => ({
    ...episode,
    ...(episode.summary ? { summary: episode.summary.slice(0, 240) } : {}),
  }))
  source.listed = found.episodes.length
  source.complete = true
  if (found.website) source.info = { ...source.info, website: source.info?.website ?? found.website }
  process.stdout.write(`\n  ${source.videos.length} episodes\n`)
}

const ids = channel.sources.filter((source) => source.enabled).flatMap((source) => (source.videos ?? []).map((video) => video.id))
channel.order = shuffledVideos([...new Set(ids)], mulberry32(number))
channel.orderKind = 'random'
channel.savedAt = Date.now()
writeFileSync(FILE, `${JSON.stringify(doc)}\n`)
process.stdout.write(`${number} ${channel.name}: ${channel.order.length} programmes, random order, written to ${FILE}\n`)
