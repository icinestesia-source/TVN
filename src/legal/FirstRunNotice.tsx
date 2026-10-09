import { useState } from 'react'
import type { TvContextValue } from '../state/tv-context.ts'
import { acknowledgeNotice, openAbout } from './about-store.ts'
import { KEYBOARD_NAV, KEYBOARD_ROWS, type KeyboardKey } from './entry-keys.ts'
import { GOOGLE_PRIVACY, YOUTUBE_TERMS } from './legal-text.ts'
import { EMPTY_SITE, EMPTY_SITE_PATH, EMPTY_SITE_WELCOMED } from '../app/site.ts'

function KeyCap({ item }: { item: KeyboardKey }) {
  const { cap, key, label, name, size = 1 } = item
  return (
    <li
      className={key ? 'kb-key is-bound' : 'kb-key'}
      style={size !== 1 ? { flexGrow: size } : undefined}
      aria-label={key ? `${name ?? cap}${label ? `: ${label}` : ''}` : undefined}
      aria-hidden={key ? undefined : true}
    >
      <kbd>{cap}</kbd>
      {label ? <span>{label}</span> : null}
    </li>
  )
}

/** The keyboard drawn out, every key TVN answers to marked with what it does. */
function EntryKeys() {
  return (
    <div className="first-run-keys" role="group" aria-label="Keyboard shortcuts">
      <div className="kb-main">
        {KEYBOARD_ROWS.map((row, index) => (
          <ul key={index} className="kb-row">
            {row.map((item, at) => (
              <KeyCap key={`${item.cap}-${at}`} item={item} />
            ))}
          </ul>
        ))}
      </div>
      <ul className="kb-nav">
        {KEYBOARD_NAV.map((item) => (
          <KeyCap key={item.cap} item={item} />
        ))}
      </ul>
      <p className="kb-note">
        0–9 tune a channel · ↑ ↓ channel · ← → volume · G Guide · Space Surf (hold to change what it covers) · P Pause · C All / User / Fav · I Media · R
        Refresh, L Latest, Z A to Z and X Reload the selected channel's schedule · O Export ALL · B N Prev/Next channel · , . programme · H Help · − and = zoom the Guide
      </p>
    </div>
  )
}

/**
 * Shown once per browser; About · Sources · Legal stays in Settings afterwards. TVN - CONTINUE carries on with the network as
 * it is loaded, NEW USER goes to tvn.lol/tvn (TVN without the example channels, kept apart from this network) for a network
 * of the viewer's own, and there clears that network again; LEGAL opens About and returns here.
 * 000 TVN stays tuned behind it whichever is chosen.
 */
export function FirstRunNotice({
  startNewNetwork = async () => '',
  networkCustomised = async () => false,
}: Partial<Pick<TvContextValue, 'startNewNetwork' | 'networkCustomised'>>) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const startNew = async () => {
    setBusy(true)
    try {
      await startNewNetwork()
      acknowledgeNotice()
    } finally {
      setBusy(false)
    }
  }
  const askNew = async () => {
    if (busy) return
    if (!EMPTY_SITE) {
      acknowledgeNotice()
      window.location.assign(`${EMPTY_SITE_PATH}${EMPTY_SITE_WELCOMED}`)
      return
    }
    if (confirming || !(await networkCustomised())) return startNew()
    setConfirming(true)
  }

  return (
    <section className="first-run" role="dialog" aria-label="About TVN" onKeyDown={(event) => event.stopPropagation()}>
      <p className="first-run-head">Welcome to TVN</p>
      <EntryKeys />
      <p>
        TVN is an independent television and media interface. Third-party programmes stay hosted and delivered by their providers, and
        TVN claims no ownership of them.
      </p>
      <p>
        YouTube-hosted programmes play in YouTube’s embedded player; by watching them you agree to the{' '}
        <a href={YOUTUBE_TERMS} target="_blank" rel="noopener noreferrer">
          YouTube Terms of Service
        </a>
        . Other programmes may come from direct video, live streams or radio, and Channel 1000, with the Local Media channels from 991,
        plays media you choose from your own device.
      </p>
      <p>
        Playback may involve communication between your browser and the programme’s provider (
        <a href={GOOGLE_PRIVACY} target="_blank" rel="noopener noreferrer">
          Google Privacy Policy
        </a>{' '}
        for YouTube). CREDITS on the remote shows sources and creators.
      </p>
      <p className="first-run-example">
        TVN includes an example network of channels to demonstrate the platform. TVN - CONTINUE carries on with it; NEW USER opens an empty
        TVN to start a network of your own.
      </p>
      {confirming ? (
        <div className="first-run-confirm" role="alertdialog" aria-label="Start new network?">
          <p className="first-run-head">Start new network?</p>
          <p>This removes the channels in your current network.</p>
          <div className="first-run-actions">
            <button type="button" onClick={() => void startNew()} disabled={busy} autoFocus>
              New
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="first-run-actions">
          <button type="button" onClick={() => acknowledgeNotice()} disabled={busy} autoFocus title="Continue with TVN as it is loaded">
            TVN - CONTINUE
          </button>
          <button type="button" onClick={() => void askNew()} disabled={busy} title={EMPTY_SITE ? 'Clear the channels and start a new network' : 'Open an empty TVN to build a network of your own'}>
            NEW USER
          </button>
          <button type="button" onClick={() => openAbout()} disabled={busy} title="About, sources and legal information">
            LEGAL
          </button>
        </div>
      )}
    </section>
  )
}
