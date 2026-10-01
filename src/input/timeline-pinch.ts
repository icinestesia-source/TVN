import { touchDistance, touchMidpoint, wheelZoomFactor } from '../epg/zoom.ts'

export interface TimelinePinchHandlers {
  /** The zoom a new gesture starts from (including one still waiting to be drawn). */
  zoomBase: () => number
  /** Zoom to `zoom`, holding the time at `offsetPx` from the timeline's left edge. */
  requestZoom: (zoom: number, offsetPx: number) => void
}

type PinchTarget = Pick<HTMLElement, 'addEventListener' | 'removeEventListener' | 'getBoundingClientRect'>
type SafariGestureEvent = Event & { scale: number; clientX: number }

/**
 * Pinch over the Guide timeline zooms the timeline instead of the page: ctrl-wheel (trackpad pinch
 * in Chromium and Firefox), Safari's gesture events, and two-finger touch. The listeners live on
 * the timeline alone and are non-passive so the page's own zoom can be declined there; ordinary
 * wheel and one-finger scrolling pass straight through. Returns the cleanup.
 */
export function bindTimelinePinch(timeline: PinchTarget, handlers: () => TimelinePinchHandlers): () => void {
  const offsetOf = (clientX: number) => clientX - timeline.getBoundingClientRect().left
  let gesture: { startZoom: number } | null = null
  let touch: { startZoom: number; startDistance: number } | null = null

  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return
    event.preventDefault()
    if (gesture || touch) return
    const { zoomBase, requestZoom } = handlers()
    requestZoom(zoomBase() * wheelZoomFactor(event.deltaY, event.deltaMode), offsetOf(event.clientX))
  }
  const onGestureStart = (event: Event) => {
    event.preventDefault()
    if (!touch) gesture = { startZoom: handlers().zoomBase() }
  }
  const onGestureChange = (event: Event) => {
    event.preventDefault()
    if (!gesture || touch) return
    const { scale, clientX } = event as SafariGestureEvent
    handlers().requestZoom(gesture.startZoom * scale, offsetOf(clientX))
  }
  const onGestureEnd = (event: Event) => {
    event.preventDefault()
    gesture = null
  }
  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 2) return
    event.preventDefault()
    touch = { startZoom: handlers().zoomBase(), startDistance: touchDistance(event.touches[0], event.touches[1]) }
  }
  const onTouchMove = (event: TouchEvent) => {
    if (!touch || event.touches.length < 2) return
    event.preventDefault()
    if (touch.startDistance <= 0) return
    const a = event.touches[0]
    const b = event.touches[1]
    handlers().requestZoom(touch.startZoom * (touchDistance(a, b) / touch.startDistance), offsetOf(touchMidpoint(a, b).x))
  }
  const onTouchEnd = (event: TouchEvent) => {
    if (event.touches.length < 2) touch = null
  }

  const listeners: [string, (event: never) => void, AddEventListenerOptions | undefined][] = [
    ['wheel', onWheel, { passive: false }],
    ['gesturestart', onGestureStart, { passive: false }],
    ['gesturechange', onGestureChange, { passive: false }],
    ['gestureend', onGestureEnd, { passive: false }],
    ['touchstart', onTouchStart, { passive: false }],
    ['touchmove', onTouchMove, { passive: false }],
    ['touchend', onTouchEnd, undefined],
    ['touchcancel', onTouchEnd, undefined],
  ]
  for (const [type, listener, options] of listeners) timeline.addEventListener(type, listener as EventListener, options)
  return () => {
    for (const [type, listener] of listeners) timeline.removeEventListener(type, listener as EventListener)
  }
}
