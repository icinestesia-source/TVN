import { useState, type KeyboardEvent } from 'react'
import { watchUrl } from '../credits/provenance.ts'
import { canFilter, originalChannelSource, originalOverrideOf, type OriginalOverride, type OriginalSource } from '../services/original-sources.ts'
import { formatDuration } from '../utils/time.ts'
import { contributionsOf, contributionText } from '../view/channel-provenance.ts'
import { SourceFilterPanel } from './ChannelCuration.tsx'

function keepKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}

/**
 * TVN ORIGINAL: the sources behind TVN's own programming for this channel, each with what it gives the channel
 * now. A source can be disabled, or filtered, in this browser only; TVN's channel itself is never changed, and
 * nothing here is fetched again.
 */
export function OriginalSources({
  originals,
  overrides,
  idle,
  disabled,
  onDecide,
}: {
  originals: readonly OriginalSource[]
  overrides: readonly OriginalOverride[] | undefined
  /** Why TVN's programming is not on air as edited (switched off, or replaced by added sources), if it is not. */
  idle: string | null
  disabled: boolean
  onDecide: (ref: string, next: OriginalOverride | null) => void
}) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const toggle = (ref: string) =>
    setOpened((current) => {
      const next = new Set(current)
      if (next.has(ref)) next.delete(ref)
      else next.add(ref)
      return next
    })
  const { rows, total } = contributionsOf(originals, overrides)
  return (
    <div className="editor-originals">
      {idle ? <p className="guide-tool-note">{idle}</p> : null}
      <ul className="editor-sources" aria-label="TVN original sources">
        {rows.map(({ source, override, ...contribution }) => {
          const open = opened.has(source.ref)
          const enabled = override?.enabled ?? true
          const filtered = Boolean(override?.filter)
          return (
            <li key={source.ref} className={enabled ? 'editor-source is-original' : 'editor-source is-original is-off'}>
              <button
                type="button"
                className="tab editor-expand"
                aria-expanded={open}
                aria-label={`${open ? 'Hide' : 'Show'} the details of ${source.name}`}
                onKeyDown={keepKey}
                onClick={() => toggle(source.ref)}
              >
                {open ? '−' : '+'}
              </button>
              <span className="editor-check editor-original-name">
                <span className="editor-source-name">{source.name}</span>
                {source.provider ? <span className="editor-source-provider">{source.provider}</span> : null}
              </span>
              <span className="editor-source-status">
                {enabled ? `${contributionText(contribution, total)}${filtered ? ' · filter on' : ''}` : `Disabled · ${source.videos.length} in TVN's pool`}
              </span>
              <button
                type="button"
                className="tab editor-source-remove"
                disabled={disabled}
                aria-label={`${enabled ? 'Disable' : 'Enable'} source ${source.name}`}
                title={enabled ? 'Disable this source in this browser only' : 'Play this source again'}
                onKeyDown={keepKey}
                onClick={() => onDecide(source.ref, originalOverrideOf(source, !enabled, override?.filter))}
              >
                {enabled ? 'Disable' : 'Enable'}
              </button>
              {open ? (
                <div className="editor-original-details">
                  <p className="guide-tool-note">
                    {source.url ? (
                      <a href={source.url} target="_blank" rel="noopener noreferrer" onKeyDown={keepKey}>
                        {source.url}
                      </a>
                    ) : (
                      'No address recorded'
                    )}
                    {' · '}
                    {source.registered ? 'In the TVN source register' : 'Not in the TVN source register'} · TVN original · not rescanned from here
                  </p>
                  {canFilter(source) ? (
                    <SourceFilterPanel
                      shipped
                      source={originalChannelSource(source, override)}
                      disabled={disabled}
                      onApply={(filter) => onDecide(source.ref, originalOverrideOf(source, enabled, filter))}
                    />
                  ) : (
                    <p className="guide-tool-note">These programmes have no recorded source, so they can be disabled or arranged one by one, but not filtered.</p>
                  )}
                  <ol className="editor-videos" aria-label={`Programmes of ${source.name}`}>
                    {source.videos.map((video) => (
                      <li key={video.id}>
                        <span className="editor-video-title">{video.title}</span>
                        <span className="editor-video-length">{formatDuration(video.durationSec)}</span>
                        <a className="tab editor-link" href={watchUrl(video.id)} target="_blank" rel="noopener noreferrer" title="Open original" aria-label={`Open ${video.title} on YouTube`} onKeyDown={keepKey}>
                          ↗
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
