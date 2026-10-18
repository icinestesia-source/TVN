import { useEffect, useMemo, useState } from 'react'
import { FOOTBALL_COMPETITIONS, competitionDef, competitionsByRegion, isKnockoutCompetition } from '../../info/football/competitions.ts'
import { diagnoseFootballEmpty } from '../../info/football/empty-state.ts'
import { loadFootballSnapshot, type FootballLoadState } from '../../info/football/load.ts'
import { chronologicalMatches, daysWithMatches, matchesForCompetition, nextDayWithMatches } from '../../info/football/match-lists.ts'
import { kickoffLocalDayIso, matchesOnDay, statusLabel, todayIso } from '../../info/football/normalize.ts'
import { isFootballEntitlementError } from '../../info/football/snapshot-safety.ts'
import { favouriteFromTeam, latestResult, nextFixture, searchTeams, teamsFromSnapshot } from '../../info/football/teams.ts'
import type { FootballMatch } from '../../info/football/types.ts'
import {
  defaultInfoPreferences,
  loadInfoPreferences,
  saveInfoPreferences,
  type FootballDefaultView,
  type InfoPreferences,
} from '../../info/preferences.ts'
import { keepKey } from '../keep-key.ts'
import { DayCalendar, formatSelectedDayLabel, shiftSelectedDay } from './DayCalendar.tsx'

type Section = 'my-football' | 'matches' | 'tables' | 'leagues'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'my-football', label: 'My Football' },
  { id: 'matches', label: 'Matches' },
  { id: 'tables', label: 'Tables' },
  { id: 'leagues', label: 'Leagues' },
]

function formatKickoffTime(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(ms)
}

function formatKickoffFull(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms)
}

function formatUpdated(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ms)
}

function matchCentreLabel(match: FootballMatch): string {
  if ((match.status === 'finished' || match.status === 'in-play') && match.score) {
    return `${match.score.home}–${match.score.away}`
  }
  if (match.status === 'postponed') return 'P–P'
  if (match.status === 'cancelled') return '—'
  return 'v'
}

function MatchRow({
  match,
  competition,
  liveReliable,
  showDate,
}: {
  match: FootballMatch
  competition: string
  liveReliable: boolean
  showDate: boolean
}) {
  const status = statusLabel(match.status, liveReliable)
  const detail =
    match.status === 'postponed'
      ? 'POSTPONED'
      : match.status === 'cancelled'
        ? 'CANCELLED'
        : showDate
          ? formatKickoffFull(match.kickoffIso)
          : formatKickoffTime(match.kickoffIso)
  return (
    <li className="info-match">
      <span className="info-match-home">{match.home}</span>
      <span className="info-match-score" title={`${competition} · ${status}`}>
        {matchCentreLabel(match)}
      </span>
      <span className="info-match-away">{match.away}</span>
      <span className="info-match-status">
        <span className="info-match-comp">{competition}</span>
        {status ? (
          <>
            <span aria-hidden="true"> · </span>
            <span>{status}</span>
          </>
        ) : null}
        <span aria-hidden="true"> · </span>
        <span>{detail}</span>
      </span>
    </li>
  )
}

function initialSection(prefs: InfoPreferences): Section {
  const hasFavs = prefs.football.favouriteTeamIds.length > 0 || prefs.football.favouriteCompetitionIds.length > 0
  const view = prefs.football.defaultView
  if (view === 'my-football') return 'my-football'
  if (view === 'today') return 'matches'
  if (view === 'default-league' || view === 'last-viewed' || view === 'favourite-team-league') return 'tables'
  return hasFavs ? 'my-football' : 'matches'
}

function resolveCompetition(prefs: InfoPreferences): string {
  const { defaultView, defaultCompetitionId, lastViewedCompetitionId, primaryTeamId, favouriteTeams } = prefs.football
  if (defaultView === 'last-viewed' && lastViewedCompetitionId) return lastViewedCompetitionId
  if (defaultView === 'favourite-team-league' && primaryTeamId) {
    const team = favouriteTeams.find((entry) => entry.id === primaryTeamId)
    if (team?.competitionId) return team.competitionId
  }
  if (defaultView === 'default-league' && defaultCompetitionId) return defaultCompetitionId
  return defaultCompetitionId ?? 'PL'
}

