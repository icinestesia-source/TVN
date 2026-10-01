import { acknowledgeNotice, openAbout } from './about-store.ts'
import { GOOGLE_PRIVACY, YOUTUBE_TERMS } from './legal-text.ts'

/** Shown once per browser; About · Sources · Legal stays in TVN settings afterwards. */
export function FirstRunNotice() {
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
        . Other programmes may come from direct video, live streams or radio, and Channel 000 plays media you choose from your own
        device.
      </p>
      <p>
        Playback may involve communication between your browser and the programme’s provider (
        <a href={GOOGLE_PRIVACY} target="_blank" rel="noopener noreferrer">
          Google Privacy Policy
        </a>{' '}
        for YouTube). CREDITS on the remote shows sources and creators.
      </p>
      <div className="first-run-actions">
        <button type="button" onClick={() => acknowledgeNotice()} autoFocus>
          Continue
        </button>
        <button
          type="button"
          onClick={() => {
            acknowledgeNotice()
            openAbout()
          }}
        >
          About &amp; legal
        </button>
      </div>
    </section>
  )
}
