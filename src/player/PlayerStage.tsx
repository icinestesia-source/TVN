import { useImperativeHandle, useRef, useState, type RefObject } from 'react'
import { LocalStage } from './LocalStage.tsx'
import { routedPlayer, type LocalPlayerHandle, type PlayerRoute } from './routed.ts'
import type { PlayerHandle, PlayerStatus } from './types.ts'
import { YoutubeStage } from './YoutubeStage.tsx'

/** The single-view player: YouTube for the network, the local media element for session files. */
export function PlayerStage({
  playerRef,
  onReady,
  onStatus,
  captions,
}: {
  playerRef: RefObject<PlayerHandle | null>
  onReady: () => void
  onStatus: (status: PlayerStatus, detail?: string) => void
  captions: boolean
}) {
  const youtubeRef = useRef<PlayerHandle | null>(null)
  const localRef = useRef<LocalPlayerHandle | null>(null)
  const routeRef = useRef<PlayerRoute>('youtube')
  const [route, setRoute] = useState<PlayerRoute>('youtube')

  useImperativeHandle(
    playerRef,
    () =>
      routedPlayer(
        () => youtubeRef.current,
        () => localRef.current,
        (next) => {
          routeRef.current = next
          setRoute(next)
        },
      ),
    [],
  )

  // Only the player that owns the picture may report status; the silenced one's slate is not the viewer's.
  const fromYoutube = (status: PlayerStatus, detail?: string) => {
    if (routeRef.current === 'youtube') onStatus(status, detail)
  }
  const fromLocal = (status: PlayerStatus, detail?: string) => {
    if (routeRef.current === 'local') onStatus(status, detail)
  }

  return (
    <>
      <YoutubeStage playerRef={youtubeRef} onReady={onReady} onStatus={fromYoutube} captions={captions} />
      <LocalStage handleRef={localRef} onStatus={fromLocal} shown={route === 'local'} />
    </>
  )
}
