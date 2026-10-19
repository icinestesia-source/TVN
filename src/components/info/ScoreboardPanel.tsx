import { useEffect, useMemo, useState } from 'react'
import { todayIso } from '../../info/football/normalize.ts'
import type { ScoreboardEvent } from '../../info/sports/scoreboard.ts'
import { daysWithEvents, eventOnDay, nextDayWithEvents, statusText } from '../../info/sports/scoreboard.ts'
import { keepKey } from '../keep-key.ts'
import { DayCalendar, formatSelectedDayLabel, shiftSelectedDay } from './DayCalendar.tsx'

function formatStart(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms)
}

function formatTime(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(ms)
}

function centre(event: ScoreboardEvent): string {
  if (event.homeScore && event.awayScore) return `${event.homeScore}–${event.awayScore}`
  return 'v'
}

/** Drop a status word when the kickoff time already says the match has not started, or when FT is already shown. */
function lineDetail(event: ScoreboardEvent, selectedDayIso: string): string {
  const raw = event.detail.trim()
  const startDay = event.startIso.slice(0, 10)
  const timeOnly = kickoffLooksSameDay(event.startIso, selectedDayIso)
  if (event.status === 'scheduled' || /^(scheduled|final|finished|full time|ft)$/i.test(raw)) {
    return timeOnly ? formatTime(event.startIso) : formatStart(event.startIso)
  }
  if (raw && !timeOnly && startDay !== selectedDayIso.slice(0, 10)) return `${raw} · ${formatStart(event.startIso)}`
  return raw || (timeOnly ? formatTime(event.startIso) : formatStart(event.startIso))
}

function kickoffLooksSameDay(startIso: string, selectedDayIso: string): boolean {
  const ms = Date.parse(startIso)
  if (!Number.isFinite(ms)) return startIso.startsWith(selectedDayIso)
  const local = new Date(ms)
  const year = local.getFullYear()
  const month = String(local.getMonth() + 1).padStart(2, '0')
  const day = String(local.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}` === selectedDayIso
}

function rank(event: ScoreboardEvent): number {
  if (event.status === 'in-play') return 0
  if (event.status === 'scheduled') return 1
  return 2
}

/**
 * One ESPN scoreboard: NFL, NBA, NHL, or cricket. Days page like Football.
 * Cricket is also grouped by series when more than one is active.
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
  const [selectedDayIso, setSelectedDayIso] = useState(() => todayIso())

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

  const filtered = useMemo(() => {
    const list = events ?? []
    return competitions.length > 1 && chosen ? list.filter((event) => event.competition === chosen) : list
  }, [events, competitions.length, chosen])

  const dataDays = useMemo(() => daysWithEvents(filtered), [filtered])
  const nextMatchDay = useMemo(() => nextDayWithEvents(dataDays, selectedDayIso), [dataDays, selectedDayIso])
  const today = todayIso()

  const shown = filtered
    .filter((event) => eventOnDay(event, selectedDayIso))
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
      <div className="info-day-nav" role="group" aria-label="Match date">
        <button
          type="button"
          className="tab info-day-arrow"
          aria-label="Previous day"
          onKeyDown={keepKey}
          onClick={() => setSelectedDayIso((day) => shiftSelectedDay(day, -1))}
        >
          ‹
        </button>
        <p className="info-day-nav-date" aria-live="polite">
          {formatSelectedDayLabel(selectedDayIso)}
          {selectedDayIso === today ? ' · Today' : ''}
        </p>
        <button
          type="button"
          className="tab info-day-arrow"
          aria-label="Next day"
          onKeyDown={keepKey}
          onClick={() => setSelectedDayIso((day) => shiftSelectedDay(day, 1))}
        >
          ›
        </button>
        <button type="button" className={selectedDayIso === today ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={() => setSelectedDayIso(today)}>
          Today
        </button>
        <button
          type="button"
          className="tab"
          disabled={nextMatchDay === null}
          title={nextMatchDay ? `Next matches · ${formatSelectedDayLabel(nextMatchDay)}` : 'No later matches in this scoreboard'}
          onKeyDown={keepKey}
          onClick={() => {
            if (nextMatchDay) setSelectedDayIso(nextMatchDay)
          }}
        >
          Next matches
        </button>
        <DayCalendar selectedDayIso={selectedDayIso} onSelect={setSelectedDayIso} daysWithData={dataDays} />
      </div>
      {events === null && !error ? <p className="options-note">Loading {label}…</p> : null}
      {error && !events?.length ? <p className="options-note">{label} scoreboard unavailable.</p> : null}
      {events && shown.length === 0 ? (
        <p className="options-note">No {label} fixtures on {formatSelectedDayLabel(selectedDayIso)}.</p>
      ) : null}
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
                <span>{lineDetail(event, selectedDayIso)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
