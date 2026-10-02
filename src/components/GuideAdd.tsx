import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { createGuidePress } from '../view/guide-press.ts'
import { directoryPicker, MEDIA_ACCEPT, pickFolder } from '../session/import.ts'
import { SESSION_CHANNEL_NUMBER } from '../session/session-channel.ts'
import type { UserNetworkExport } from '../services/user-network-export.ts'
import { readRestoreFile, type TvnExport } from '../services/tvn-export.ts'
import type { GuideTool } from '../types/input.ts'
import { USER_NAME_MAX } from '../data/user-network/users.ts'
import { padChannel } from '../utils/time.ts'

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
 * GUIDE · OPTIONS · NOW · ADD · MEDIA: ordinary Guide actions beside SEARCH, each opening in the Guide itself. GUIDE holds
 * the viewer's own viewing Guides; it reads green only while one is being followed. OPTIONS holds the users and every
 * viewer setting.
 * ADD opens the Add Channel row, MEDIA builds 1000 Local Media from local files. New users and channel-list
 * imports live behind the + tab (after TVN and the users, before FAV).
 */
export function GuideActions({
  tool,
  picked,
  following = false,
  query = null,
  onNow,
  onTool,
  onGuideSearch,
}: {
  tool: GuideTool | null
  /** The words the Guide on show was created from, shown beside GUIDE while it is. */
  query?: string | null
  /** A programme chosen in the Guide is playing; NOW returns to air. */
  picked: boolean
  /** A viewing Guide is choosing what plays. */
  following?: boolean
  onNow: () => void
  onTool: (tool: GuideTool) => void
  /** CREATE GUIDE FROM…: a right-click or a hold on GUIDE. */
  onGuideSearch?: () => void
}) {
  const open = tool === 'guides'
  const openGuide = () => {
    if (!open) onTool('guides')
  }
  const action = (label: string, on: boolean, run: () => void, title?: string, extra = '') => (
    <button type="button" className={`${on ? 'tab is-on' : 'tab'}${extra}`} aria-pressed={on} title={title} onKeyDown={keepKey} onClick={run}>
      {label}
    </button>
  )
  return (
    <div className="guide-import guide-actions">
      <GuideTab open={open} following={following} onOpen={openGuide} onSearch={onGuideSearch ?? openGuide} />
      {query ? (
        <span className="guide-query" title={`This Guide was created from “${query}”`}>
          {query}
        </span>
      ) : null}
      {action('Options', tool === 'options', () => onTool('options'), 'Users and settings')}
      {action('Now', picked && !following, onNow, picked ? 'Back to the programme on air' : 'Back to the current time')}
      {action('Add', tool === 'add', () => onTool('add'))}
      {action('Media', tool === 'media', () => onTool('media'))}
    </div>
  )
}

/**
 * GUIDE names the screen the viewer is in, so it always reads as selected here, in white rather than yellow.
 * A click or a tap opens the viewer's Guide at once; a right-click or a hold opens CREATE GUIDE FROM….
 */
