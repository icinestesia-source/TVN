import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { channelByNumber, programmesFor } from '../data/catalogue.ts'
import { refusedVideos } from '../services/embed-refusals.ts'
import { resolveItem, unsaved, type GuideItem, type GuideRun, type ViewingGuide } from '../services/viewing-guides.ts'
import { useTv } from '../state/tv-context.ts'
import { padChannel } from '../utils/time.ts'

/** Enter and Space press these controls; they must not also confirm (and tune) the guide cursor. */
function keepKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}

function viewerMessage(caught: unknown, fallback: string): string {
  const text = caught instanceof Error ? caught.message.trim() : ''
  return text && text.length <= 90 && !/[<>{}]/.test(text) ? text.toUpperCase() : fallback
}

function minutes(seconds: number): string {
  const total = Math.max(1, Math.round(seconds / 60))
  return total >= 60 ? `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m` : `${total}m`
}

type ItemState = 'playing' | 'paused' | 'skipped' | 'unavailable' | null

function itemState(item: GuideItem, index: number, guide: ViewingGuide, run: GuideRun | null, reason: string | null): ItemState {
  const ours = run !== null && run.guide.id === guide.id
  if (ours && run.guide.items[run.index]?.id === item.id && index === guide.items.findIndex((entry) => entry.id === item.id)) {
    return run.state === 'active' ? 'playing' : 'paused'
  }
  if (reason) return 'unavailable'
  if (ours && run.skipped.includes(item.id)) return 'skipped'
  return null
}

const STATE_LABEL: Record<Exclude<ItemState, null>, string> = {
  playing: 'Playing',
  paused: 'Paused here',
  skipped: 'Skipped',
  unavailable: 'Unavailable',
}

/**
 * GUIDE: the viewer's own viewing Guide, an ordered list of programmes from any channels played one after
 * another. It holds references only; schedules and running orders are never touched.
 */
