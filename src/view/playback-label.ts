import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'

/** What kind of picture this is, in the bar's own small vocabulary: a live stream, a video, an audio episode, or 1000 Local Media. */
export type PlaybackLabel = 'Live' | 'Video' | 'Audio' | 'Local'

export function playbackLabel(channel: Channel, programme: Programme): PlaybackLabel {
  if (channel.origin === 'session') return 'Local'
  if (programme.liveStream !== undefined) return 'Live'
  return programme.mediaUrl !== undefined && programme.mediaKind === 'audio' ? 'Audio' : 'Video'
}
