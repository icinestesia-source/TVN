import type { ScreenFace } from '../app/screen-face.ts'

/**
 * What owns the single-view stage, beneath the tuning static that covers it while a tune is pending (so
 * the static hands over to this without a bare frame). TVN's cards and faces replace the picture for
 * channels without one; on a picture channel the provider's
 * video is shown only once the airing it was last asked for is really playing (or the viewer paused it
 * there). Until then TVN's noise owns the picture, so the provider's own still, spinner or play button
 * is never what the viewer sees.
 */
export type PictureOwner = 'face' | 'cover' | 'video'

export function pictureOwner(state: { face: ScreenFace; live: boolean; paused: boolean }): PictureOwner {
  if (state.face !== 'picture') return 'face'
  return state.live || state.paused ? 'video' : 'cover'
}

/**
 * A provider's PLAYING report belongs to the current request only when the player is on the video it was
 * last asked for (and, for a live request, that video is still live). A late report from the video it was
 * playing before cannot uncover the picture of the one asked for since.
 */
export function playingRequested(requested: string | null, actual: string | null, liveRequest: boolean, isLive: boolean | undefined): boolean {
  if (!requested || actual !== requested) return false
  return !(liveRequest && isLive === false)
}

/** How long the player may take to answer a load before it counts as failed. */
export const PLAYER_LOAD_TIMEOUT_MS = 12000
