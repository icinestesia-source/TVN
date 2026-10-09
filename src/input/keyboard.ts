import type { TvCommand } from '../types/input.ts'

/** Keys typed into a text field belong to the field, not the television. */
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false
  const element = target as { tagName?: string; isContentEditable?: boolean }
  return element.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName ?? '')
}

export function commandFromKeyEvent(
  event: { key: string; target: unknown; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  guideOpen: boolean,
  multiview = false,
): TvCommand | null {
  if (isEditableTarget(event.target)) return null
  return commandFromKey(event.key, { meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey }, guideOpen, multiview)
}

export function commandFromKey(
  key: string,
  modifiers: { meta: boolean; ctrl: boolean; alt: boolean },
  guideOpen: boolean,
  multiview = false,
): TvCommand | null {
  if (modifiers.meta || modifiers.ctrl || modifiers.alt) return null

  if (/^[0-9]$/.test(key)) return { type: 'digit', digit: Number(key) }

  const moveFocus = multiview && !guideOpen

  switch (key) {
    case 'ArrowUp':
      if (guideOpen) return { type: 'nav', direction: 'up' }
      return moveFocus ? { type: 'focus-move', direction: 'up' } : { type: 'channel-up' }
    case 'ArrowDown':
      if (guideOpen) return { type: 'nav', direction: 'down' }
      return moveFocus ? { type: 'focus-move', direction: 'down' } : { type: 'channel-down' }
    case 'ArrowLeft':
      if (guideOpen) return { type: 'nav', direction: 'left' }
      return moveFocus ? { type: 'focus-move', direction: 'left' } : { type: 'volume-down' }
    case 'ArrowRight':
      if (guideOpen) return { type: 'nav', direction: 'right' }
      return moveFocus ? { type: 'focus-move', direction: 'right' } : { type: 'volume-up' }
    case 'Enter':
      return { type: 'confirm' }
    case 'Escape':
      return { type: 'cancel' }
    case 'Backspace':
      return { type: 'digit-back' }
    // Space is TV Surf (a hold switches its scope: see space-hold.ts); P pauses and resumes.
    case ' ':
      return guideOpen ? null : { type: 'random-channel' }
    case 'p':
    case 'P':
      return { type: 'play-pause' }
    case 'g':
    case 'G':
      return { type: 'guide' }
    case 'v':
    case 'V':
      return { type: 'info' }
    case 'm':
    case 'M':
      return { type: 'mute' }
    case '/':
      return { type: 'multiview' }
    case ',':
      return { type: 'history-back' }
    case '.':
      return { type: 'history-forward' }
    case 'u':
    case 'U':
      return { type: 'guide-tool', tool: 'add' }
    case 'f':
    case 'F':
      return { type: 'fullscreen' }
    case 'a':
    case 'A':
      return { type: 'favourite' }
    case 's':
    case 'S':
      return { type: 'subtitles' }
    case 'd':
    case 'D':
      return { type: 'debug' }
    case 'i':
    case 'I':
      return { type: 'media' }
    case 'o':
    case 'O':
      return { type: 'export-all' }
    case 'y':
    case 'Y':
      return { type: 'user-channels' }
    case 'c':
    case 'C':
      return { type: 'guide-cycle' }
    // A channel's schedule, as the Guide's buttons arrange it: REFRESH (a new random order), LATEST and A to Z, and RELOAD.
    case 'r':
    case 'R':
      return { type: 'schedule', action: 'random' }
    case 'x':
    case 'X':
      return { type: 'schedule', action: 'reload' }
    case 'l':
    case 'L':
      return { type: 'schedule', action: 'latest' }
    case 'z':
    case 'Z':
      return { type: 'schedule', action: 'az' }
    case 't':
    case 'T':
      return { type: 'surf' }
    case 'b':
    case 'B':
      return { type: 'step', direction: -1 }
    case 'n':
    case 'N':
      return { type: 'step', direction: 1 }
    case 'h':
    case 'H':
    case '?':
      return { type: 'hints' }
    case 'Home':
      return { type: 'guide-now' }
    case 'e':
    case 'E':
    case 'ContextMenu':
      return { type: 'guide-tool', tool: 'edit' }
    // The unshifted keys: in the Guide they zoom the timeline, over the picture they set the volume.
    case '=':
    case '+':
      return guideOpen ? { type: 'guide-zoom', direction: 1 } : { type: 'volume-up' }
    case '-':
    case '_':
      return guideOpen ? { type: 'guide-zoom', direction: -1 } : { type: 'volume-down' }
    case 'PageUp':
      return guideOpen ? { type: 'nav', direction: 'up', rows: 8 } : { type: 'channel-up' }
    case 'PageDown':
      return guideOpen ? { type: 'nav', direction: 'down', rows: 8 } : { type: 'channel-down' }
    default:
      return null
  }
}
