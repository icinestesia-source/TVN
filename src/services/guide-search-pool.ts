import { listChannels, programmesFor } from '../data/catalogue.ts'
import { mediaLibrary } from '../director/library.ts'
import { policyFor } from '../director/policies.ts'
import type { MediaItem } from '../director/types.ts'
import { isLiveStreamChannel } from '../dynamic/stream.ts'
import { schedulingPool } from '../library/mode.ts'
import { getChannelMedia } from '../library/query.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import type { ChannelEditorial } from './channel-curation.ts'
import { buildSearchIndex, type SearchChannel, type SearchIndex, type SearchProgramme } from './guide-search.ts'
import { cannotAdd, guideProgramme } from './viewing-guides.ts'

function fromListing(channel: Channel, programme: Programme): SearchProgramme | null {
  if (cannotAdd(channel, programme) || programme.source === 'demo') return null
  return {
    id: programme.id,
    title: programme.title,
    durationSeconds: programme.durationSeconds,
    videoId: programme.videoId,
    mediaUrl: programme.mediaUrl,
    source: programme.creator,
    guide: guideProgramme(programme),
  }
}

function fromLibrary(item: MediaItem): SearchProgramme | null {
  if (item.live || item.provider !== 'youtube' || !item.externalId || !(item.durationSeconds > 0)) return null
  const source = (item as { sourceCollection?: string }).sourceCollection ?? item.creator
  return {
    id: `search-${item.externalId}`,
    title: item.title,
    durationSeconds: item.durationSeconds,
    videoId: item.externalId,
    source,
    guide: { id: `search-${item.externalId}`, title: item.title, videoId: item.externalId, durationSeconds: item.durationSeconds, source: 'imported', programmeType: item.programmeType, ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}) },
  }
}

/**
 * What each on-air channel can lend a Guide now: its own lineup where it has one (a viewer's sources,
 * a User Channel, a fixed listing), else the library pool TVN schedules it from. Disabled channels, live
 * streams and anything refused or removed stay out, exactly as they do on air.
 */
export function searchChannels(editorialOf: (number: number) => ChannelEditorial | undefined, refused: ReadonlySet<string>): SearchChannel[] {
  const library = schedulingPool(mediaLibrary())
  const out: SearchChannel[] = []
  for (const channel of listChannels()) {
    if (!channel.enabled || channel.number < 1 || channel.origin === 'session' || isLiveStreamChannel(channel)) continue
    const own = channel.customLineup || channel.origin === 'user-import' || !policyFor(channel.number)
    const programmes = (own ? programmesFor(channel.id).map((programme) => fromListing(channel, programme)) : getChannelMedia(library, channel.number).map(fromLibrary)).filter(
      (programme): programme is SearchProgramme => programme !== null && !(programme.videoId && refused.has(programme.videoId)),
    )
    if (programmes.length === 0) continue
    const notes = editorialOf(channel.number)
    out.push({
      number: channel.number,
      name: channel.name,
      description: channel.description,
      category: channel.category,
      tags: notes?.tags,
      purpose: notes?.purpose,
      desired: notes?.desired,
      eras: notes?.eras,
      programmes,
    })
  }
  return out
}

let cached: { channels: readonly Channel[]; library: readonly MediaItem[]; stamp: string; index: SearchIndex } | null = null

/** The search index, rebuilt whenever the channels, the library or the editorial notes have changed. */
export function searchIndex(editorialOf: (number: number) => ChannelEditorial | undefined, refused: ReadonlySet<string>, stamp: string): SearchIndex {
  const channels = listChannels()
  const library = mediaLibrary()
  const key = `${stamp}|${refused.size}`
  if (cached && cached.channels === channels && cached.library === library && cached.stamp === key) return cached.index
  const index = buildSearchIndex(searchChannels(editorialOf, refused))
  cached = { channels, library, stamp: key, index }
  return index
}
