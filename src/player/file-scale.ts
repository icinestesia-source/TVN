/**
 * Seconds on the schedule to seconds on this element. Firefox measures an MP3 without a seek index from its
 * bitrate and can come out a minute short of the feed's length, so a seek late in an episode lands past
 * the end of the file. A position in proportion to the browser's own length lands where the schedule means.
 */
export function fileScale(elementSeconds: number, scheduledSeconds: number | undefined): number {
  if (!scheduledSeconds || !Number.isFinite(elementSeconds) || elementSeconds <= 1) return 1
  const gap = Math.abs(elementSeconds - scheduledSeconds)
  if (gap <= Math.max(2, scheduledSeconds * 0.005) || gap > scheduledSeconds * 0.25) return 1
  return elementSeconds / scheduledSeconds
}
