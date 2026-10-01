import type { MediaItem } from '../director/types.ts'
import { liveCams, liveEndpoint } from '../dynamic/providers.ts'
import type { Channel } from '../types/channel.ts'
import { sourceIdOf, watchUrl, youtubeChannelUrl, type SourceRegister } from './provenance.ts'

export const EXPORT_FORMAT = 'tvn-provenance-v1'

/**
 * TVN's programming provenance as machine-readable metadata: who made each programme, where it is
 * hosted and how to reach the original. Built on request from the same records as the credit roll. It
 * holds no performance or viewing records and nothing of the viewer's own network.
 */
export function provenanceExport(channels: readonly Channel[], poolOf: (channelNumber: number) => readonly MediaItem[], register: SourceRegister, generatedAt: string) {
  const programmes = new Map<string, { item: MediaItem; channels: number[] }>()
  const live: { channel: number; provider: string; service: string; publisher: string | null; originalId: string; originalUrl: string | null; creatorUrl: string | null }[] = []
  const shipped = channels.filter((channel) => channel.number >= 1 && channel.number <= 999 && channel.origin !== 'user-import' && channel.origin !== 'user-created')
  for (const channel of shipped) {
    for (const item of poolOf(channel.number)) {
      if (!sourceIdOf(item)?.startsWith('src_')) continue
      const entry = programmes.get(item.id) ?? { item, channels: [] }
      entry.channels.push(channel.number)
      programmes.set(item.id, entry)
    }
    const endpoints = [...liveCams(channel.number)]
    const stream = liveEndpoint(channel.number)
    if (stream && !endpoints.includes(stream)) endpoints.push(stream)
    for (const endpoint of endpoints) {
      live.push({
        channel: channel.number,
        provider: 'YouTube',
        service: endpoint.service,
        publisher: endpoint.publisher ?? register.sources[endpoint.sourceId]?.name ?? null,
        originalId: endpoint.videoId,
        originalUrl: watchUrl(endpoint.videoId) ?? null,
        creatorUrl: register.sources[endpoint.sourceId]?.channelUrl ?? youtubeChannelUrl(endpoint.sourceId) ?? null,
      })
    }
  }
  const sources: Record<string, { name: string; provider: string; channelUrl: string | null; website: string | null }> = {}
  const rows: (string | number[] | null)[][] = []
  for (const { item, channels: on } of programmes.values()) {
    const sourceId = sourceIdOf(item) as string
    const recorded = register.sources[sourceId]
    sources[sourceId] ??= { name: recorded?.name ?? sourceId, provider: recorded?.provider ?? 'YouTube', channelUrl: recorded?.channelUrl ?? null, website: recorded?.website ?? null }
    const originalId = item.externalId ?? null
    rows.push([originalId, item.title, sourceId, on, originalId ? (watchUrl(originalId) ?? null) : null])
  }
  return {
    format: EXPORT_FORMAT,
    generatedAt,
    notice:
      'Third-party programmes listed here are hosted by their providers and remain attributable to their creators. TVN claims no ownership of them. No licence is recorded unless stated.',
    sources,
    programmeColumns: ['originalId', 'title', 'sourceId', 'channels', 'originalUrl'],
    programmes: rows,
    live,
  }
}

/** Saves the export as a file in the viewer's browser. Nothing is uploaded. */
export function downloadJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
