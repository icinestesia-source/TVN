import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { listChannels } from '../data/catalogue.ts'
import { channelMatchesFilter } from '../data/network.ts'
import { userFilter, userNetworkName } from '../data/user-network/users.ts'
import type { StoredSource } from '../services/channels-import.ts'
import { loadStoredSources } from '../services/user-db.ts'
import { useTv } from '../state/tv-context.ts'
import { TVN_CHANNEL_NUMBER } from '../tvn/tvn-channel.ts'
import type { Channel } from '../types/channel.ts'
import type { GuideFilter } from '../types/preferences.ts'
import { networkRows, networkStatus, unloaded } from '../view/network-rows.ts'

/** The editor's lists: ALL, USER (1001+), each named user's channels, and FAV. */
type EditorList = GuideFilter

const pad = (number: number) => String(number).padStart(3, '0')
const isUser = (channel: Channel) => channel.origin === 'user-import' || channel.origin === 'user-created'

function message(caught: unknown, fallback: string): string {
  const text = caught instanceof Error ? caught.message.trim() : ''
  return text && text.length <= 90 && !/[<>{}]/.test(text) ? text.toUpperCase() : fallback
}

/** Enter and Space press these controls; they must not also confirm (and tune) the Guide cursor. */
function keepKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}

/** A channel as listed here: hidden and resting channels too, which the Guide leaves out. */
function listedIn(channel: Channel, list: EditorList, favourites: readonly number[]): boolean {
  // A User Network tab lists its own owner's channels only; named users have tabs of their own.
  return channelMatchesFilter({ ...channel, enabled: true }, list, favourites)
}

/**
 * NETWORK EDITOR (TVN in the header): the television network itself, as ALL, USER and FAV. Each row is one
 * channel, wherever it is listed: renaming, deleting or renumbering it shows in every list at once, because
 * every list is a view of the one network. User channels (1001+) can be moved, wherever they are listed, by
 * ↑ ↓, MOVE TO, dragging, SORT A–Z or RANDOMISE; each renumbers the User Network from 1001 and is kept as its
 * running order. TVN's 001–999 keep their numbers. EDIT opens the Channel Editor, and 000 opens TVN's settings.
 */
