/**
 * Applies one central channel definition from src/data/central-sources.json to the shipped catalogue:
 * reads each source through TVN's keyless resolver, keeps what its filter admits, and makes those the
 * channel's only programmes. A deliberate editorial change, run by hand: `node scripts/central-channel.ts 555`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolveChannel } from '../server/youtube-channel.ts'
import { eligibleOf, type SourceFilter, type SourceMode } from '../src/services/channel-curation.ts'

interface CentralSource {
  id: string
  input: string
  mode?: SourceMode
  filter?: SourceFilter
  /** A playlist source: the id of a channel source in the same definition that must own it, confirmed from the playlist's own header. */
  owner?: string
}

const number = Number(process.argv[2])
const central = JSON.parse(readFileSync('src/data/central-sources.json', 'utf8')) as { channels: Record<string, { name: string; sources: CentralSource[] }> }
const definition = central.channels[String(number)]
if (!definition) throw new Error(`No central definition for channel ${number}`)

const PLAYABLE = 'public/independent/playable.json'
const REGISTER = 'public/independent/sources.json'
const MANIFEST = 'src/data/independent/manifest.json'
const NETWORK = 'src/data/canonical-network.json'
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path: string, value: unknown, indent: number, ending = '') => writeFileSync(path, `${JSON.stringify(value, null, indent || undefined)}${ending}`)
/** The catalogue with only `changed` top-level values re-serialised; the rest keep their exact text, integer-keyed maps in their order. */
function compactWith(raw: string, value: Record<string, unknown>, changed: readonly string[]): string {
  const keys = Object.keys(JSON.parse(raw) as object)
  const starts: number[] = []
  for (const key of keys) starts.push(raw.indexOf(`"${key}":`, (starts.at(-1) ?? 0) + 1))
  const parts = keys.map((key, index) => (changed.includes(key) ? `"${key}":${JSON.stringify(value[key])}` : raw.slice(starts[index], index + 1 < keys.length ? starts[index + 1] - 1 : raw.length - 1)))
  const text = `{${parts.join(',')}}`
  if (changed.length === 0 && text !== raw) throw new Error('The catalogue could not be split safely')
  return text
}

const playableText = readFileSync(PLAYABLE, 'utf8')
const playable = JSON.parse(playableText)
compactWith(playableText, playable, [])
if (compactWith(playableText, playable, ['items', 'sources']) !== playableText) throw new Error('The catalogue does not round-trip')
const register = readJson(REGISTER)
const manifest = readJson(MANIFEST)
const network = readJson(NETWORK)

type Item = [string, string, number, string, number[], string]
const items = playable.items as Item[]
const ownIds = new Set(definition.sources.map((source) => source.id))
for (const item of items) item[4] = item[4].filter((channel) => channel !== number)
// The channel's own earlier reads go; anything another channel still carries stays.
for (let index = items.length - 1; index >= 0; index -= 1) if (items[index][4].length === 0 && ownIds.has(items[index][3])) items.splice(index, 1)
for (const source of manifest.sources) source.targets = source.targets.filter((target: number) => target !== number)

const byId = new Map(items.map((item) => [item[0], item]))
const report: string[] = []
const resolved = new Map<string, Awaited<ReturnType<typeof resolveChannel>>>()
const read = (source: CentralSource) => resolveChannel(source.input, fetch, { wide: source.mode !== undefined && source.mode !== 'recent' })
// Owners first, so every playlist can be checked against the channel it claims.
for (const source of definition.sources) if (!source.owner) resolved.set(source.id, await read(source))
const seen = new Set<string>()
let total = 0
for (const source of definition.sources) {
  const found = resolved.get(source.id) ?? (await read(source))
  let ownerChannel = found.channelId
  if (source.owner) {
    const owner = resolved.get(source.owner)
    if (!owner || owner.sourceType !== 'youtube-channel') throw new Error(`${source.id} names ${source.owner}, which is not a channel source here`)
    if (found.ownerId !== owner.channelId) throw new Error(`${source.id} (${found.title}) is not owned by ${owner.title}; it is not added`)
    ownerChannel = owner.channelId
  }
  const kept = eligibleOf({ videos: found.videos, filter: source.filter, mode: source.mode })
  let fresh = 0
  let freshSeconds = 0
  for (const video of kept) {
    if (seen.has(video.id)) continue
    seen.add(video.id)
    fresh += 1
    freshSeconds += video.durationSec
    const existing = byId.get(video.id)
    if (existing) {
      if (!existing[4].includes(number)) existing[4].push(number)
      continue
    }
    const item: Item = [video.id, video.title, video.durationSec, source.id, [number], 'api']
    items.push(item)
    byId.set(video.id, item)
  }
  total += freshSeconds
  const channelUrl = `https://www.youtube.com/channel/${ownerChannel}`
  playable.sources[source.id] = found.title
  register.sources[source.id] = { name: found.title, provider: 'YouTube', channelUrl }
  const url = found.sourceType === 'youtube-playlist' ? `https://www.youtube.com/playlist?list=${found.channelId}` : channelUrl
  const entry = { id: source.id, name: found.title, class: 'CONFIRMED_FREE_YOUTUBE', url, targets: [number], tags: ['music'], excludeTags: [], notes: `Central source for channel ${number}, read from ${source.input} (mode ${source.mode ?? 'recent'}).` }
  const at = manifest.sources.findIndex((item: { id: string }) => item.id === source.id)
  if (at >= 0) manifest.sources[at] = entry
  else manifest.sources.push(entry)
  report.push(`${found.title} (${found.channelId}${source.owner ? `, owned by ${ownerChannel}` : ''}): ${found.pages ?? 1} pages, ${found.scanned} listed, ${found.videos.length} playable, ${kept.length} kept, ${fresh} new, ${(freshSeconds / 3600).toFixed(2)} h`)
}
report.push(`Channel ${number}: ${seen.size} programmes, ${(total / 3600).toFixed(2)} h`)
const route = manifest.routes.find((item: { number: number }) => item.number === number)
const sourceIds = definition.sources.map((source) => source.id)
if (route) route.sourceIds = sourceIds
else manifest.routes.push({ number, strategy: 'SOURCE_ROUTED', sourceIds })
const channel = network.channels.find((item: { number: number }) => item.number === number)
if (channel) channel.name = definition.name

if (playable.programmeRoutes[String(number)]) throw new Error(`Channel ${number} has hand-routed programmes; remove them first`)
writeFileSync(PLAYABLE, compactWith(playableText, playable, ['items', 'sources']))
writeJson(REGISTER, register, 1, '\n')
writeJson(MANIFEST, manifest, 0)
writeJson(NETWORK, network, 2)
console.log(report.join('\n'))
