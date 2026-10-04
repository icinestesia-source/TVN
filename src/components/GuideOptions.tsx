import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { openAbout } from '../legal/about-store.ts'
import { ChannelChangeOptions } from './ChannelChangeOptions.tsx'
import { listChannels } from '../data/catalogue.ts'
import { USER_NUMBER_START } from '../data/network.ts'
import { USER_NAME_MAX, userFilter, userNetworkName, type NetworkUser } from '../data/user-network/users.ts'
import { GUIDE_ZOOM_MAX, GUIDE_ZOOM_MIN, GUIDE_ZOOM_STEP } from '../epg/zoom.ts'
import { SLEEP_CHOICES } from '../state/sleep.ts'
import { SURF_LIMIT_MAX, SURF_LIMIT_MIN } from '../state/surf.ts'
import { useTv } from '../state/tv-context.ts'
import { CORNER_LABELS, CORNERS, SHORTCUT_IDS, SHORTCUTS, type ShortcutId } from '../view/info-shortcuts.ts'

/** Enter and Space press these controls; they must not also confirm (and tune) the guide cursor. */
function keepKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}

function message(caught: unknown, fallback: string): string {
  const text = caught instanceof Error ? caught.message.trim() : ''
  return text && text.length <= 90 && !/[<>{}]/.test(text) ? text.toUpperCase() : fallback
}

function Card({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={wide ? 'options-card is-wide' : 'options-card'} aria-label={title}>
      <h3 className="options-head">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="options-row">
      <span className="options-label">{label}</span>
      <span className="options-control">{children}</span>
    </div>
  )
}

/** One named user: rename in place, or delete after choosing what happens to its channels. */
function UserRow({ user, channels, onStatus }: { user: NetworkUser; channels: number; onStatus: (text: string) => void }) {
  const tv = useTv()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(user.name)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const rename = () => {
    try {
      onStatus(tv.renameNetworkUser(user.id, name))
      setRenaming(false)
    } catch (caught) {
      onStatus(message(caught, 'THAT NAME COULD NOT BE USED'))
    }
  }
  const remove = async (mode: 'move' | 'remove') => {
    setBusy(true)
    try {
      onStatus(await tv.deleteNetworkUser(user.id, mode))
    } catch (caught) {
      onStatus(message(caught, 'THAT USER COULD NOT BE DELETED'))
      setBusy(false)
    }
  }
  const count = `${channels} ${channels === 1 ? 'channel' : 'channels'}`

  // OPTIONS closing (pressed again, or Esc) keeps a rename still being typed.
  const pending = useRef<string | null>(null)
  useEffect(() => {
    pending.current = renaming && name.trim() && name.trim() !== user.name ? name : null
  })
  const renameUser = tv.renameNetworkUser
  useEffect(
    () => () => {
      if (pending.current === null) return
      try {
        renameUser(user.id, pending.current)
      } catch {
        // A refused name leaves the user as it was.
      }
    },
    [renameUser, user.id],
  )

  return (
    <div className="options-user">
      {renaming ? (
        <form
          className="options-user-name"
          onSubmit={(event) => {
            event.preventDefault()
            rename()
          }}
          onKeyDown={keepKey}
        >
          <input
            value={name}
            maxLength={USER_NAME_MAX}
            aria-label={`New name for ${user.name}`}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              setRenaming(false)
            }}
          />
          <button type="submit" className="tab" disabled={!name.trim()}>
            Save
          </button>
          <button type="button" className="tab" onClick={() => setRenaming(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <span className="options-user-name">
          <strong>{user.name}</strong>
          <span className="options-dim">{count}</span>
        </span>
      )}
      {confirming ? (
        <span className="options-actions" role="alertdialog" aria-label={`Delete ${user.name}?`}>
          <span className="remove-ask">Delete {user.name}?{channels > 0 ? ` Its ${count}:` : ''}</span>
          {channels > 0 ? (
            <>
              <button type="button" className="tab" disabled={busy} onKeyDown={keepKey} onClick={() => void remove('move')}>
                Move to TVN
              </button>
              <button type="button" className="tab remove-key" disabled={busy} onKeyDown={keepKey} onClick={() => void remove('remove')}>
                Delete them too
              </button>
            </>
          ) : (
            <button type="button" className="tab remove-key" disabled={busy} onKeyDown={keepKey} onClick={() => void remove('move')}>
              Yes, delete
            </button>
          )}
          <button type="button" className="tab" disabled={busy} onKeyDown={keepKey} onClick={() => setConfirming(false)}>
            Keep
          </button>
        </span>
      ) : renaming ? null : (
        <span className="options-actions">
          <button
            type="button"
            className="tab"
            onKeyDown={keepKey}
            onClick={() => {
              setName(user.name)
              setRenaming(true)
            }}
          >
            Rename
          </button>
          <button type="button" className="tab remove-key" onKeyDown={keepKey} onClick={() => setConfirming(true)}>
            Delete…
          </button>
        </span>
      )}
    </div>
  )
}

