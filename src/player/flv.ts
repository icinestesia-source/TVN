import type Mpegts from 'mpegts.js'
import { scanFile, withKeyframeIndex } from './flv-index.ts'
import { sliceLoader } from './flv-slices.ts'

/** Containers no browser plays itself, which TVN repackages in the page for the media element. */
export type Remux = 'flv'

/** A repackaged file attached to one media element; letting go detaches it and stops reading. */
export interface Remuxer {
  url: string
  destroy(): void
}

const MSE_AVC = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"'

/** How far ahead of the picture an FLV is read, when reading resumes, and how much that has played is kept for a short step back. */
export const FLV_READ_AHEAD_SECONDS = 90
export const FLV_RESUME_SECONDS = 30
export const FLV_KEEP_BEHIND_SECONDS = 60

/** Whether this browser can be handed repackaged FLV at all: it needs Media Source with H.264. */
export function remuxSupported(scope: object = window): boolean {
  const source = (scope as { MediaSource?: { isTypeSupported?(type: string): boolean } }).MediaSource
  return typeof source?.isTypeSupported === 'function' && source.isTypeSupported(MSE_AVC)
}

/** An address that names an FLV file, on the web or as a file name. */
export function remuxOf(address: string | undefined): Remux | undefined {
  return address && /\.flv(?:[?#]|$)/i.test(address) ? 'flv' : undefined
}

const files = new Map<string, Blob>()

/** The file behind an object URL made at import, so it can be given a keyframe index before it plays. */
export function registerFlvSource(url: string, file: Blob): void {
  files.set(url, file)
}

export function forgetFlvSource(url: string): void {
  files.delete(url)
}

/** Picture codecs the FLV player can repackage: H.264 and HEVC. */
const PLAYABLE_FLV_VIDEO = new Set([7, 12])

/**
 * The running time of an FLV picked on this device, read from its own tags rather than by loading it into a
 * media element, which Safari cannot do for a whole file at once. Null if TVN cannot play it; undefined if the
 * address is not such a file.
 */
export async function localFlvSeconds(url: string, kind: 'video' | 'audio'): Promise<number | null | undefined> {
  const file = files.get(url)
  if (!file) return undefined
  if (!remuxSupported()) return null
  const scan = await scanFile(file)
  if (!scan) return null
  if (kind === 'video' && (scan.videoCodec === null || !PLAYABLE_FLV_VIDEO.has(scan.videoCodec))) return null
  return Number.isFinite(scan.duration) && scan.duration >= 1 ? scan.duration : null
}

/**
 * Repackages the FLV at `url` (an object URL or a web address) into the media element. The library is
 * fetched only the first time an FLV plays. `onError` reports a file that cannot be read or decoded.
 */
export async function attachFlv(video: HTMLMediaElement, url: string, onError: (reason: string) => void): Promise<Remuxer> {
  const { default: mpegts } = await import('mpegts.js')
  mpegts.LoggingControl.applyConfig({ enableAll: false, enableError: false, enableWarn: false, enableInfo: false, enableDebug: false, enableVerbose: false })
  if (!mpegts.isSupported()) throw new Error('flv unsupported')
  const file = files.get(url)
  const source = file ? await withKeyframeIndex(file) : null
  const playing = source && source !== file ? URL.createObjectURL(source) : url
  // The browser's media buffer is limited (about 150 MB of video in Chrome). A long file must be read a minute or
  // so ahead of the picture, with what has played let go, or the buffer fills and the picture stops.
  const player = mpegts.createPlayer(
    { type: 'flv', url: playing, isLive: false },
    {
      ...(source ? { customLoader: sliceLoader(source) as unknown as Mpegts.CustomLoaderConstructor } : {}),
      enableWorker: false,
      seekType: 'range',
      accurateSeek: true,
      lazyLoad: true,
      lazyLoadMaxDuration: FLV_READ_AHEAD_SECONDS,
      lazyLoadRecoverDuration: FLV_RESUME_SECONDS,
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: FLV_KEEP_BEHIND_SECONDS,
      autoCleanupMinBackwardDuration: FLV_KEEP_BEHIND_SECONDS / 2,
    },
  )
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
        if (playing !== url) URL.revokeObjectURL(playing)
      }
    },
  }
}
