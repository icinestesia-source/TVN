import { useState } from 'react'
import { useTv } from '../state/tv-context.ts'
import { formatDuration, padChannel } from '../utils/time.ts'
import { removeBookmark, useBookmarks } from '../view/bookmarks-store.ts'

/** 📜: the clips the viewer bookmarked (D, or the bookmark on the information bar), newest first, each to play again. */
export function BookmarksPanel() {
  const tv = useTv()
  const bookmarks = useBookmarks()
  const [note, setNote] = useState<string | null>(null)

  return (
    <div className="guide-options guide-bookmarks-panel" aria-label="Bookmarks">
      <p className="options-status" role="status">
        {note ?? (bookmarks.length ? `${bookmarks.length} ${bookmarks.length === 1 ? 'bookmark' : 'bookmarks'}` : 'No bookmarks yet')}
      </p>
      {bookmarks.length === 0 ? (
        <p className="options-note">Press D, or the 📜 after a programme&apos;s title on the information bar, to bookmark the clip you are watching. It is listed here to play again.</p>
      ) : (
        <ol className="bookmark-list">
          {bookmarks.map((bookmark) => (
            <li key={bookmark.key} className="bookmark-row">
              <span className="bookmark-title">{bookmark.title}</span>
              <span className="bookmark-channel">
                {padChannel(bookmark.channelNumber)} {bookmark.channelName}
              </span>
              <span className="bookmark-length">{formatDuration(bookmark.durationSeconds)}</span>
              <button
                type="button"
                className="tab"
                onClick={() => {
                  const refused = tv.playChannelProgramme(bookmark.channelNumber, bookmark.programmeId)
                  setNote(refused ? (refused === 'SAVE THE CHANNEL FIRST, THEN PLAY IT' ? 'THAT CLIP IS NO LONGER ON ITS CHANNEL' : refused) : `PLAYING · ${bookmark.title}`)
                }}
              >
                Play
              </button>
              <button type="button" className="tab" aria-label={`Remove the bookmark for ${bookmark.title}`} onClick={() => removeBookmark(bookmark.key)}>
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
