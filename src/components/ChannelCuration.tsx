import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import {
  cleanFilter,
  EDITORIAL_LIMITS,
  formatTerms,
  parseTags,
  parseTerms,
  previewFilter,
  SOURCE_MODE_LABELS,
  SOURCE_MODES,
  sourceModeOf,
  widenSource,
  type ChannelEditorial,
  type SourceDraft,
  type SourceFilter,
  type SourceMode,
} from '../services/channel-curation.ts'
import type { ChannelSource } from '../services/channel-sources.ts'
import type { ImportedVideo } from '../services/channels-import.ts'
import { formatDuration } from '../utils/time.ts'

/** Enter and Space press these controls; they must not also reach the Guide. */
function keepKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}

const MODE_NOTES: Record<SourceMode, string> = {
  recent: 'The newest uploads, newest weighted.',
  archive: 'Everything the source lists plus TVN’s back catalogue, spread across the years.',
  all: 'As Archive, and every rescan adds to what was found before.',
}

interface Draft {
  mode: SourceMode
  terms: string
  playlists: string
  minMinutes: string
  maxMinutes: string
  yearFrom: string
  yearTo: string
  dropUnknown: boolean
  excludeTerms: string
  shorts: boolean
}

const minutes = (seconds: number | undefined) => (seconds === undefined ? '' : String(Math.round((seconds / 60) * 10) / 10))
const number = (text: string) => (text.trim() === '' ? undefined : Number(text))

function draftOf(source: ChannelSource): Draft {
  const inc = source.filter?.include ?? {}
  const exc = source.filter?.exclude ?? {}
  return {
    mode: sourceModeOf(source),
    terms: formatTerms(inc.terms),
    playlists: formatTerms(inc.playlists),
    minMinutes: minutes(inc.minSeconds),
    maxMinutes: minutes(inc.maxSeconds),
    yearFrom: inc.yearFrom ? String(inc.yearFrom) : '',
    yearTo: inc.yearTo ? String(inc.yearTo) : '',
    dropUnknown: inc.unknownYear === 'drop',
    excludeTerms: formatTerms(exc.terms),
    shorts: exc.shorts === true,
  }
}

