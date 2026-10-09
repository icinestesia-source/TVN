import { useState, type KeyboardEvent } from 'react'
import { useTv } from '../state/tv-context.ts'
import { formatDuration, padChannel } from '../utils/time.ts'
import { removeBookmark, removeBookmarks, useBookmarks } from '../view/bookmarks-store.ts'

const DEFAULT_NAME = 'My Bookmarks'

function keepKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}

/**
 * ♡: the clips the viewer bookmarked (D, or the bookmark on the information bar), newest first, each to play
 * again. A tick box by each one chooses clips to remove, or (CREATE CHANNEL) the clips a new channel airs, in
 * the order listed.
 */
export function BookmarksPanel() {
  const tv = useTv()
  const bookmarks = useBookmarks()
  const [note, setNote] = useState<string | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState(DEFAULT_NAME)
  const [clearing, setClearing] = useState(false)
  const [busy, setBusy] = useState(false)

  const chosen = bookmarks.filter((bookmark) => picked.has(bookmark.key))
  const toggle = (key: string) =>
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const startCreating = () => {
    setPicked(new Set(bookmarks.map((bookmark) => bookmark.key)))
    setName(DEFAULT_NAME)
    setClearing(false)
    setCreating(true)
    setNote('UNTICK THE CLIPS TO LEAVE OUT · THE CHANNEL AIRS THE REST IN THIS ORDER')
  }
  const create = async () => {
    if (chosen.length === 0 || busy) return
    setBusy(true)
    try {
      const made = await tv.createBookmarkChannel(name, chosen)
      setNote(made.message)
      setCreating(false)
      setPicked(new Set())
    } catch (error) {
      setNote(error instanceof Error ? error.message.toUpperCase() : 'THAT CHANNEL COULD NOT BE CREATED')
    } finally {
      setBusy(false)
    }
  }
  const removeChosen = () => {
    const count = chosen.length
    removeBookmarks(chosen.map((bookmark) => bookmark.key))
    setPicked(new Set())
    setNote(`${count} ${count === 1 ? 'BOOKMARK' : 'BOOKMARKS'} REMOVED`)
  }

  return (
    <div className="guide-options guide-bookmarks-panel" aria-label="Bookmarks">
      <p className="options-status" role="status">
        {note ?? (bookmarks.length ? `${bookmarks.length} ${bookmarks.length === 1 ? 'bookmark' : 'bookmarks'}` : 'No bookmarks yet')}
      </p>
      {bookmarks.length === 0 ? (
        <p className="options-note">Press D, or the ♡ after a programme&apos;s title on the information bar, to bookmark the clip you are watching. It is listed here to play again.</p>
      ) : (
        <>
          {creating ? (
            <form
              className="bookmark-actions"
              aria-label="Create a channel from the ticked clips"
              onKeyDown={keepKey}
              onSubmit={(event) => {
                event.preventDefault()
                void create()
              }}
            >
              <input
                className="bookmark-name"
                value={name}
                maxLength={80}
                aria-label="New channel name"
                autoFocus
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  event.preventDefault()
                  event.stopPropagation()
                  setCreating(false)
                  setNote(null)
                }}
              />
              <button type="submit" className="tab is-on" disabled={busy || chosen.length === 0 || !name.trim()}>
                Create channel · {chosen.length} {chosen.length === 1 ? 'clip' : 'clips'}
              </button>
              <button
                type="button"
                className="tab"
                disabled={busy}
                onClick={() => {
                  setCreating(false)
                  setPicked(new Set())
                  setNote(null)
                }}
              >
                Cancel
              </button>
            </form>
          ) : clearing ? (
            <div className="bookmark-actions" role="alertdialog" aria-label="Remove every bookmark?">
              <span className="remove-ask">Remove all {bookmarks.length} bookmarks?</span>
              <button
                type="button"
                className="tab remove-key"
                onKeyDown={keepKey}
                onClick={() => {
                  removeBookmarks('all')
                  setPicked(new Set())
                  setClearing(false)
                  setNote('ALL BOOKMARKS REMOVED')
                }}
              >
                Yes, remove all
              </button>
              <button type="button" className="tab" onKeyDown={keepKey} onClick={() => setClearing(false)}>
                Keep
              </button>
            </div>
          ) : (
            <div className="bookmark-actions">
              <button type="button" className="tab" onKeyDown={keepKey} onClick={startCreating}>
                Create Channel
              </button>
              <button type="button" className="tab remove-key" disabled={chosen.length === 0} onKeyDown={keepKey} onClick={removeChosen}>
                Remove selected{chosen.length ? ` · ${chosen.length}` : ''}
              </button>
              <button type="button" className="tab remove-key" onKeyDown={keepKey} onClick={() => setClearing(true)}>
                Remove all
              </button>
            </div>
          )}
          <ol className="bookmark-list">
            {bookmarks.map((bookmark) => (
              <li key={bookmark.key} className={picked.has(bookmark.key) ? 'bookmark-row is-picked' : 'bookmark-row'}>
                <input type="checkbox" className="bookmark-pick" checked={picked.has(bookmark.key)} aria-label={`Select ${bookmark.title}`} onKeyDown={keepKey} onChange={() => toggle(bookmark.key)} />
                <span className="bookmark-title">{bookmark.title}</span>
                <span className="bookmark-channel">
                  {padChannel(bookmark.channelNumber)} {bookmark.channelName}
                </span>
                <span className="bookmark-length">{formatDuration(bookmark.durationSeconds)}</span>
                <button
                  type="button"
                  className="tab"
                  onKeyDown={keepKey}
                  onClick={() => {
                    const refused = tv.playChannelProgramme(bookmark.channelNumber, bookmark.programmeId)
                    setNote(refused ? (refused === 'SAVE THE CHANNEL FIRST, THEN PLAY IT' ? 'THAT CLIP IS NO LONGER ON ITS CHANNEL' : refused) : `PLAYING · ${bookmark.title}`)
                  }}
                >
                  Play
                </button>
                <button type="button" className="tab" aria-label={`Remove the bookmark for ${bookmark.title}`} onKeyDown={keepKey} onClick={() => removeBookmark(bookmark.key)}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
