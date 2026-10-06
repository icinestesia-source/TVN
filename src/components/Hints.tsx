import { useTv } from '../state/tv-context.ts'

export function Hints() {
  const { hintsOn, guideOpen } = useTv()
  if (!hintsOn || guideOpen) return null

  return (
    <p className="hints">
      ↑↓ Channel · G Guide · I Info · 0–9 Tune · ⌫ Last · , . Prev/Next · Space Surf (hold: ALL / network) · P Pause · S Favourite · M Mute · / Multi · A Add · R All / User / Fav · T Cycle · − = Guide zoom · Home now
    </p>
  )
}
