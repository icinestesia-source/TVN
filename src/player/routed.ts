import type { LoadResult, PlayerHandle, PlayerLoadRequest } from './types.ts'
import { vimeoIdOf } from './vimeo.ts'

export type PlayerRoute = 'youtube' | 'local' | 'embed' | 'web'

/** The local media element: a player that can also let go of its file entirely. */
export interface LocalPlayerHandle extends PlayerHandle {
  stop(): void
}

const SILENCE: PlayerLoadRequest = { videoId: null, startSeconds: 0, loop: false }

/** YouTube for network videos; a provider's embed for a Vimeo video; a sandboxed frame for a website; the browser's own media element for files and live streams. */
export function routeFor(request: PlayerLoadRequest): PlayerRoute {
  if (request.webUrl) return 'web'
  if (vimeoIdOf(request.localUrl)) return 'embed'
  return request.localUrl || request.streamUrl ? 'local' : 'youtube'
}

/**
 * One handle over every player. Each load picks the player for its source and silences the others first,
 * so a switch between network, embedded and local media never leaves two pictures or two soundtracks running.
 */
export function routedPlayer(
  youtube: () => PlayerHandle | null,
  local: () => LocalPlayerHandle | null,
  onRoute: (route: PlayerRoute) => void,
  embed: () => LocalPlayerHandle | null = () => null,
  web: () => LocalPlayerHandle | null = () => null,
): LocalPlayerHandle {
  let route: PlayerRoute = 'youtube'
  let sound: [audible: boolean, volume: number, muted: boolean] = [true, 100, false]
  const handle = (which: PlayerRoute): PlayerHandle | null => (which === 'local' ? local() : which === 'embed' ? embed() : which === 'web' ? web() : youtube())
  const others = (): PlayerRoute[] => (['youtube', 'local', 'embed', 'web'] as const).filter((which) => which !== route)
  const active = (): PlayerHandle | null => handle(route)
  const letGo = (which: PlayerRoute) => {
    if (which === 'youtube') void youtube()?.load(SILENCE)
    else if (which === 'local') local()?.stop()
    else if (which === 'web') web()?.stop()
    else embed()?.stop()
  }
  return {
    load(request): Promise<LoadResult> {
      const next = routeFor(request)
      if (next !== route) {
        route = next
        // The player taking over inherits the sound the viewer asked for; the ones handing over go quiet.
        active()?.setAudible(...sound)
        for (const which of others()) handle(which)?.setAudible(false, 0, true)
      }
      onRoute(route)
      for (const which of others()) letGo(which)
      if (route === 'local') return local()?.load(request) ?? Promise.resolve('error')
      if (route === 'embed') return embed()?.load(request) ?? Promise.resolve('error')
      if (route === 'web') return web()?.load(request) ?? Promise.resolve('error')
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
      for (const which of others()) handle(which)?.setAudible(false, 0, true)
    },
    currentTime() {
      return active()?.currentTime() ?? 0
    },
    actualVideoId() {
      return route === 'youtube' ? (youtube()?.actualVideoId() ?? null) : null
    },
    stop() {
      void youtube()?.load(SILENCE)
      local()?.stop()
      embed()?.stop()
      web()?.stop()
    },
  }
}
