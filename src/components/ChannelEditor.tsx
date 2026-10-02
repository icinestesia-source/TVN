import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { watchUrl } from '../credits/provenance.ts'
import { shippedChannel, shippedProgrammes } from '../data/catalogue.ts'
import { broadcast } from '../services/broadcast.ts'
import type { ChannelEdit } from '../services/channel-editor.ts'
import { reachesArchive } from '../services/channel-curation.ts'
import type { ImportedVideo } from '../services/channels-import.ts'
import {
  ADDABLE_KINDS,
  inOrder,
  inventoryOf,
  isStreamSource,
  liveStreamOf,
  newSource,
  sourceStatusText,
  SOURCE_TYPES,
  type ChannelSource,
  type SourceKind,
} from '../services/channel-sources.ts'
import type { Channel } from '../types/channel.ts'
import { formatDuration, padChannel } from '../utils/time.ts'
import { useClock } from '../utils/use-clock.ts'
import type { EditorScope } from '../view/channel-edit.ts'
import { EditorialPanel, SourceFilterPanel } from './ChannelCuration.tsx'
import { SourceDetails } from './SourceDetails.tsx'

/** Enter and Space press these controls; they must not also reach the Guide. */
function keepKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}

function viewerMessage(caught: unknown, fallback: string): string {
  const message = caught instanceof Error ? caught.message.trim() : ''
  return message && message.length <= 90 && !/[<>{}]/.test(message) ? message.toUpperCase() : fallback
}

const KIND_CHOICES: readonly { value: SourceKind | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Detect' },
  ...ADDABLE_KINDS.map((kind) => ({ value: kind, label: kind === 'youtube' ? 'YouTube' : SOURCE_TYPES[kind].label })),
]

function sourceTitle(source: ChannelSource): string {
  if (source.kind === 'tvn') return 'TVN programming'
  if (source.kind === 'collection') return `${source.label} · TVN list`
  return source.label && source.kind === 'youtube' ? source.label : source.url
}

/** The video on air on the channel as saved; a channel with nothing scheduled has none. */
function onAirVideo(channel: Channel, now: number): string | null {
  try {
    return broadcast(channel, now).current.programme.videoId
  } catch {
    return null
  }
}

interface ListedVideo {
  id: string
  title: string
  durationSec: number
  /** The provider's own page for it, when its id is a YouTube video id. */
  href?: string
}

/** What a source holds, from its last scan: nothing is fetched to show it. */
function sourceProgrammes(source: ChannelSource, number: number): ListedVideo[] {
  if (source.kind !== 'tvn') return (source.videos ?? []).map((video) => ({ ...video, href: watchUrl(video.id) }))
  const shipped = shippedChannel(number)
  return shipped
    ? shippedProgrammes(shipped.id).map((programme) => ({
        id: programme.id,
        title: programme.title,
        durationSec: programme.durationSeconds,
        href: watchUrl(programme.videoId),
      }))
    : []
}

/** Opens a programme where its provider hosts it; a programme with no address keeps the space empty. */
function OriginalLink({ video }: { video: ListedVideo }) {
  if (!video.href) return <span className="editor-link" aria-hidden="true" />
  return (
    <a
      className="tab editor-link"
      href={video.href}
      target="_blank"
      rel="noopener noreferrer"
      title="Open original"
      aria-label={`Open ${video.title} on YouTube`}
      onKeyDown={keepKey}
    >
      ↗
    </a>
  )
}

/**
 * The Channel Editor: one channel's name and sources, opened from the Guide by right-click, a long press
 * or E. It sits where the Guide's information bar is and closes back into it.
 */
