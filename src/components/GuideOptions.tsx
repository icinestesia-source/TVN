import { useEffect, useRef, useState, type ReactNode } from 'react'
import { formatBytes, formatPlayed, resetUsage, useUsage } from '../session/usage.ts'
import { PIP_SIZE_MAX, PIP_SIZE_MIN, PIP_SIZE_STEP } from '../view/multiview.ts'
import { openAbout } from '../legal/about-store.ts'
import { ChannelChangeOptions } from './ChannelChangeOptions.tsx'
import { listChannels } from '../data/catalogue.ts'
import { USER_NUMBER_START } from '../data/network.ts'
import { USER_NAME_MAX, userFilter, userNetworkName, type NetworkUser } from '../data/user-network/users.ts'
import { GUIDE_ZOOM_MAX, GUIDE_ZOOM_MIN, GUIDE_ZOOM_STEP } from '../epg/zoom.ts'
import { SLEEP_CHOICES } from '../state/sleep.ts'
import { SURF_LIMIT_MAX, SURF_LIMIT_MIN } from '../state/surf.ts'
import { useTv } from '../state/tv-context.ts'
import { rememberSupported, setRememberMedia, useRememberMedia } from '../session/remembered-media.ts'
import { DISPLAY_QUALITIES, setDisplayQuality, useDisplayQuality } from '../view/display-quality.ts'
import { setFillEdges, useFillEdges } from '../view/fill-edges.ts'
import { setResumeFromPause, useResumeFromPause } from '../view/resume-from-pause.ts'
import { setLoadingLogo, useLoadingLogo } from '../view/loading-logo.ts'
import { setFlagAt, useFlagAt } from '../view/clip-flags.ts'
import { CORNER_LABELS, CORNERS, SHORTCUT_IDS, SHORTCUTS, type ShortcutId } from '../view/info-shortcuts.ts'
import { keepKey } from './keep-key.ts'
import { viewerMessage } from './viewer-message.ts'

const channelNumberText = (text: string) => /^\d{1,5}$/.test(text.trim()) && Number(text) >= 1

function Card({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={wide ? 'options-card is-wide' : 'options-card'} aria-label={title}>
      <h3 className="options-head">{title}</h3>
      {children}
    </section>
  )
}

