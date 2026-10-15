import type { KeyboardEvent } from 'react'

/** Enter and Space press the control; they must not also reach the television (and tune or confirm the Guide). */
export function keepKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}
