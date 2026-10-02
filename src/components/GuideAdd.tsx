import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { directoryPicker, MEDIA_ACCEPT, pickFolder } from '../session/import.ts'
import type { UserNetworkExport } from '../services/user-network-export.ts'
import { readUserNetworkFile } from '../services/user-network-restore.ts'
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
 * OPTIONS · NOW · ADD · MEDIA: ordinary Guide actions beside SEARCH, each opening in the Guide itself. OPTIONS holds
 * the users and every viewer setting.
 * ADD opens the Add Channel row, MEDIA builds channel 000 from local files. New users and channel-list
 * imports live behind the + tab (after TVN and the users, before FAV).
 */
export function GuideActions({
  tool,
  picked,
  onNow,
  onTool,
}: {
  tool: GuideTool | null
  /** A programme chosen in the Guide is playing; NOW returns to air. */
  picked: boolean
  onNow: () => void
  onTool: (tool: GuideTool) => void
}) {
  const action = (label: string, on: boolean, run: () => void, title?: string) => (
    <button type="button" className={on ? 'tab is-on' : 'tab'} aria-pressed={on} title={title} onKeyDown={keepKey} onClick={run}>
      {label}
    </button>
  )
  return (
    <div className="guide-import guide-actions">
      {action('Options', tool === 'options', () => onTool('options'), 'Users and settings')}
      {action('Now', picked, onNow, picked ? 'Back to the programme on air' : 'Back to the current time')}
      {action('Add', tool === 'add', () => onTool('add'))}
      {action('Media', tool === 'media', () => onTool('media'))}
    </div>
  )
}

/** A box for a YouTube channel or video link; IMPORT brings that source in as a User Channel. EXPORT, after it, downloads the User Network. */
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
        type="url"
        inputMode="url"
        value={link}
        placeholder="Paste a YouTube channel, playlist or video link"
        aria-label={nextNumber ? `YouTube link for channel ${nextNumber}` : 'YouTube channel or playlist link'}
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

/** The Guide footer while MEDIA is open: channel 000 from a folder or files on this device. */
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
          <span className="info-net">Session</span>
          <span>{padChannel(0)}</span>
          <span>Media</span>
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
}: {
  userChannels: number
  onApply: (document: UserNetworkExport) => Promise<string>
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [pending, setPending] = useState<{ document: UserNetworkExport; channels: number; empty: number; users: number; filename: string } | null>(null)
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
      const read = readUserNetworkFile(await file.text())
      if (!read.ok) {
        setNote(`NOT A TVN USER NETWORK FILE · ${read.errors[0].toUpperCase()}`)
        return
      }
      setNote(null)
      setPending({ document: read.value, channels: read.channels, empty: read.empty, users: read.users, filename: file.name })
    } catch {
      setNote('THAT FILE COULD NOT BE READ')
    }
  }

  const apply = async () => {
    if (!pending) return
    const { document } = pending
    setPending(null)
    setBusy(true)
    setNote('IMPORTING USER NETWORK…')
    try {
      setNote(await onApply(document))
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
            <span className="remove-ask" role="alertdialog" aria-label="Import User Network?">
              Import User Network? This will replace your current User Network
              {userChannels > 0 ? ` (${userChannels} ${userChannels === 1 ? 'channel' : 'channels'})` : ''} with {pending.channels}{' '}
              {pending.channels === 1 ? 'channel' : 'channels'}
              {pending.empty > 0 ? `, ${pending.empty} empty,` : ''} from {pending.filename}.
              {pending.users > 0
                ? ` Its ${pending.users} ${pending.users === 1 ? 'user replaces' : 'users replace'} yours.`
                : ' It has no named users: every channel goes to TVN.'}
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
}: {
  userChannels: number
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
        <p className="guide-tool-note">Kept in this browser. Paste a YouTube channel or video link in the last row.</p>
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
