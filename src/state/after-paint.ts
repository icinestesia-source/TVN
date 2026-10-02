/**
 * Runs `run` once the browser has painted the next frame and then has idle time. A task queued from inside an
 * animation frame only starts after that frame is painted. Returns a cancel.
 */
export function afterPaint(run: () => void): () => void {
  let timer = 0
  let idle = 0
  const frame = window.requestAnimationFrame(() => {
    timer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(run, { timeout: 4000 })
      else run()
    }, 0)
  })
  return () => {
    window.cancelAnimationFrame(frame)
    window.clearTimeout(timer)
    if (idle) window.cancelIdleCallback(idle)
  }
}
