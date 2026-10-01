export type PictureKind = 'real' | 'seed' | 'holding'

export interface PlaybackTrace {
  channelNumber: number | null
  programmeId: string
  programmeTitle: string
  mediaId: string | null
  provider: string
  externalId: string | null
  expectedVideoId: string | null
  resolvedVideoId: string | null
  requestedVideoId: string | null
  actualVideoId: string | null
  playerState: string
  playerTime: number
  expectedSeek: number
  lastLoad: string | null
  lastCue: string | null
  lastPlay: string | null
  lastError: string | null
  fallbackActive: boolean
  fallbackReason: string | null
  kind: PictureKind
}

const blank = (): PlaybackTrace => ({
  channelNumber: null,
  programmeId: '',
  programmeTitle: '',
  mediaId: null,
  provider: '',
  externalId: null,
  expectedVideoId: null,
  resolvedVideoId: null,
  requestedVideoId: null,
  actualVideoId: null,
  playerState: 'idle',
  playerTime: 0,
  expectedSeek: 0,
  lastLoad: null,
  lastCue: null,
  lastPlay: null,
  lastError: null,
  fallbackActive: false,
  fallbackReason: null,
  kind: 'holding',
})

let current = blank()
const listeners = new Set<() => void>()

export function playbackTrace(): PlaybackTrace {
  return current
}

export function subscribePlaybackTrace(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notePlayback(patch: Partial<PlaybackTrace>): void {
  current = { ...current, ...patch }
  for (const listener of listeners) listener()
}

export function resetPlaybackTrace(): void {
  current = blank()
}