function filterOf(draft: Draft): SourceFilter | undefined {
  const min = number(draft.minMinutes)
  const max = number(draft.maxMinutes)
  return cleanFilter({
    include: {
      terms: parseTerms(draft.terms),
      playlists: parseTerms(draft.playlists),
      minSeconds: min === undefined ? undefined : min * 60,
      maxSeconds: max === undefined ? undefined : max * 60,
      yearFrom: number(draft.yearFrom),
      yearTo: number(draft.yearTo),
      unknownYear: draft.dropUnknown ? 'drop' : 'keep',
    },
    exclude: { terms: parseTerms(draft.excludeTerms), shorts: draft.shorts },
  })
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * One scheduled source's mode and filter, in the order they act: MODE (how far back the source reaches), FILTER
 * (which of its programmes are eligible), PREVIEW (what that makes eligible from what the source already holds),
 * then RESCAN (fetch again with them). Nothing is fetched or saved until APPLY or APPLY & RESCAN; the editor's
 * own RESCAN also uses a draft not yet applied, and SAVE keeps it.
 */
export function SourceFilterPanel({
  source,
  archive = [],
  disabled,
  onApply,
  onRescan,
  onDraft,
}: {
  source: ChannelSource
  archive?: readonly ImportedVideo[]
  disabled: boolean
  onApply: (filter: SourceFilter | undefined, mode: SourceMode) => void
  /** Applies the draft and rescans the channel with it. */
  onRescan?: (filter: SourceFilter | undefined, mode: SourceMode) => void
  /** The draft while it differs from what the source has, or null once it matches again. */
  onDraft?: (draft: SourceDraft | null) => void
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(source))
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))
  const filter = filterOf(draft)
  const preview = useMemo(
    () => previewFilter(widenSource({ ...source, mode: draft.mode }, archive), filter, draft.mode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, archive, JSON.stringify(filter), draft.mode],
  )
  const changed = !same(filter, cleanFilter(source.filter)) || draft.mode !== sourceModeOf(source)
  const filterKey = JSON.stringify(filter ?? null)
  useEffect(() => {
    onDraft?.(changed ? { filter, mode: draft.mode } : null)
    // The draft is reported when it changes; the callback itself may be a new function each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changed, filterKey, draft.mode])
  const id = `curation-${source.id}`
  const field = (label: string, key: keyof Draft, props: { placeholder?: string; inputMode?: 'numeric' | 'decimal'; wide?: boolean } = {}) => (
    <label className={props.wide ? 'curation-field is-wide' : 'curation-field'}>
      <span>{label}</span>
      <input
        type="text"
        value={draft[key] as string}
        placeholder={props.placeholder}
        inputMode={props.inputMode}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        onKeyDown={keepKey}
        onChange={(event) => set({ [key]: event.target.value } as Partial<Draft>)}
      />
    </label>
  )
  return (
    <div className="curation" role="group" aria-labelledby={`${id}-head`}>
      <p className="editor-heading" id={`${id}-head`}>
        Mode · filter · preview · rescan
        <span className="curation-state">
          {SOURCE_MODE_LABELS[sourceModeOf(source)]}
          {source.filter ? ' · filter on' : ''}
          {changed ? ' · not applied yet' : ''}
        </span>
      </p>
      <p className="curation-step">1 · Mode</p>
      <label className="curation-field is-wide">
        <span>Source mode</span>
        <select value={draft.mode} disabled={disabled} onKeyDown={keepKey} onChange={(event) => set({ mode: event.target.value as SourceMode })}>
          {SOURCE_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {SOURCE_MODE_LABELS[mode]}
            </option>
          ))}
        </select>
        <small>{MODE_NOTES[draft.mode]}</small>
      </label>
      <p className="curation-step">2 · Filter</p>
      <p className="curation-sub">Include</p>
      <div className="curation-grid">
        {field('Title contains any of', 'terms', { placeholder: 'comma separated', wide: true })}
        {field('From playlists', 'playlists', { placeholder: 'playlist links or ids', wide: true })}
        {field('Min minutes', 'minMinutes', { inputMode: 'decimal' })}
        {field('Max minutes', 'maxMinutes', { inputMode: 'decimal' })}
        {field('Era from', 'yearFrom', { inputMode: 'numeric', placeholder: 'year' })}
        {field('Era to', 'yearTo', { inputMode: 'numeric', placeholder: 'year' })}
      </div>
      <label className="editor-check curation-check">
        <input type="checkbox" checked={draft.dropUnknown} disabled={disabled} onKeyDown={keepKey} onChange={() => set({ dropUnknown: !draft.dropUnknown })} />
        <span>Leave out programmes whose year is unknown</span>
      </label>
      <p className="curation-sub">Exclude</p>
      <div className="curation-grid">{field('Title contains any of', 'excludeTerms', { placeholder: 'comma separated', wide: true })}</div>
      <label className="editor-check curation-check">
        <input type="checkbox" checked={draft.shorts} disabled={disabled} onKeyDown={keepKey} onChange={() => set({ shorts: !draft.shorts })} />
        <span>Shorts</span>
      </label>
      <p className="curation-step">3 · Preview · from what this source already holds</p>
      <p className="curation-count" role="status" aria-label="Filter preview">
        <span>Matches {preview.matches}</span>
        <span>Excluded {preview.excluded}</span>
        <span>{formatDuration(preview.matchSeconds)}</span>
      </p>
      {preview.sample.length > 0 ? (
        <ol className="editor-videos curation-sample" aria-label="Matching programmes">
          {preview.sample.map((video) => (
            <li key={video.id}>
              <span className="editor-video-title">{video.title}</span>
              <span className="editor-video-length">{formatDuration(video.durationSec)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="editor-videos-empty">{(source.videos?.length ?? 0) === 0 ? 'Nothing scanned yet · Rescan to fetch its programmes' : 'Nothing matches'}</p>
      )}
      {preview.excludedSample.length > 0 ? (
        <ol className="editor-videos curation-sample is-excluded" aria-label="Excluded programmes">
          {preview.excludedSample.map(({ video, reason }) => (
            <li key={video.id}>
              <span className="editor-video-title">{video.title}</span>
              <span className="editor-video-length">{reason}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="curation-step">4 · Rescan · fetches the source again with this mode and filter</p>
      <div className="curation-actions">
        <button type="button" className="tab" disabled={disabled || !changed} onKeyDown={keepKey} onClick={() => onApply(filter, draft.mode)}>
          Apply filter
        </button>
        {onRescan ? (
          <button type="button" className="tab" disabled={disabled} onKeyDown={keepKey} onClick={() => onRescan(filter, draft.mode)}>
            {changed ? 'Apply & rescan' : 'Rescan with this filter'}
          </button>
        ) : null}
        <button
          type="button"
          className="tab"
          disabled={disabled || (!source.filter && sourceModeOf(source) === 'recent')}
          onKeyDown={keepKey}
          onClick={() => {
            setDraft(draftOf({ ...source, filter: undefined, mode: undefined }))
            onApply(undefined, 'recent')
          }}
        >
          Clear
        </button>
      </div>
    </div>
  )
}

const TEXT_NOTES: readonly { key: 'purpose' | 'include' | 'exclude' | 'sourceNotes' | 'desired' | 'gaps' | 'eras'; label: string }[] = [
  { key: 'purpose', label: 'Purpose' },
  { key: 'include', label: 'What belongs' },
  { key: 'exclude', label: 'What does not' },
  { key: 'sourceNotes', label: 'Source notes' },
  { key: 'desired', label: 'Desired content' },
  { key: 'gaps', label: 'Known gaps' },
  { key: 'eras', label: 'Eras' },
]

/** The viewer's own notes on the channel. Metadata only: none of it changes what plays. */
export function EditorialPanel({
  editorial,
  disabled,
  onChange,
}: {
  editorial: ChannelEditorial | undefined
  disabled: boolean
  onChange: (next: ChannelEditorial) => void
}) {
  const notes = editorial ?? {}
  const [tags, setTags] = useState(() => (notes.tags ?? []).join(', '))
  const [hours, setHours] = useState(() => (notes.targetHours ? String(notes.targetHours) : ''))
  const [count, setCount] = useState(() => (notes.targetProgrammes ? String(notes.targetProgrammes) : ''))
  const target = (text: string) => {
    const value = Number(text)
    return text.trim() && Number.isFinite(value) && value > 0 ? value : undefined
  }
  return (
    <div className="curation editorial" role="group" aria-label="Editorial notes">
      <p className="guide-tool-note">Your notes about this channel. They are kept and exported with it, and never change what plays.</p>
      {TEXT_NOTES.map(({ key, label }) => (
        <label key={key} className="curation-field is-wide">
          <span>{label}</span>
          <textarea
            rows={key === 'purpose' ? 2 : 1}
            value={notes[key] ?? ''}
            maxLength={EDITORIAL_LIMITS.text}
            disabled={disabled}
            onKeyDown={keepKey}
            onChange={(event) => onChange({ ...notes, [key]: event.target.value })}
          />
        </label>
      ))}
      <div className="curation-grid">
        <label className="curation-field is-wide">
          <span>Tags</span>
          <input
            type="text"
            value={tags}
            placeholder="comma separated"
            autoComplete="off"
            disabled={disabled}
            onKeyDown={keepKey}
            onChange={(event) => {
              setTags(event.target.value)
              onChange({ ...notes, tags: parseTags(event.target.value) })
            }}
          />
        </label>
        <label className="curation-field">
          <span>Target hours</span>
          <input
            type="text"
            inputMode="decimal"
            value={hours}
            disabled={disabled}
            onKeyDown={keepKey}
            onChange={(event) => {
              setHours(event.target.value)
              onChange({ ...notes, targetHours: target(event.target.value) })
            }}
          />
        </label>
        <label className="curation-field">
          <span>Target programmes</span>
          <input
            type="text"
            inputMode="numeric"
            value={count}
            disabled={disabled}
            onKeyDown={keepKey}
            onChange={(event) => {
              setCount(event.target.value)
              onChange({ ...notes, targetProgrammes: target(event.target.value) })
            }}
          />
        </label>
      </div>
    </div>
  )
}