export function GuidePanel({ searchAsk = 0 }: { searchAsk?: number }) {
  const tv = useTv()
  const library = tv.guideLibrary
  const guide = library.current
  const run = tv.guideRun
  const following = run?.state === 'active'
  const [name, setName] = useState(guide?.name ?? '')
  const [note, setNote] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [words, setWords] = useState('')
  const [building, setBuilding] = useState(false)
  const wordsRef = useRef<HTMLInputElement>(null)
  const search = tv.guideSearch && guide && tv.guideSearch.guideId === guide.id ? tv.guideSearch : null
  useEffect(() => {
    // Asked for with a mouse (a right-click on GUIDE), the words box is ready to type in; a touch keeps the keyboard down.
    if (!searchAsk || typeof window === 'undefined') return
    if (window.matchMedia?.('(pointer: fine)').matches) wordsRef.current?.focus()
    else wordsRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [searchAsk])
  const shown = `${guide?.id ?? ''}:${guide?.name ?? ''}`
  const [seen, setSeen] = useState(shown)
  if (seen !== shown) {
    setSeen(shown)
    setName(guide?.name ?? '')
    setConfirmDelete(false)
  }

  const act = (run: () => string | void) => {
    try {
      const message = run()
      setNote(message || null)
    } catch (caught) {
      setNote(viewerMessage(caught, 'THAT DID NOT WORK'))
    }
  }

  const commitName = () => {
    const next = name.trim()
    if (!next || next === guide?.name) return
    act(() => tv.editGuide({ type: 'rename', name: next }))
  }

  /** Builds after the note has painted: a broad search over the whole catalogue takes a moment. */
  const create = (rescan: boolean) => {
    if (building) return
    if (!rescan && !words.trim()) {
      setNote('TYPE WHAT THE GUIDE SHOULD BE ABOUT')
      return
    }
    setBuilding(true)
    setNote(rescan ? 'RESCANNING…' : 'BUILDING A GUIDE…')
    window.setTimeout(() => {
      act(() => tv.searchGuide(words, rescan))
      setBuilding(false)
    }, 30)
  }
  const submitWords = (event: FormEvent) => {
    event.preventDefault()
    create(false)
  }

  const lookup = { channelByNumber, programmesFor, refused: refusedVideos() }
  const button = (label: string, onClick: () => void, options: { disabled?: boolean; on?: boolean; title?: string; className?: string } = {}) => (
    <button
      type="button"
      className={`${options.on ? 'tab is-on' : 'tab'}${options.className ? ` ${options.className}` : ''}`}
      disabled={options.disabled}
      title={options.title}
      onKeyDown={keepKey}
      onClick={onClick}
    >
      {label}
    </button>
  )
  const runHere = run !== null && guide !== null && run.guide.id === guide.id
  const position = run ? `${Math.min(run.index + 1, run.guide.items.length)} OF ${run.guide.items.length}` : ''

  return (
    <footer className="guide-info guide-editor guide-plan" aria-label="Viewing Guide">
      <form className="plan-search" onSubmit={submitWords} aria-label="Create Guide from">
        <label className="editor-field plan-search-field">
          <span className="editor-heading">Create Guide from…</span>
          <input
            ref={wordsRef}
            value={words}
            maxLength={60}
            placeholder="Music, Daft Punk, Italian cooking…"
            aria-label="Create a Guide from these words"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            onChange={(event) => setWords(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') submitWords(event)
            }}
          />
        </label>
        <button type="submit" className="tab" disabled={building} onKeyDown={keepKey}>
          Create
        </button>
        {search ? (
          <>
            {button('Watch Guide', () => tv.playGuide(0), { disabled: building || !guide || guide.items.length === 0, className: 'guide-follow', title: 'Play this Guide from the start' })}
            {button('Rescan', () => create(true), { disabled: building, title: search.small ? `Only ${search.matched} programmes match, so a rescan cannot vary much` : `Build ${search.query} again, differently` })}
          </>
        ) : null}
      </form>
      <div className="plan-head">
        <label className="editor-field plan-name">
          <span className="editor-heading">Guide</span>
          <input
            value={name}
            maxLength={60}
            placeholder="Name this Guide"
            aria-label="Guide name"
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') commitName()
            }}
          />
        </label>
        <p className={following ? 'plan-state is-following' : run ? 'plan-state is-paused' : 'plan-state'} role="status">
          {following
            ? `TVN is following ${run.guide.name} · ${position}`
            : run
              ? `${run.guide.name} paused · ${position}`
              : guide && unsaved(library)
                ? 'Not saved'
                : ''}
        </p>
      </div>

      <div className="plan-controls">
        {run && !following
          ? button('Resume Guide', () => tv.resumeGuide(), { className: 'guide-follow', title: 'Follow the Guide again from where it was' })
          : button('Play', () => tv.playGuide(0), { disabled: !guide || guide.items.length === 0, title: 'Play this Guide from the start' })}
        {button('‹ Prev', () => tv.guideStep(-1), { disabled: !run, title: 'Previous item in the Guide' })}
        {button('Next ›', () => tv.guideStep(1), { disabled: !run, title: 'Next item in the Guide' })}
        {button('Stop', () => tv.stopGuide(), { disabled: !run, title: 'Stop following the Guide' })}
        <label className="plan-loop">
          <input
            type="checkbox"
            checked={guide?.loop === true}
            disabled={!guide}
            onChange={(event) => act(() => tv.editGuide({ type: 'loop', loop: event.target.checked }))}
          />
          Loop
        </label>
      </div>

      {guide && guide.items.length > 0 ? (
        <ol className="plan-items">
          {guide.items.map((item, index) => {
            const resolved = resolveItem(item, lookup)
            const state = itemState(item, index, guide, runHere ? run : null, resolved.ok ? null : resolved.reason)
            return (
              <li key={item.id} className={`plan-item${state ? ` is-${state}` : ''}`} data-state={state ?? ''}>
                <span className="plan-order">{index + 1}</span>
                <span className="plan-channel">
                  {padChannel(item.channelNumber)} {item.channelName}
                </span>
                <span className="plan-title" title={item.programme.title}>
                  {item.programme.title}
                </span>
                <span className="plan-meta">
                  {state ? STATE_LABEL[state] : minutes(item.programme.durationSeconds)}
                  {state === 'unavailable' && !resolved.ok ? ` · ${resolved.reason}` : ''}
                </span>
                <span className="plan-actions">
                  {button('▲', () => act(() => tv.editGuide({ type: 'move', itemId: item.id, delta: -1 })), { disabled: index === 0, title: 'Move up' })}
                  {button('▼', () => act(() => tv.editGuide({ type: 'move', itemId: item.id, delta: 1 })), {
                    disabled: index === guide.items.length - 1,
                    title: 'Move down',
                  })}
                  {button('Play', () => tv.playGuide(index), { disabled: !resolved.ok, title: 'Play the Guide from here' })}
                  {button('Remove', () => act(() => tv.editGuide({ type: 'remove', itemId: item.id })), { title: 'Remove from this Guide' })}
                </span>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="plan-empty">
          Type a few words above to build a Guide from TVN's channels, or right-click or hold a programme in the Guide and choose ADD TO GUIDE. A normal click still plays it.
        </p>
      )}

      <div className="plan-library">
        {button('New', () => act(() => tv.editGuide({ type: 'new' })))}
        {button('Save', () => act(() => tv.editGuide({ type: 'save' })), { disabled: !guide || !unsaved(library) })}
        {button('Duplicate', () => act(() => tv.editGuide({ type: 'duplicate' })), { disabled: !guide })}
        {button('Clear', () => act(() => tv.editGuide({ type: 'clear' })), { disabled: !guide || guide.items.length === 0 })}
        {button(
          confirmDelete ? 'Delete?' : 'Delete',
          () => {
            if (!confirmDelete) {
              setConfirmDelete(true)
              return
            }
            setConfirmDelete(false)
            act(() => tv.editGuide({ type: 'delete' }))
          },
          { disabled: !guide, title: 'Delete this Guide' },
        )}
      </div>

      {library.saved.length > 0 ? (
        <div className="plan-saved">
          <span className="editor-heading">Saved Guides</span>
          <ul>
            {library.saved.map((saved) => (
              <li key={saved.id} className={saved.id === guide?.id ? 'is-current' : undefined}>
                <span className="plan-saved-name">{saved.name}</span>
                <span className="plan-meta">
                  {saved.items.length} {saved.items.length === 1 ? 'item' : 'items'}
                </span>
                {button('Load', () => act(() => tv.editGuide({ type: 'load', id: saved.id })), { disabled: saved.id === guide?.id })}
                {button(
                  'Play',
                  () => {
                    if (saved.id !== guide?.id) tv.editGuide({ type: 'load', id: saved.id })
                    tv.playGuide(0)
                  },
                  { disabled: saved.items.length === 0 },
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {note ? <p className="plan-note">{note}</p> : null}
    </footer>
  )
}
