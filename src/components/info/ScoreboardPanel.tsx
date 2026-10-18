import { useEffect, useMemo, useState } from 'react'
import type { ScoreboardEvent } from '../../info/sports/scoreboard.ts'
import { statusText } from '../../info/sports/scoreboard.ts'
import { keepKey } from '../keep-key.ts'

function formatStart(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms)
}

function centre(event: ScoreboardEvent): string {
  if (event.homeScore && event.awayScore) return `${event.homeScore}–${event.awayScore}`
  return 'v'
}

/** Drop a status word when the kickoff time already says the match has not started, or when FT is already shown. */
function lineDetail(event: ScoreboardEvent): string {
  const raw = event.detail.trim()
  if (event.status === 'scheduled' || /^(scheduled|final|finished|full time|ft)$/i.test(raw)) return formatStart(event.startIso)
  return raw
}

function rank(event: ScoreboardEvent): number {
  if (event.status === 'in-play') return 0
  if (event.status === 'scheduled') return 1
  return 2
}

/**
 * One ESPN scoreboard: NFL, NBA, NHL, or cricket. Cricket is grouped by series.
 */
export function ScoreboardPanel({
  label,
  load,
}: {
  label: string
  load: () => Promise<ScoreboardEvent[]>
}) {
  const [events, setEvents] = useState<ScoreboardEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [series, setSeries] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const pull = () => {
      void load()
        .then((next) => {
          if (!live) return
          setEvents(next)
          setError(null)
        })
        .catch((caught: unknown) => {
          if (!live) return
          setError(caught instanceof Error ? caught.message : 'Scoreboard unavailable')
        })
    }
    pull()
    const id = window.setInterval(pull, 5 * 60 * 1000)
    return () => {
      live = false
      window.clearInterval(id)
    }
  }, [load])

  const competitions = useMemo(() => {
    const names: string[] = []
    for (const event of events ?? []) {
      if (!names.includes(event.competition)) names.push(event.competition)
    }
    return names
  }, [events])

  const inProgress = competitions.find((name) => (events ?? []).some((event) => event.competition === name && event.status === 'in-play'))
  const chosen = series && competitions.includes(series) ? series : competitions.length > 1 ? inProgress ?? competitions[0] : null
  const shown = (events ?? [])
    .filter((event) => (competitions.length > 1 && chosen ? event.competition === chosen : true))
    .slice()
    .sort((a, b) => rank(a) - rank(b) || a.startIso.localeCompare(b.startIso))

  return (
    <div className="info-matches">
      <p className="info-panel-meta">Scores from ESPN · {label}</p>
      {competitions.length > 1 ? (
        <div className="tabs" role="tablist" aria-label={`${label} series`}>
          {competitions.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={chosen === name}
              className={chosen === name ? 'tab is-on' : 'tab'}
              onKeyDown={keepKey}
              onClick={() => setSeries(name)}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      {events === null && !error ? <p className="options-note">Loading {label}…</p> : null}
      {error && !events?.length ? <p className="options-note">{label} scoreboard unavailable.</p> : null}
      {events && shown.length === 0 ? <p className="options-note">No {label} fixtures on the current scoreboard.</p> : null}
      {shown.length ? (
        <ul className="info-list">
          {shown.map((event) => (
            <li key={event.id} className="info-match">
              <span className="info-match-home">{event.home}</span>
              <span className={`info-match-score${(event.homeScore?.length ?? 0) > 6 ? ' is-long' : ''}`} title={event.detail}>
                {centre(event)}
              </span>
              <span className="info-match-away">{event.away}</span>
              <span className="info-match-status">
                <span className="info-match-comp">{event.competition}</span>
                {statusText(event.status) ? (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span>{statusText(event.status)}</span>
                  </>
                ) : null}
                <span aria-hidden="true"> · </span>
                <span>{lineDetail(event)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
