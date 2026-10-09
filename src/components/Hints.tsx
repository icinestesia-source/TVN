import { useTv } from '../state/tv-context.ts'

export function Hints() {
  const { hintsOn, guideOpen } = useTv()
  if (!hintsOn || guideOpen) return null

  return (
    <p className="hints">
      ↑↓ Channel · G Guide · V Info · 0–9 Tune · ⌫ Last · , . Prev/Next · Space Surf (hold: ALL / network) · P Pause · A Favourite · S Subtitles · M Mute · / Multi · U Add · I Media · C All / User / Fav · R Refresh · X Reload · L Latest · Z A to Z · O Export ALL · T Cycle · − = Guide zoom · Home now
    </p>
  )
}
