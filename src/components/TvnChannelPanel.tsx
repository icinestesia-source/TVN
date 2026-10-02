import { useSyncExternalStore, type KeyboardEvent } from 'react'
import { setTvnChannelSettings, subscribeTvnChannel, tvnChannelSettings, tvnChoice } from '../tvn/tvn-channel.ts'
import { padChannel } from '../utils/time.ts'

function keepKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Escape') event.stopPropagation()
}

/** The settings of 000 TVN, where Edit Channel opens for it: in the Guide, over the picture and from its information bar. */
export function TvnChannelPanel({ onChooseAnother, onClose }: { onChooseAnother: () => void; onClose?: () => void }) {
  const settings = useSyncExternalStore(subscribeTvnChannel, tvnChannelSettings)
  const choice = useSyncExternalStore(subscribeTvnChannel, tvnChoice)
  return (
    <footer
      className="guide-info guide-tool guide-editor tvn-channel-panel"
      aria-label="TVN channel settings"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !onClose) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <div className="info-main">
        <p className="info-kicker">
          <span className="info-net">TVN</span>
          <span>000</span>
          <span>TVN channel</span>
        </p>
        <p className="guide-tool-note">
          000 chooses a programme airing now elsewhere on TVN, plays it, then chooses another. It never copies a programme and learns nothing about
          you.
        </p>
        <label className="editor-check tvn-setting">
          <input type="checkbox" checked={settings.autoNext} onKeyDown={keepKey} onChange={() => setTvnChannelSettings({ autoNext: !settings.autoNext })} />
          <span>Automatically choose another programme</span>
        </label>
        <label className="editor-check tvn-setting">
          <input type="checkbox" checked={settings.includeUser} onKeyDown={keepKey} onChange={() => setTvnChannelSettings({ includeUser: !settings.includeUser })} />
          <span>Include User Network</span>
        </label>
        <p className="guide-tool-status">
          {choice ? `Now · ${choice.programme.title} · from ${padChannel(choice.channelNumber)}` : 'Nothing chosen yet'}
        </p>
        <div className="editor-actions">
          <button type="button" className="tab" onKeyDown={keepKey} onClick={onChooseAnother}>
            Choose another
          </button>
          {onClose ? (
            <button type="button" className="tab" onKeyDown={keepKey} onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
      </div>
    </footer>
  )
}
