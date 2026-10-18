import { useState } from 'react'
import { FootballPanel } from './FootballPanel.tsx'
import { keepKey } from '../keep-key.ts'

type Sport = 'football'

/**
 * INFO → Sports. Football is the first sport; others can join as sibling tabs later.
 */
export function SportsPanel() {
  const [sport, setSport] = useState<Sport>('football')
  return (
    <div className="info-panel">
      <div className="tabs" role="tablist" aria-label="Sports">
        <button type="button" role="tab" aria-selected={sport === 'football'} className={sport === 'football' ? 'tab is-on' : 'tab'} onKeyDown={keepKey} onClick={() => setSport('football')}>
          Football
        </button>
      </div>
      {sport === 'football' ? <FootballPanel /> : null}
    </div>
  )
}
