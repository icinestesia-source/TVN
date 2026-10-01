import type { PlaybackMode } from '../types/programme.ts'

/**
 * Map a broadcast seek onto the attached media.
 * The schedule seek stays untouched; this is only the player adapter.
 * Live sources join the live edge. They do not seek into a recording.
 */
export function mediaSeekSeconds(
  scheduleSeekSeconds: number,
  programme: {
    playbackMode: PlaybackMode
    durationSeconds: number
    mediaDurationSeconds?: number
    playback?: 'seekable-recorded' | 'live' | 'audio' | 'generated'
  },
): number {
  if (programme.playback === 'live') return 0
  const elapsed = Math.max(0, scheduleSeekSeconds)
  const media = programme.mediaDurationSeconds

  if (programme.playbackMode === 'loop-demo' && media && media > 1) {
    return Math.min(elapsed % media, media - 1)
  }

  if (media && media > 1) {
    return Math.min(elapsed, media - 1)
  }

  return Math.min(elapsed, Math.max(0, programme.durationSeconds - 0.25))
}