export function ChannelEditor({
  channel,
  scope,
  onLoad,
  onSave,
  onRescan,
  onDelete,
  onClose,
  onExport,
  archiveOf,
  initial = null,
}: {
  channel: Channel
  scope: EditorScope
  onLoad: (channelNumber: number) => Promise<ChannelEdit | null>
  onSave: (channelNumber: number, edit: ChannelEdit) => Promise<string>
  onRescan: (channelNumber: number, edit: ChannelEdit) => Promise<{ edit: ChannelEdit; message: string }>
  onDelete: (channelNumber: number) => Promise<string>
  onClose: () => void
  /** EXPORT CHANNEL (user channels): the channel as shown, as a tvn-channel-v1 file or its readable manifest. */
  onExport?: (channelNumber: number, edit: ChannelEdit, as: 'json' | 'md') => Promise<string>
  /** TVN's shipped back catalogue for a source, so the filter preview counts what ARCHIVE and ALL would add. */
  archiveOf?: (source: ChannelSource) => readonly ImportedVideo[]
  /** The channel as already read, shown until the editor's own read completes. */
  initial?: ChannelEdit | null
}) {
  const number = channel.number
  const [edit, setEdit] = useState<ChannelEdit | null>(initial)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [link, setLink] = useState('')
  const [kind, setKind] = useState<SourceKind | 'auto'>('auto')
  const [confirming, setConfirming] = useState(false)
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const [notesOpen, setNotesOpen] = useState(false)
  const curates = scope === 'user'
  const now = useClock(30_000)
  const rootRef = useRef<HTMLElement>(null)
  const linkRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    setMissing(false)
    setNote(null)
    setAdding(false)
    setConfirming(false)
    onLoad(number).then(
      (loaded) => {
        if (!live) return
        if (loaded) setEdit(loaded)
        else setMissing(true)
      },
      () => live && setMissing(true),
    )
    rootRef.current?.focus({ preventScroll: true })
    return () => {
      live = false
    }
  }, [number, onLoad])

  useEffect(() => {
    if (adding) linkRef.current?.focus()
  }, [adding])

  const change = (next: ChannelEdit) => {
    setEdit(next)
    setNote(null)
  }
  const setSource = (id: string, patch: Partial<ChannelSource>) =>
    edit && change({ ...edit, sources: edit.sources.map((source) => (source.id === id ? { ...source, ...patch } : source)) })
  const toggleOpen = (id: string) =>
    setOpened((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const lineup = edit ? inOrder(inventoryOf(edit.sources), edit.order) : []
  const ownOrder = (edit?.order?.length ?? 0) > 0
  const onAir = onAirVideo(channel, now)
  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta
    if (!edit || to < 0 || to >= lineup.length) return
    const ids = lineup.map((video) => video.id)
    ;[ids[index], ids[to]] = [ids[to], ids[index]]
    change({ ...edit, order: ids })
  }

  const run = async (label: string, work: () => Promise<string>) => {
    setBusy(label)
    setConfirming(false)
    setNote(label === 'rescan' ? 'RESCANNING THIS CHANNEL…' : null)
    try {
      setNote(await work())
    } catch (caught) {
      setNote(viewerMessage(caught, 'THAT DID NOT WORK'))
    } finally {
      setBusy(null)
    }
  }

  const addSource = (event: FormEvent | KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    if (!edit || !link.trim()) return
    try {
      const source = newSource(edit.sources, link, kind)
      change({ ...edit, sources: [...edit.sources, source] })
      setLink('')
      setKind('auto')
      setAdding(false)
      setNote(source.kind === 'youtube' ? 'SOURCE ADDED · RESCAN TO FETCH ITS PROGRAMMES' : 'SOURCE ADDED · SAVE OR RESCAN TO USE IT')
    } catch (caught) {
      setNote(viewerMessage(caught, 'THAT SOURCE COULD NOT BE ADDED'))
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (adding) setAdding(false)
    else if (confirming) setConfirming(false)
    else onClose()
  }

  const kicker = (
    <p className="info-kicker">
      <span className="info-net">{scope === 'curated' ? 'TVN' : 'User'}</span>
      <span>{padChannel(number)}</span>
      <span>Edit channel</span>
    </p>
  )

  return (
    <footer ref={rootRef} className="guide-info guide-tool guide-editor" aria-label={`Edit channel ${padChannel(number)}`} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="info-main">
        {kicker}
        {scope === 'curated' ? (
          <p className="guide-tool-note">Your changes to this TVN channel are kept in this browser only. Nobody else's TVN changes.</p>
        ) : null}
        {missing ? (
          <p className="guide-tool-note">This channel could not be read.</p>
        ) : !edit ? (
          <p className="guide-tool-status">Reading…</p>
        ) : (
          <>
            <label className="editor-field">
              <span className="editor-heading">Channel name</span>
              <input
                type="text"
                value={edit.name}
                maxLength={80}
                autoComplete="off"
                spellCheck={false}
                disabled={busy !== null}
                onChange={(event) => change({ ...edit, name: event.target.value })}
              />
            </label>
            <p className="editor-heading">Sources</p>
            <ul className="editor-sources">
              {edit.sources.length === 0 ? <li className="editor-empty">No sources yet</li> : null}
              {edit.sources.map((source) => {
                const open = opened.has(source.id)
                const held = isStreamSource(source) ? [] : sourceProgrammes(source, number)
                return (
                <li key={source.id} className={source.enabled ? 'editor-source' : 'editor-source is-off'}>
                  <button
                    type="button"
                    className="tab editor-expand"
                    aria-expanded={open}
                    aria-label={`${open ? 'Hide' : 'Show'} the details of ${sourceTitle(source)}`}
                    onKeyDown={keepKey}
                    onClick={() => toggleOpen(source.id)}
                  >
                    {open ? '−' : '+'}
                  </button>
                  <label className="editor-check" title={source.url || undefined}>
                    <input
                      type="checkbox"
                      checked={source.enabled}
                      disabled={busy !== null}
                      onKeyDown={keepKey}
                      onChange={() => setSource(source.id, { enabled: !source.enabled })}
                    />
                    <span className="editor-source-name">{sourceTitle(source)}</span>
                  </label>
                  <span className="editor-source-status">{sourceStatusText(source, edit.sources)}</span>
                  {source.kind === 'tvn' ? (
                    <span className="editor-source-remove" aria-hidden="true" />
                  ) : (
                    <button
                      type="button"
                      className="tab editor-source-remove"
                      disabled={busy !== null}
                      aria-label={`Remove source ${sourceTitle(source)}`}
                      onKeyDown={keepKey}
                      onClick={() => change({ ...edit, sources: edit.sources.filter((item) => item.id !== source.id) })}
                    >
                      Remove
                    </button>
                  )}
                  {open ? (
                    <SourceDetails source={source} number={number} disabled={busy !== null} onInfo={(info) => setSource(source.id, { info })} />
                  ) : null}
                  {open && curates && (source.kind === 'youtube' || source.kind === 'collection') ? (
                    <SourceFilterPanel
                      source={source}
                      archive={archiveOf?.(source)}
                      disabled={busy !== null}
                      onApply={(filter, mode) => {
                        setSource(source.id, { filter, mode: mode === 'recent' ? undefined : mode })
                        setNote(filter || mode !== 'recent' ? 'FILTER APPLIED · SAVE TO KEEP IT' : 'FILTER CLEARED · SAVE TO KEEP IT')
                      }}
                    />
                  ) : null}
                  {open && !isStreamSource(source) ? (
                    held.length === 0 ? (
                      <p className="editor-videos-empty">
                        {source.kind === 'youtube' ? 'Nothing scanned yet · Rescan to fetch its programmes' : 'No programmes listed'}
                      </p>
                    ) : (
                      <ol className="editor-videos" aria-label={`Programmes of ${sourceTitle(source)}`}>
                        {held.map((video) => (
                          <li key={video.id}>
                            <span className="editor-video-title">{video.title}</span>
                            <span className="editor-video-length">{formatDuration(video.durationSec)}</span>
                            <OriginalLink video={video} />
                          </li>
                        ))}
                      </ol>
                    )
                  ) : null}
                </li>
                )
              })}
            </ul>
            {adding ? (
              <form className="add-channel editor-add" onSubmit={addSource} onKeyDown={keepKey}>
                <input
                  ref={linkRef}
                  type="url"
                  inputMode="url"
                  value={link}
                  placeholder="YouTube channel, video or playlist, or a stream address"
                  aria-label="Source address"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setLink(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addSource(event)
                  }}
                />
                <select value={kind} aria-label="Source type" onChange={(event) => setKind(event.target.value as SourceKind | 'auto')}>
                  {KIND_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                <button type="submit" className="tab" disabled={!link.trim()}>
                  Add
                </button>
                <button type="button" className="tab" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button type="button" className="tab editor-add-key" disabled={busy !== null} onKeyDown={keepKey} onClick={() => setAdding(true)}>
                + Add source
              </button>
            )}
            {curates ? (
              <>
                <div className="editor-lineup-head">
                  <button
                    type="button"
                    className="tab editor-expand"
                    aria-expanded={notesOpen}
                    aria-label={`${notesOpen ? 'Hide' : 'Show'} the editorial notes`}
                    onKeyDown={keepKey}
                    onClick={() => setNotesOpen((current) => !current)}
                  >
                    {notesOpen ? '−' : '+'}
                  </button>
                  <p className="editor-heading">Editorial · curation{edit.editorial?.purpose?.trim() ? ` · ${edit.editorial.purpose.trim().slice(0, 60)}` : ''}</p>
                </div>
                {notesOpen ? <EditorialPanel editorial={edit.editorial} disabled={busy !== null} onChange={(editorial) => change({ ...edit, editorial })} /> : null}
              </>
            ) : null}
            <div className="editor-lineup-head">
              <p className="editor-heading">Running order · {ownOrder ? 'yours' : 'automatic'}</p>
              {ownOrder ? (
                <button type="button" className="tab" disabled={busy !== null} onKeyDown={keepKey} onClick={() => change({ ...edit, order: undefined })}>
                  Reset to automatic
                </button>
              ) : null}
            </div>
            {liveStreamOf(edit.sources) ? (
              <p className="guide-tool-note">A live stream carries this channel, so it has no running order.</p>
            ) : lineup.length === 0 ? (
              <p className="guide-tool-note">
                {edit.sources.some((source) => source.kind === 'tvn' && source.enabled)
                  ? "TVN schedules this channel's own programming. Add a source to set a running order of your own."
                  : 'No programmes yet. Add a source and rescan.'}
              </p>
            ) : (
              <>
                <p className="guide-tool-note">
                  {ownOrder
                    ? 'The channel plays these in this order, then starts again. Save to keep it.'
                    : reachesArchive(edit.sources)
                      ? 'TVN plays these in turn, from across the archive. Move one to set your own order.'
                      : 'TVN plays these in turn, with repeats and earlier uploads between them. Move one to set your own order.'}
                </p>
                <ol className="editor-lineup" aria-label="Running order">
                  {lineup.map((video, index) => (
                    <li key={video.id} className={video.id === onAir ? 'is-on-air' : undefined}>
                      <span className="editor-lineup-pos">{index + 1}</span>
                      <span className="editor-video-title">{video.title}</span>
                      {video.id === onAir ? <span className="editor-lineup-now">On air</span> : null}
                      <span className="editor-video-length">{formatDuration(video.durationSec)}</span>
                      <OriginalLink video={{ ...video, href: watchUrl(video.id) }} />
                      <button
                        type="button"
                        className="tab editor-move"
                        aria-label={`Move ${video.title} earlier`}
                        disabled={busy !== null || index === 0}
                        onKeyDown={keepKey}
                        onClick={() => move(index, -1)}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="tab editor-move"
                        aria-label={`Move ${video.title} later`}
                        disabled={busy !== null || index === lineup.length - 1}
                        onKeyDown={keepKey}
                        onClick={() => move(index, 1)}
                      >
                        ▼
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </>
        )}
        {note ? (
          <p className="guide-tool-status" role="status">
            {note}
          </p>
        ) : null}
      </div>
      <div className="info-actions editor-actions">
        {edit ? (
          <>
            <button
              type="button"
              className="tab"
              disabled={busy !== null}
              onKeyDown={keepKey}
              onClick={() =>
                void run('rescan', async () => {
                  const result = await onRescan(number, edit)
                  setEdit(result.edit)
                  return result.message
                })
              }
            >
              {busy === 'rescan' ? 'Rescanning…' : 'Rescan channel'}
            </button>
            <button type="button" className="tune-key" disabled={busy !== null} onKeyDown={keepKey} onClick={() => void run('save', () => onSave(number, edit))}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            {curates && onExport ? (
              <>
                <button type="button" className="tab" disabled={busy !== null} onKeyDown={keepKey} onClick={() => void run('export', () => onExport(number, edit, 'json'))}>
                  Export channel
                </button>
                <button type="button" className="tab" disabled={busy !== null} onKeyDown={keepKey} onClick={() => void run('export', () => onExport(number, edit, 'md'))}>
                  Export manifest
                </button>
              </>
            ) : null}
          </>
        ) : null}
        <button type="button" className="tab" onKeyDown={keepKey} onClick={onClose}>
          Close
        </button>
      </div>
      {edit ? (
        <div className="editor-danger">
          {confirming ? (
            <>
              <span className="remove-ask">
                {scope === 'curated'
                  ? `Discard your changes to ${padChannel(number)} and restore it as TVN ships it?`
                  : `Delete ${padChannel(number)}'s sources from this browser? The number stays as an empty channel you can fill again.`}
              </span>
              <button type="button" className="tab remove-key" disabled={busy !== null} onKeyDown={keepKey} onClick={() => void run('delete', () => onDelete(number))}>
                {scope === 'curated' ? 'Yes, restore' : 'Yes, delete'}
              </button>
              <button type="button" className="tab" onKeyDown={keepKey} onClick={() => setConfirming(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="tab remove-key" disabled={busy !== null} onKeyDown={keepKey} onClick={() => setConfirming(true)}>
              {scope === 'curated' ? 'Restore TVN original…' : 'Delete channel…'}
            </button>
          )}
        </div>
      ) : null}
    </footer>
  )
}
