import type { PlayerHandle } from './types.ts'

/**
 * What the browser held back when TVN started: 'sound' while the picture plays muted and waits for the viewer
 * before sound is allowed. Held sound needs no words: it shows as Muted, and UNMUTE or any key or tap brings it.
 */
export type StartHold = 'sound' | null

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
 * back. `current` is false once something else has tuned, paused or left single view, and the check stops:
 * if that was Surf rather than the viewer, sound was never proven allowed, so it stays held.
 */
export async function confirmStart(
  player: PlayerHandle,
  current: () => boolean,
  wait: Wait,
  interacted: () => boolean = viewerInteracted,
): Promise<StartHold> {
  const unproven = (): StartHold => (interacted() ? null : 'sound')
  const moving = await advancing(player, wait)
  if (!current()) return unproven()
  // A click or key during the check (CONTINUE on the welcome notice, say) is the interaction itself.
  if (moving || interacted()) return null
  player.setAudible(false, 0, true)
  player.play()
  // Muted and still not moving is a slow first clip as often as a refusal: it is left to play on, with no
  // message over it, and the viewer's first key or tap brings the sound either way.
  await advancing(player, wait)
  if (!current()) return unproven()
  if (interacted()) return null
  return 'sound'
}

/**
 * Whether a tune must keep the sound off. Unmuting a muted video before the viewer has interacted makes the
 * browser pause it on its still, so sound stays off while the start is held or still being checked.
 */
export function soundHeld(hold: StartHold, checking: boolean, interacted: boolean): boolean {
  return hold !== null || (checking && !interacted)
}

let touched = false
if (typeof window !== 'undefined') {
  const mark = () => {
    touched = true
  }
  window.addEventListener('pointerdown', mark, { capture: true, once: true })
  window.addEventListener('keydown', mark, { capture: true, once: true })
}

/** The browser's own record of the viewer's interaction, or the first click or key where it keeps none. */
export function viewerInteracted(): boolean {
  try {
    if (typeof navigator !== 'undefined' && navigator.userActivation) return navigator.userActivation.hasBeenActive
  } catch {
    /* fall through */
  }
  return touched
}

type AutoplayPolicy = 'allowed' | 'allowed-muted' | 'disallowed'

/**
 * True when the browser says outright that this site may start media only muted (Firefox answers; Chrome keeps
 * no such answer and TVN checks the start instead), and the viewer has not yet clicked or pressed a key.
 */
export function soundRefused(
  policy: (() => AutoplayPolicy | undefined) | null = () =>
    (navigator as Navigator & { getAutoplayPolicy?: (type: 'mediaelement') => AutoplayPolicy }).getAutoplayPolicy?.('mediaelement'),
  interacted: () => boolean = viewerInteracted,
): boolean {
  try {
    return typeof navigator !== 'undefined' && policy?.() === 'allowed-muted' && !interacted()
  } catch {
    return false
  }
}
