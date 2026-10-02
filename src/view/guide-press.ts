import { createLongPress, type PressPoint } from './channel-edit.ts'

type Timers = Parameters<typeof createLongPress>[1]
export type GuidePressActions = { open: () => void; search: () => void }

/**
 * GUIDE in the Guide header. A click or a tap opens the viewer's Guide at once; a right-click or a touch
 * held past the long-press threshold opens CREATE GUIDE FROM… instead, and never the click as well.
 * Each event brings the handlers current when it happens; a hold keeps those it began with.
 */
export function createGuidePress(timers?: Timers) {
  let held: GuidePressActions | null = null
  const press = createLongPress(() => held?.search(), timers)
  let pointer = 'mouse'
  return {
    down(point: PressPoint, actions: GuidePressActions) {
      pointer = point.pointerType
      held = actions
      press.down(point)
    },
    move: (point: PressPoint) => press.move(point),
    up: () => press.up(),
    cancel: () => press.cancel(),
    click(actions: GuidePressActions) {
      pointer = 'mouse'
      if (press.swallowClick()) return
      actions.open()
    },
    contextMenu(actions: GuidePressActions) {
      if (pointer !== 'mouse') {
        // The phone's own menu during a touch hold is that hold, once; after the hold has fired it is nothing.
        const holding = press.holding()
        press.opened()
        if (holding) actions.search()
        return
      }
      press.cancel()
      actions.search()
    },
  }
}
