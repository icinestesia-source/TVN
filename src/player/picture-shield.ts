/**
 * The picture belongs to TVN. A provider's own player (YouTube's iframe) is shown and driven through its API, but
 * the viewer never touches it: pointer input stops at TVN's layer above it (`.click-catch`, with the provider
 * surfaces at `pointer-events: none`), and these keep keyboard focus out of the frame, where it would take TVN's
 * keys and bring up the provider's own controls.
 */
export function shieldProviderFrame(frame: Element | null | undefined): void {
  if (!frame || frame.tagName !== 'IFRAME') return
  ;(frame as HTMLIFrameElement).tabIndex = -1
  frame.setAttribute('aria-hidden', 'true')
}

const PICTURE = '.stage, .tile'

/** A provider frame inside the picture, if that is where focus is. */
export function focusedProviderFrame(doc: Document): HTMLElement | null {
  const active = doc.activeElement
  return active?.tagName === 'IFRAME' && active.closest(PICTURE) ? (active as HTMLElement) : null
}

/** Focus that reaches a provider frame anyway goes straight back to TVN, so its keys keep working. */
export function guardProviderFocus(win: Window = window): () => void {
  let timer = 0
  const reclaim = () => {
    win.clearTimeout(timer)
    timer = win.setTimeout(() => {
      const frame = focusedProviderFrame(win.document)
      if (!frame) return
      frame.blur()
      win.focus()
    }, 0)
  }
  // The window blurs when focus moves into a frame; a window that never had system focus may only see focusin.
  win.addEventListener('blur', reclaim)
  win.document.addEventListener('focusin', reclaim, true)
  return () => {
    win.clearTimeout(timer)
    win.removeEventListener('blur', reclaim)
    win.document.removeEventListener('focusin', reclaim, true)
  }
}
