import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { directoryPicker, MEDIA_ACCEPT, pickFolder } from '../session/import.ts'
import type { GuideTool } from '../types/input.ts'
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

/** NOW, IMPORT, ADD and EXPORT: ordinary Guide actions beside SEARCH. IMPORT and ADD open in the Guide itself; EXPORT downloads a file. */
export function GuideActions({
  tool,
  picked,
  onNow,
  onTool,
  onExport,
}: {
  tool: GuideTool | null
  /** A programme chosen in the Guide is playing; NOW returns to air. */
  picked: boolean
  onNow: () => void
  onTool: (tool: GuideTool) => void
  /** Download the User Network as a file; the answer is a short line for the viewer. */
  onExport?: () => Promise<string>
}) {
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<string | null>(null)
  const runExport = () => {
    if (!onExport || exporting) return
    setExporting(true)
    onExport()
      .then((message) => setExported(message))
      .catch((caught: unknown) => setExported(viewerMessage(caught, 'THE USER NETWORK COULD NOT BE EXPORTED')))
      .finally(() => setExporting(false))
  }
  useEffect(() => {
    if (!exported) return
    const timer = setTimeout(() => setExported(null), 4000)
    return () => clearTimeout(timer)
  }, [exported])
  const action = (label: string, on: boolean, run: () => void, title?: string) => (
    <button type="button" className={on ? 'tab is-on' : 'tab'} aria-pressed={on} title={title} onKeyDown={keepKey} onClick={run}>
      {label}
    </button>
  )
  return (
    <div className="guide-import guide-actions">
      {action('Now', picked, onNow, picked ? 'Back to the programme on air' : 'Back to the current time')}
      {action('Import', tool === 'import', () => onTool('import'))}
      {action('Add', tool === 'add', () => onTool('add'))}
      {onExport
        ? action(exporting ? 'Exporting…' : exported ? 'Exported' : 'Export', false, runExport, exported ?? 'Download your User Network (1001+) as a JSON file')
        : null}
      {exported ? (
        <span className="visually-hidden" role="status">
          {exported}
        </span>
      ) : null}
    </div>
  )
}

/** A box for a YouTube channel or video link; the channel joins the bottom of the guide. */
export function AddChannelForm({
  nextNumber,
  onAdd,
  onFocus,
  inputRef,
}: {
  nextNumber: number | null
  onAdd: (link: string) => Promise<string>
  onFocus?: () => void
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

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
        {busy ? 'Adding…' : 'Add'}
      </button>
      {note ? (
        <span className="add-channel-note" role="status">
          {note}
        </span>
      ) : null}
    </form>
  )
}

/** The Guide footer while IMPORT is open: channel 000 from a folder or files on this device. */
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
    <footer className="guide-info guide-tool" aria-label="Import">
      <div className="info-main">
        <p className="info-kicker">
          <span className="info-net">Session</span>
          <span>{padChannel(0)}</span>
          <span>Import</span>
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

/** The Guide footer while ADD is open: the rest of the User Network's tools. Removing always asks first. */
export function UserNetworkTools({
  userChannels,
  onImportList,
  onLoadTest,
  onRemoveStarter,
  onRemoveAll,
}: {
  userChannels: number
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
