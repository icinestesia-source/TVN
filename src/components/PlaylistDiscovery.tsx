import { useState, type KeyboardEvent } from 'react'
import { lookUpPlaylists, playlistUrl, type PlaylistFound } from '../services/add-channel.ts'

function keepKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Escape') event.stopPropagation()
}

/**
 * DISCOVER PLAYLISTS on a YouTube channel source: lists the playlists the channel shows, marks those its own
 * header says it owns, and adds only the ones the curator ticks.
 */
export function PlaylistDiscovery({
  channelUrl,
  present,
  disabled,
  onAdd,
  look = lookUpPlaylists,
}: {
  channelUrl: string
  /** Source addresses already on the channel. */
  present: ReadonlySet<string>
  disabled: boolean
  onAdd: (chosen: readonly PlaylistFound[]) => void
  look?: typeof lookUpPlaylists
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle')
  const [found, setFound] = useState<readonly PlaylistFound[]>([])
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState('')

  const discover = () => {
    setState('busy')
    look(channelUrl).then(
      (result) => {
        setFound(result.playlists)
        setChosen(new Set())
        setState('done')
      },
      (caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'No playlists were found')
        setState('failed')
      },
    )
  }
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const fresh = found.filter((playlist) => !present.has(playlistUrl(playlist.id)))

  return (
    <div className="editor-discover">
      <button type="button" className="tab" disabled={disabled || state === 'busy'} onKeyDown={keepKey} onClick={discover}>
        {state === 'busy' ? 'Discovering…' : 'Discover playlists'}
      </button>
      {state === 'failed' ? <p className="editor-videos-empty">{error}</p> : null}
      {state === 'done' && found.length === 0 ? <p className="editor-videos-empty">This channel lists no playlists</p> : null}
      {state === 'done' && found.length > 0 ? (
        <>
          <p className="guide-tool-note">
            Official: the channel's own playlists. Others are listed for you to judge; nothing is added until you choose.
          </p>
          <ul className="editor-videos editor-discovered" aria-label="Discovered playlists">
            {found.map((playlist) => {
              const already = present.has(playlistUrl(playlist.id))
              return (
                <li key={playlist.id}>
                  <label className="editor-check">
                    <input
                      type="checkbox"
                      checked={already || chosen.has(playlist.id)}
                      disabled={disabled || already}
                      onKeyDown={keepKey}
                      onChange={() => toggle(playlist.id)}
                    />
                    <span className="editor-video-title">{playlist.title}</span>
                  </label>
                  <span className="editor-video-length">
                    {already ? 'Added' : playlist.official ? 'Official' : 'Not the channel’s own'}
                    {playlist.videos !== null ? ` · ${playlist.videos} videos` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            className="tab"
            disabled={disabled || chosen.size === 0}
            onKeyDown={keepKey}
            onClick={() => {
              onAdd(fresh.filter((playlist) => chosen.has(playlist.id)))
              setChosen(new Set())
            }}
          >
            Add selected
          </button>
        </>
      ) : null}
    </div>
  )
}
