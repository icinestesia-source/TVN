import { useEffect, useRef, useState } from 'react'
import { createWheelStepper, swipeStep } from '../input/gestures.ts'
import { PlayerStage } from '../player/PlayerStage.tsx'
import { pictureOwner } from '../player/picture.ts'
import { guardProviderFocus } from '../player/picture-shield.ts'
import { startWebInteraction, stopWebInteraction, useWebInteraction } from '../player/web-interaction.ts'
import { SessionCard } from '../components/SessionCard.tsx'
import { TvnChannelPanel } from '../components/TvnChannelPanel.tsx'
import { screenFace } from './screen-face.ts'
import { useTv } from '../state/tv-context.ts'
import { onScreen } from '../player/manual.ts'
import { useClock } from '../utils/use-clock.ts'
import { clampGuideSplit } from '../view/guide-mode.ts'
import { DebugPanel } from '../components/DebugPanel.tsx'
import { DiagnosticPanel } from '../components/DiagnosticPanel.tsx'
import { Guide } from '../components/Guide.tsx'
import { Hints } from '../components/Hints.tsx'
import { MultiviewGrid } from '../components/MultiviewGrid.tsx'
import { ChannelEditor } from '../components/ChannelEditor.tsx'
import { SessionImportTools } from '../components/GuideAdd.tsx'
import { sessionProgrammes } from '../session/session-channel.ts'
import { NowNextOverlay } from '../components/NowNextOverlay.tsx'
import { editorScope } from '../view/channel-edit.ts'
import { NumericEntry } from '../components/NumericEntry.tsx'
import { RadioFace } from '../components/RadioFace.tsx'
import { Noise } from '../components/StaticOverlay.tsx'
import { ChannelTransition } from '../components/TransitionOverlay.tsx'
import { TestCard } from '../components/TestCard.tsx'
import { TouchRemote } from '../components/TouchRemote.tsx'
import { VolumeOsd } from '../components/VolumeOsd.tsx'
import { CreditsRoll } from '../credits/CreditsRoll.tsx'
import { useAboutOpen, useNoticeAcknowledged } from '../legal/about-store.ts'
import { AboutPanel } from '../legal/AboutPanel.tsx'
import { FirstRunNotice } from '../legal/FirstRunNotice.tsx'
import { presentedChannel, transitionTiming } from '../state/transitions.ts'
import { BufferingTitle } from '../components/BufferingTitle.tsx'
import { slowSource } from '../player/slow-source.ts'

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

const GUIDE_CLOSE_MS = 300
const INFO_FADE_MS = 320

/** Keeps a panel on screen long enough to play its closing animation (the guide folding, the bar fading). */
function usePresence(open: boolean, closeMs: number): 'open' | 'closing' | null {
  const [wasOpen, setWasOpen] = useState(open)
  const [closing, setClosing] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    setClosing(!open && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  }
  useEffect(() => {
    if (!closing) return
    const id = window.setTimeout(() => setClosing(false), closeMs)
    return () => window.clearTimeout(id)
  }, [closing, closeMs])
  return open ? 'open' : closing ? 'closing' : null
}