function GuideTab({ open, following, onOpen, onSearch }: { open: boolean; following: boolean; onOpen: () => void; onSearch: () => void }) {
  const [press] = useState(() => createGuidePress())
  const actions = { open: onOpen, search: onSearch }
  useEffect(() => press.cancel, [press])
  const point = (event: PointerEvent<HTMLButtonElement>) => ({ pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY })
  const label = following ? 'Guide, TVN is following a Guide' : 'Guide'
  return (
    <button
      type="button"
      className={`tab guide-follow is-current${open ? ' is-open' : ''}${following ? ' is-following' : ''}`}
      aria-current="page"
      aria-expanded={open}
      aria-label={`${label}. Right-click or hold to create a Guide from words`}
      title={following ? 'TVN is following a Guide · right-click or hold: Create Guide from…' : 'Right-click or hold: Create Guide from…'}
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
  onExport,
  onFocus,
  inputRef,
}: {
  nextNumber: number | null
  onAdd: (link: string) => Promise<string>
  /** Download the User Network as a file; the answer is a short line for the viewer. */
  onExport?: () => Promise<string>
  onFocus?: () => void
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState(false)

  const runExport = () => {
    if (!onExport || exporting) return
    setExporting(true)
    onExport()
      .then((message) => {
        setNote(message)
        setExported(true)
      })
      .catch((caught: unknown) => setNote(viewerMessage(caught, 'THE USER NETWORK COULD NOT BE EXPORTED')))
      .finally(() => setExporting(false))
  }
  useEffect(() => {
    if (!exported) return
    const timer = setTimeout(() => setExported(false), 4000)
    return () => clearTimeout(timer)
  }, [exported])

  const submit = async (event: FormEvent | KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    if (!link.trim() || busy) return
    setBusy(true)
    setNote('FINDING CHANNEL…')
    try {
      setNote(await onAdd(link))
      setLink('')
    } catch (caught) {
      setNote(viewerMessage(caught, 'THAT CHANNEL COULD NOT BE ADDED'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="add-channel" onSubmit={(event) => void submit(event)} onKeyDown={keepKey}>
      <input
        ref={inputRef}
        type="text"
        inputMode="url"
        autoCapitalize="off"
        value={link}
        placeholder="@handle, YouTube link, podcast or website"
        aria-label={nextNumber ? `YouTube link, @handle or podcast for channel ${nextNumber}` : 'YouTube link, @handle or podcast'}
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
      {onExport ? (
        <button type="button" className="tab" title="Download your User Network (1001+) as a JSON file" disabled={exporting} onClick={runExport}>
          {exporting ? 'Exporting…' : exported ? 'Exported' : 'Export'}
        </button>
      ) : null}
      {note ? (
        <span className="add-channel-note" role="status">
          {note}
        </span>
      ) : null}
    </form>
  )
}

/** The Guide footer while MEDIA is open: 1000 Local Media from a folder or files on this device. */
export function SessionImportTools({ onImport }: { onImport: (files: readonly File[]) => Promise<string> }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const first = useRef<HTMLButtonElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const folders = folderSupported()

  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '')
    first.current?.focus()
  }, [])

  const run = async (files: readonly File[] | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    setNote('READING…')
    try {
      setNote((await onImport(files)) || null)
    } catch (caught) {
      setNote(viewerMessage(caught, 'THOSE FILES COULD NOT BE READ'))
    } finally {
      setBusy(false)
    }
  }

  const chooseFolder = async () => {
    const picker = directoryPicker()
    if (picker) await run(await pickFolder(picker))
    else folderInput.current?.click()
  }

  const fromInput = (input: HTMLInputElement) => {
    const files = input.files ? [...input.files] : []
    input.value = ''
    void run(files)
  }

  return (
    <footer className="guide-info guide-tool" aria-label="Media">
      <div className="info-main">
        <p className="info-kicker">
          <span>{padChannel(SESSION_CHANNEL_NUMBER)}</span>
          <span>Local Media</span>
        </p>
        <p className="guide-tool-note">A temporary channel from video or audio on this device, for this session only. Nothing is uploaded.</p>
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
          onClick={() => filesInput.current?.click()}
        >
          Files
        </button>
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
  onApply: (document: UserNetworkExport) => Promise<string>
  onApplyComplete: (document: TvnExport) => Promise<string>
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [pending, setPending] = useState<
    | { kind: 'network'; document: UserNetworkExport; channels: number; empty: number; users: number; filename: string }
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
      } else setPending({ kind: 'network', document: read.value, channels: read.channels, empty: read.empty, users: read.users, filename: file.name })
    } catch {
      setNote('THAT FILE COULD NOT BE READ')
    }
  }

  const apply = async () => {
    if (!pending) return
    const chosen = pending
    setPending(null)
    setBusy(true)
    setNote(chosen.kind === 'complete' ? 'RESTORING TVN…' : 'IMPORTING USER NETWORK…')
    try {
      setNote(chosen.kind === 'complete' ? await onApplyComplete(chosen.document) : await onApply(chosen.document))
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
            <span className="remove-ask" role="alertdialog" aria-label={pending.kind === 'complete' ? 'Restore complete TVN export?' : 'Import User Network?'}>
              {pending.kind === 'complete'
                ? `Restore complete TVN export? This will replace your Favourites (with ${pending.favourites}), your settings and`
                : 'Import User Network? This will replace'}{' '}
              your current User Network
              {userChannels > 0 ? ` (${userChannels} ${userChannels === 1 ? 'channel' : 'channels'})` : ''} with {pending.channels}{' '}
              {pending.channels === 1 ? 'channel' : 'channels'}
              {pending.empty > 0 ? `, ${pending.empty} empty,` : ''} from {pending.filename}.
              {pending.users > 0
                ? ` Its ${pending.users} ${pending.users === 1 ? 'user replaces' : 'users replace'} yours.`
                : ' It has no named users: every channel goes to TVN.'}
              {pending.kind === 'complete' && pending.document.central
                ? ` Your curation of TVN channels 001–999 is replaced with its ${pending.overrides}; TVN's own channels are not changed.`
                : ''}
            </span>
            {key('Yes, replace it', () => void apply(), 'tab remove-key')}
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
  onImportNetwork,
  onImportList,
  onLoadTest,
  onRemoveStarter,
  onRemoveAll,
  onNewChannel,
}: {
  userChannels: number
  /** A new, empty channel, opened in Edit Channel to name and fill with sources. */
  onNewChannel?: () => Promise<void>
  /** Opens IMPORT: a User Network file saved with EXPORT, replacing the User Network. */
  onImportNetwork?: () => void
  /** A channel list file (a TVN export or a list of YouTube links) joins 1001+. */
  onImportList: (file: File) => Promise<string>
  /** The bundled starter network, added after the viewer's own channels. */
  onLoadTest: () => Promise<string>
  onRemoveStarter: () => Promise<string>
  onRemoveAll: () => Promise<string>
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
    <footer className="guide-info guide-tool" aria-label="User Network">
      <div className="info-main">
        <p className="info-kicker">
          <span className="info-net">User</span>
          <span>1001+</span>
          <span>
            {userChannels} {userChannels === 1 ? 'channel' : 'channels'}
          </span>
        </p>
        <p className="guide-tool-note">Kept in this browser. Paste a YouTube channel or video link in the last row, or start a new channel and add its sources in Edit Channel.</p>
        {note ? (
          <p className="guide-tool-status" role="status">
            {note}
          </p>
        ) : null}
      </div>
      <div className="info-actions">
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
            {onNewChannel ? key('New channel…', () => void run(async () => (await onNewChannel(), '')), 'tune-key') : null}
            {onImportNetwork ? key('Restore', onImportNetwork) : null}
            {key('Channel list', () => listInput.current?.click())}
            {key('Add starter network', () => void run(onLoadTest))}
            {userChannels > 0 ? key('Remove starter…', () => setConfirming('starter'), 'tab remove-key') : null}
            {userChannels > 0 ? key('Remove all…', () => setConfirming('all'), 'tab remove-key') : null}
          </>
        )}
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
