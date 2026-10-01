import { useEffect, useState, type KeyboardEvent } from 'react'
import { loadRegister } from '../credits/load.ts'
import { channelSourceUrl, sourceIdOf, sourceTypeLabel, webUrl, type SourceRegister } from '../credits/provenance.ts'
import { cleanSourceInfo, draftOf, linkLabel, type SourceInfoDraft } from '../credits/source-info.ts'
import { mediaLibrary } from '../director/library.ts'
import { getChannelMedia } from '../library/query.ts'
import type { ChannelSource, SourceInfo } from '../services/channel-sources.ts'

function keepKeys(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Escape') event.stopPropagation()
}

function Link({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

/** The TVN sources behind a shipped channel, counted from its own programming. Read only when shown. */
function TvnSources({ number }: { number: number }) {
  const [register, setRegister] = useState<SourceRegister | null>(null)
  useEffect(() => {
    let live = true
    void loadRegister().then((loaded) => live && setRegister(loaded))
    return () => {
      live = false
    }
  }, [])
  if (!register) return <p className="source-public-note">Reading sources…</p>
  const counts = new Map<string, number>()
  for (const item of getChannelMedia(mediaLibrary(), number)) {
    const id = sourceIdOf(item)
    if (id?.startsWith('src_')) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  if (counts.size === 0) return <p className="source-public-note">This channel shows TVN presentation cards only.</p>
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  return (
    <ul className="source-tvn-list" aria-label="Sources on this channel">
      {ranked.map(([id, count]) => {
        const entry = register.sources[id]
        const url = webUrl(entry?.channelUrl) ?? webUrl(entry?.website)
        const name = entry?.name ?? id
        return (
          <li key={id}>
            {url ? <Link href={url}>{name}</Link> : <span>{name}</span>}
            <span>
              {entry?.provider ?? 'YouTube'} · {count}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

const FIELDS: readonly { key: keyof SourceInfoDraft; label: string; type: string; placeholder: string }[] = [
  { key: 'website', label: 'Website', type: 'url', placeholder: 'https://' },
  { key: 'contactPage', label: 'Contact page', type: 'url', placeholder: 'https://' },
  { key: 'links', label: 'Social links', type: 'textarea', placeholder: 'One official link per line' },
  { key: 'email', label: 'Public email', type: 'email', placeholder: 'Published business or contact email' },
  { key: 'phone', label: 'Business phone', type: 'tel', placeholder: 'Published business number' },
]

/** Optional public details for a source, typed in by the viewer; only valid entries are kept. */
function PublicInfo({ source, disabled, onChange }: { source: ChannelSource; disabled: boolean; onChange: (info: SourceInfo | undefined) => void }) {
  const [draft, setDraft] = useState<SourceInfoDraft>(() => draftOf(source.info))
  const [problem, setProblem] = useState<string | null>(null)
  const update = (key: keyof SourceInfoDraft, value: string) => {
    const next = { ...draft, [key]: value }
    setDraft(next)
    const checked = cleanSourceInfo(next)
    setProblem(checked.problem ?? null)
    if (!checked.problem) onChange(checked.info)
  }
  return (
    <details className="source-public" open={Boolean(source.info)}>
      <summary>Public information (optional)</summary>
      <p className="source-public-note">
        Only what the creator publishes for public or business contact. A website or contact page is best. TVN never looks these up, and
        they stay in this browser.
      </p>
      {FIELDS.map((field) => (
        <label key={field.key}>
          <span>{field.label}</span>
          {field.type === 'textarea' ? (
            <textarea rows={2} value={draft[field.key]} placeholder={field.placeholder} disabled={disabled} onKeyDown={keepKeys} onChange={(event) => update(field.key, event.target.value)} />
          ) : (
            <input
              type={field.type}
              value={draft[field.key]}
              placeholder={field.placeholder}
              autoComplete="off"
              disabled={disabled}
              onKeyDown={keepKeys}
              onChange={(event) => update(field.key, event.target.value)}
            />
          )}
        </label>
      ))}
      {problem ? <p className="source-public-note" role="alert">{problem}</p> : null}
    </details>
  )
}

/** A source opened in the Channel Editor: what it is and where it lives, before its programmes. */
export function SourceDetails({
  source,
  number,
  disabled,
  onInfo,
}: {
  source: ChannelSource
  number: number
  disabled: boolean
  onInfo: (info: SourceInfo | undefined) => void
}) {
  if (source.kind === 'tvn') {
    return (
      <div className="source-details">
        <dl>
          <dt>Type</dt>
          <dd>TVN programming</dd>
        </dl>
        {number >= 1 && number <= 999 ? <TvnSources number={number} /> : null}
      </div>
    )
  }
  const home = channelSourceUrl(source)
  const address = webUrl(source.url)
  return (
    <div className="source-details">
      <dl>
        <dt>Name</dt>
        <dd>{source.label || '—'}</dd>
        <dt>Type</dt>
        <dd>{source.kind === 'youtube' ? 'YouTube' : sourceTypeLabel(source)}</dd>
        {home ? (
          <>
            <dt>Original</dt>
            <dd>
              <Link href={home}>{linkLabel(home)}</Link>
            </dd>
          </>
        ) : null}
        {address && address !== home ? (
          <>
            <dt>Address</dt>
            <dd>
              <Link href={address}>{linkLabel(address)}</Link>
            </dd>
          </>
        ) : null}
      </dl>
      {source.kind === 'collection' ? null : <PublicInfo source={source} disabled={disabled} onChange={onInfo} />}
    </div>
  )
}
