import type { PlayerHandle } from './types.ts'

/**
 * What the browser held back when TVN started: 'sound' when the picture plays muted and waits for the
 * viewer before sound is allowed, 'picture' when nothing may start until the viewer interacts.
 */
export type StartHold = 'sound' | 'picture' | null

export const START_HOLD_COPY: Record<Exclude<StartHold, null>, string> = {
  sound: 'Sound off · press any key or tap for sound',
  picture: 'Press any key or tap to start',
}

type Wait = (ms: number) => Promise<void>

/** A player reporting a loaded video can still be sitting on its still: only a moving clock is playback. */
export async function advancing(player: Pick<PlayerHandle, 'currentTime'>, wait: Wait): Promise<boolean> {
  await wait(1000)
  const from = player.currentTime()
  await wait(2500)
  return player.currentTime() - from > 0.5
}

/**
 * Checks the first programme really started. Browsers refuse sound before the viewer has interacted with a
 * new site, so when it did not start TVN plays it muted, as browsers allow, and reports what is being held
 * back. `current` is false once the viewer has tuned, paused or left single view, and the check stops.
 */
export async function confirmStart(player: PlayerHandle, current: () => boolean, wait: Wait): Promise<StartHold> {
  if (await advancing(player, wait)) return null
  if (!current()) return null
  player.setAudible(false, 0, true)
  player.play()
  const muted = await advancing(player, wait)
  if (!current()) return null
  return muted ? 'sound' : 'picture'
}
