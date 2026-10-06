import { VOLUME_BOOST_MAX, VOLUME_FULL } from '../player/volume.ts'

export function VolumeOsd({ volume, muted }: { volume: number; muted: boolean }) {
  const silent = muted || volume === 0
  const boost = !silent && volume > VOLUME_FULL
  return (
    <div className={boost ? 'volume is-boost' : 'volume'} role="status">
      <p>{silent ? 'Mute' : boost ? 'Boost' : 'Volume'}</p>
      <div className="volume-track" aria-hidden="true">
        <span style={{ width: `${silent ? 0 : Math.min(volume, VOLUME_FULL)}%` }} />
        {boost ? <span className="volume-boost" style={{ width: `${((volume - VOLUME_FULL) / (VOLUME_BOOST_MAX - VOLUME_FULL)) * 100}%` }} /> : null}
      </div>
      <p className="volume-value">{silent ? '—' : volume}</p>
    </div>
  )
}
