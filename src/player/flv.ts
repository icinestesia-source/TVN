/** Containers no browser plays itself, which TVN repackages in the page for the media element. */
export type Remux = 'flv'

/** A repackaged file attached to one media element; letting go detaches it and stops reading. */
export interface Remuxer {
  url: string
  destroy(): void
}

const MSE_AVC = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"'

/** Whether this browser can be handed repackaged FLV at all: it needs Media Source with H.264. */
export function remuxSupported(scope: object = window): boolean {
  const source = (scope as { MediaSource?: { isTypeSupported?(type: string): boolean } }).MediaSource
  return typeof source?.isTypeSupported === 'function' && source.isTypeSupported(MSE_AVC)
}

/** An address that names an FLV file, on the web or as a file name. */
export function remuxOf(address: string | undefined): Remux | undefined {
  return address && /\.flv(?:[?#]|$)/i.test(address) ? 'flv' : undefined
}

/**
 * Repackages the FLV at `url` (an object URL or a web address) into the media element. The library is
 * fetched only the first time an FLV plays. `onError` reports a file that cannot be read or decoded.
 */
export async function attachFlv(video: HTMLMediaElement, url: string, onError: (reason: string) => void): Promise<Remuxer> {
  const { default: mpegts } = await import('mpegts.js')
  mpegts.LoggingControl.applyConfig({ enableAll: false, enableError: false, enableWarn: false, enableInfo: false, enableDebug: false, enableVerbose: false })
  if (!mpegts.isSupported()) throw new Error('flv unsupported')
  const player = mpegts.createPlayer({ type: 'flv', url, isLive: false }, { enableWorker: false, lazyLoad: false, seekType: 'range', accurateSeek: true })
  let live = true
  let reported = false
  // Errors arrive in bursts from queued callbacks; the player must not be torn down inside one of them.
  player.on(mpegts.Events.ERROR, (type: string, detail: string) => {
    if (!live || reported) return
    reported = true
    window.setTimeout(() => {
      if (live) onError(`flv ${String(detail || type).toLowerCase()}`)
    }, 0)
  })
  player.attachMediaElement(video)
  player.load()
  return {
    url,
    destroy() {
      if (!live) return
      live = false
      try {
        player.pause()
        player.unload()
        player.detachMediaElement()
      } finally {
        player.destroy()
      }
    },
  }
}
