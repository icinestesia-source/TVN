import { useState } from 'react'
import { useTv } from '../state/tv-context.ts'
import { formatDuration, formatRange, padChannel } from '../utils/time.ts'
import { flagBookmark, removeClipFlags, useClipFlags } from '../view/clip-flags.ts'
import { keepKey } from './keep-key.ts'

const DEFAULT_NAME = 'My Flagged Clips'

/**
 * ⚑: the clips the viewer flagged in the Guide (right-click a clip), in the order they air. TVN tunes to
 * each as it starts; aired ones stay until removed. A tick box by each one chooses flags to remove, or (CREATE CHANNEL) the clips a new
 * channel airs, in the order listed.
 */
export function FlagsPanel() {
  const tv = useTv()
  const flags = useClipFlags()
  const [note, setNote] = useState<string | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState(DEFAULT_NAME)
  const [busy, setBusy] = useState(false)

  const chosen = flags.filter((flag) => picked.has(flag.key))
  const aired = flags.filter((flag) => flag.fired).length
  const toggle = (key: string) =>
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const create = async () => {
    if (chosen.length === 0 || busy) return
    setBusy(true)
    try {
      const made = await tv.createBookmarkChannel(name, chosen.map(flagBookmark))
      setNote(made.message)
      setCreating(false)
      setPicked(new Set())
    } catch (error) {
      setNote(error instanceof Error ? error.message.toUpperCase() : 'THAT CHANNEL COULD NOT BE CREATED')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="guide-options guide-bookmarks-panel" aria-label="Flags">
      <p className="options-status" role="status">
        {note ??
          (flags.length
            ? `${flags.length} ${flags.length === 1 ? 'flag' : 'flags'} · ${aired ? `${aired} aired, kept for channels · ` : ''}TVN tunes to each still to come as it starts`
            : 'No flags')}
      </p>
      {flags.length === 0 ? (
        <p className="options-note">
          Right-click a clip in the Guide to flag it: TVN tunes to it when it starts and stays until the next flag. Flags are kept after they air, to make channels from, until you
          remove them. Right-click it again to remove the flag.
        </p>
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
          ) : (
            <div className="bookmark-actions">
              <button
                type="button"
                className="tab"
                onKeyDown={keepKey}
                onClick={() => {
                  setPicked(new Set(flags.map((flag) => flag.key)))
                  setName(DEFAULT_NAME)
                  setCreating(true)
                  setNote('UNTICK THE CLIPS TO LEAVE OUT · THE CHANNEL AIRS THE REST IN THIS ORDER')
                }}
              >
                Create Channel
              </button>
              <button
                type="button"
                className="tab remove-key"
                disabled={chosen.length === 0}
                onKeyDown={keepKey}
                onClick={() => {
                  removeClipFlags(chosen.map((flag) => flag.key))
                  setPicked(new Set())
                  setNote(`${chosen.length} ${chosen.length === 1 ? 'FLAG' : 'FLAGS'} REMOVED`)
                }}
              >
                Remove selected{chosen.length ? ` · ${chosen.length}` : ''}
              </button>
              <button
                type="button"
                className="tab remove-key"
                onKeyDown={keepKey}
                onClick={() => {
                  removeClipFlags('all')
                  setPicked(new Set())
                  setNote('ALL FLAGS REMOVED')
                }}
              >
                Remove all
              </button>
            </div>
          )}
          <ol className="bookmark-list">
            {flags.map((flag) => (
              <li key={flag.key} className={picked.has(flag.key) ? 'bookmark-row is-picked' : 'bookmark-row'}>
                <input type="checkbox" className="bookmark-pick" checked={picked.has(flag.key)} aria-label={`Select ${flag.title}`} onKeyDown={keepKey} onChange={() => toggle(flag.key)} />
                <span className="bookmark-title">
                  ⚑{'\uFE0E'} {formatRange(flag.startMs, flag.endMs)}
                  {flag.fired ? ' · aired' : ''} · {flag.title}
                </span>
                <span className="bookmark-channel">
                  {padChannel(flag.channelNumber)} {flag.channelName}
                </span>
                <span className="bookmark-length">{formatDuration(flag.durationSeconds ?? Math.round((flag.endMs - flag.startMs) / 1000))}</span>
                <button type="button" className="tab" onKeyDown={keepKey} onClick={() => tv.dispatch({ type: 'tune', channelNumber: flag.channelNumber })}>
                  Tune
                </button>
                <button type="button" className="tab" aria-label={`Remove the flag on ${flag.title}`} onKeyDown={keepKey} onClick={() => removeClipFlags([flag.key])}>
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
