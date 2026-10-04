import { LONG_PRESS_MS } from '../view/channel-edit.ts'

/**
 * Space is the keyboard's TV Surf button: a press surfs, a hold switches the surf scope (ALL or the active
 * User Network), exactly as a click and a right-click or hold do on the button. A hold never also surfs, the
 * key's auto-repeat is not a second press, and a press abandoned (the window losing focus) does nothing.
 */
export interface SpaceHold {
  /** keydown; `repeat` is the browser's auto-repeat for a key already down. */
  down(repeat: boolean): void
  /** keyup. */
  up(): void
  /** The key's release will never arrive here (focus left the window): forget the press. */
  cancel(): void
}

export function createSpaceHold({ surf, toggle, delayMs = LONG_PRESS_MS }: { surf: () => void; toggle: () => void; delayMs?: number }): SpaceHold {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pressed = false
  let held = false
  return {
    down(repeat) {
      if (repeat || pressed) return
      pressed = true
      held = false
      timer = setTimeout(() => {
        held = true
        toggle()
      }, delayMs)
    },
    up() {
      if (!pressed) return
      pressed = false
      clearTimeout(timer)
      if (!held) surf()
    },
    cancel() {
      pressed = false
      clearTimeout(timer)
    },
  }
}
