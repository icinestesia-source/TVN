import { useEffect, useMemo, useState } from 'react'
import { loadFootballSnapshot, type FootballLoadState } from '../../info/football/load.ts'
import { matchesOnDay, statusLabel, todayIso } from '../../info/football/normalize.ts'
import type { FootballMatch } from '../../info/football/types.ts'
import { keepKey } from '../keep-key.ts'

type Section = 'today' | 'fixtures' | 'results' | 'tables' | 'competitions'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'fixtures', label: 'Fixtures' },
  { id: 'results', label: 'Results' },
  { id: 'tables', label: 'Tables' },
  { id: 'competitions', label: 'Competitions' },
]

function formatKickoff(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms)
}

function formatUpdated(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ms)
}

function MatchRow({ match, competition, liveReliable }: { match: FootballMatch; competition: string; liveReliable: boolean }) {
  const score =
    match.score && (match.status === 'finished' || match.status === 'in-play')
      ? `${match.score.home}–${match.score.away}`
      : 'v'
  return (
    <li className="info-match">
      <span className="info-match-home">{match.home}</span>
      <span className="info-match-score" title={competition}>
        {score}
      </span>
      <span className="info-match-away">{match.away}</span>
      <span className="info-match-status">
        {statusLabel(match.status, liveReliable)} · {formatKickoff(match.kickoffIso)}
      </span>
    </li>
  )
}

/**
 * INFO → Sports → Football. Uses the published snapshot only; never talks to football-data.org from the browser.
 */
export function FootballPanel() {
  const [state, setState] = useState<FootballLoadState>({ status: 'loading' })
  const [section, setSection] = useState<Section>('today')
  const [competitionId, setCompetitionId] = useState<string>('all')

  useEffect(() => {
    let live = true
    void loadFootballSnapshot().then((next) => {
      if (live) setState(next)
    })
    return () => {
      live = false
    }
  }, [])

  const day = todayIso()
  const ready = state.status === 'ready' ? state : null
  const snapshot = ready?.snapshot ?? (state.status === 'unavailable' ? state.snapshot : null)

  const filtered = useMemo(() => {
    if (!snapshot) return []
    const base = competitionId === 'all' ? snapshot.matches : snapshot.matches.filter((match) => match.competitionId === competitionId)
    return base
  }, [snapshot, competitionId])

  const competitionName = (id: string) => snapshot?.competitions.find((entry) => entry.id === id)?.name ?? id

  if (state.status === 'loading') {
    return (
      <div className="info-panel">
        <p className="options-note">Loading football…</p>
      </div>
    )
  }

  if (state.status === 'unavailable' && (!snapshot || (!snapshot.matches.length && !snapshot.tables.length))) {
    return (
      <div className="info-panel">
        <p className="options-note" role="status">
          {state.message}
        </p>
        <p className="info-panel-meta">Football data from football-data.org · free tier is delayed, never shown as Live.</p>
      </div>
    )
  }

  if (!ready || !snapshot) {
    return (
      <div className="info-panel">
        <p className="options-note" role="status">
          Football unavailable
        </p>
      </div>
    )
  }

  const today = matchesOnDay(filtered, day)
  const fixtures = filtered.filter((match) => match.status === 'scheduled' || (match.status === 'in-play' && match.kickoffIso.slice(0, 10) >= day))
  const results = filtered.filter((match) => match.status === 'finished').slice().reverse()
  const tables =
    competitionId === 'all'
      ? snapshot.tables
      : snapshot.tables.filter((table) => table.competitionId === competitionId)

  return (
    <div className="info-panel">
      <p className={ready.stale || ready.fromCache ? 'info-panel-meta is-stale' : 'info-panel-meta'} role="status">
        Updated {formatUpdated(snapshot.updatedIso)}
        {ready.stale ? ' · stale' : ''}
        {ready.fromCache ? ' · last good copy' : ''}
        {' · '}
        {snapshot.liveReliable ? 'Live scores on' : 'Delayed scores · not Live'}
        {' · '}
        {snapshot.attribution}
      </p>
      <div className="tabs" role="tablist" aria-label="Football sections">
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={section === entry.id}
            className={section === entry.id ? 'tab is-on' : 'tab'}
            onKeyDown={keepKey}
            onClick={() => setSection(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {section !== 'competitions' ? (
        <div className="tabs" role="tablist" aria-label="Competitions filter">
          <button type="button" role="tab" aria-selected={competitionId === 'all'} className={competitionId === 'all' ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={() => setCompetitionId('all')}>
            All
          </button>
          {snapshot.competitions.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={competitionId === entry.id}
              className={competitionId === entry.id ? 'tab is-on' : 'tab'}
              onKeyDown={keepKey}
              onClick={() => setCompetitionId(entry.id)}
            >
              {entry.name}
            </button>
          ))}
        </div>
      ) : null}

      {section === 'competitions' ? (
        <ul className="info-list">
          {snapshot.competitions.map((entry) => (
            <li key={entry.id} className="info-item">
              <span className="info-item-title">{entry.name}</span>
              <span className="info-item-meta">
                {entry.area ?? 'International'} · {entry.code}
              </span>
            </li>
          ))}
        </ul>
      ) : section === 'tables' ? (
        tables.length === 0 ? (
          <p className="options-note">No league tables in this selection.</p>
        ) : (
          tables.map((table) => (
            <div key={`${table.competitionId}-${table.type}`}>
              <p className="info-panel-meta">{competitionName(table.competitionId)}</p>
              <table className="info-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Team</th>
                    <th className="num">P</th>
                    <th className="num">W</th>
                    <th className="num">D</th>
                    <th className="num">L</th>
                    <th className="num">GD</th>
                    <th className="num">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => (
                    <tr key={`${table.competitionId}-${row.position}-${row.team}`}>
                      <td className="num">{row.position}</td>
                      <td>{row.team}</td>
                      <td className="num">{row.played}</td>
                      <td className="num">{row.won}</td>
                      <td className="num">{row.drawn}</td>
                      <td className="num">{row.lost}</td>
                      <td className="num">{row.goalDifference}</td>
                      <td className="num">{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )
      ) : (
        (() => {
          const list = section === 'today' ? today : section === 'results' ? results : fixtures
          if (list.length === 0) {
            return <p className="options-note">{section === 'today' ? 'No matches today in this selection.' : section === 'results' ? 'No results in this selection.' : 'No fixtures in this selection.'}</p>
          }
          return (
            <ul className="info-list">
              {list.map((match) => (
                <MatchRow key={match.id} match={match} competition={competitionName(match.competitionId)} liveReliable={snapshot.liveReliable} />
              ))}
            </ul>
          )
        })()
      )}
      {snapshot.errors?.length ? <p className="info-panel-meta is-stale">{snapshot.errors.length} update {snapshot.errors.length === 1 ? 'warning' : 'warnings'}</p> : null}
    </div>
  )
}
