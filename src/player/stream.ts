import { SOURCE_TYPES, type ChannelSource } from '../services/channel-sources.ts'

const PROBE_MS = 8000

/** HLS plays only where the browser handles it natively (Safari, iOS, and recent Chrome and Edge). */
export function nativeHls(canPlayType: (type: string) => string): boolean {
  return canPlayType('application/vnd.apple.mpegurl') !== '' || canPlayType('application/x-mpegurl') !== ''
}

/** Opens a stream in a muted, detached media element and reports whether it starts delivering media. */
export function probeStream(source: Pick<ChannelSource, 'kind' | 'url'>, timeoutMs = PROBE_MS): Promise<'online' | 'unavailable' | 'unsupported'> {
  if (typeof document === 'undefined') return Promise.resolve('unavailable')
  const type = SOURCE_TYPES[source.kind]
  const element = document.createElement(type.media === 'audio' ? 'audio' : 'video')
  if (type.format === 'hls' && !nativeHls((mime) => element.canPlayType(mime))) return Promise.resolve('unsupported')
  element.muted = true
  element.preload = 'metadata'
  return new Promise((resolve) => {
    let settled = false
    const done = (verdict: 'online' | 'unavailable') => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      element.removeAttribute('src')
      element.load()
      resolve(verdict)
    }
    const timer = window.setTimeout(() => done('unavailable'), timeoutMs)
    element.addEventListener('loadedmetadata', () => done('online'), { once: true })
    element.addEventListener('error', () => done('unavailable'), { once: true })
    element.src = source.url
  })
}
