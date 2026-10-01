export function VolumeOsd({ volume, muted }: { volume: number; muted: boolean }) {
  const silent = muted || volume === 0
  return (
    <div className="volume" role="status">
      <p>{silent ? 'Mute' : 'Volume'}</p>
      <div className="volume-track" aria-hidden="true">
        <span style={{ width: `${silent ? 0 : volume}%` }} />
      </div>
      <p className="volume-value">{silent ? '—' : volume}</p>
    </div>
  )
}
