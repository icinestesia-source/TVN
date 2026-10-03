import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { listChannels } from '../data/catalogue.ts'
import { channelMatchesFilter, USER_NUMBER_START } from '../data/network.ts'
import { userFilter } from '../data/user-network/users.ts'
import { isOnAir } from '../network/airing.ts'
import { useTv } from '../state/tv-context.ts'
import { TVN_CHANNEL_NUMBER } from '../tvn/tvn-channel.ts'
import type { Channel } from '../types/channel.ts'
import type { GuideFilter } from '../types/preferences.ts'

/** The editor's lists: the Guide's own tabs, and TVN's shipped 001–999 on their own. */
type EditorList = GuideFilter | 'central'

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
  if (list === 'central') return !isUser(channel) && channel.origin !== 'session' && channel.origin !== 'tvn' && channel.number < USER_NUMBER_START && channelMatchesFilter({ ...channel, enabled: true }, 'all', favourites)
  return channelMatchesFilter({ ...channel, enabled: true }, list, favourites)
}

function statusOf(channel: Channel): string {
  if (channel.number === TVN_CHANNEL_NUMBER) return 'Surfing'
  if (channel.emptySlot) return 'Empty'
  if (!channel.enabled) return 'Off'
  if (channel.origin === 'session') return 'This device'
  return isOnAir(channel) ? 'On air' : 'Resting'
}

/**
 * NETWORK EDITOR (TVN in the Guide's header): the television network itself, in the same lists the Guide
 * has. Each row is one channel, wherever it is listed: renaming, deleting or renumbering it shows in every
 * list at once, because every list is a view of the one network. User channels (1001+) can be moved, which
 * renumbers the User Network from 1001; TVN's 001–999 keep their numbers. EDIT opens the Channel Editor
 * the Guide already has, and 000 opens TVN's own settings.
 */
export function NetworkEditor({ onEdit }: { onEdit: (channelNumber: number) => void }) {
  const tv = useTv()
  const [list, setList] = useState<EditorList>(() => (tv.guideFilter === 'favourites' || tv.guideFilter === 'user' || tv.guideFilter.startsWith('user:') ? tv.guideFilter : 'all'))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState<number | null>(null)
  const listRef = useRef<HTMLOListElement>(null)

  const rows = useMemo(() => {
    const listed = listChannels().filter((channel) => listedIn(channel, list, tv.favourites))
    if (list !== 'favourites') return listed
    const at = new Map(tv.favourites.map((number, index) => [number, index]))
    return listed.sort((a, b) => (at.get(a.number) ?? 0) - (at.get(b.number) ?? 0))
    // The network changes under the same function; visibleChannels is what moves when it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, tv.favourites, tv.visibleChannels])

  const canMove = list !== 'favourites' && list !== 'central'
  const users = rows.filter(isUser)

  const move = async (channel: Channel, to: number | undefined, focus = true) => {
    if (to === undefined || to === channel.number || busy) return
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
    ['central', '001–999'],
    ['user', 'TVN'],
    ...tv.networkUsers.map((user) => [userFilter(user.id), user.name] as [EditorList, string]),
    ['favourites', 'Fav'],
  ]

  return (
    <div className="guide-options network-editor" role="region" aria-label="Network editor">
      <div className="network-head">
        <h3 className="options-head">Network editor</h3>
        <div className="tabs" role="tablist" aria-label="Network lists">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={list === id} className={list === id ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={() => setList(id)}>
              {label}
            </button>
          ))}
        </div>
        <p className="network-hint">
          {canMove ? 'Move your channels with ↑ ↓, Alt+↑ ↓ or by dragging: the User Network renumbers from 1001.' : list === 'central' ? 'TVN’s own channels keep their numbers.' : 'Favourites are listed in your own order.'}
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
          const owner = user ? (tv.networkUsers.find((item) => item.id === channel.owner)?.name ?? 'TVN') : null
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
              <button type="button" className="network-name" onKeyDown={keepKey} onClick={() => onEdit(channel.number)} title={`Edit ${channel.name}`}>
                <span className="network-title">{channel.name}</span>
                <span className="network-kind">{network}</span>
              </button>
              <span className={`network-status is-${statusOf(channel).toLowerCase().replace(/\s+/g, '-')}`}>{statusOf(channel)}</span>
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
                  </>
                ) : null}
              </span>
              <button type="button" className="tab network-edit" onKeyDown={keepKey} onClick={() => onEdit(channel.number)}>
                {channel.number === TVN_CHANNEL_NUMBER ? 'Settings' : 'Edit'}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
