import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { channelByNumber, programmesFor } from '../data/catalogue.ts'
import { refusedVideos } from '../services/embed-refusals.ts'
import { NEW_MAP_NAME, resolveItem, unsaved, type GuideItem, type GuideRun, type GuideSource, type ViewingGuide } from '../services/viewing-guides.ts'
import { useTv } from '../state/tv-context.ts'
import { padChannel } from '../utils/time.ts'
import { mapSources, mapSummary } from '../view/map-summary.ts'

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
 * MY GUIDE (in the Guide's header) is the viewer's collection of MAPS. A Map is one curated viewing schedule,
 * played one programme after another: built from channel sources, from a topic, from programmes added in the
 * Guide, or all three. The panel lists the Maps (PLAY, EDIT, DUPLICATE, DELETE, + NEW MAP); EDIT and NEW MAP open
 * one Map's editor, where its schedule is built, arranged and saved. A Map holds references only; schedules and
 * running orders are never touched. (Inside TVN a Map is still a viewing Guide; GUIDE alone is the listings.)
 */
export function GuidePanel({ searchAsk = 0 }: { searchAsk?: number }) {
  const tv = useTv()
  const library = tv.guideLibrary
  const guide = library.current
  const run = tv.guideRun
  const following = run?.state === 'active'
  const dirty = guide !== null && unsaved(library) && (guide.items.length > 0 || (guide.sources?.length ?? 0) > 0)
  const [view, setView] = useState<'maps' | 'editor'>(() => (guide && unsaved(library) && !run ? 'editor' : 'maps'))
  const [name, setName] = useState(guide?.name ?? '')
  const [note, setNote] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [words, setWords] = useState('')
  const [building, setBuilding] = useState(false)
  const wordsRef = useRef<HTMLInputElement>(null)
  const [number, setNumber] = useState('')
  const sources = useMemo(() => guide?.sources ?? [], [guide?.sources])
  // Each source as it is now: the channel its id names (whatever its number) and what it can supply.
  const supplies = useMemo(
    () => sources.map((source) => ({ source, ...tv.guideSupply(source) })),
    // The network moving changes what a source supplies; visibleChannels is what moves with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources, tv.visibleChannels, tv.guideSupply],
  )
  const search = tv.guideSearch && guide && tv.guideSearch.guideId === guide.id ? tv.guideSearch : null
  const shown = `${guide?.id ?? ''}:${guide?.name ?? ''}`
  const [seen, setSeen] = useState(shown)
  if (seen !== shown) {
    setSeen(shown)
    setName(guide?.name ?? '')
    setConfirmDelete(null)
  }
  if (view === 'editor' && !guide) setView('maps')

  const act = (run: () => string | void) => {
    try {
      const message = run()
      setNote(message || null)
    } catch (caught) {
      setNote(viewerMessage(caught, 'THAT DID NOT WORK'))
    }
  }

  /** Leaving a Map with edits not saved asks once; pressing again goes on and lets the edits go. */
  const guarded = (key: string, go: () => void) => {
    if (dirty && pending !== key) {
      setPending(key)
      setNote(`${guide!.name.toUpperCase()} IS NOT SAVED · PRESS AGAIN TO LEAVE IT`)
      return
    }
    setPending(null)
    go()
  }

  const newMap = () =>
    guarded('new', () => {
      act(() => tv.editGuide({ type: 'new', name: NEW_MAP_NAME }))
      setWords('')
      setView('editor')
    })

  useEffect(() => {
    // CREATE FROM… (a right-click or a hold on MY GUIDE) is a Map's topic box: the Map being edited, or a new one.
    if (!searchAsk || typeof window === 'undefined') return
    setView('editor')
    if (!guide) tv.editGuide({ type: 'new', name: NEW_MAP_NAME })
    window.setTimeout(() => {
      if (window.matchMedia?.('(pointer: fine)').matches) wordsRef.current?.focus()
      else wordsRef.current?.scrollIntoView?.({ block: 'nearest' })
    }, 0)
    // Only a fresh ask opens the topic box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchAsk])

  const commitName = () => {
    const next = name.trim()
    if (!next || next === guide?.name) return
    act(() => tv.editGuide({ type: 'rename', name: next }))
  }

  /** Builds after the note has painted: a broad search over the whole catalogue takes a moment. */
  const create = (rescan: boolean) => {
    if (building) return
    if (!rescan && !words.trim()) {
      setNote('TYPE WHAT THE MAP SHOULD BE ABOUT')
      return
    }
    setBuilding(true)
    setNote(rescan ? 'RESCANNING…' : 'BUILDING THE MAP…')
    window.setTimeout(() => {
      act(() => tv.searchGuide(words, rescan))
      setBuilding(false)
    }, 30)
  }
  const submitWords = (event: FormEvent) => {
    event.preventDefault()
    create(false)
  }

  const addSource = (event: FormEvent) => {
    event.preventDefault()
    const typed = Number(number.trim())
    if (!number.trim() || !Number.isInteger(typed) || typed < 0) {
      setNote('TYPE A CHANNEL NUMBER')
      return
    }
    act(() => tv.addGuideSource(typed))
    setNumber('')
  }
  const setSources = (next: GuideSource[]) => act(() => tv.editGuide({ type: 'sources', sources: next }))
  const moveSource = (index: number, delta: -1 | 1) => {
    const next = sources.slice()
    const [moved] = next.splice(index, 1)
    next.splice(index + delta, 0, moved!)
    setSources(next)
  }
  const buildFromSources = () => {
    if (building) return
    setBuilding(true)
    setNote('BUILDING THE MAP…')
    window.setTimeout(() => {
      act(() => tv.buildChannelGuide())
      setBuilding(false)
    }, 30)
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

  const playMap = (map: ViewingGuide) => {
    if (run && run.guide.id === map.id && !following) {
      tv.resumeGuide()
      return
    }
    guarded(`play:${map.id}`, () => {
      if (map.id !== guide?.id) tv.editGuide({ type: 'load', id: map.id })
      tv.playGuide(0)
    })
  }
  const editMap = (map: ViewingGuide) =>
    guarded(`edit:${map.id}`, () => {
      if (map.id !== guide?.id) act(() => tv.editGuide({ type: 'load', id: map.id }))
      setView('editor')
    })
  const deleteMap = (map: ViewingGuide) => {
    if (confirmDelete !== map.id) {
      setConfirmDelete(map.id)
      return
    }
    setConfirmDelete(null)
    act(() => tv.editGuide({ type: 'delete', id: map.id }))
  }

  // The Map being edited, when it has never been saved, heads the list until it is.
  const maps: ViewingGuide[] = [...(guide && !library.saved.some((saved) => saved.id === guide.id) ? [guide] : []), ...library.saved]

  const playing = run ? (
    <section className="map-playing" aria-label="The Map playing">
      <div className="map-playing-head">
        <p className={following ? 'plan-state is-following' : 'plan-state is-paused'} role="status">
          {following ? `Playing ${run.guide.name} · ${position}` : `${run.guide.name} paused · ${position}`}
        </p>
        <span className="plan-actions">
          {following ? null : button('Resume', () => tv.resumeGuide(), { className: 'guide-follow', title: 'Follow this Map again from where it was' })}
          {button('‹ Prev', () => tv.guideStep(-1), { title: 'Previous programme in the Map' })}
          {button('Next ›', () => tv.guideStep(1), { title: 'Next programme in the Map' })}
          {button('Stop', () => tv.stopGuide(), { title: 'Stop following the Map' })}
        </span>
      </div>
      <ol className="plan-items map-playing-items">
        {run.guide.items.map((item, index) => {
          if (index < run.index - 1 || index > run.index + 4) return null
          const current = index === run.index
          const skipped = run.skipped.includes(item.id)
          const state: ItemState = current ? (following ? 'playing' : 'paused') : skipped ? 'skipped' : null
          return (
            <li key={item.id} className={`plan-item${state ? ` is-${state}` : ''}`} data-state={state ?? ''}>
              <span className="plan-order">{index + 1}</span>
              <span className="plan-channel">
                {padChannel(item.channelNumber)} {item.channelName}
              </span>
              <span className="plan-title" title={item.programme.title}>
                {item.programme.title}
              </span>
              <span className="plan-meta">{state ? STATE_LABEL[state] : index < run.index ? 'Played' : minutes(item.programme.durationSeconds)}</span>
            </li>
          )
        })}
      </ol>
    </section>
  ) : null

  return (
    <footer className="guide-info guide-editor guide-plan" aria-label="My Guide">
      <div className="map-top">
        <h3 className="options-head plan-title-head">My Guide</h3>
        {view === 'editor'
          ? button('‹ All Maps', () => setView('maps'), { title: 'Back to the Maps in My Guide' })
          : button('+ New Map', newMap, { title: 'A new Map: a schedule of programmes from channels, a topic or the Guide' })}
      </div>

      {view === 'maps' ? (
        <>
          {playing}
          {maps.length > 0 ? (
            <ul className="map-list" aria-label="Maps">
              {maps.map((map) => {
                const isRun = run !== null && run.guide.id === map.id
                const isCurrent = map.id === guide?.id
                const status = isRun ? (following ? `Playing · ${position}` : `Paused · ${position}`) : isCurrent && unsaved(library) ? 'Not saved' : ''
                return (
                  <li key={map.id} className={`map-row${isRun && following ? ' is-playing' : ''}${isCurrent ? ' is-current' : ''}`}>
                    <span className="map-name">{map.name}</span>
                    <span className="plan-meta">{mapSummary(map)}</span>
                    <span className="map-sources" title={mapSources(map)}>
                      {mapSources(map)}
                    </span>
                    <span className={`map-state${isRun && following ? ' is-following' : ''}`}>{status}</span>
                    <span className="plan-actions">
                      {button(isRun && !following ? 'Resume' : 'Play', () => playMap(map), {
                        disabled: map.items.length === 0,
                        title: `Play ${map.name}`,
                        on: pending === `play:${map.id}`,
                      })}
                      {button('Edit', () => editMap(map), { title: `Edit ${map.name}`, on: pending === `edit:${map.id}` })}
                      {button('Duplicate', () => act(() => tv.editGuide({ type: 'duplicate', id: map.id })), {
                        disabled: isCurrent && !library.saved.some((saved) => saved.id === map.id),
                        title: `A copy of ${map.name}`,
                      })}
                      {button(confirmDelete === map.id ? 'Delete?' : 'Delete', () => deleteMap(map), { title: `Delete ${map.name}` })}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="plan-empty">
              No Maps yet. A Map is a schedule of programmes you follow one after another. + NEW MAP builds one from channels or a topic, or right-click or hold a programme in the Guide and choose ADD TO.
            </p>
          )}
        </>
      ) : guide ? (
        <>
          <div className="plan-head">
            <label className="editor-field plan-name">
              <span className="editor-heading">Map name</span>
              <input
                value={name}
                maxLength={60}
                placeholder="Name this Map"
                aria-label="Map name"
                onChange={(event) => setName(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter') commitName()
                }}
              />
            </label>
            <p className={runHere && following ? 'plan-state is-following' : runHere ? 'plan-state is-paused' : unsaved(library) ? 'plan-state is-unsaved' : 'plan-state'} role="status">
              {runHere && following ? `Playing · ${position}` : runHere ? `Paused · ${position}` : unsaved(library) ? 'Not saved' : 'Saved'}
            </p>
          </div>

          <form className="plan-search plan-sources" onSubmit={addSource} aria-label="Channel sources">
            <label className="editor-field plan-source-field">
              <span className="editor-heading">Channel sources</span>
              <input
                value={number}
                maxLength={5}
                inputMode="numeric"
                placeholder="001"
                aria-label="Add a channel source by its number"
                autoComplete="off"
                onChange={(event) => setNumber(event.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter') addSource(event)
                }}
              />
            </label>
            <button type="submit" className="tab" onKeyDown={keepKey}>
              Add source
            </button>
            {button('Build from sources', buildFromSources, { disabled: building || sources.length === 0, title: 'Schedule two to four hours from these channels, mixed' })}
          </form>
          {supplies.length > 0 ? (
            <ol className="plan-source-list" aria-label="Channels this Map draws on">
              {supplies.map(({ source, channel, programmes, seconds }, index) => (
                <li key={source.channelId} className={channel ? 'plan-source' : 'plan-source is-gone'}>
                  <span className="plan-channel">
                    {padChannel(channel?.number ?? source.channelNumber)} · {channel?.name ?? source.channelName}
                  </span>
                  <span className="plan-meta">{!channel ? 'No longer in the network' : programmes === 0 ? 'Nothing to schedule yet' : `${programmes} ${programmes === 1 ? 'programme' : 'programmes'} · ${minutes(seconds)} available`}</span>
                  <span className="plan-actions">
                    {button('▲', () => moveSource(index, -1), { disabled: index === 0, title: 'Move up' })}
                    {button('▼', () => moveSource(index, 1), { disabled: index === supplies.length - 1, title: 'Move down' })}
                    {button('×', () => setSources(sources.filter((item) => item.channelId !== source.channelId)), { title: `Remove ${channel?.name ?? source.channelName}` })}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          <form className="plan-search" onSubmit={submitWords} aria-label="Build this Map from a topic">
            <label className="editor-field plan-search-field">
              <span className="editor-heading">Topic or search</span>
              <input
                ref={wordsRef}
                value={words}
                maxLength={60}
                placeholder="Music, Daft Punk, Italian cooking…"
                aria-label="Build this Map from these words"
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
              Build from topic
            </button>
            {search
              ? button('Rescan', () => create(true), { disabled: building, title: search.small ? `Only ${search.matched} programmes match, so a rescan cannot vary much` : `Build ${search.query} again, differently` })
              : null}
          </form>
          {search ? <p className="plan-note map-built">Built from “{search.query}”</p> : null}

          <p className="editor-heading map-programmes-head">Programmes · {mapSummary(guide)}</p>
          {guide.items.length > 0 ? (
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
                      {button('Play', () => tv.playGuide(index), { disabled: !resolved.ok, title: 'Play this Map from here' })}
                      {button('Remove', () => act(() => tv.editGuide({ type: 'remove', itemId: item.id })), { title: 'Remove from this Map' })}
                    </span>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="plan-empty">
              Add channel sources and BUILD FROM SOURCES, type a topic and BUILD FROM TOPIC, or right-click or hold a programme in the Guide and choose ADD TO. A normal click in the Guide still plays it.
            </p>
          )}

          <div className="plan-controls">
            {runHere && !following
              ? button('Resume', () => tv.resumeGuide(), { className: 'guide-follow', title: 'Follow this Map again from where it was' })
              : button('Play', () => tv.playGuide(0), { disabled: guide.items.length === 0, title: 'Play this Map from the start' })}
            {button('‹ Prev', () => tv.guideStep(-1), { disabled: !runHere, title: 'Previous programme in the Map' })}
            {button('Next ›', () => tv.guideStep(1), { disabled: !runHere, title: 'Next programme in the Map' })}
            {button('Stop', () => tv.stopGuide(), { disabled: !runHere, title: 'Stop following the Map' })}
            <label className="plan-loop">
              <input type="checkbox" checked={guide.loop === true} onChange={(event) => act(() => tv.editGuide({ type: 'loop', loop: event.target.checked }))} />
              Loop
            </label>
          </div>

          <div className="plan-library">
            {button('Save', () => act(() => tv.editGuide({ type: 'save' })), { disabled: !unsaved(library), on: unsaved(library), title: 'Keep this Map in My Guide' })}
            {button('Duplicate', () => act(() => tv.editGuide({ type: 'duplicate' })), { title: 'Save a copy of this Map and edit the copy' })}
            {button('Clear', () => act(() => tv.editGuide({ type: 'clear' })), { disabled: guide.items.length === 0, title: 'Take every programme out of this Map' })}
            {button(confirmDelete === guide.id ? 'Delete?' : 'Delete', () => deleteMap(guide), { title: 'Delete this Map' })}
            {button('Done', () => setView('maps'), { title: 'Back to the Maps in My Guide' })}
          </div>
        </>
      ) : null}

      {note ? <p className="plan-note">{note}</p> : null}
    </footer>
  )
}
