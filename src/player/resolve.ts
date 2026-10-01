import type { MediaKind, Programme } from '../types/programme.ts'

export interface ResolvedSource {
  type: 'youtube' | 'local' | 'audio' | 'generated'
  sourceId: string
  videoId: string | null
}

/**
 * Turn a scheduled programme into something a player can attempt.
 * The scheduler never calls this.
 */
export function resolveSource(programme: Programme, channelKind: MediaKind = 'video'): ResolvedSource {
  const kind = programme.mediaKind ?? channelKind
  const sourceId = programme.sourceRef ?? (programme.videoId ? `youtube:${programme.videoId}` : `generated:${programme.id}`)

  if (kind === 'audio' || programme.programmeType === 'radio') {
    return { type: 'audio', sourceId, videoId: programme.videoId }
  }
  if (programme.videoId && programme.source !== 'demo') {
    return { type: 'youtube', sourceId, videoId: programme.videoId }
  }
  if (programme.videoId) {
    return { type: 'youtube', sourceId, videoId: programme.videoId }
  }
  if (programme.sourceRef?.startsWith('local:')) {
    return { type: 'local', sourceId, videoId: null }
  }
  return { type: 'generated', sourceId, videoId: null }
}