export function TvScreen() {
  const tv = useTv()
  const guide = usePresence(tv.guideMode !== 'closed', GUIDE_CLOSE_MS)
  const now = useClock(1000)
  const width = useViewportWidth()
  const aboutOpen = useAboutOpen()
  const noticeSeen = useNoticeAcknowledged()
  const narrow = width < 800
  const single = tv.multiviewMode === '1'
  const programme = onScreen(tv.channel, now).current.programme
  const [held, setHeld] = useState(false)
  const holding = held && single
  useEffect(() => guardProviderFocus(), [])
  const web = useWebInteraction()
  // INSTANT holds the old picture while the destination loads unseen: nothing is drawn over it until the cut.
  const face = holding ? 'picture' : screenFace(tv.channel, programme, tv.playerStatus)
  const owner = holding ? 'picture' : pictureOwner({ face, live: tv.pictureLive, paused: tv.paused })
  const audio = face === 'radio'
  const showCard = face === 'card'
  // Only a publisher's own file or stream is titled while it buffers; YouTube keeps its plain cut.
  const slow = single && face === 'picture' && slowSource(programme)
  const nextClip = owner === 'cover' && tv.tuningNumber === null && tv.presentation === null && tv.pictureChannel === tv.channel.number
  const presented = presentedChannel({
    presentation: tv.presentation,
    tuningNumber: tv.tuningNumber,
    channelNumber: tv.channel.number,
    covered: owner === 'cover',
    single,
  })
  // The picture (or a face) has the screen: the effect cuts, or fades for its reveal, and the presentation ends.
  const ending = tv.presentation !== null && presented === null && tv.tuningNumber === null ? tv.presentation : null
  const revealMs = ending ? transitionTiming(ending.settings).revealMs : 0
  // INFO waits for the picture, not just the commit: the card names the channel until then.
  const info = usePresence(tv.overlay === 'info' && tv.tuningNumber === null && presented === null && !holding, INFO_FADE_MS)
  const { endTransition } = tv
  useEffect(() => {
    if (!ending) return
    const id = window.setTimeout(() => endTransition(ending.session), revealMs)
    return () => window.clearTimeout(id)
  }, [ending, revealMs, endTransition])
  const layer = presented !== null && tv.presentation ? { presentation: tv.presentation, number: presented, revealing: false } : ending && revealMs > 0 && single ? { presentation: ending, number: ending.number, revealing: true } : null
  const shell = [
    'tv',
    tv.guideMode === 'integrated' ? 'is-integrated' : '',
    tv.guideMode === 'expanded' ? 'is-expanded' : '',
    single ? 'is-single' : 'is-multi',
    narrow ? 'is-narrow' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={shell}
      style={{
        ['--video-fr' as string]: `${tv.guideSplit}fr`,
        ['--guide-fr' as string]: `${1 - tv.guideSplit}fr`,
      }}
    >
      <div className={tv.credits ? 'watch is-credits' : 'watch'}>
        {single ? (
          <div className={`${face === 'picture' ? 'stage' : 'stage is-card'}${web.interacting ? ' is-interacting' : ''}`}>
            <PlayerStage playerRef={tv.playerRef} onReady={tv.onPlayerReady} onStatus={tv.onPlayerStatus} captions={tv.subtitles} prebuffer={tv.transition.id === 'instant'} onHold={setHeld} />
            {/* Static belongs to changing channel; the next clip on the same channel comes in on a plain cut. */}
            {owner === 'cover' ? (
              <div className="stage-waiting">
                {nextClip ? null : <Noise />}
                {slow ? <BufferingTitle key={programme.id} programme={programme} /> : null}
              </div>
            ) : slow && owner === 'video' && tv.playerStatus === 'buffering' && !tv.paused ? (
              <BufferingTitle key={programme.id} programme={programme} over />
            ) : null}
            {audio ? <RadioFace channel={tv.channel} /> : null}
            {showCard ? <TestCard /> : null}
            {face === 'session-empty' ? <SessionCard channel={tv.channel} /> : null}
            {/* TVN's glass: lifted only while the viewer uses a website they chose INTERACT on. */}
            {web.interacting ? null : <PictureCatch />}
            <WebControls />
          </div>
        ) : (
          <MultiviewGrid width={width} />
        )}
        {layer ? (
          <ChannelTransition key={layer.presentation.session} settings={layer.presentation.settings} channelNumber={layer.presentation.cardNumber ?? layer.number} revealing={layer.revealing} />
        ) : null}
        {tv.credits ? <CreditsRoll /> : null}
        {tv.screenEdit !== null ? (
          <div className="screen-edit-stack">
            <ScreenEditor />
            <NowNextOverlay />
          </div>
        ) : info ? (
          <NowNextOverlay leaving={info === 'closing'} />
        ) : null}
        {tv.overlay === 'volume' ? <VolumeOsd volume={tv.volume} muted={tv.muted} /> : null}
        {tv.numeric ? <NumericEntry digits={tv.numeric} /> : null}
        {tv.notice ? <div className="notice">{tv.notice}</div> : null}
        {tv.paused ? <div className="paused-bug">Paused</div> : null}
        <Hints />
      </div>
      {tv.guideMode === 'integrated' && single && !narrow ? <GuideSplitter /> : null}
      {guide ? <Guide closing={guide === 'closing'} /> : null}
      <TouchRemote />
      {tv.startupPhase === 'ready' && !noticeSeen ? <FirstRunNotice startNewNetwork={tv.startNewNetwork} networkCustomised={tv.networkCustomised} /> : null}
      {aboutOpen ? <AboutPanel /> : null}
      {tv.debugOpen ? <DiagnosticPanel /> : null}
      {import.meta.env.DEV && tv.debugOpen ? <DebugPanel /> : null}
    </div>
  )
}

/**
 * A website programme on screen: INTERACT hands it the pointer and keyboard; EXIT, or Esc while TVN has the
 * keyboard, gives them back. When its slot ends mid-use the schedule moves on and says so briefly.
 */
