import type { LoadResult, PlayerHandle, PlayerLoadRequest } from './types.ts'

export type PlayerRoute = 'youtube' | 'local'

/** The local media element: a player that can also let go of its file entirely. */
export interface LocalPlayerHandle extends PlayerHandle {
  stop(): void
}

const SILENCE: PlayerLoadRequest = { videoId: null, startSeconds: 0, loop: false }

/** YouTube for network videos; the browser's own media element for session files and live streams. */
export function routeFor(request: PlayerLoadRequest): PlayerRoute {
  return request.localUrl || request.streamUrl ? 'local' : 'youtube'
}

/**
 * One handle over both players. Each load picks the player for its source and silences the other first,
 * so a switch between network and local media never leaves two pictures or two soundtracks running.
 */
export function routedPlayer(
  youtube: () => PlayerHandle | null,
  local: () => LocalPlayerHandle | null,
  onRoute: (route: PlayerRoute) => void,
): LocalPlayerHandle {
  let route: PlayerRoute = 'youtube'
  let sound: [audible: boolean, volume: number, muted: boolean] = [true, 100, false]
  const active = (): PlayerHandle | null => (route === 'local' ? local() : youtube())
  const inactive = (): PlayerHandle | null => (route === 'local' ? youtube() : local())
  return {
    load(request): Promise<LoadResult> {
      const next = routeFor(request)
      if (next !== route) {
        route = next
        // The player taking over inherits the sound the viewer asked for; the one handing over goes quiet.
        active()?.setAudible(...sound)
        inactive()?.setAudible(false, 0, true)
      }
      onRoute(route)
      if (route === 'local') {
        void youtube()?.load(SILENCE)
        return local()?.load(request) ?? Promise.resolve('error')
      }
      local()?.stop()
      return youtube()?.load(request) ?? Promise.resolve('slate')
    },
    play() {
      active()?.play()
    },
    pause() {
      active()?.pause()
    },
    seek(seconds) {
      active()?.seek(seconds)
    },
    setAudible(audible, volume, muted) {
      sound = [audible, volume, muted]
      active()?.setAudible(audible, volume, muted)
      inactive()?.setAudible(false, 0, true)
    },
    currentTime() {
      return active()?.currentTime() ?? 0
    },
    actualVideoId() {
      return route === 'local' ? null : (youtube()?.actualVideoId() ?? null)
    },
    stop() {
      void youtube()?.load(SILENCE)
      local()?.stop()
    },
  }
}
