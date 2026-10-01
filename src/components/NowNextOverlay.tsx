import { demoCredit } from '../data/media.ts'
import { useTv } from '../state/tv-context.ts'
import { manualAiring, onScreen, stepFrom } from '../player/manual.ts'
import { hasPicture } from '../session/session-channel.ts'
import { useClock } from '../utils/use-clock.ts'
import { editorScope } from '../view/channel-edit.ts'
import { channelActions, cornerActions } from '../view/info-shortcuts.ts'
import { historyActions, InfoActions } from './InfoActions.tsx'
import { ProgrammeInfo } from './ProgrammeInfo.tsx'
import { useEditPress } from './use-edit-press.ts'

/**
 * INFO: the Guide's information bar over the picture, for what the channel is showing now and next,
 * with the same actions. A right-click or a hold anywhere on it but its buttons (or E) edits the channel, as in the Guide.
 */
export function NowNextOverlay({ leaving = false }: { leaving?: boolean }) {
  const now = useClock(1000)
  const tv = useTv()
  const { channel } = tv
  const snapshot = onScreen(channel, now)
  const current = snapshot.current
  const next = snapshot.next
  const stream = current.programme.liveStream !== undefined
  const steps = !stream && channel.origin !== 'session'
  const progress = stream ? 100 : Math.min(100, (current.elapsedSeconds / current.programme.durationSeconds) * 100)
  const credit = demoCredit(current.programme.videoId)
  const editable = editorScope(channel) !== null && tv.multiviewMode === '1'
  const { press, handlers } = useEditPress(editable ? () => tv.dispatch({ type: 'guide-tool', tool: 'edit' }) : undefined)

  return (
    <aside
      className={leaving ? 'guide-info is-programme info-bar is-leaving' : 'guide-info is-programme info-bar'}
      aria-live="polite"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') tv.holdInfo(true)
      }}
      onPointerLeave={(event) => {
        press.cancel()
        if (event.pointerType === 'mouse') tv.holdInfo(false)
      }}
      {...handlers}
    >
      <div className="info-bar-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <ProgrammeInfo
        channel={channel}
        programme={current.programme}
        startMs={current.startMs}
        endMs={current.endMs}
        now={now}
        next={stream ? undefined : { title: next.programme.title, startMs: next.startMs, endMs: next.endMs }}
        picked={manualAiring(channel.number, now) !== null}
      />
      <InfoActions
        key={channel.number}
        channel={channel}
        programme={current.programme}
        onPrev={steps && hasPicture(stepFrom(channel, now, -1).programme) ? () => tv.screenStep(-1) : undefined}
        onNext={steps && hasPicture(stepFrom(channel, now, 1).programme) ? () => tv.screenStep(1) : undefined}
        history={historyActions(tv)}
        corners={cornerActions(tv)}
        channels={channelActions(tv)}
      />
      {credit ? <p className="info-credit">Demonstration picture · {credit}</p> : null}
    </aside>
  )
}