function WebControls() {
  const web = useWebInteraction()
  useEffect(() => {
    if (!web.interacting) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      stopWebInteraction()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [web.interacting])
  if (web.interacting) {
    return (
      <div className="web-bar" role="status">
        <span>Interacting · Esc to TVN</span>
        <button
          type="button"
          className="web-exit"
          onClick={() => {
            stopWebInteraction()
            window.focus()
          }}
        >
          Exit
        </button>
      </div>
    )
  }
  if (web.shown) {
    return (
      <button type="button" className="web-interact" title="Use this website: pointer and keyboard go to it until EXIT or Esc"
        onClick={() => {
          startWebInteraction()
          window.requestAnimationFrame(() => document.querySelector<HTMLIFrameElement>('.web-host.is-interacting')?.focus())
        }}
      >
        Interact
      </button>
    )
  }
  return web.endedAt > 0 ? (
    <div className="web-bar is-ended" role="status">
      Website slot ended
    </div>
  ) : null
}

/**
 * The picture itself: a tap or click shows the information bar, a double-click goes full screen, and a
 * scroll or a vertical swipe changes channel.
 */
function PictureCatch() {
  const tv = useTv()
  const [wheel] = useState(createWheelStepper)
  const swipe = useRef<{ id: number; x: number; y: number; at: number } | null>(null)
  const swiped = useRef(false)
  return (
    <div
      className="click-catch"
      onClick={() => {
        if (swiped.current) swiped.current = false
        else tv.dispatch({ type: 'info' })
      }}
      onDoubleClick={() => tv.dispatch({ type: 'fullscreen' })}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={(event) => {
        const step = wheel(event)
        if (step) tv.dispatch(step)
      }}
      onPointerDown={(event) => {
        swiped.current = false
        swipe.current = event.pointerType === 'mouse' ? null : { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp }
      }}
      onPointerUp={(event) => {
        const start = swipe.current
        swipe.current = null
        if (!start || start.id !== event.pointerId) return
        const step = swipeStep(start, { x: event.clientX, y: event.clientY, at: event.timeStamp })
        if (!step) return
        swiped.current = true
        tv.dispatch(step)
      }}
      onPointerCancel={() => {
        swipe.current = null
      }}
    />
  )
}

/** The Channel Editor over the picture, where the information bar sits, for the channel being watched. */
function ScreenEditor() {
  const tv = useTv()
  const scope = editorScope(tv.channel)
  if (!scope || tv.screenEdit !== tv.channel.number) return null
  if (scope === 'local') {
    return (
      <div className="info-bar screen-editor">
        <SessionImportTools
          key={tv.channel.number}
          channel={tv.channel}
          programmes={sessionProgrammes(tv.channel.number)}
          watching
          onImport={tv.importSession}
          onRemove={tv.removeSessionFile}
          onMove={tv.moveSessionFile}
          onReload={tv.reloadLocalMedia}
          onClear={tv.clearLocalChannel}
          onRename={tv.renameLocalChannel}
          onWatch={() => {}}
          onClose={() => tv.dispatch({ type: 'guide-tool', tool: 'edit' })}
        />
      </div>
    )
  }
  if (scope === 'tvn') {
    return (
      <div className="info-bar screen-editor">
        <TvnChannelPanel onChooseAnother={tv.chooseAnotherTvn} onClose={() => tv.dispatch({ type: 'guide-tool', tool: 'edit' })} />
      </div>
    )
  }
  return (
    <div className="info-bar screen-editor">
      <ChannelEditor
        key={tv.channel.number}
        channel={tv.channel}
        scope={scope}
        onLoad={tv.openChannelEdit}
        onSave={tv.saveChannelEdit}
        onRescan={tv.rescanChannelEdit}
        onLoadMore={tv.loadMoreChannelSource}
        onDelete={scope === 'curated' ? tv.restoreCuratedChannel : tv.deleteUserChannel}
        onClose={() => tv.dispatch({ type: 'guide-tool', tool: 'edit' })}
        onExport={tv.exportChannelFile}
        archiveOf={tv.sourceArchive}
        onPlay={tv.playChannelProgramme}
      />
    </div>
  )
}

function GuideSplitter() {
  const tv = useTv()
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={30}
      aria-valuemax={70}
      aria-valuenow={Math.round(tv.guideSplit * 100)}
      onPointerDown={(event) => {
        const handle = event.currentTarget
        const parent = handle.parentElement
        if (!parent) return
        handle.setPointerCapture(event.pointerId)
        const move = (pointer: PointerEvent) => {
          const rect = parent.getBoundingClientRect()
          if (rect.width <= 0) return
          tv.dispatch({ type: 'guide-split', share: clampGuideSplit((pointer.clientX - rect.left) / rect.width) })
        }
        const end = () => {
          handle.removeEventListener('pointermove', move)
          handle.removeEventListener('pointerup', end)
        }
        handle.addEventListener('pointermove', move)
        handle.addEventListener('pointerup', end)
      }}
    />
  )
}
