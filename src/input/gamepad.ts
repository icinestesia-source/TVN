import type { TvCommand } from '../types/input.ts'

/**
 * Standard gamepad. D-pad and the left stick move the guide.
 * A confirms, B goes back, Start or Back opens the guide, X shows info, Y in the guide edits the channel.
 */
const CONFIRM = 0
const BACK = 1
const INFO = 2
const EDIT = 3
const GUIDE_BACK = 8
const GUIDE_START = 9
const DPAD = [12, 13, 14, 15] as const

export function commandFromGamepad(
  pad: { buttons: readonly { pressed: boolean }[]; axes: readonly number[] },
  held: ReadonlySet<number>,
  guideOpen: boolean,
): { command: TvCommand | null; held: Set<number> } {
  const down = new Set<number>()
  const press = (index: number) => {
    if (!pad.buttons[index]?.pressed) return false
    down.add(index)
    return !held.has(index)
  }

  const direction = (index: number): TvCommand => {
    if (!guideOpen) {
      if (index === 12) return { type: 'channel-up' }
      if (index === 13) return { type: 'channel-down' }
      if (index === 14) return { type: 'volume-down' }
      return { type: 'volume-up' }
    }
    if (index === 12) return { type: 'nav', direction: 'up' }
    if (index === 13) return { type: 'nav', direction: 'down' }
    if (index === 14) return { type: 'nav', direction: 'left' }
    return { type: 'nav', direction: 'right' }
  }

  let command: TvCommand | null = null
  if (press(12)) command = direction(12)
  else if (press(13)) command = direction(13)
  else if (press(14)) command = direction(14)
  else if (press(15)) command = direction(15)
  else if (press(CONFIRM)) command = { type: 'confirm' }
  else if (press(BACK)) command = { type: 'cancel' }
  else if (press(GUIDE_START) || press(GUIDE_BACK)) command = { type: 'guide' }
  else if (press(INFO)) command = { type: 'info' }
  else if (guideOpen && press(EDIT)) command = { type: 'guide-tool', tool: 'edit' }

  if (!command) {
    const x = pad.axes[0] ?? 0
    const y = pad.axes[1] ?? 0
    const stick =
      Math.abs(x) > 0.55 || Math.abs(y) > 0.55
        ? Math.abs(x) > Math.abs(y)
          ? x > 0
            ? 15
            : 14
          : y > 0
            ? 13
            : 12
        : null
    if (
      guideOpen &&
      stick !== null &&
      !held.has(stick) &&
      !DPAD.some((index) => pad.buttons[index]?.pressed)
    ) {
      down.add(stick)
      command = direction(stick)
    }
  }

  return { command, held: down }
}
