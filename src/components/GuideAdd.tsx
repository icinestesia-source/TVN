import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { createGuidePress } from '../view/guide-press.ts'
import { directoryPicker, filePicker, MEDIA_ACCEPT, pickFiles, pickFolder } from '../session/import.ts'
import { rememberedChannels, rememberSupported, useRememberMedia, type MediaHandle } from '../session/remembered-media.ts'
import { LOCAL_NAME_LIMIT, SESSION_CHANNEL } from '../session/session-channel.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import type { UserNetworkExport } from '../services/user-network-export.ts'
import { sourcePreviewLines, type FoundFeed } from '../services/podcast-source.ts'
import { isPlaylistsLink, isYouTubeChannelLink, lookUpChannelPlaylists, playlistUrl } from '../services/add-channel.ts'
import { readRestoreFile, type TvnExport } from '../services/tvn-export.ts'
import type { GuideTool } from '../types/input.ts'
import { USER_NAME_MAX } from '../data/user-network/users.ts'
import { formatDuration, padChannel } from '../utils/time.ts'

/** Enter and Space press these controls; they must not also confirm (and tune) the guide cursor. */
function keepKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}

function folderSupported(): boolean {
  if (typeof window === 'undefined') return false
  return directoryPicker() !== null || 'webkitdirectory' in HTMLInputElement.prototype
}

/** A short line for the viewer; anything that is not one reads as a plain failure. */
function viewerMessage(caught: unknown, fallback: string): string {
  const message = caught instanceof Error ? caught.message.trim() : ''
  return message && message.length <= 90 && !/[<>{}]/.test(message) ? message.toUpperCase() : fallback
}

/**
 * NETWORK · GUIDE · OPTIONS · NOW · ADD · MEDIA: ordinary Guide actions beside SEARCH, each opening in the
 * Guide itself. NETWORK is the Network Editor (curate the channels); GUIDE is the television listings (what is
 * on), and a right-click or a hold on it opens the viewer's programmable Guide (saved Maps: create, edit, play,
 * resume, duplicate, delete). GUIDE reads green while one of those Maps is being followed. OPTIONS holds the
 * users and every viewer setting. ADD opens the Add Channel row, MEDIA builds 1000 Local Media from local files.
 * New users and channel-list imports live behind the + tab (after TVN and the users, before FAV).
 */
export function GuideActions({
  tool,
  picked,
  following = false,
  onNow,
  onClose,
  onTool,
}: {
  tool: GuideTool | null
  /** A programme chosen in the Guide is playing; NOW returns to air. */
  picked: boolean
  /** A viewing Guide is choosing what plays. */
  following?: boolean
  onNow: () => void
  /** GUIDE pressed while the listings are already showing: the same as CLOSE. */
  onClose?: () => void
  onTool: (tool: GuideTool) => void
}) {
  const action = (label: string, on: boolean, run: () => void, title?: string, extra = '') => (
    <button type="button" className={`${on ? 'tab is-on' : 'tab'}${extra}`} aria-pressed={on} title={title} onKeyDown={keepKey} onClick={run}>
      {label}
    </button>
  )
  return (
    <div className="guide-import guide-actions">
      {action('Network', tool === 'editor', () => onTool('editor'), 'Network Editor: arrange and edit the channels')}
      <GuideTab tool={tool} following={following} onTool={onTool} onClose={onClose} />
      {action('Options', tool === 'options', () => onTool('options'), 'Users and settings')}
      {action('Now', picked && !following, onNow, picked ? 'Back to the programme on air' : 'The channel playing, now · press again for the picture')}
      {action('Add', tool === 'add', () => onTool('add'))}
      {action('Media', tool === 'media', () => onTool('media'))}
    </div>
  )
}

/**
 * GUIDE: a click or a tap is the television listings; a right-click or a touch held past the long-press
 * threshold opens the programmable Guide (the Maps) instead, never both. Green while a Map is followed.
 */