/** OPTIONS → Usage: what this tab has downloaded since it opened, as far as the browser lets TVN measure. */
function UsageRows() {
  const usage = useUsage()
  const since = new Date(usage.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <>
      <Row label="Total, about">
        <output className="options-value">{formatBytes(usage.dataBytes + usage.mediaBytes + usage.youtubeEstimate)}</output>
      </Row>
      <Row label={`YouTube · ${formatPlayed(usage.youtubeSeconds)} played, about`}>
        <output className="options-value">{formatBytes(usage.youtubeEstimate)}</output>
      </Row>
      <Row label="Streams, podcasts & files">
        <output className="options-value">{formatBytes(usage.mediaBytes)}</output>
      </Row>
      <Row label={`Pages & data · ${usage.dataRequests} ${usage.dataRequests === 1 ? 'request' : 'requests'}`}>
        <output className="options-value">{formatBytes(usage.dataBytes)}</output>
      </Row>
      <p className="options-note">
        Since {since}. YouTube keeps its downloads inside its own players, so TVN counts the time each one plays, every Multi View tile
        included, and estimates the data from the quality YouTube reports. Streams, podcasts and files TVN plays itself, its pages and data,
        and other sites that share their sizes are measured
        {usage.unmeasured > 0 ? `; ${usage.unmeasured} ${usage.unmeasured === 1 ? 'request' : 'requests'} went to sites that keep their sizes private` : ''}. Local
        files are never downloaded.
      </p>
      <div className="options-foot">
        <button type="button" className="tab" onKeyDown={keepKey} onClick={() => resetUsage()}>
          Reset
        </button>
      </div>
    </>
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
      onStatus(viewerMessage(caught, 'THAT NAME COULD NOT BE USED'))
    }
  }
  const remove = async (mode: 'move' | 'remove') => {
    setBusy(true)
    try {
      onStatus(await tv.deleteNetworkUser(user.id, mode))
    } catch (caught) {
      onStatus(viewerMessage(caught, 'THAT USER COULD NOT BE DELETED'))
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
  const quality = useDisplayQuality()
  const remember = useRememberMedia()
  const fill = useFillEdges()
  const holdPause = useResumeFromPause()
  const logo = useLoadingLogo()
  const flagWhere = useFlagAt()
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const loadingAll = tv.loadAll && tv.loadAll.result === undefined ? tv.loadAll : null
  const [confirmDefault, setConfirmDefault] = useState(false)
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const users = listChannels().filter((channel) => (channel.number >= USER_NUMBER_START || channel.origin === 'user-import') && !channel.emptySlot)
  const owned = (id: string | undefined) => users.filter((channel) => channel.owner === id).length

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    try {
      setStatus((await work()) || null)
    } catch (caught) {
      setStatus(viewerMessage(caught, 'THAT DID NOT WORK'))
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

        <Card title="Channel change" wide>
          <ChannelChangeOptions settings={tv.transition} onChange={tv.setTransition} />
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

        <Card title="Playback">
          <p className="options-note">
            When this is on, unpausing a clip continues from the moment you paused it. When it is off, unpausing rejoins wherever the Guide
            timeline has moved on to.
          </p>
          <Row label="Resume where paused">{toggle(holdPause, ['On', 'Off'], () => setResumeFromPause(!holdPause))}</Row>
        </Card>

        <Card title="Display">
          <p className="options-note">The highest picture quality TVN asks YouTube for. On a slow connection YouTube may still choose less.</p>
          <div className="options-choices" role="radiogroup" aria-label="Picture quality">
            {DISPLAY_QUALITIES.map(({ id, label, hint }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={quality === id}
                className={quality === id ? 'tab is-on' : 'tab'}
                title={hint}
                onKeyDown={keepKey}
                onClick={() => setDisplayQuality(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="options-note">The logo while TVN loads: Pulse gently, or Spin, which you can flick round its centre like a fidget spinner.</p>
          <div className="options-row">
            <span className="options-label">Loading logo</span>
            <span className="options-choices" role="radiogroup" aria-label="Loading logo">
              {(['pulse', 'spin'] as const).map((mode) => (
                <button key={mode} type="button" role="radio" aria-checked={logo === mode} className={logo === mode ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={() => setLoadingLogo(mode)}>
                  {mode === 'pulse' ? 'Pulse' : 'Spin'}
                </button>
              ))}
            </span>
          </div>
          <p className="options-note">Where a programme does not cover the screen, such as a Short, fill the edges with its own picture, enlarged and blurred.</p>
          <Row label="Fill edges">{toggle(fill, ['On', 'Off'], () => setFillEdges(!fill))}</Row>
          <p className="options-note">
            Picture in picture is the first Multi View (press / to step through, \ for a single channel again): one channel fills the screen and a
            second sits in the top right corner. ← and → choose which is heard, ↑ and ↓ change its channel, and [ and ] make the corner picture
            smaller or larger.
          </p>
          <label className="options-row">
            <span className="options-label">Picture in picture size</span>
            <span className="options-control">
              <input
                type="range"
                min={PIP_SIZE_MIN}
                max={PIP_SIZE_MAX}
                step={PIP_SIZE_STEP}
                value={tv.pipSize}
                onKeyDown={keepKey}
                onChange={(event) => tv.setPipSize(Number(event.target.value))}
              />
              <output className="options-value">{tv.pipSize}%</output>
            </span>
          </label>
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

        <Card title="Local Media">
          <p className="options-note">
            {rememberSupported()
              ? 'Remember the folders and files imported into Local Media, so RELOAD PREVIOUS in MEDIA can load them again on a later visit. Only where they are on this device is kept, never the media; the browser asks again before TVN reads them. Turning this off forgets them.'
              : 'This browser cannot remember Local Media folders and files between visits. Chrome and Edge can.'}
          </p>
          <Row label="Remember imports">
            {rememberSupported() ? toggle(remember, ['On', 'Off'], () => setRememberMedia(!remember)) : <span className="options-dim">Unavailable</span>}
          </Row>
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
          <div className="options-row">
            <span className="options-label">Flags</span>
            <span className="options-choices" role="radiogroup" aria-label="Flags set">
              {(['start', 'clicked'] as const).map((mode) => (
                <button key={mode} type="button" role="radio" aria-checked={flagWhere === mode} className={flagWhere === mode ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={() => setFlagAt(mode)}>
                  {mode === 'start' ? 'Clip start' : 'Where clicked'}
                </button>
              ))}
            </span>
          </div>
          <p className="options-note">
            Right-click or hold a clip in the Guide timeline to flag it. Clip start flags it from its beginning; Where clicked flags it from the moment
            under the pointer, marked with a gold line, so TVN tunes in at that point. Flag a flagged clip again to take its flag off.
          </p>
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
            Random (TVN on the control pad, Space on a keyboard), CH+ and CH− draw from the Guide tab chosen here. TVN on the control pad is underlined while it draws from a User Network.
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

        <Card title="Usage this session">
          <UsageRows />
        </Card>

        <Card title="Save & restore">
          <p className="options-note">
            Everything here is kept in this browser. Export ALL saves your users, User Network channels, your curation of TVN channels
            001–999, Favourites and settings. Export USER saves your users, User Network channels and their Favourites. Restore takes
            either, asks first, and can restore just the USER part of an ALL export. Single channels and their manifests are in Edit
            Channel. Load all &amp; export brings every User Network channel up to date and reads each source to its end (a YouTube
            channel through its own uploads, a playlist through that playlist only, a podcast&rsquo;s whole feed), then exports USER. Default removes every User channel, so new ones start again at 1001.
          </p>
          <div className="options-choices">
            <button type="button" className="tab" disabled={busy} onKeyDown={keepKey} onClick={() => void run(tv.exportTvn)}>
              Export ALL
            </button>
            <button type="button" className="tab" disabled={busy} onKeyDown={keepKey} onClick={() => void run(tv.exportUserNetwork)}>
              Export USER
            </button>
            <button type="button" className="tab" disabled={busy} onKeyDown={keepKey} onClick={() => tv.dispatch({ type: 'guide-tool', tool: 'network' })}>
              Restore
            </button>
            <button type="button" className="tab" disabled={busy} onKeyDown={keepKey} onClick={() => void run(tv.loadTestChannels)}>
              Add starter network
            </button>
            <button type="button" className="tab" disabled={busy || loadingAll !== null} onKeyDown={keepKey} onClick={tv.startLoadAll}>
              Load all &amp; export
            </button>
            <button type="button" className="tab remove-key" disabled={busy || loadingAll !== null} onKeyDown={keepKey} onClick={() => setConfirmDefault(true)}>
              Default…
            </button>
          </div>
          <p className="options-note">
            Export channels saves just the channels numbered From–To (for example 950 to 970): your User channels there and your curation of
            TVN&rsquo;s channels there, with all their sources, running orders, notes and Favourites. Restore reads that file back and changes only
            those numbers.
          </p>
          <div className="options-choices">
            <label className="options-range">
              From{' '}
              <input type="number" min={1} step={1} inputMode="numeric" value={rangeFrom} aria-label="First channel" onKeyDown={keepKey} onChange={(event) => setRangeFrom(event.target.value)} />
            </label>
            <label className="options-range">
              To{' '}
              <input type="number" min={1} step={1} inputMode="numeric" value={rangeTo} aria-label="Last channel" onKeyDown={keepKey} onChange={(event) => setRangeTo(event.target.value)} />
            </label>
            <button
              type="button"
              className="tab"
              disabled={busy || !channelNumberText(rangeFrom) || !channelNumberText(rangeTo || rangeFrom)}
              onKeyDown={keepKey}
              onClick={() => void run(() => tv.exportRange(Number(rangeFrom), Number(rangeTo || rangeFrom)))}
            >
              Export channels
            </button>
          </div>
          {confirmDefault ? (
            <div className="options-choices options-confirm" role="alertdialog" aria-label="Remove every User channel?">
              <span className="remove-ask">Remove every User channel, 1001 onwards, from this browser? New channels then start again at 1001. Export first to keep them.</span>
              <button
                type="button"
                className="tab remove-key"
                disabled={busy}
                onKeyDown={keepKey}
                onClick={() => {
                  setConfirmDefault(false)
                  void run(() => tv.removeUserChannels('all'))
                }}
              >
                Yes, remove them
              </button>
              <button type="button" className="tab" onKeyDown={keepKey} onClick={() => setConfirmDefault(false)}>
                Keep them
              </button>
            </div>
          ) : null}
          {tv.loadAll?.result !== undefined ? <p className="options-load-all-done" role="status">{tv.loadAll.result}</p> : null}
          {loadingAll ? (
            <div className="options-load-all" role="status">
              <progress max={100} value={loadingAll.percent} aria-label="Load all and export" />
              <span className="options-load-all-text">
                LOADING ALL · {loadingAll.percent}%{loadingAll.channel ? ` · ${loadingAll.channel}` : ''}
              </span>
              <button type="button" className="tab" onKeyDown={keepKey} onClick={tv.stopLoadAll}>
                Stop
              </button>
            </div>
          ) : null}
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
