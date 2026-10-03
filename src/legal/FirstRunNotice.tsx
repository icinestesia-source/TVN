import { useState } from 'react'
import type { TvContextValue } from '../state/tv-context.ts'
import { acknowledgeNotice, openAbout } from './about-store.ts'
import { GOOGLE_PRIVACY, YOUTUBE_TERMS } from './legal-text.ts'

/**
 * Shown once per browser; About · Sources · Legal stays in Settings afterwards. TVN carries on with the network as
 * it is loaded, NEW clears the example channels for a network of the viewer's own, LEGAL opens About and returns here.
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
    if (confirming || !(await networkCustomised())) return startNew()
    setConfirming(true)
  }

  return (
    <section className="first-run" role="dialog" aria-label="About TVN" onKeyDown={(event) => event.stopPropagation()}>
      <p className="first-run-head">Welcome to TVN</p>
      <p>
        TVN is an independent television and media interface. Third-party programmes stay hosted and delivered by their providers, and
        TVN claims no ownership of them.
      </p>
      <p>
        YouTube-hosted programmes play in YouTube’s embedded player; by watching them you agree to the{' '}
        <a href={YOUTUBE_TERMS} target="_blank" rel="noopener noreferrer">
          YouTube Terms of Service
        </a>
        . Other programmes may come from direct video, live streams or radio, and Channel 1000 plays media you choose from your own
        device.
      </p>
      <p>
        Playback may involve communication between your browser and the programme’s provider (
        <a href={GOOGLE_PRIVACY} target="_blank" rel="noopener noreferrer">
          Google Privacy Policy
        </a>{' '}
        for YouTube). CREDITS on the remote shows sources and creators.
      </p>
      <p className="first-run-example">
        TVN includes an example network of channels to demonstrate the platform. TVN carries on with it; NEW clears the channels to start
        a network of your own.
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
            TVN
          </button>
          <button type="button" onClick={() => void askNew()} disabled={busy} title="Clear the channels and start a new network">
            New
          </button>
          <button type="button" onClick={() => openAbout()} disabled={busy} title="About, sources and legal information">
            Legal
          </button>
        </div>
      )}
    </section>
  )
}