export function NetworkEditor({ onEdit }: { onEdit: (channelNumber: number) => void }) {
  const tv = useTv()
  const [list, setList] = useState<EditorList>(() => (tv.guideFilter === 'favourites' || tv.guideFilter === 'user' || tv.guideFilter.startsWith('user:') ? tv.guideFilter : 'all'))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<'alphabetical' | 'shuffle' | null>(null)
  const [targets, setTargets] = useState<Record<string, string>>({})
  const listRef = useRef<HTMLOListElement>(null)
  // What is stored, not only what can air: a channel whose source has not been read yet is still a channel.
  const [stored, setStored] = useState<readonly StoredSource[]>([])
  useEffect(() => {
    let live = true
    loadStoredSources().then(
      (sources) => live && setStored(sources),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [tv.visibleChannels])

  const rows = useMemo(() => {
    const merged = networkRows(listChannels(), stored, new Set(tv.networkUsers.map((user) => user.id)))
    const listed = merged.filter((channel) => listedIn(channel, list, tv.favourites))
    if (list !== 'favourites') return listed
    const at = new Map(tv.favourites.map((number, index) => [number, index]))
    return listed.sort((a, b) => (at.get(a.number) ?? 0) - (at.get(b.number) ?? 0))
    // The network changes under the same function; visibleChannels is what moves when it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, tv.favourites, tv.visibleChannels, tv.networkUsers, stored])

  const canMove = list !== 'favourites'
  const users = rows.filter(isUser)

  const move = async (channel: Channel, to: number | undefined, focus = true) => {
    if (to === undefined || to === channel.number || busy) return
    setConfirm(null)
    setBusy(true)
    try {
      const id = channel.id
      setNote(await tv.moveUserChannel(channel.number, to))
      if (focus) {
        requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-channel-id="${CSS.escape(id)}"] .network-move`)?.focus())
      }
    } catch (caught) {
      setNote(message(caught, 'THAT CHANNEL COULD NOT BE MOVED'))
    } finally {
      setBusy(false)
    }
  }
  const moveToTyped = (channel: Channel) => {
    const typed = (targets[channel.id] ?? '').trim()
    const to = Number(typed)
    if (!typed || !Number.isInteger(to)) {
      setNote('TYPE THE USER NUMBER TO MOVE IT TO')
      return
    }
    setTargets((current) => ({ ...current, [channel.id]: '' }))
    void move(channel, to)
  }

  /** SORT A–Z and RANDOMISE renumber the whole User Network, so each asks once before it runs. */
  const arrange = async (how: 'alphabetical' | 'shuffle') => {
    if (busy) return
    if (confirm !== how) {
      setConfirm(how)
      return
    }
    setConfirm(null)
    setBusy(true)
    try {
      setNote(await tv.arrangeUserNetwork(how))
    } catch (caught) {
      setNote(message(caught, 'THE USER NETWORK COULD NOT BE REORDERED'))
    } finally {
      setBusy(false)
    }
  }

  const neighbour = (channel: Channel, step: -1 | 1) => users[users.findIndex((item) => item.number === channel.number) + step]?.number

  const rowKey = (event: KeyboardEvent<HTMLLIElement>, channel: Channel) => {
    const rowsHere = [...(listRef.current?.querySelectorAll<HTMLElement>('.network-row') ?? [])]
    const at = rowsHere.indexOf(event.currentTarget)
    if ((event.altKey || event.metaKey) && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && canMove && isUser(channel)) {
      event.preventDefault()
      event.stopPropagation()
      void move(channel, neighbour(channel, event.key === 'ArrowUp' ? -1 : 1))
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      const next = rowsHere[at + (event.key === 'ArrowUp' ? -1 : 1)]
      ;(next?.querySelector<HTMLElement>('.network-name') ?? next)?.focus()
    }
  }

  const drop = (event: DragEvent<HTMLLIElement>, target: Channel) => {
    event.preventDefault()
    const from = users.find((item) => item.number === dragging)
    setDragging(null)
    if (from && isUser(target)) void move(from, target.number, false)
  }

  const tabs: [EditorList, string][] = [
    ['all', 'All'],
    ['user', userNetworkName(undefined, tv.networkUsers)],
    ...tv.networkUsers.map((user) => [userFilter(user.id), user.name] as [EditorList, string]),
    ['favourites', 'Fav'],
  ]

  return (
    <div className="guide-options network-editor" role="region" aria-label="Network editor">
      <div className="network-head">
        <h3 className="options-head">Network editor</h3>
        <div className="tabs" role="tablist" aria-label="Network lists">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={list === id}
              className={list === id ? 'tab is-on' : 'tab'}
              onKeyDown={keepKey}
              onClick={() => {
                setList(id)
                setConfirm(null)
              }}
            >
              {label}
            </button>
          ))}
          {list === 'user' ? (
            <span className="network-order" role="group" aria-label="Order the User Network">
              <button type="button" className={confirm === 'alphabetical' ? 'tab is-on' : 'tab'} disabled={busy || users.length < 2} onKeyDown={keepKey} onClick={() => void arrange('alphabetical')} title="Sort every User channel by name and renumber from 1001">
                {confirm === 'alphabetical' ? 'Sort User Network A–Z?' : 'Sort A–Z'}
              </button>
              <button type="button" className={confirm === 'shuffle' ? 'tab is-on' : 'tab'} disabled={busy || users.length < 2} onKeyDown={keepKey} onClick={() => void arrange('shuffle')} title="Shuffle the User Network once and renumber from 1001">
                {confirm === 'shuffle' ? 'Randomise User Network?' : 'Randomise'}
              </button>
            </span>
          ) : null}
        </div>
        <p className="network-hint">
          {canMove ? 'Move your channels with ↑ ↓, MOVE TO, Alt+↑ ↓ or by dragging: the User Network renumbers from 1001. TVN’s own 001–999 keep their numbers.' : 'Favourites are listed in your own order.'}
        </p>
        {note ? (
          <p className="options-status" role="status">
            {note}
          </p>
        ) : null}
      </div>
      <ol ref={listRef} className="network-list" aria-label="Channels">
        {rows.map((channel) => {
          const user = isUser(channel)
          const favourite = tv.favourites.includes(channel.number)
          const owner = user ? userNetworkName(channel.owner, tv.networkUsers) : null
          const network = channel.number === TVN_CHANNEL_NUMBER ? 'TVN' : user ? `User · ${owner}` : channel.origin === 'session' ? 'Local' : 'TVN 001–999'
          const movable = canMove && user
          return (
            <li
              key={channel.id}
              data-channel-id={channel.id}
              className={`network-row${channel.number === tv.channel.number ? ' is-current' : ''}${dragging === channel.number ? ' is-dragging' : ''}`}
              draggable={movable && !busy}
              onDragStart={movable ? (event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', String(channel.number))
                setDragging(channel.number)
              } : undefined}
              onDragEnd={() => setDragging(null)}
              onDragOver={movable && dragging !== null ? (event) => event.preventDefault() : undefined}
              onDrop={movable ? (event) => drop(event, channel) : undefined}
              onKeyDown={(event) => rowKey(event, channel)}
            >
              <span className="network-number">{pad(channel.number)}</span>
              <button type="button" className="network-name" disabled={unloaded(channel)} onKeyDown={keepKey} onClick={() => onEdit(channel.number)} title={unloaded(channel) ? `${channel.name}: editable once its source has loaded` : `Edit ${channel.name}`}>
                <span className="network-title">{channel.name}</span>
                <span className="network-kind">{network}</span>
              </button>
              <span className={`network-status is-${networkStatus(channel).toLowerCase().replace(/\s+/g, '-')}`}>{networkStatus(channel)}</span>
              <button
                type="button"
                className={favourite ? 'network-star is-on' : 'network-star'}
                aria-pressed={favourite}
                aria-label={favourite ? `Remove ${channel.name} from Favourites` : `Add ${channel.name} to Favourites`}
                onKeyDown={keepKey}
                onClick={() => tv.dispatch({ type: 'favourite', channelNumber: channel.number })}
              >
                {favourite ? '★' : '☆'}
              </button>
              <span className="network-moves">
                {movable ? (
                  <>
                    <button type="button" className="tab network-move" disabled={busy || neighbour(channel, -1) === undefined} aria-label={`Move ${channel.name} up`} onKeyDown={keepKey} onClick={() => void move(channel, neighbour(channel, -1))}>
                      ↑
                    </button>
                    <button type="button" className="tab network-move" disabled={busy || neighbour(channel, 1) === undefined} aria-label={`Move ${channel.name} down`} onKeyDown={keepKey} onClick={() => void move(channel, neighbour(channel, 1))}>
                      ↓
                    </button>
                    <input
                      className="network-target"
                      value={targets[channel.id] ?? ''}
                      inputMode="numeric"
                      maxLength={5}
                      placeholder={pad(channel.number)}
                      aria-label={`User number to move ${channel.name} to`}
                      onChange={(event) => setTargets((current) => ({ ...current, [channel.id]: event.target.value.replace(/[^0-9]/g, '') }))}
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === 'Enter') moveToTyped(channel)
                      }}
                    />
                    <button type="button" className="tab network-move-to" disabled={busy || !(targets[channel.id] ?? '').trim()} onKeyDown={keepKey} onClick={() => moveToTyped(channel)} title={`Insert ${channel.name} at that User number; the channels between move along one`}>
                      Move to
                    </button>
                  </>
                ) : null}
              </span>
              <button type="button" className="tab network-edit" disabled={unloaded(channel)} onKeyDown={keepKey} onClick={() => onEdit(channel.number)}>
                {channel.number === TVN_CHANNEL_NUMBER ? 'Settings' : 'Edit'}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
