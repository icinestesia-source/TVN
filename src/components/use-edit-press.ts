import { useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { createLongPress } from '../view/channel-edit.ts'

/** The bar's control pad keeps its own clicks, right-clicks and holds. */
function inPad(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.info-actions') !== null
}

/**
 * A right-click or a touch hold anywhere on an information bar, apart from its buttons, edits the channel.
 * Without `onEdit` (a channel that cannot be edited) the bar behaves as plain text.
 */
export function useEditPress(onEdit: (() => void) | undefined) {
  const editRef = useRef(onEdit)
  editRef.current = onEdit
  const [press] = useState(() => createLongPress(() => editRef.current?.()))
  return {
    press,
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (editRef.current && !inPad(event.target)) press.down(event)
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => press.move(event),
      onPointerUp: press.up,
      onPointerCancel: press.cancel,
      onContextMenu: (event: MouseEvent<HTMLElement>) => {
        if (!editRef.current || inPad(event.target)) return
        event.preventDefault()
        press.opened()
        editRef.current()
      },
      onClickCapture: (event: MouseEvent<HTMLElement>) => {
        // The lift that ends a hold opened the editor; it presses nothing on the bar.
        if (press.swallowClick()) event.stopPropagation()
      },
    },
  }
}
