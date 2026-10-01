import type { MediaItem } from '../../director/types.ts'
import { NETWORK_SOURCES, NETWORK_VIDEOS, type NetworkSourceDefinition } from './manifest.ts'

/** Geography Mix is a general policy. Default films are not assigned there. */
const GENERAL_SINK = 61

export function networkSources(): readonly NetworkSourceDefinition[] {
  return NETWORK_SOURCES
}

let defaults: readonly MediaItem[] | null = null

/** The shipped defaults are fixed, so every publish reuses the same records. */
export function defaultNetworkItems(): readonly MediaItem[] {
  defaults ??= buildDefaultNetworkItems()
  return defaults
}

function buildDefaultNetworkItems(): MediaItem[] {
  const liveSources = new Set(NETWORK_SOURCES.filter((source) => source.enabled).map((source) => source.id))
  return NETWORK_VIDEOS.filter(
    (entry) => entry.verified && entry.durationSeconds > 0 && liveSources.has(entry.sourceId),
  ).map((entry) => {
    const excludes = [GENERAL_SINK]
    if (entry.programmeType !== 'film') excludes.push(103)
    return {
      id: `net:${entry.videoId}`,
      title: entry.title,
      durationSeconds: entry.durationSeconds,
      programmeType: entry.programmeType,
      topics: entry.topics,
      subjects: entry.subjects,
      sport: entry.sport,
      teams: entry.teams,
      year: entry.year,
      provider: 'youtube',
      externalId: entry.videoId,
      sourceRef: entry.sourceId,
      creator: entry.author,
      mediaKind: 'video',
      playbackKind: 'seekable-recorded',
      live: false,
      canSeek: true,
      quality: 'high',
      explicitChannelExcludes: excludes,
    }
  })
}