/**
 * OPTIONS: every viewer setting in one place, in the Guide. Users (TVN and the named users, which can be
 * renamed or deleted), picture and sound, sleep, the Guide, random surf, the information overlay’s shortcuts,
 * the User Network file, and About.
 */
export function GuideOptions() {
  const tv = useTv()
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const users = listChannels().filter((channel) => channel.number >= USER_NUMBER_START && !channel.emptySlot)
  const owned = (id: string | undefined) => users.filter((channel) => channel.owner === id).length

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    try {
      setStatus((await work()) || null)
    } catch (caught) {
      setStatus(message(caught, 'THAT DID NOT WORK'))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (on: boolean, label: [string, string], action: () => void) => (
    <button type="button" className={on ? 'tab is-on' : 'tab'} aria-pressed={on} onKeyDown={keepKey} onClick={action}>
      {on ? label[0] : label[1]}
    </button>
  )

  return (
    <div className="guide-options" role="region" aria-label="Options" onKeyDown={keepKey}>
      {status ? (
        <p className="options-status" role="status">
          {status}
        </p>
      ) : null}
      <div className="options-grid">
        <Card title="Users" wide>
          <div className="options-user">
            <span className="options-user-name">
              <strong>TVN</strong>
              <span className="options-dim">
                {owned(undefined)} {owned(undefined) === 1 ? 'channel' : 'channels'} · the first User Network, always kept
              </span>
            </span>
          </div>
          {tv.networkUsers.map((user) => (
            <UserRow key={user.id} user={user} channels={owned(user.id)} onStatus={setStatus} />
          ))}
          <div className="options-foot">
            <button type="button" className="tune-key" onKeyDown={keepKey} onClick={() => tv.dispatch({ type: 'guide-tool', tool: 'users' })}>
              + New user
            </button>
          </div>
        </Card>

        <Card title="Picture & sound">
          <Row label="Volume">
            <button type="button" className="tab" aria-label="Volume down" onKeyDown={keepKey} onClick={() => tv.dispatch({ type: 'volume-down' })}>
              −
            </button>
            <output className="options-value">{tv.volume}</output>
            <button type="button" className="tab" aria-label="Volume up" onKeyDown={keepKey} onClick={() => tv.dispatch({ type: 'volume-up' })}>
              +
            </button>
          </Row>
          <Row label="Sound">{toggle(tv.muted, ['Muted', 'On'], () => tv.dispatch({ type: 'mute' }))}</Row>
          <Row label="Subtitles">{toggle(tv.subtitles, ['On', 'Off'], () => tv.dispatch({ type: 'subtitles' }))}</Row>
        </Card>

        <Card title="Channel change" wide>
          <ChannelChangeOptions settings={tv.transition} onChange={tv.setTransition} />
        </Card>

        <Card title="Sleep">
          <p className="options-note">Stop streaming after this long without use.</p>
          <div className="options-choices" role="radiogroup" aria-label="Sleep after">
            {SLEEP_CHOICES.map((minutes) => (
              <button
                key={minutes}
                type="button"
                role="radio"
                aria-checked={tv.sleepMinutes === minutes}
                className={tv.sleepMinutes === minutes ? 'tab is-on' : 'tab'}
                onKeyDown={keepKey}
                onClick={() => tv.dispatch({ type: 'sleep-cycle', minutes })}
              >
                {minutes > 0 ? `${minutes} min` : 'Off'}
              </button>
            ))}
          </div>
        </Card>

        <Card title="Guide">
          <label className="options-row">
            <span className="options-label">Timeline zoom</span>
            <span className="options-control">
              <input
                type="range"
                min={GUIDE_ZOOM_MIN}
                max={GUIDE_ZOOM_MAX}
                step={GUIDE_ZOOM_STEP}
                value={tv.guideZoom}
                onChange={(event) => tv.setGuideZoom(Number(event.target.value))}
              />
              <output className="options-value">{tv.guideZoom.toFixed(1)}×</output>
            </span>
          </label>
          <Row label="Key hints">
            <button type="button" className="tab" onKeyDown={keepKey} onClick={() => tv.dispatch({ type: 'hints' })}>
              Show
            </button>
          </Row>
        </Card>

        <Card title="Random Cycle">
          <Row label="Random from">
            <span className="options-choices" role="group" aria-label="Random from">
              {(
                [
                  ['all', 'All'],
                  ['user', userNetworkName(undefined, tv.networkUsers)],
                  ...tv.networkUsers.map((user) => [userFilter(user.id), user.name] as const),
                ] as const
              ).map(([filter, label]) => (
                <button
                  key={filter}
                  type="button"
                  className={tv.guideFilter === filter ? 'tab is-on' : 'tab'}
                  aria-pressed={tv.guideFilter === filter}
                  onKeyDown={keepKey}
                  onClick={() => tv.dispatch({ type: 'guide-filter', filter })}
                >
                  {label}
                </button>
              ))}
            </span>
          </Row>
          <p className="options-note">
            Random (TVN on the control pad, R on a keyboard), CH+ and CH− draw from the Guide tab chosen here. TVN on the control pad is underlined while it draws from a User Network.
          </p>
          <p className="options-note">Hold TVN on the control pad to start or stop it (T on a keyboard); each hop comes after a random wait in this range.</p>
          <label className="options-row">
            <span className="options-label">Minimum</span>
            <span className="options-control">
              <input
                type="range"
                min={SURF_LIMIT_MIN}
                max={SURF_LIMIT_MAX}
                step={1}
                value={tv.surfRange.minSeconds}
                onChange={(event) => tv.setSurfRange({ ...tv.surfRange, minSeconds: Number(event.target.value) }, 'min')}
              />
              <output className="options-value">{tv.surfRange.minSeconds} s</output>
            </span>
          </label>
          <label className="options-row">
            <span className="options-label">Maximum</span>
            <span className="options-control">
              <input
                type="range"
                min={SURF_LIMIT_MIN}
                max={SURF_LIMIT_MAX}
                step={1}
                value={tv.surfRange.maxSeconds}
                onChange={(event) => tv.setSurfRange({ ...tv.surfRange, maxSeconds: Number(event.target.value) }, 'max')}
              />
              <output className="options-value">{tv.surfRange.maxSeconds} s</output>
            </span>
          </label>
          <Row label="Wait for the end">{toggle(tv.surfUntilEnd, ['On', 'Off'], () => tv.setSurfUntilEnd(!tv.surfUntilEnd))}</Row>
          <p className="options-note">With Wait for the end on, TV Surf lets each programme finish before it moves to the next channel; the wait above applies only where a programme has no end in reach.</p>
          <Row label="Random Cycle">{toggle(tv.surfing, ['Stop', 'Start'], tv.toggleSurf)}</Row>
        </Card>

        <Card title="Information overlay shortcuts">
          {CORNERS.map((corner) => (
            <label key={corner} className="options-row">
              <span className="options-label">{CORNER_LABELS[corner]}</span>
              <span className="options-control">
                <select value={tv.infoShortcuts[corner]} onChange={(event) => tv.setInfoShortcut(corner, event.target.value as ShortcutId)}>
                  {SHORTCUT_IDS.map((id) => (
                    <option key={id} value={id}>
                      {SHORTCUTS[id].name}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          ))}
          <div className="options-foot">
            <button type="button" className="tab" onKeyDown={keepKey} onClick={tv.resetInfoShortcuts}>
              Reset to defaults
            </button>
          </div>
        </Card>

        <Card title="Save & restore">
          <p className="options-note">
            Everything here is kept in this browser. The complete export saves your users, User Network channels, your curation of TVN
            channels 001–999, Favourites and settings;
            Restore takes it or a User Network file, and asks before replacing anything. Single channels and their manifests are in Edit
            Channel.
          </p>
          <div className="options-choices">
            <button type="button" className="tab" disabled={busy} onKeyDown={keepKey} onClick={() => void run(tv.exportTvn)}>
              Complete export
            </button>
            <button type="button" className="tab" disabled={busy} onKeyDown={keepKey} onClick={() => void run(tv.exportUserNetwork)}>
              User Network only
            </button>
            <button type="button" className="tab" disabled={busy} onKeyDown={keepKey} onClick={() => tv.dispatch({ type: 'guide-tool', tool: 'network' })}>
              Restore
            </button>
            <button type="button" className="tab" disabled={busy} onKeyDown={keepKey} onClick={() => void run(tv.loadTestChannels)}>
              Add starter network
            </button>
          </div>
        </Card>

        <Card title="About">
          <div className="options-choices">
            <button type="button" className="tab" onKeyDown={keepKey} onClick={() => openAbout()}>
              About · Sources · Legal
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}