function GuideTab({ tool, following, onTool, onClose }: { tool: GuideTool | null; following: boolean; onTool: (tool: GuideTool) => void; onClose?: () => void }) {
  const [press] = useState(() => createGuidePress())
  useEffect(() => press.cancel, [press])
  const maps = tool === 'guides'
  const listingsShown = tool === null || tool === 'edit'
  // From any panel standing in their place GUIDE brings the listings back; over the listings it closes the Guide, as CLOSE does.
  const listings = () => {
    if (tool && tool !== 'edit') onTool(tool)
    else onClose?.()
  }
  const openMaps = () => {
    if (!maps) onTool('guides')
  }
  const actions = { open: listings, search: openMaps }
  const point = (event: PointerEvent<HTMLButtonElement>) => ({ pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY })
  const label = following ? 'Guide, TVN is following a Map from your Guide' : 'Guide'
  return (
    <button
      type="button"
      className={`tab guide-section guide-follow${listingsShown || maps ? ' is-on' : ''}${maps ? ' is-open' : ''}${following ? ' is-following' : ''}`}
      aria-current={listingsShown ? 'page' : undefined}
      aria-expanded={maps}
      aria-label={`${label}. Right-click or hold for your saved Guides`}
      title={following ? 'The television listings · TVN is following one of your Guides · right-click or hold: your Guides' : 'The television listings · right-click or hold: your Guides'}
      onKeyDown={keepKey}
      onClick={() => press.click(actions)}
      onContextMenu={(event) => {
        event.preventDefault()
        press.contextMenu(actions)
      }}
      onPointerDown={(event) => press.down(point(event), actions)}
      onPointerMove={(event) => press.move(point(event))}
      onPointerUp={press.up}
      onPointerCancel={press.cancel}
      onPointerLeave={press.cancel}
    >
      Guide
    </button>
  )
}

