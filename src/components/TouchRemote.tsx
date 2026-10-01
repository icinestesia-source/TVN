import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { openAbout } from '../legal/about-store.ts'
import { sleepLabel } from '../state/sleep.ts'
import { SURF_LIMIT_MAX, SURF_LIMIT_MIN } from '../state/surf.ts'
import { useTv } from '../state/tv-context.ts'
import { createLongPress } from '../view/channel-edit.ts'

const KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
/** Matches how long the information bar stays up. */
const CONTROLS_MS = 6000

export function TouchRemote() {
  const tv = useTv()
  const barRef = useRef<HTMLDivElement>(null)
  const [pointerNear, setPointerNear] = useState(false)
  const [focused, setFocused] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const openSettings = () => {
    if (tv.remoteOpen) tv.dispatch({ type: 'remote' })
    setSettingsOpen(true)
  }
  const openRef = useRef(openSettings)
  openRef.current = openSettings
  const press = useMemo(() => createLongPress(() => openRef.current()), [])

  // Moving the mouse or touching the screen brings the buttons back, like the information bar.
  useEffect(() => {
    let timer = 0
    const show = () => {
      setPointerNear(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setPointerNear(false), CONTROLS_MS)
    }
    const events = ['pointermove', 'pointerdown', 'touchstart'] as const
    for (const name of events) window.addEventListener(name, show, { passive: true })
    return () => {
      for (const name of events) window.removeEventListener(name, show)
      window.clearTimeout(timer)
    }
  }, [])

  const shown = tv.overlay === 'info' || tv.guideOpen || tv.remoteOpen || settingsOpen || pointerNear || focused

  // The information bar shares this row and stretches up to the first button, whatever the buttons read.
  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar) return
    const root = document.documentElement
    const apply = () => root.style.setProperty('--dock-w', `${bar.offsetWidth}px`)
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply)
    observer?.observe(bar)
    return () => observer?.disconnect()
  }, [])

  return (
    <>
      <div
        className={shown ? 'remote-bar' : 'remote-bar is-hidden'}
        ref={barRef}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
        }}
      >
        <button
          type="button"
          className={tv.guideOpen ? 'guide-key is-on' : 'guide-key'}
          aria-pressed={tv.guideOpen}
          onClick={() => tv.dispatch({ type: 'guide' })}
        >
          Guide
        </button>
        <button type="button" onClick={() => tv.dispatch({ type: 'multiview' })}>
          Multi
        </button>
        <button type="button" onClick={() => tv.dispatch({ type: 'remote' })}>
          Remote
        </button>
        <button
          type="button"
          className={tv.surfing ? 'tvn-key is-on' : 'tvn-key'}
          aria-pressed={tv.surfing}
          aria-haspopup="dialog"
          title="Surf random channels · right-click or hold for TVN settings"
          onPointerDown={(event) => press.down(event)}
          onPointerMove={(event) => press.move(event)}
          onPointerUp={press.up}
          onPointerCancel={press.cancel}
          onPointerLeave={press.cancel}
          onContextMenu={(event) => {
            event.preventDefault()
            press.opened()
            openSettings()
          }}
          onClick={() => {
            if (!press.swallowClick()) tv.toggleSurf()
          }}
        >
          TVN
        </button>
      </div>
      {settingsOpen ? (
        <section
          className="remote-panel tvn-settings"
          role="dialog"
          aria-label="TVN settings"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            setSettingsOpen(false)
          }}
        >
          <p className="tvn-settings-head">TVN settings</p>
          <p className="tvn-settings-note">Random surf. Click TVN to start or stop; each hop comes after a random wait in this range.</p>
          <label className="tvn-range">
            <span>Minimum</span>
            <input
              type="range"
              min={SURF_LIMIT_MIN}
              max={SURF_LIMIT_MAX}
              step={1}
              value={tv.surfRange.minSeconds}
              onChange={(event) => tv.setSurfRange({ ...tv.surfRange, minSeconds: Number(event.target.value) }, 'min')}
            />
            <output>{tv.surfRange.minSeconds} s</output>
          </label>
          <label className="tvn-range">
            <span>Maximum</span>
            <input
              type="range"
              min={SURF_LIMIT_MIN}
              max={SURF_LIMIT_MAX}
              step={1}
              value={tv.surfRange.maxSeconds}
              onChange={(event) => tv.setSurfRange({ ...tv.surfRange, maxSeconds: Number(event.target.value) }, 'max')}
            />
            <output>{tv.surfRange.maxSeconds} s</output>
          </label>
          <button
            type="button"
            className="tvn-about-link"
            onClick={() => {
              setSettingsOpen(false)
              openAbout()
            }}
          >
            About · Sources · Legal
          </button>
          <div className="remote-foot">
            <button type="button" aria-pressed={tv.surfing} onClick={tv.toggleSurf}>
              {tv.surfing ? 'Stop surf' : 'Start surf'}
            </button>
            <button type="button" className="remote-close" onClick={() => setSettingsOpen(false)}>
              Close
            </button>
          </div>
        </section>
      ) : null}
      {tv.remoteOpen ? (
        <section className="remote-panel" role="dialog" aria-label="Remote control">
          <div className="remote-row">
            <button type="button" onClick={() => tv.dispatch({ type: 'channel-up' })}>
              CH+
            </button>
            <button type="button" onClick={() => tv.dispatch({ type: 'channel-down' })}>
              CH−
            </button>
            <button type="button" onClick={() => tv.dispatch({ type: 'last-channel' })}>
              Last
            </button>
            <button type="button" onClick={() => tv.dispatch({ type: 'random-channel' })}>
              Random
            </button>
          </div>
          <div className="remote-row">
        <button type="button" onClick={() => tv.dispatch({ type: 'info' })}>
          Info
        </button>
        <button type="button" onClick={() => tv.dispatch({ type: 'user-channels' })}>
          User
        </button>
            <button type="button" onClick={() => tv.dispatch({ type: 'favourite' })}>
              Fav
            </button>
            <button type="button" onClick={() => tv.dispatch({ type: 'mute' })}>
              {tv.muted ? 'Sound' : 'Mute'}
            </button>
          </div>
          <div className="remote-pad" aria-label="Channel number">
            {KEYS.map((digit) => (
              <button key={digit} type="button" onClick={() => tv.dispatch({ type: 'digit', digit })}>
                {digit}
              </button>
            ))}
            <button type="button" onClick={() => tv.dispatch({ type: 'digit-back' })}>
              ⌫
            </button>
            <button type="button" onClick={() => tv.dispatch({ type: 'confirm' })}>
              OK
            </button>
          </div>
          <div className="remote-foot">
            <button type="button" className="remote-close" aria-label="Close remote" onClick={() => tv.dispatch({ type: 'remote' })}>
              Close
            </button>
            <button
              type="button"
              className={tv.credits ? 'credits-key is-on' : 'credits-key'}
              aria-pressed={tv.credits}
              title="Credits: what is playing and who made it"
              onClick={() => tv.dispatch({ type: 'credits' })}
            >
              Credits
            </button>
            <button type="button" aria-pressed={tv.paused} onClick={() => tv.dispatch({ type: 'play-pause' })}>
              {tv.paused ? 'Play' : 'Pause'}
            </button>
            <button
              type="button"
              className={tv.sleepMinutes > 0 ? 'sleep-key is-on' : 'sleep-key'}
              aria-pressed={tv.sleepMinutes > 0}
              title="Stop streaming after this many minutes without use"
              onClick={() => tv.dispatch({ type: 'sleep-cycle' })}
            >
              {sleepLabel(tv.sleepMinutes)}
            </button>
          </div>
        </section>
      ) : null}
    </>
  )
}
