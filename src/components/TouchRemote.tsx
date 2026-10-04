import { useEffect, useRef } from 'react'
import { openAbout } from '../legal/about-store.ts'
import { sleepLabel } from '../state/sleep.ts'
import { SURF_LIMIT_MAX, SURF_LIMIT_MIN } from '../state/surf.ts'
import { useTv } from '../state/tv-context.ts'
import { CORNER_LABELS, CORNERS, SHORTCUT_IDS, SHORTCUTS, type ShortcutId } from '../view/info-shortcuts.ts'
import { closeRandomSettings, useRandomSettingsOpen } from '../view/tvn-settings-store.ts'

const KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]

/**
 * The remote and the Random settings, opened from the information overlay's REMOTE key and a right-click on R.
 */
export function TouchRemote() {
  const tv = useTv()
  const settingsOpen = useRandomSettingsOpen()
  const padRef = useRef<HTMLDivElement>(null)

  // The remote and the settings share a place; the one opened last takes it.
  useEffect(() => {
    if (tv.remoteOpen) closeRandomSettings()
  }, [tv.remoteOpen])

  return (
    <>
      {settingsOpen ? (
        <section
          className="remote-panel tvn-settings"
          role="dialog"
          aria-label="Random settings"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            closeRandomSettings()
          }}
        >
          <p className="tvn-settings-head">Random settings</p>
          <p className="tvn-settings-note">Random Cycle. Hold TVN on the control pad to start or stop it; each hop comes after a random wait in this range.</p>
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
          <fieldset className="tvn-shortcuts">
            <legend className="tvn-settings-head">Information Overlay shortcuts</legend>
            {CORNERS.map((corner) => (
              <label key={corner} className="tvn-shortcut">
                <span>{CORNER_LABELS[corner]}</span>
                <select
                  value={tv.infoShortcuts[corner]}
                  onChange={(event) => tv.setInfoShortcut(corner, event.target.value as ShortcutId)}
                >
                  {SHORTCUT_IDS.map((id) => (
                    <option key={id} value={id}>
                      {SHORTCUTS[id].name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button type="button" className="tvn-shortcuts-reset" onClick={tv.resetInfoShortcuts}>
              Reset to defaults
            </button>
          </fieldset>
          <button
            type="button"
            className="tvn-about-link"
            onClick={() => {
              closeRandomSettings()
              openAbout()
            }}
          >
            About · Sources · Legal
          </button>
          <div className="remote-foot">
            <button type="button" aria-pressed={tv.surfing} onClick={tv.toggleSurf}>
              {tv.surfing ? 'Stop Random Cycle' : 'Start Random Cycle'}
            </button>
            <button type="button" className="remote-close" onClick={() => closeRandomSettings()}>
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
            <button type="button" onClick={() => tv.dispatch({ type: 'multiview' })}>
              Multi
            </button>
          </div>
          <div className="remote-row">
            <button type="button" onClick={() => tv.dispatch({ type: 'info' })}>
              Info
            </button>
            <button type="button" onClick={() => tv.dispatch({ type: 'user-channels' })}>
              User
            </button>
            <button
              type="button"
              className={tv.smart ? 'smart-key is-on' : 'smart-key'}
              aria-pressed={tv.smart}
              aria-label="Smart"
              title={tv.smart ? 'SMART is on: type a channel number; it tunes and the remote closes' : 'SMART: type a channel number; it tunes and the remote closes'}
              onClick={() => {
                tv.dispatch({ type: 'smart' })
                // Keys typed now feed the channel number, and no remote button holds focus to take Enter or Space.
                padRef.current?.focus()
              }}
            >
              <svg className="smart-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M7.05 6.05a7 7 0 1 0 9.9 0" />
                <path d="M12 3v8" />
              </svg>
            </button>
            <button type="button" onClick={() => tv.dispatch({ type: 'favourite' })}>
              Fav
            </button>
            <button type="button" onClick={() => tv.dispatch({ type: 'mute' })}>
              {tv.muted ? 'Sound' : 'Mute'}
            </button>
          </div>
          <div ref={padRef} tabIndex={-1} className={tv.smart ? 'remote-pad is-smart' : 'remote-pad'} aria-label="Channel number">
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