/** A box for a YouTube channel or video link, an @handle, or a podcast or its website; IMPORT brings that source in as a User Channel. EXPORT, after it, downloads the User Network. */
export function AddChannelForm({
  nextNumber,
  onAdd,
  onPreview,
  onExport,
  onExportAll,
  onNewChannel,
  nextLowNumber = null,
  onNewLowChannel,
  onRestore,
  onAddMany,
  listPlaylists = lookUpChannelPlaylists,
  onFocus,
  inputRef,
}: {
  nextNumber: number | null
  onAdd: (link: string) => Promise<string>
  /** Reads a website, feed or archive first, so the viewer sees what it holds before it is added; null adds directly. */
  onPreview?: (link: string, onProgress: (text: string) => void) => Promise<FoundFeed | null>
  /** Download the User Network, with its Favourites, as a file; the answer is a short line for the viewer. */
  onExport?: () => Promise<string>
  /** Download everything portable: User Network, curation of 001–999, Favourites and settings. */
  onExportAll?: () => Promise<string>
  /** A new, empty channel, opened in Edit Channel to name and fill with sources. */
  onNewChannel?: () => Promise<void>
  /** In a network of the viewer's own, the first free channel from 001; null hides "New channel 001". */
  nextLowNumber?: number | null
  /** A new, empty channel at `nextLowNumber`, opened in Edit Channel. */
  onNewLowChannel?: () => Promise<void>
  /** Opens RESTORE: a User Network file saved with EXPORT, replacing the User Network. */
  onRestore?: () => void
  /** ADD CHANNELS: each playlist link a channel of its own; the answer is a short line for the viewer. */
  onAddMany?: (links: readonly string[], onProgress: (done: number, total: number) => void) => Promise<string>
  listPlaylists?: typeof lookUpChannelPlaylists
  onFocus?: () => void
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'all' | 'user' | null>(null)
  const [exported, setExported] = useState<'all' | 'user' | null>(null)
  const [preview, setPreview] = useState<FoundFeed | null>(null)
  /** A channel's Playlists tab given to IMPORT: one channel, or one per playlist? */
  const [asking, setAsking] = useState<string | null>(null)
  const [lists, setLists] = useState<Awaited<ReturnType<typeof lookUpChannelPlaylists>> | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())

  const findPlaylists = async (from = link) => {
    if (!onAddMany || busy) return
    setAsking(null)
    setPreview(null)
    if (!isYouTubeChannelLink(from)) {
      setNote('PASTE A YOUTUBE CHANNEL OR ITS /PLAYLISTS LINK, THEN ADD CHANNELS')
      inputRef?.current?.focus()
      return
    }
    setBusy(true)
    setNote('FINDING PLAYLISTS…')
    try {
      const found = await listPlaylists(from)
      if (found.playlists.length === 0) {
        setNote(`${found.title || 'THAT CHANNEL'} LISTS NO PLAYLISTS`.toUpperCase())
        return
      }
      setNote(null)
      setLists(found)
      setPicked(new Set(found.playlists.map((playlist) => playlist.id)))
    } catch (caught) {
      setNote(viewerMessage(caught, 'NO PLAYLISTS COULD BE FOUND'))
    } finally {
      setBusy(false)
    }
  }

  const addMany = async () => {
    if (!onAddMany || !lists) return
    const chosen = lists.playlists.filter((playlist) => picked.has(playlist.id)).map((playlist) => playlistUrl(playlist.id))
    if (chosen.length === 0) return
    setLists(null)
    setBusy(true)
    setNote(`ADDING ${chosen.length} ${chosen.length === 1 ? 'CHANNEL' : 'CHANNELS'}…`)
    try {
      setNote(await onAddMany(chosen, (done, total) => setNote(`ADDING CHANNELS · ${done} OF ${total} READ`)))
      setLink('')
    } catch (caught) {
      setNote(viewerMessage(caught, 'THE CHANNELS COULD NOT BE ADDED'))
    } finally {
      setBusy(false)
    }
  }

  const togglePicked = (id: string) =>
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const runExport = (which: 'all' | 'user') => {
    const work = which === 'all' ? onExportAll : onExport
    if (!work || exporting) return
    setExporting(which)
    work()
      .then((message) => {
        setNote(message)
        setExported(which)
      })
      .catch((caught: unknown) => setNote(viewerMessage(caught, 'THE EXPORT COULD NOT BE SAVED')))
      .finally(() => setExporting(null))
  }
  useEffect(() => {
    if (!exported) return
    const timer = setTimeout(() => setExported(null), 4000)
    return () => clearTimeout(timer)
  }, [exported])

  const add = async () => {
    setBusy(true)
    setNote('FINDING CHANNEL…')
    try {
      setNote(await onAdd(link))
      setLink('')
      setPreview(null)
    } catch (caught) {
      setNote(viewerMessage(caught, 'THAT CHANNEL COULD NOT BE ADDED'))
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent | KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    return importLink()
  }

  /** IMPORT; `single` once the viewer has chosen one channel for a channel's Playlists tab. */
  const importLink = async (single = false) => {
    if (!link.trim() || busy) return
    setAsking(null)
    if (!single && onAddMany && isPlaylistsLink(link)) {
      setPreview(null)
      setLists(null)
      setNote(null)
      setAsking(link.trim())
      return
    }
    if (!onPreview) return add()
    setBusy(true)
    setPreview(null)
    setNote('READING SOURCE…')
    let found: FoundFeed | null
    try {
      found = await onPreview(link, setNote)
    } catch (caught) {
      setNote(viewerMessage(caught, 'THAT SOURCE COULD NOT BE READ'))
      setBusy(false)
      return
    }
    setBusy(false)
    if (!found) return add()
    setNote(null)
    setPreview(found)
  }

  return (
    <form className="add-channel" onSubmit={(event) => void submit(event)} onKeyDown={keepKey}>
      <input
        ref={inputRef}
        type="text"
        inputMode="url"
        autoCapitalize="off"
        value={link}
        placeholder="@handle, YouTube, Vimeo, podcast, website or stream"
        aria-label={nextNumber ? `Video, channel, podcast or stream address for channel ${nextNumber}` : 'Video, channel, podcast or stream address'}
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
        onFocus={onFocus}
        onChange={(event) => setLink(event.target.value)}
        onKeyDown={(event) => {
          // Remote-control browsers can send Enter without the implicit form submission.
          if (event.key === 'Enter') void submit(event)
        }}
      />
      <button type="submit" className="tab" disabled={busy || !link.trim()}>
        {busy ? 'Importing…' : 'Import'}
      </button>
      {onExportAll ? (
        <button
          type="button"
          className="tab"
          title="Download ALL: your User Network, your curation of 001–999, Favourites and settings"
          disabled={exporting !== null}
          onClick={() => runExport('all')}
        >
          {exporting === 'all' ? 'Exporting…' : exported === 'all' ? 'Exported' : 'Export ALL'}
        </button>
      ) : null}
      {onExport ? (
        <button type="button" className="tab" title="Download your User Network (1001+) and its Favourites" disabled={exporting !== null} onClick={() => runExport('user')}>
          {exporting === 'user' ? 'Exporting…' : exported === 'user' ? 'Exported' : 'Export USER'}
        </button>
      ) : null}
      {onRestore ? (
        <button type="button" className="tab" title="Restore an ALL or USER export" onClick={onRestore}>
          Restore
        </button>
      ) : null}
      {onNewChannel ? (
        <button
          type="button"
          className="tune-key"
          onClick={() => void onNewChannel().catch((caught: unknown) => setNote(viewerMessage(caught, 'THE CHANNEL COULD NOT BE MADE')))}
        >
          New channel…
        </button>
      ) : null}
      {onAddMany ? (
        <button
          type="button"
          className="tune-key"
          title="A channel for each playlist of a YouTube channel: paste the channel or its /playlists link first"
          disabled={busy}
          onClick={() => void findPlaylists()}
        >
          Add channels…
        </button>
      ) : null}
      {onNewLowChannel && nextLowNumber !== null ? (
        <button
          type="button"
          className="tune-key"
          title="A new, empty channel among 001–990"
          onClick={() => void onNewLowChannel().catch((caught: unknown) => setNote(viewerMessage(caught, 'THE CHANNEL COULD NOT BE MADE')))}
        >
          New channel {String(nextLowNumber).padStart(3, '0')}
        </button>
      ) : null}
      {note ? (
        <span className="add-channel-note" role="status">
          {note}
        </span>
      ) : null}
      {asking ? (
        <div className="add-preview" role="dialog" aria-label="One channel or one per playlist?">
          <p className="add-preview-text">This link lists a YouTube channel’s playlists. Add the channel as one channel, or make a channel of each playlist?</p>
          <div className="add-preview-actions">
            <button type="button" className="tab is-on" disabled={busy} onClick={() => void findPlaylists(asking)}>
              A channel per playlist
            </button>
            <button type="button" className="tab" disabled={busy} onClick={() => void importLink(true)}>
              One channel
            </button>
            <button type="button" className="tab" disabled={busy} onClick={() => setAsking(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {lists ? (
        <div className="add-preview add-playlists" role="dialog" aria-label="Playlists to add as channels">
          <p className="add-preview-text">
            {lists.title ? `${lists.title} · ` : ''}
            {lists.playlists.length} {lists.playlists.length === 1 ? 'playlist' : 'playlists'}
            {lists.more ? ` (the first ${lists.playlists.length})` : ''}. Each one ticked becomes a channel of its own, named after it.
          </p>
          <ul className="add-playlists-list" aria-label="Playlists">
            {lists.playlists.map((playlist) => (
              <li key={playlist.id}>
                <label className="editor-check">
                  <input type="checkbox" checked={picked.has(playlist.id)} onChange={() => togglePicked(playlist.id)} />
                  <span>{playlist.title}</span>
                </label>
                {playlist.videos !== null ? <span className="add-playlists-count">{playlist.videos} videos</span> : null}
              </li>
            ))}
          </ul>
          <div className="add-preview-actions">
            <button type="button" className="tab" onClick={() => setPicked(new Set(lists.playlists.map((playlist) => playlist.id)))}>
              All
            </button>
            <button type="button" className="tab" onClick={() => setPicked(new Set())}>
              None
            </button>
            <button type="button" className="tab is-on" disabled={picked.size === 0} onClick={() => void addMany()}>
              Add {picked.size} {picked.size === 1 ? 'channel' : 'channels'}
            </button>
            <button type="button" className="tab" onClick={() => setLists(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {preview ? (
        <div className="add-preview" role="dialog" aria-label="What TVN found">
          <dl>
            {sourcePreviewLines(preview).map((line) => (
              <div key={line.label}>
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
          <div className="add-preview-actions">
            <button type="button" className="tab is-on" disabled={busy} onClick={() => void add()}>
              Add channel
            </button>
            <button type="button" className="tab" disabled={busy} onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </form>
  )
}

/**
 * The Guide footer while MEDIA is open, and the editor of a Local Media channel (991–1000): its name, the
 * files it holds, more from a folder or files on this device, Watch, and Clear. Added files join the end of
 * its running order and the panel stays open, so one folder after another builds the channel.
 */
export function SessionImportTools({
  channel = SESSION_CHANNEL,
  programmes = [],
  watching = false,
  onImport,
  onRemove = () => {},
  onMove = () => false,
  onClear = () => {},
  onRename = () => false,
  onWatch = () => {},
  onReload,
  onClose,
}: {
  channel?: Channel
  programmes?: readonly Programme[]
  watching?: boolean
  onImport: (files: readonly File[], channelNumber: number, handles?: readonly MediaHandle[]) => Promise<string>
  onRemove?: (programmeId: string) => void
  onMove?: (programmeId: string, to: number) => boolean
  onClear?: (channelNumber: number) => void
  onRename?: (channelNumber: number, name: string) => boolean
  onWatch?: (channelNumber: number) => void
  /** REMEMBER LOCAL MEDIA: load the channels remembered from an earlier visit. */
  onReload?: () => Promise<string>
  onClose?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const name = draft ?? channel.name
  const cancelled = useRef(false)
  const first = useRef<HTMLButtonElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const folders = folderSupported()
  const remember = useRememberMedia() && rememberSupported()
  const [reloadable, setReloadable] = useState(false)

  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '')
    first.current?.focus()
  }, [])

  useEffect(() => {
    if (!remember || !onReload) return
    let live = true
    void rememberedChannels().then((records) => {
      if (live) setReloadable(records.length > 0)
    })
    return () => {
      live = false
    }
  }, [remember, onReload])

  const run = async (files: readonly File[] | null, handles: readonly MediaHandle[] = []) => {
    if (!files || files.length === 0) return
    setBusy(true)
    setNote('READING…')
    try {
      setNote((await onImport(files, channel.number, handles)) || null)
    } catch (caught) {
      setNote(viewerMessage(caught, 'THOSE FILES COULD NOT BE READ'))
    } finally {
      setBusy(false)
      first.current?.focus()
    }
  }

  const chooseFolder = async () => {
    const picker = directoryPicker()
    if (!picker) {
      folderInput.current?.click()
      return
    }
    let root: MediaHandle | null = null
    const picked = await pickFolder(picker, (handle) => {
      root = handle as unknown as MediaHandle
    })
    // A browser that will not show its own folder picker still has the ordinary one.
    if (picked === 'refused') folderInput.current?.click()
    else await run(picked, root ? [root] : [])
  }

  /** With REMEMBER on, the browser's own file picker, so the files can be found again on a later visit. */
  const chooseFiles = async () => {
    const picker = remember ? filePicker() : null
    if (!picker) {
      filesInput.current?.click()
      return
    }
    const picked = await pickFiles(picker)
    if (picked === 'refused') filesInput.current?.click()
    else if (picked) await run(picked.files, picked.handles as unknown as MediaHandle[])
  }

  const reload = async () => {
    if (!onReload) return
    setBusy(true)
    setNote('RELOADING…')
    try {
      setNote((await onReload()) || null)
      setReloadable(false)
    } catch (caught) {
      setNote(viewerMessage(caught, 'THE REMEMBERED MEDIA COULD NOT BE LOADED'))
    } finally {
      setBusy(false)
    }
  }

  const fromInput = (input: HTMLInputElement) => {
    const files = input.files ? [...input.files] : []
    input.value = ''
    void run(files)
  }

  const rename = () => {
    if (!cancelled.current && draft !== null && onRename(channel.number, draft)) setNote(`${channel.number} · NAMED`)
    cancelled.current = false
    setDraft(null)
  }

  const shown = programmes.slice(0, 200)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<number | null>(null)

  return (
    <footer className="guide-info guide-tool local-media-tool" aria-label="Media">
      <div className="info-main">
        <p className="info-kicker">
          <span>{padChannel(channel.number)}</span>
          <span>{channel.name}</span>
          <span>
            {programmes.length} {programmes.length === 1 ? 'file' : 'files'}
          </span>
        </p>
        <form
          className="add-channel"
          onSubmit={(event) => {
            event.preventDefault()
            rename()
          }}
          onKeyDown={keepKey}
        >
          <input
            type="text"
            value={name}
            aria-label={`Name of channel ${channel.number}`}
            autoComplete="off"
            spellCheck={false}
            maxLength={LOCAL_NAME_LIMIT}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={rename}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                cancelled.current = true
                event.currentTarget.blur()
              }
            }}
          />
        </form>
        {shown.length > 0 ? (
          <ul className="local-media-list" aria-label={`Files on ${channel.name}`}>
            {shown.map((programme, index) => (
              <li
                key={programme.id}
                className={dragging === programme.id ? 'is-dragging' : over === index && dragging ? 'is-drop' : undefined}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', programme.id)
                  setDragging(programme.id)
                }}
                onDragOver={(event) => {
                  if (!dragging) return
                  event.preventDefault()
                  setOver(index)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (dragging) onMove(dragging, index)
                  setDragging(null)
                  setOver(null)
                }}
                onDragEnd={() => {
                  setDragging(null)
                  setOver(null)
                }}
              >
                <span className="local-media-grip" aria-hidden="true">
                  ⋮⋮
                </span>
                <span className="match-title">{programme.title}</span>
                <span className="match-time">{formatDuration(programme.durationSeconds)}</span>
                <button
                  type="button"
                  className="local-media-step"
                  aria-label={`Move ${programme.title} earlier`}
                  title="Earlier"
                  disabled={index === 0}
                  onKeyDown={keepKey}
                  onClick={() => onMove(programme.id, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="local-media-step"
                  aria-label={`Move ${programme.title} later`}
                  title="Later"
                  disabled={index === shown.length - 1}
                  onKeyDown={keepKey}
                  onClick={() => onMove(programme.id, index + 1)}
                >
                  ↓
                </button>
                <button type="button" className="local-media-remove" aria-label={`Remove ${programme.title}`} title="Remove" onKeyDown={keepKey} onClick={() => onRemove(programme.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="guide-tool-note">
            {remember
              ? 'A channel from video or audio on this device. Nothing is uploaded; the name is kept, and RELOAD PREVIOUS brings its folders and files back on a later visit.'
              : 'A channel from video or audio on this device, for this session only. Nothing is uploaded; the name is kept.'}
          </p>
        )}
        {note ? (
          <p className="guide-tool-status" role="status">
            {note}
          </p>
        ) : null}
      </div>
      <div className="info-actions">
        {folders ? (
          <button ref={first} type="button" className="tune-key" disabled={busy} onKeyDown={keepKey} onClick={() => void chooseFolder()}>
            Folder
          </button>
        ) : null}
        <button
          ref={folders ? undefined : first}
          type="button"
          className={folders ? 'tab' : 'tune-key'}
          disabled={busy}
          onKeyDown={keepKey}
          onClick={() => void chooseFiles()}
        >
          Files
        </button>
        {reloadable ? (
          <button type="button" className="tab" disabled={busy} title="Load the Local Media remembered from your last visit" onKeyDown={keepKey} onClick={() => void reload()}>
            Reload previous
          </button>
        ) : null}
        {programmes.length > 0 && !watching ? (
          <button type="button" className="tab" disabled={busy} onKeyDown={keepKey} onClick={() => onWatch(channel.number)}>
            Watch
          </button>
        ) : null}
        {programmes.length > 0 ? (
          <button
            type="button"
            className="tab"
            disabled={busy}
            onKeyDown={keepKey}
            onClick={() => {
              onClear(channel.number)
              setNote(`${channel.number} · CLEARED`)
            }}
          >
            Clear
          </button>
        ) : null}
        {onClose ? (
          <button type="button" className="tab" onKeyDown={keepKey} onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
      <input ref={folderInput} className="sr" type="file" multiple tabIndex={-1} aria-hidden="true" onChange={(event) => fromInput(event.currentTarget)} />
      <input
        ref={filesInput}
        className="sr"
        type="file"
        multiple
        accept={MEDIA_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => fromInput(event.currentTarget)}
      />
    </footer>
  )
}

/**
 * The Guide footer while + is open: a new named user (its own User Network tab), or a channel list file
 * imported as a new user named after the file. The Guide holds the name and the note, so + pressed again
 * can add the typed name or close; Esc closes without adding anyone.
 */
export function NewUserTools({
  name,
  note,
  onName,
  onNote,
  onCreate,
  onImportList,
  onCancel,
}: {
  name: string
  note: string | null
  onName: (name: string) => void
  onNote: (note: string | null) => void
  /** The answer is a short line for the viewer; a refused name throws. */
  onCreate: (name: string) => string
  onImportList: (file: File) => Promise<string>
  onCancel: () => void
}) {
  const setName = onName
  const setNote = onNote
  const [busy, setBusy] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const listInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameInput.current?.focus()
  }, [])

  const create = (event: FormEvent | KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    if (busy) return
    try {
      setNote(onCreate(name))
      setName('')
    } catch (caught) {
      setNote(viewerMessage(caught, 'THAT USER COULD NOT BE CREATED'))
    }
  }

  const importList = async (file: File) => {
    setBusy(true)
    setNote('READING CHANNEL LIST…')
    try {
      setNote((await onImportList(file)) || null)
    } catch (caught) {
      setNote(viewerMessage(caught, 'THAT CHANNEL LIST COULD NOT BE IMPORTED'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <footer className="guide-info guide-tool" aria-label="New user">
      <div className="info-main">
        <p className="info-kicker">
          <span className="info-net">User</span>
          <span>1001+</span>
          <span>New user</span>
        </p>
        <form className="add-channel" onSubmit={create} onKeyDown={keepKey}>
          <input
            ref={nameInput}
            type="text"
            value={name}
            placeholder="Name of the new user"
            aria-label="Name of the new user"
            autoComplete="off"
            spellCheck={false}
            maxLength={USER_NAME_MAX}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') create(event)
              else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                onCancel()
              }
            }}
          />
          <button type="submit" className="tune-key" disabled={busy || !name.trim()}>
            Add user
          </button>
        </form>
        {note ? (
          <p className="guide-tool-status" role="status">
            {note}
          </p>
        ) : null}
      </div>
      <div className="info-actions">
        <button type="button" className="tab" disabled={busy} onKeyDown={keepKey} onClick={() => listInput.current?.click()}>
          Import channel list
        </button>
      </div>
      <input
        ref={listInput}
        className="sr"
        type="file"
        accept=".json,.txt,application/json"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void importList(file)
        }}
      />
    </footer>
  )
}

/** A User Network file is a few hundred kilobytes at most; anything far larger is not one. */
const MAX_NETWORK_FILE_BYTES = 20 * 1024 * 1024

/**
 * The Guide footer while IMPORT is open: restore a TVN User Network file. The file is read and checked
 * first; replacing the viewer's User Network always asks, and a refused file changes nothing.
 */
export function UserNetworkImportTools({
  userChannels,
  onApply,
  onApplyComplete,
}: {
  userChannels: number
  onApply: (document: UserNetworkExport, onProgress: (note: string) => void) => Promise<string>
  onApplyComplete: (document: TvnExport, scope: 'all' | 'user', onProgress: (note: string) => void) => Promise<string>
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [pending, setPending] = useState<
    | { kind: 'network'; document: UserNetworkExport; channels: number; empty: number; users: number; favourites: number | null; filename: string }
    | { kind: 'complete'; document: TvnExport; channels: number; empty: number; users: number; favourites: number; overrides: number; filename: string }
    | null
  >(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    first.current?.focus()
  }, [])

  const choose = async (file: File) => {
    setPending(null)
    if (file.size > MAX_NETWORK_FILE_BYTES) {
      setNote('THAT FILE IS TOO LARGE TO BE A TVN USER NETWORK')
      return
    }
    setNote('READING…')
    try {
      const read = readRestoreFile(await file.text())
      if (!read.ok) {
        setNote(`${read.kind === 'complete' ? 'NOT A COMPLETE TVN EXPORT' : 'NOT A TVN USER NETWORK FILE'} · ${read.errors[0].toUpperCase()}`)
        return
      }
      setNote(null)
      if (read.kind === 'complete') {
        const empty = read.value.userNetwork.channels.filter((channel) => channel.state === 'empty').length
        setPending({ kind: 'complete', document: read.value, channels: read.channels, empty, users: read.users, favourites: read.favourites, overrides: read.overrides, filename: file.name })
      } else setPending({ kind: 'network', document: read.value, channels: read.channels, empty: read.empty, users: read.users, favourites: read.favourites, filename: file.name })
    } catch {
      setNote('THAT FILE COULD NOT BE READ')
    }
  }

  const apply = async (scope: 'all' | 'user') => {
    if (!pending) return
    const chosen = pending
    setPending(null)
    setBusy(true)
    const restoring = chosen.kind === 'complete' && scope === 'all' ? 'RESTORING ALL…' : 'RESTORING USER NETWORK…'
    setNote(restoring)
    let done: string | null = null
    const progress = (update: string) => setNote(`${done ?? restoring} · ${update}`)
    try {
      done = chosen.kind === 'complete' ? await onApplyComplete(chosen.document, scope, progress) : await onApply(chosen.document, progress)
      setNote(done)
    } catch (caught) {
      setNote(viewerMessage(caught, 'THE USER NETWORK COULD NOT BE IMPORTED'))
    } finally {
      setBusy(false)
    }
  }

  const key = (label: string, action: () => void, className = 'tab') => (
    <button type="button" className={className} disabled={busy} onKeyDown={keepKey} onClick={action}>
      {label}
    </button>
  )

  return (
    <footer className="guide-info guide-tool" aria-label="Import User Network">
      <div className="info-main">
        <p className="info-kicker">
          <span className="info-net">TVN</span>
          <span>1001+</span>
          <span>Import</span>
        </p>
        {note ? (
          <p className="guide-tool-status" role="status">
            {note}
          </p>
        ) : null}
      </div>
      <div className="info-actions">
        {pending ? (
          <>
            <span className="remove-ask" role="alertdialog" aria-label={pending.kind === 'complete' ? 'Restore ALL or USER?' : 'Restore USER?'}>
              {pending.kind === 'complete' ? 'An ALL export. ' : 'A USER export. '}
              Restoring replaces your User Network
              {userChannels > 0 ? ` (${userChannels} ${userChannels === 1 ? 'channel' : 'channels'})` : ''} with exactly its {pending.channels}{' '}
              {pending.channels === 1 ? 'channel' : 'channels'}
              {pending.empty > 0 ? `, ${pending.empty} empty,` : ''} from {pending.filename}, adding any that are missing here.
              {pending.users > 0
                ? ` Its ${pending.users} ${pending.users === 1 ? 'user replaces' : 'users replace'} yours.`
                : ' It has no named users: every channel goes to TVN.'}
              {pending.kind === 'complete'
                ? ` ALL also replaces your Favourites (with ${pending.favourites}), your settings${
                    pending.document.central ? ` and your curation of TVN channels 001–999 (with its ${pending.overrides})` : ''
                  }. USER restores only the User Network and its Favourites.`
                : pending.favourites !== null
                  ? ` Its ${pending.favourites} User Network ${pending.favourites === 1 ? 'Favourite replaces' : 'Favourites replace'} yours; other Favourites stay.`
                  : ' It lists no Favourites: yours stay wherever their channels do.'}
            </span>
            {pending.kind === 'complete' ? key('Restore ALL', () => void apply('all'), 'tab remove-key') : null}
            {key(pending.kind === 'complete' ? 'Restore USER only' : 'Restore USER', () => void apply('user'), 'tab remove-key')}
            {key('Keep mine', () => setPending(null))}
          </>
        ) : (
          <button ref={first} type="button" className="tune-key" disabled={busy} onKeyDown={keepKey} onClick={() => fileInput.current?.click()}>
            Choose file
          </button>
        )}
      </div>
      <input
        ref={fileInput}
        className="sr"
        type="file"
        accept=".json,application/json"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void choose(file)
        }}
      />
    </footer>
  )
}

/**
 * The Guide footer while ADD is open: RESTORE of a User Network file saved with EXPORT, and the rest of the
 * User Network's tools. Removing always asks first.
 */
export function UserNetworkTools({
  userChannels,
  onImportList,
  onLoadTest,
  onRemoveStarter,
  onRemoveAll,
  onExport,
  onExportAll,
  onRestore,
}: {
  userChannels: number
  /** A channel list file (a TVN export or a list of YouTube links) joins 1001+. */
  onImportList: (file: File) => Promise<string>
  /** The bundled starter network, added after the viewer's own channels. */
  onLoadTest: () => Promise<string>
  onRemoveStarter: () => Promise<string>
  onRemoveAll: () => Promise<string>
  /** Download the User Network, with its Favourites, as a file. */
  onExport?: () => Promise<string>
  /** Download everything portable: User Network, curation of 001–999, Favourites and settings. */
  onExportAll?: () => Promise<string>
  /** Opens RESTORE: a file saved with EXPORT. */
  onRestore?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'starter' | 'all' | null>(null)
  const listInput = useRef<HTMLInputElement>(null)

  const run = async (work: () => Promise<string>) => {
    setConfirming(null)
    setBusy(true)
    setNote(null)
    try {
      setNote((await work()) || null)
    } catch (caught) {
      setNote(viewerMessage(caught, 'THAT DID NOT WORK'))
    } finally {
      setBusy(false)
    }
  }

  const key = (label: string, action: () => void, className = 'tab') => (
    <button type="button" className={className} disabled={busy} onKeyDown={keepKey} onClick={action}>
      {label}
    </button>
  )

  return (
    <footer className="guide-info guide-tool user-tools" aria-label="User Network">
      <div className="info-main">
        <p className="info-kicker">
          <span className="info-net">User</span>
          <span>1001+</span>
          <span>
            {userChannels} {userChannels === 1 ? 'channel' : 'channels'}
          </span>
        </p>
        {note ? (
          <p className="guide-tool-status" role="status">
            {note}
          </p>
        ) : null}
      </div>
      <div className="info-actions">
        {onExport || onExportAll || onRestore ? (
          <div className="user-tools-row">
            {onExportAll ? key('Export ALL', () => void run(onExportAll)) : null}
            {onExport ? key('Export USER', () => void run(onExport)) : null}
            {onRestore ? key('Restore', onRestore) : null}
          </div>
        ) : null}
        <div className="user-tools-row">
        {confirming === 'all' ? (
          <>
            <span className="remove-ask">Remove all {userChannels} user channels from this browser?</span>
            {key('Yes, remove them', () => void run(onRemoveAll), 'tab remove-key')}
            {key('Keep them', () => setConfirming(null))}
          </>
        ) : confirming === 'starter' ? (
          <>
            <span className="remove-ask">Remove the starter network from this browser? Your other channels stay.</span>
            {key('Yes, remove it', () => void run(onRemoveStarter), 'tab remove-key')}
            {key('Keep it', () => setConfirming(null))}
          </>
        ) : (
          <>
            {key('Channel list', () => listInput.current?.click())}
            {key('Add starter network', () => void run(onLoadTest))}
            {userChannels > 0 ? key('Remove starter…', () => setConfirming('starter'), 'tab remove-key') : null}
            {userChannels > 0 ? key('Remove all…', () => setConfirming('all'), 'tab remove-key') : null}
          </>
        )}
        </div>
      </div>
      <input
        ref={listInput}
        className="sr"
        type="file"
        accept=".json,.txt,application/json"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void run(() => onImportList(file))
        }}
      />
    </footer>
  )
}
