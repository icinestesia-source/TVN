import { hasPicture, sessionActive } from '../session/session-channel.ts'
import type { PlayerStatus } from '../player/types.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'

export type ScreenFace = 'picture' | 'card' | 'radio' | 'session-empty'

/** What the single-view screen shows over (or instead of) the player for this channel and programme. */
export function screenFace(channel: Channel, programme: Programme, status: PlayerStatus): ScreenFace {
  const session = channel.origin === 'session'
  if (session && !sessionActive(channel.number)) return 'session-empty'
  // A live stream that will not play shows TVN's unavailable card, radio or not.
  if (programme.liveStream && status === 'error') return 'card'
  // A channel mixing episodes (audio files beside video) shows the radio face for its audio ones.
  if (channel.mediaKind === 'audio' || ((session || programme.mediaUrl !== undefined) && programme.mediaKind === 'audio')) return 'radio'
  if (!hasPicture(programme) || status === 'loading-api' || status === 'slate' || status === 'error') return 'card'
  return 'picture'
}
