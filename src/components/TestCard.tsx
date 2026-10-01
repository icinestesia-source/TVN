import { scheduleBootstrapping } from '../director/cache.ts'
import { useTv } from '../state/tv-context.ts'
import { onScreen } from '../player/manual.ts'
import { useClock } from '../utils/use-clock.ts'
import { formatClock, formatElapsed, padChannel } from '../utils/time.ts'
import { hasPicture } from '../session/session-channel.ts'
import { isRefusalCode, refusedVideos } from '../services/embed-refusals.ts'

const BARS = ['#c4c4c4', '#c4c400', '#00c4c4', '#00c400', '#c400c4', '#c40000', '#0000c4']

export function TestCard() {
  const now = useClock(1000)
  const { channel, playerStatus, playerDetail } = useTv()
  const snapshot = onScreen(channel, now)
  const programme = snapshot.current.programme
  const stream = programme.liveStream !== undefined
  const progress = stream ? 0 : Math.min(100, (snapshot.current.elapsedSeconds / programme.durationSeconds) * 100)
  const waiting = playerStatus === 'loading-api' || playerStatus === 'buffering'
  const failed = playerStatus === 'error'
  const nextAt = formatClock(snapshot.next.startMs)
  const pictureless = !hasPicture(programme)
  const refused = (failed && isRefusalCode(playerDetail)) || Boolean(programme.videoId && refusedVideos().has(programme.videoId))
  const provisional = pictureless && !programme.caption && scheduleBootstrapping()
  const note = provisional
    ? 'TVN · PICTURE COMING UP'
    : pictureless
    ? (programme.caption ?? `TVN · PROGRAMMING RESUMES SOON · NEXT ${nextAt}`)
    : stream
      ? failed
        ? 'LIVE STREAM CURRENTLY UNAVAILABLE'
        : 'CONNECTING TO LIVE STREAM'
    : refused
      ? `THE PUBLISHER DOES NOT ALLOW THIS VIDEO TO PLAY OUTSIDE YOUTUBE · NEXT ${nextAt}`
    : failed
      ? `PROGRAMME CURRENTLY UNAVAILABLE · NEXT ${nextAt}`
      : waiting
        ? 'PICTURE COMING UP'
        : 'DEMONSTRATION TRANSMISSION'

  return (
    <div className="test-card">
      <div className="bars" aria-hidden="true">
        {BARS.map((color) => (
          <span key={color} style={{ background: color }} />
        ))}
      </div>
      <div className="card-disc" aria-hidden="true" />
      <div className="card-copy">
        <p className="card-number">{padChannel(channel.number)}</p>
        <p className="card-name">{channel.name}</p>
        <p className="card-title">{provisional ? 'Tuning in' : programme.title}</p>
        <p className="card-elapsed">{pictureless || stream ? formatClock(now, true) : formatElapsed(snapshot.current.elapsedSeconds)}</p>
        <p className="card-note">
          {note}
        </p>
      </div>
      <div className="card-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}
