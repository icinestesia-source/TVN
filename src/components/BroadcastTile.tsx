import { useEffect, useRef, useState } from 'react'
import { channelByNumber } from '../data/catalogue.ts'
import { YoutubeStage } from '../player/YoutubeStage.tsx'
import type { PlayerHandle, PlayerStatus } from '../player/types.ts'
import { deliver, playbackCommand } from '../player/command.ts'
import { videoOverride } from '../services/overrides.ts'
import { liveKey } from '../scheduler/calculate.ts'
import { broadcast } from '../services/broadcast.ts'
import { useTv } from '../state/tv-context.ts'
import { useClock } from '../utils/use-clock.ts'
import { padChannel } from '../utils/time.ts'
import { tileEmbeds } from '../view/multiview.ts'
import { RadioFace } from './RadioFace.tsx'

export function BroadcastTile({
  channelNumber,
  index,
  audible,
  active,
  focused,
}: {
  channelNumber: number
  index: number
  audible: boolean
  active: boolean
  focused: boolean
}) {
  const tv = useTv()
  const now = useClock(1000)
  const playerRef = useRef<PlayerHandle | null>(null)
  const keyRef = useRef('')
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState<PlayerStatus>('loading-api')
  const channel = channelByNumber(channelNumber)
  const audio = channel?.mediaKind === 'audio'
  const tileRef = useRef<HTMLElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const snap = channel ? broadcast(channel, now) : null
  const failed = status === 'error'
  // YouTube allows one automatically playing embedded player per screen, at least 200×200: the selected
  // tile. The others show a still of what their own channel is airing now, so each changes at its own
  // programme boundary.
  const embed = active && tileEmbeds({ focused, ...size })
  const thumbnail = size.width >= 120 && size.height >= 70
  const still = !audio && !embed && thumbnail && snap?.current.programme.videoId ? `https://i.ytimg.com/vi/${snap.current.programme.videoId}/hqdefault.jpg` : null

  useEffect(() => {
    const node = tileRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.borderBoxSize?.[0]
      setSize(box ? { width: box.inlineSize, height: box.blockSize } : { width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [channel])

  useEffect(() => {
    if (!embed) {
      setReady(false)
      setStatus('loading-api')
      keyRef.current = ''
      return
    }
    const timer = window.setTimeout(() => setReady(true), Math.min(index, 8) * 120)
    return () => window.clearTimeout(timer)
  }, [embed, index, channelNumber])

  useEffect(() => {
    if (!ready || !channel || audio) return
    const position = broadcast(channel, Date.now())
    const key = liveKey(channel.id, position.current.programme.id, position.current.startMs)
    if (key === keyRef.current) return
    const handle = playerRef.current
    if (!handle) return
    keyRef.current = key
    const command = playbackCommand(position.current.programme, position.current.seekSeconds, videoOverride(channel.number))
    void deliver(handle, command)
  }, [audio, channel, now, ready])

  useEffect(() => {
    playerRef.current?.setAudible(audible && active && !tv.muted, tv.volume, !audible || tv.muted)
  }, [active, audible, ready, status, tv.muted, tv.volume])

  if (!channel || !snap) return null

  return (
    <article
      ref={tileRef}
      className={focused ? 'tile is-focus' : 'tile'}
      onClick={() => tv.dispatch({ type: 'focus-tile', index })}
      onDoubleClick={() => tv.dispatch({ type: 'confirm' })}
      onContextMenu={(event) => event.preventDefault()}
    >
      {audio ? <RadioFace channel={channel} compact /> : null}
      {still ? <img className="tile-still" src={still} alt="" loading="lazy" decoding="async" /> : null}
      {!audio && embed && ready ? (
        // YouTube replaces its host element with the iframe, so React must own the node it removes.
        <div className="tile-player">
          <YoutubeStage
            playerRef={playerRef}
            captions={tv.subtitles}
            onReady={() => {
              setStatus('buffering')
            }}
            onStatus={(next) => setStatus(next)}
          />
        </div>
      ) : null}
      {!audio && (failed || !snap.current.programme.videoId) ? (
        <div className="tile-slate">
          <p>{failed ? 'Picture unavailable' : padChannel(channel.number)}</p>
          <p>{snap.current.programme.title}</p>
        </div>
      ) : null}
      <p className="tile-bug">
        {audible ? <span className="tile-audio">Audio</span> : null}
        {padChannel(channel.number)} {channel.shortName}
      </p>
    </article>
  )
}