function competitionUnavailable(snapshot: { errors?: string[]; matches: FootballMatch[]; tables: { competitionId: string }[] }, code: string): boolean {
  const error = snapshot.errors?.find((entry) => entry.startsWith(`${code} `) || entry.startsWith(`${code}:`))
  if (!error) return false
  if (!isFootballEntitlementError(error) && !/skipped/i.test(error)) return false
  return !snapshot.matches.some((match) => match.competitionId === code) && !snapshot.tables.some((table) => table.competitionId === code)
}

/**
 * INFO → Sports → Football. Snapshot only; favourites and league prefs are local.
 */
export function FootballPanel() {
  const [state, setState] = useState<FootballLoadState>({ status: 'loading' })
  const [prefs, setPrefs] = useState<InfoPreferences>(() => {
    try {
      return loadInfoPreferences()
    } catch {
      return defaultInfoPreferences()
    }
  })
  const [section, setSection] = useState<Section>(() => initialSection(prefs))
  const [competitionId, setCompetitionId] = useState<string>(() => resolveCompetition(prefs))
  const [selectedDayIso, setSelectedDayIso] = useState(() => todayIso())
  const [leagueRegion, setLeagueRegion] = useState<string | null>(null)
  const [teamQuery, setTeamQuery] = useState('')
  const [showAllLeagues, setShowAllLeagues] = useState(false)

  useEffect(() => {
    let live = true
    const pull = () => {
      void loadFootballSnapshot().then((next) => {
        if (live) setState(next)
      })
    }
    pull()
    // The published snapshot can change without a site rebuild. Refresh quietly while Info is open.
    const id = window.setInterval(pull, 5 * 60 * 1000)
    return () => {
      live = false
      window.clearInterval(id)
    }
  }, [])

  const persist = (next: InfoPreferences) => {
    const normalized = { ...next }
    saveInfoPreferences(normalized)
    setPrefs(normalized)
  }

  const selectCompetition = (id: string) => {
    setCompetitionId(id)
    persist({
      ...prefs,
      football: { ...prefs.football, lastViewedCompetitionId: id === 'all' ? prefs.football.lastViewedCompetitionId : id },
    })
  }

  const ready = state.status === 'ready' ? state : null
  const snapshot = ready?.snapshot ?? (state.status === 'unavailable' ? state.snapshot : null)

  const availableCodes = useMemo(() => new Set(snapshot?.competitions.map((entry) => entry.code) ?? []), [snapshot])
  const teams = useMemo(() => (snapshot ? teamsFromSnapshot(snapshot) : []), [snapshot])
  const teamHits = useMemo(() => searchTeams(teams, teamQuery), [teams, teamQuery])

  const filtered = useMemo(() => {
    if (!snapshot) return []
    return matchesForCompetition(snapshot.matches, competitionId)
  }, [snapshot, competitionId])

  const dayMatches = useMemo(() => chronologicalMatches(matchesOnDay(filtered, selectedDayIso)), [filtered, selectedDayIso])
  const dataDays = useMemo(() => daysWithMatches(filtered), [filtered])
  const nextMatchDay = useMemo(() => nextDayWithMatches(dataDays, selectedDayIso), [dataDays, selectedDayIso])

  const competitionName = (id: string) =>
    competitionDef(id)?.name ?? snapshot?.competitions.find((entry) => entry.id === id)?.name ?? id

  const orderedPrimaryLeagues = useMemo(() => {
    const hidden = new Set(prefs.football.hiddenCompetitionIds)
    const fav = new Set(prefs.football.favouriteCompetitionIds)
    const order = prefs.football.competitionOrder
    const list = FOOTBALL_COMPETITIONS.filter((entry) => !hidden.has(entry.code) || showAllLeagues)
    return [...list].sort((a, b) => {
      const af = fav.has(a.code) ? 0 : 1
      const bf = fav.has(b.code) ? 0 : 1
      if (af !== bf) return af - bf
      return order.indexOf(a.code) - order.indexOf(b.code)
    })
  }, [prefs, showAllLeagues])

  if (state.status === 'loading') {
    return (
      <div className="info-panel">
        <p className="options-note">Loading football…</p>
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="info-panel">
        <p className="options-note" role="status">
          {state.status === 'unavailable' ? state.message : 'Football unavailable'}
        </p>
      </div>
    )
  }

  const loadStatus = state.status === 'unavailable' ? 'unavailable' : 'ready'
  const emptyMatches = diagnoseFootballEmpty({
    section: 'matches',
    competitionId,
    snapshot,
    loadStatus,
    selectedDayIso,
  })
  const tables =
    competitionId === 'all'
      ? snapshot.tables
      : snapshot.tables.filter((table) => table.competitionId === competitionId)
  const knockout = competitionId !== 'all' && isKnockoutCompetition(competitionId)
  const today = todayIso()

  const toggleFavouriteLeague = (code: string) => {
    const set = new Set(prefs.football.favouriteCompetitionIds)
    if (set.has(code)) set.delete(code)
    else set.add(code)
    persist({ ...prefs, football: { ...prefs.football, favouriteCompetitionIds: [...set] } })
  }

  const hideLeague = (code: string) => {
    const hidden = new Set(prefs.football.hiddenCompetitionIds)
    hidden.add(code)
    persist({
      ...prefs,
      football: {
        ...prefs.football,
        hiddenCompetitionIds: [...hidden],
        favouriteCompetitionIds: prefs.football.favouriteCompetitionIds.filter((id) => id !== code),
      },
    })
  }

  const restoreHidden = () => {
    persist({ ...prefs, football: { ...prefs.football, hiddenCompetitionIds: [] } })
  }

  const resetFootballDefaults = () => {
    const defaults = defaultInfoPreferences().football
    persist({ ...prefs, football: defaults })
    setCompetitionId(defaults.defaultCompetitionId ?? 'PL')
    setSection('matches')
    setSelectedDayIso(todayIso())
  }

  const moveLeague = (code: string, dir: -1 | 1) => {
    const order = [...prefs.football.competitionOrder]
    const index = order.indexOf(code)
    if (index < 0) return
    const next = index + dir
    if (next < 0 || next >= order.length) return
    ;[order[index], order[next]] = [order[next], order[index]]
    persist({ ...prefs, football: { ...prefs.football, competitionOrder: order } })
  }

  const addFavouriteTeam = (teamId: string) => {
    const team = teams.find((entry) => entry.id === teamId)
    if (!team) return
    const favourite = favouriteFromTeam(team)
    const favouriteTeams = [...prefs.football.favouriteTeams.filter((entry) => entry.id !== teamId), favourite]
    const favouriteTeamIds = [...new Set([...prefs.football.favouriteTeamIds, teamId])]
    persist({
      ...prefs,
      football: {
        ...prefs.football,
        favouriteTeams,
        favouriteTeamIds,
        primaryTeamId: prefs.football.primaryTeamId ?? teamId,
        defaultView: prefs.football.favouriteTeamIds.length === 0 ? 'my-football' : prefs.football.defaultView,
      },
    })
  }

  const removeFavouriteTeam = (teamId: string) => {
    const favouriteTeamIds = prefs.football.favouriteTeamIds.filter((id) => id !== teamId)
    const favouriteTeams = prefs.football.favouriteTeams.filter((entry) => entry.id !== teamId)
    persist({
      ...prefs,
      football: {
        ...prefs.football,
        favouriteTeamIds,
        favouriteTeams,
        primaryTeamId: prefs.football.primaryTeamId === teamId ? favouriteTeamIds[0] ?? null : prefs.football.primaryTeamId,
      },
    })
  }

  const moveFavouriteTeam = (teamId: string, dir: -1 | 1) => {
    const ids = [...prefs.football.favouriteTeamIds]
    const index = ids.indexOf(teamId)
    if (index < 0) return
    const next = index + dir
    if (next < 0 || next >= ids.length) return
    ;[ids[index], ids[next]] = [ids[next], ids[index]]
    const favouriteTeams = ids
      .map((id) => prefs.football.favouriteTeams.find((entry) => entry.id === id))
      .filter(Boolean) as InfoPreferences['football']['favouriteTeams']
    persist({ ...prefs, football: { ...prefs.football, favouriteTeamIds: ids, favouriteTeams } })
  }

  const setDefaultView = (defaultView: FootballDefaultView) => {
    persist({ ...prefs, football: { ...prefs.football, defaultView } })
    if (defaultView === 'my-football') setSection('my-football')
    if (defaultView === 'today') {
      setSection('matches')
      setSelectedDayIso(todayIso())
    }
    if (defaultView === 'default-league' || defaultView === 'last-viewed' || defaultView === 'favourite-team-league') {
      setCompetitionId(resolveCompetition({ ...prefs, football: { ...prefs.football, defaultView } }))
      setSection('tables')
    }
  }

  const regionGroups = competitionsByRegion(showAllLeagues ? FOOTBALL_COMPETITIONS : orderedPrimaryLeagues)

  const goToday = () => {
    setSelectedDayIso(todayIso())
    setSection('matches')
  }

  return (
    <div className="info-panel">
      <p className={ready?.stale || ready?.fromCache ? 'info-panel-meta is-stale' : 'info-panel-meta'} role="status">
        Last update {formatUpdated(snapshot.updatedIso)}
        {ready?.stale ? ' · stale' : ''}
        {ready?.fromCache ? ' · last good copy' : ''}
        {state.status === 'unavailable' && snapshot.matches.length + snapshot.tables.length > 0
          ? ' · showing last successful data'
          : ''}
        {' · '}
        {snapshot.liveReliable ? 'Live scores on' : 'Delayed scores · not Live'}
        {' · '}
        {snapshot.attribution}
      </p>
      {state.status === 'unavailable' || (snapshot.matches.length === 0 && snapshot.tables.length === 0) ? (
        <p className="options-note" role="alert">
          {snapshot.unavailableReason ||
            (state.status === 'unavailable' ? state.message : null) ||
            'DATA NOT YET PUBLISHED — Matches require a published football snapshot.'}
        </p>
      ) : null}
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

      {section !== 'leagues' && section !== 'my-football' ? (
        <div className="tabs info-competition-tabs" role="tablist" aria-label="Competitions filter">
          <button
            type="button"
            role="tab"
            aria-selected={competitionId === 'all'}
            className={competitionId === 'all' ? 'tab is-on' : 'tab'}
            onKeyDown={keepKey}
            onClick={() => selectCompetition('all')}
          >
            <span className="tab-full">All</span>
            <span className="tab-short">All</span>
          </button>
          {orderedPrimaryLeagues.map((entry) => {
            const unavailable = competitionUnavailable(snapshot, entry.code)
            return (
              <button
                key={entry.code}
                type="button"
                role="tab"
                aria-selected={competitionId === entry.code}
                className={[competitionId === entry.code ? 'tab is-on' : 'tab', unavailable ? 'is-unavailable' : '']
                  .filter(Boolean)
                  .join(' ')}
                onKeyDown={keepKey}
                onClick={() => selectCompetition(entry.code)}
                title={
                  unavailable
                    ? `${entry.name} · unavailable under current API plan`
                    : availableCodes.has(entry.code)
                      ? entry.name
                      : `${entry.name} · no data in snapshot`
                }
              >
                <span className="tab-full">{entry.name}</span>
                <span className="tab-short">{entry.code}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {section === 'my-football' ? (
        <div className="info-my-football">
          <p className="info-item-meta">Favourite teams</p>
          {prefs.football.favouriteTeamIds.length === 0 ? (
            <p className="options-note">No favourite teams yet. Search below to add clubs from the current snapshot.</p>
          ) : (
            <ul className="info-list">
              {prefs.football.favouriteTeamIds.map((teamId) => {
                const team = prefs.football.favouriteTeams.find((entry) => entry.id === teamId)
                const next = nextFixture(snapshot.matches, teamId)
                const last = latestResult(snapshot.matches, teamId)
                return (
                  <li key={teamId} className="info-item">
                    <span className="info-item-title">
                      {team?.name ?? teamId}
                      {prefs.football.primaryTeamId === teamId ? ' · primary' : ''}
                    </span>
                    <span className="info-item-meta">
                      Next: {next ? `${next.home} v ${next.away} · ${formatKickoffFull(next.kickoffIso)}` : '—'}
                      {' · '}
                      Last: {last ? `${last.home} ${last.score?.home ?? ''}–${last.score?.away ?? ''} ${last.away}` : '—'}
                    </span>
                    <div className="info-weather-search-row">
                      <button type="button" className="tab" onKeyDown={keepKey} onClick={() => persist({ ...prefs, football: { ...prefs.football, primaryTeamId: teamId } })}>
                        Primary
                      </button>
                      <button type="button" className="tab" onKeyDown={keepKey} onClick={() => moveFavouriteTeam(teamId, -1)}>
                        Up
                      </button>
                      <button type="button" className="tab" onKeyDown={keepKey} onClick={() => moveFavouriteTeam(teamId, 1)}>
                        Down
                      </button>
                      {team?.competitionId ? (
                        <button
                          type="button"
                          className="tab"
                          onKeyDown={keepKey}
                          onClick={() => {
                            selectCompetition(team.competitionId)
                            setSection('tables')
                          }}
                        >
                          League
                        </button>
                      ) : null}
                      <button type="button" className="tab" onKeyDown={keepKey} onClick={() => removeFavouriteTeam(teamId)}>
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <label className="info-item-meta" htmlFor="team-search">
            Find a club
          </label>
          <input
            id="team-search"
            className="info-weather-input"
            value={teamQuery}
            onChange={(event) => setTeamQuery(event.target.value)}
            placeholder="Search by club name"
          />
          <ul className="info-list">
            {teamHits.map((team) => (
              <li key={team.id} className="info-item info-league-row">
                <span className="info-item-title">
                  {team.name} · {team.competitionIds.map(competitionName).join(', ')}
                </span>
                <button type="button" className="tab" onKeyDown={keepKey} onClick={() => addFavouriteTeam(team.id)} disabled={prefs.football.favouriteTeamIds.includes(team.id)}>
                  {prefs.football.favouriteTeamIds.includes(team.id) ? 'Saved' : 'Favourite'}
                </button>
              </li>
            ))}
          </ul>
          <p className="info-item-meta">Default view</p>
          <div className="tabs" role="tablist" aria-label="Default football view">
            {(
              [
                ['my-football', 'My Football'],
                ['favourite-team-league', 'Favourite team league'],
                ['default-league', 'Default league'],
                ['today', 'Today'],
                ['last-viewed', 'Last viewed'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={prefs.football.defaultView === id ? 'tab is-on' : 'tab'}
                aria-selected={prefs.football.defaultView === id}
                onKeyDown={keepKey}
                onClick={() => setDefaultView(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="tab" onKeyDown={keepKey} onClick={resetFootballDefaults}>
            Reset football preferences
          </button>
        </div>
      ) : section === 'leagues' ? (
        <div className="info-leagues">
          <div className="info-weather-search-row">
            <button type="button" className={showAllLeagues ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={() => setShowAllLeagues((value) => !value)}>
              {showAllLeagues ? 'Primary list' : 'All leagues'}
            </button>
            {prefs.football.hiddenCompetitionIds.length ? (
              <button type="button" className="tab" onKeyDown={keepKey} onClick={restoreHidden}>
                Restore hidden
              </button>
            ) : null}
          </div>
          {!leagueRegion ? (
            <ul className="info-list">
              {regionGroups.map((group) => (
                <li key={group.region} className="info-item">
                  <button type="button" className="info-item-title" onKeyDown={keepKey} onClick={() => setLeagueRegion(group.region)}>
                    {group.region}
                  </button>
                  <span className="info-item-meta">{group.competitions.length} competitions</span>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <button type="button" className="tab" onKeyDown={keepKey} onClick={() => setLeagueRegion(null)}>
                ← Regions
              </button>
              <p className="info-item-meta">{leagueRegion}</p>
              <ul className="info-list">
                {(regionGroups.find((group) => group.region === leagueRegion)?.competitions ?? []).map((entry) => {
                  const inSnapshot = availableCodes.has(entry.code)
                  const fav = prefs.football.favouriteCompetitionIds.includes(entry.code)
                  const unavailable = competitionUnavailable(snapshot, entry.code)
                  return (
                    <li key={entry.code} className="info-item">
                      <button
                        type="button"
                        className={competitionId === entry.code ? 'info-item-title is-active' : 'info-item-title'}
                        onKeyDown={keepKey}
                        onClick={() => {
                          selectCompetition(entry.code)
                          setSection(isKnockoutCompetition(entry.code) ? 'matches' : 'tables')
                        }}
                      >
                        {entry.name}
                      </button>
                      <span className="info-item-meta">
                        {entry.area} · {entry.format}
                        {inSnapshot ? '' : ' · not in current snapshot'}
                        {unavailable || (entry.code === 'EL1' && !inSnapshot)
                          ? ' · unavailable under current API plan'
                          : ''}
                      </span>
                      <div className="info-weather-search-row">
                        <button type="button" className="tab" onKeyDown={keepKey} onClick={() => toggleFavouriteLeague(entry.code)}>
                          {fav ? 'Unfavourite' : 'Favourite'}
                        </button>
                        <button type="button" className="tab" onKeyDown={keepKey} onClick={() => moveLeague(entry.code, -1)}>
                          Up
                        </button>
                        <button type="button" className="tab" onKeyDown={keepKey} onClick={() => moveLeague(entry.code, 1)}>
                          Down
                        </button>
                        <button
                          type="button"
                          className="tab"
                          onKeyDown={keepKey}
                          onClick={() =>
                            persist({ ...prefs, football: { ...prefs.football, defaultCompetitionId: entry.code, defaultView: 'default-league' } })
                          }
                        >
                          Default
                        </button>
                        <button type="button" className="tab" onKeyDown={keepKey} onClick={() => hideLeague(entry.code)}>
                          Hide
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      ) : section === 'tables' ? (
        knockout ? (
          <p className="options-note">
            {competitionName(competitionId)} is a knockout competition. No league table is shown — use Matches.
          </p>
        ) : tables.length === 0 ? (
          <p className="options-note">
            {competitionUnavailable(snapshot, competitionId)
              ? `COMPETITION NOT INCLUDED IN CURRENT API PLAN — ${competitionName(competitionId)}.`
              : `No league table for ${competitionName(competitionId)}${
                  availableCodes.has(competitionId) ? '' : ' · competition not present in the published snapshot'
                }.`}
          </p>
        ) : (
          tables.map((table) => (
            <div key={`${table.competitionId}-${table.type}`}>
              <p className="info-panel-meta info-competition-heading">{competitionName(table.competitionId)}</p>
              <table className="info-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Club</th>
                    <th className="num">P</th>
                    <th className="num">W</th>
                    <th className="num">D</th>
                    <th className="num">L</th>
                    <th className="num">GF</th>
                    <th className="num">GA</th>
                    <th className="num">GD</th>
                    <th className="num">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => (
                    <tr key={`${table.competitionId}-${row.position}-${row.teamId ?? row.team}`}>
                      <td className="num">{row.position}</td>
                      <td>{row.team}</td>
                      <td className="num">{row.played}</td>
                      <td className="num">{row.won}</td>
                      <td className="num">{row.drawn}</td>
                      <td className="num">{row.lost}</td>
                      <td className="num">{row.goalsFor}</td>
                      <td className="num">{row.goalsAgainst}</td>
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
        <div className="info-matches">
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
            <button type="button" className={selectedDayIso === today ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={goToday}>
              Today
            </button>
            <button
              type="button"
              className="tab"
              disabled={nextMatchDay === null}
              title={nextMatchDay ? `Next matches · ${formatSelectedDayLabel(nextMatchDay)}` : 'No later matches in the published snapshot'}
              onKeyDown={keepKey}
              onClick={() => {
                if (nextMatchDay) setSelectedDayIso(nextMatchDay)
              }}
            >
              Next matches
            </button>
            <DayCalendar selectedDayIso={selectedDayIso} onSelect={setSelectedDayIso} daysWithData={dataDays} />
          </div>
          {competitionId !== 'all' && competitionUnavailable(snapshot, competitionId) ? (
            <p className="options-note" role="status" data-empty-kind="competition-unavailable">
              COMPETITION NOT INCLUDED IN CURRENT API PLAN — {competitionName(competitionId)}
              {competitionId === 'EL1'
                ? ' (League One) is not on the football-data.org plan, and the daily public scoreboard did not return fixtures.'
                : ' is unavailable under the current football-data.org entitlement.'}
            </p>
          ) : dayMatches.length === 0 ? (
            <p className="options-note" role="status" data-empty-kind={emptyMatches.kind}>
              {emptyMatches.message}
            </p>
          ) : (
            <ul className="info-list">
              {dayMatches.map((match) => (
                <MatchRow
                  key={match.id}
                  match={match}
                  competition={competitionName(match.competitionId)}
                  liveReliable={snapshot.liveReliable}
                  showDate={kickoffLocalDayIso(match.kickoffIso) !== selectedDayIso}
                />
              ))}
            </ul>
          )}
        </div>
      )}
      {snapshot.errors?.length ? (
        <p className="info-panel-meta is-stale">
          {snapshot.errors.length} update {snapshot.errors.length === 1 ? 'warning' : 'warnings'}
        </p>
      ) : null}
    </div>
  )
}

export const FOOTBALL_SECTIONS = SECTIONS
