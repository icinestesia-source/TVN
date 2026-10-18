import { useCallback, useState } from 'react'
import { fetchCricketScoreboard, fetchNbaScoreboard, fetchNflScoreboard, fetchNhlScoreboard } from '../../info/sports/scoreboard.ts'
import { keepKey } from '../keep-key.ts'
import { FootballPanel } from './FootballPanel.tsx'
import { ScoreboardPanel } from './ScoreboardPanel.tsx'

type Sport = 'football' | 'nfl' | 'nba' | 'nhl' | 'cricket'

const SPORTS: { id: Sport; label: string }[] = [
  { id: 'football', label: 'Football' },
  { id: 'nfl', label: 'NFL' },
  { id: 'nba', label: 'NBA' },
  { id: 'nhl', label: 'NHL' },
  { id: 'cricket', label: 'Cricket' },
]

/**
 * INFO → Sports. Football stays on the published snapshot, with League One filled from ESPN
 * when that snapshot has none. The other tabs read ESPN's public scoreboards directly.
 */
export function SportsPanel() {
  const [sport, setSport] = useState<Sport>('football')
  const loadNfl = useCallback(() => fetchNflScoreboard(), [])
  const loadNba = useCallback(() => fetchNbaScoreboard(), [])
  const loadNhl = useCallback(() => fetchNhlScoreboard(), [])
  const loadCricket = useCallback(() => fetchCricketScoreboard(), [])
  return (
    <div className="info-panel">
      <div className="tabs" role="tablist" aria-label="Sports">
        {SPORTS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={sport === entry.id}
            className={sport === entry.id ? 'tab is-on' : 'tab'}
            onKeyDown={keepKey}
            onClick={() => setSport(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {sport === 'football' ? <FootballPanel /> : null}
      {sport === 'nfl' ? <ScoreboardPanel label="NFL" load={loadNfl} /> : null}
      {sport === 'nba' ? <ScoreboardPanel label="NBA" load={loadNba} /> : null}
      {sport === 'nhl' ? <ScoreboardPanel label="NHL" load={loadNhl} /> : null}
      {sport === 'cricket' ? <ScoreboardPanel label="Cricket" load={loadCricket} /> : null}
    </div>
  )
}
