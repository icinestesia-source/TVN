import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'

/** What kind of picture this is, in the bar's own small vocabulary: a live stream, a video, or local media on 000. */
export type PlaybackLabel = 'Live' | 'Video' | 'Local'

export function playbackLabel(channel: Channel, programme: Programme): PlaybackLabel {
  if (channel.origin === 'session') return 'Local'
  return programme.liveStream !== undefined ? 'Live' : 'Video'
}
