import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react'
import { handoffPlayer, type HandoffPlayer, type Slot } from './handoff.ts'
import { LocalStage } from './LocalStage.tsx'
import { routedPlayer, routeFor, type LocalPlayerHandle, type PlayerRoute } from './routed.ts'
import type { PlayerHandle, PlayerStatus } from './types.ts'
import { YoutubeStage } from './YoutubeStage.tsx'

/**
 * The single-view player: YouTube for the network, the local media element for session files. With
 * INSTANT a second, hidden slot loads the next programme while the current one stays on screen.
 */
export function PlayerStage({
  playerRef,
  onReady,
  onStatus,
  captions,
  prebuffer = false,
  onHold,
}: {
  playerRef: RefObject<PlayerHandle | null>
  onReady: () => void
  onStatus: (status: PlayerStatus, detail?: string) => void
  captions: boolean
  prebuffer?: boolean
  onHold?: (held: boolean) => void
}) {
  const youtubeRefs = [useRef<PlayerHandle | null>(null), useRef<PlayerHandle | null>(null)] as const
  const localRefs = [useRef<LocalPlayerHandle | null>(null), useRef<LocalPlayerHandle | null>(null)] as const
  const routeRefs = useRef<[PlayerRoute, PlayerRoute]>(['youtube', 'youtube'])
  const [routes, setRoutes] = useState<[PlayerRoute, PlayerRoute]>(['youtube', 'youtube'])
  const [primary, setPrimary] = useState<Slot>(0)
  // The standby slot appears the first time INSTANT is chosen and then stays, so a slot on screen is never removed.
  const [standbyMounted, setStandbyMounted] = useState(prebuffer)
  if (prebuffer && !standbyMounted) setStandbyMounted(true)
  const ready = useRef<[boolean, boolean]>([false, false])
  const prebufferRef = useRef(prebuffer)
  const onStatusRef = useRef(onStatus)
  const onHoldRef = useRef(onHold)
  const handoffRef = useRef<HandoffPlayer | null>(null)

  useEffect(() => {
    prebufferRef.current = prebuffer
    onStatusRef.current = onStatus
    onHoldRef.current = onHold
  })

  useImperativeHandle(
    playerRef,
    () => {
      const slots = ([0, 1] as const).map((index) =>
        routedPlayer(
          () => youtubeRefs[index].current,
          () => localRefs[index].current,
          (next) => {
            routeRefs.current[index] = next
            setRoutes((current) => (current[index] === next ? current : index === 0 ? [next, current[1]] : [current[0], next]))
          },
        ),
      )
      const player = handoffPlayer({
        slot: (index) => slots[index],
        prebuffer: () => prebufferRef.current,
        ready: (index, request) => routeFor(request) === 'local' ? localRefs[index].current !== null : ready.current[index],
        onPrimary: setPrimary,
        onHold: (held) => onHoldRef.current?.(held),
        emit: (status, detail) => onStatusRef.current(status, detail),
      })
      handoffRef.current = player
      return player
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Only the player that owns a slot's picture may report for it; the silenced one's slate is not the viewer's.
  const from = (index: Slot, route: PlayerRoute) => (status: PlayerStatus, detail?: string) => {
    if (routeRefs.current[index] === route) handoffRef.current?.status(index, status, detail)
  }
  const readied = (index: Slot) => () => {
    ready.current[index] = true
    if (index === 0) onReady()
  }

  const slot = (index: Slot) => (
    <div key={index} className={primary === index ? 'player-slot' : 'player-slot is-standby'} aria-hidden={primary === index ? undefined : true}>
      <YoutubeStage playerRef={youtubeRefs[index]} onReady={readied(index)} onStatus={from(index, 'youtube')} captions={captions} />
      <LocalStage handleRef={localRefs[index]} onStatus={from(index, 'local')} shown={routes[index] === 'local'} />
    </div>
  )

  return (
    <>
      {slot(0)}
      {standbyMounted ? slot(1) : null}
    </>
  )
}
