import { loadYouTubeApi } from './load-api.ts'
import type { YouTubePlayer } from '../types/youtube.ts'

export interface YoutubeProbeSuccess {
  ok: true
  durationSec: number
  /** Present when getVideoData() returns a title. Absent titles stay unset. */
  title?: string
}

export interface YoutubeProbeFailure {
  ok: false
  reason: string
}

export type YoutubeProbeResult = YoutubeProbeSuccess | YoutubeProbeFailure

/** Resolves one known YouTube ID. It does not search or accept a page URL. */
export interface YoutubeMetadataProbe {
  resolve(providerItemId: string): Promise<YoutubeProbeResult>
  close?(): void
}

const METADATA_TIMEOUT_MS = 12_000

/** Official IFrame Player API error codes. */
export function youtubePlayerFailure(code: number): string {
  if (code === 100) return 'video unavailable'
  if (code === 101 || code === 150) return 'embedding disabled'
  if (code === 2) return 'invalid video id'
  return 'player error'
}

interface PendingMetadata {
  generation: number
  providerItemId: string
  sawRequestedVideo: boolean
  askedPlay: boolean
  finish: (result: YoutubeProbeResult) => void
}

/**
 * One hidden IFrame player, reused for every ID.
 * Duration comes from getDuration() after the requested video has loaded.
 */
export function createYouTubeMetadataProbe(): YoutubeMetadataProbe {
  let player: YouTubePlayer | null = null
  let host: HTMLDivElement | null = null
  let opening: Promise<YouTubePlayer> | null = null
  let pending: PendingMetadata | null = null
  let generation = 0
  let timer = 0
  let poll = 0

  const finish = (current: number, result: YoutubeProbeResult) => {
    if (!pending || pending.generation !== current) return
    window.clearTimeout(timer)
    window.clearInterval(poll)
    const done = pending.finish
    pending = null
    done(result)
  }

  const readDuration = () => {
    const current = pending
    const active = player
    if (!current || !active) return
    const data = active.getVideoData?.()
    if (data?.video_id !== current.providerItemId) return
    current.sawRequestedVideo = true
    const duration = active.getDuration()
    if (Number.isFinite(duration) && duration > 0) {
      active.pauseVideo()
      const title = typeof data.title === 'string' ? data.title.trim() : ''
      finish(current.generation, title ? { ok: true, durationSec: duration, title } : { ok: true, durationSec: duration })
      return
    }
    if (!current.askedPlay) {
      current.askedPlay = true
      active.mute()
      active.playVideo()
    }
  }

  const ensurePlayer = async (): Promise<YouTubePlayer> => {
    if (player) return player
    if (opening) return opening
    opening = (async () => {
      if (typeof document === 'undefined' || !document.body) throw new Error('player unavailable')
      await loadYouTubeApi()
      if (!window.YT?.Player) throw new Error('player unavailable')
      const element = document.createElement('div')
      element.setAttribute('aria-hidden', 'true')
      element.style.position = 'absolute'
      element.style.width = '200px'
      element.style.height = '200px'
      element.style.left = '-9999px'
      element.style.top = '0'
      element.style.pointerEvents = 'none'
      document.body.appendChild(element)
      host = element
      const created = await new Promise<YouTubePlayer>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('player unavailable')), METADATA_TIMEOUT_MS)
        const instance = new window.YT!.Player(element, {
          width: 200,
          height: 200,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              window.clearTimeout(timeout)
              event.target.mute()
              resolve(event.target)
            },
            onStateChange: () => {
              readDuration()
            },
            onError: (event) => {
              const current = pending
              if (!current) return
              finish(current.generation, { ok: false, reason: youtubePlayerFailure(event.data) })
            },
          },
        })
        void instance
      })
      player = created
      return created
    })()
    opening = opening.catch((error: unknown) => {
      opening = null
      throw error
    })
    return opening
  }

  return {
    async resolve(providerItemId) {
      let active: YouTubePlayer
      try {
        active = await ensurePlayer()
      } catch {
        return { ok: false, reason: 'player unavailable' }
      }
      const current = ++generation
      return new Promise<YoutubeProbeResult>((done) => {
        pending = { generation: current, providerItemId, sawRequestedVideo: false, askedPlay: false, finish: done }
        timer = window.setTimeout(() => {
          const reason = pending?.sawRequestedVideo ? 'duration unavailable' : 'metadata unavailable'
          finish(current, { ok: false, reason })
        }, METADATA_TIMEOUT_MS)
        poll = window.setInterval(readDuration, 250)
        active.cueVideoById({ videoId: providerItemId })
      })
    },
    close() {
      generation += 1
      if (typeof window !== 'undefined') {
        window.clearTimeout(timer)
        window.clearInterval(poll)
      }
      pending = null
      player?.destroy()
      player = null
      opening = null
      host?.remove()
      host = null
    },
  }
}
