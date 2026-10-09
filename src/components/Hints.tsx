import { useTv } from '../state/tv-context.ts'

export function Hints() {
  const { hintsOn, guideOpen } = useTv()
  if (!hintsOn || guideOpen) return null

  return (
    <p className="hints">
      ↑↓ Channel · G Guide · V Info · 0–9 Tune · ⌫ Last · B N Prev/Next · , . Programme · Space Surf (hold: ALL / network) · P Pause · A Favourite · D Bookmark · S Subtitles · M Mute · / Multi · I Add · U Media · C All / User / Fav · R Refresh · X Reload · L Latest · Z A to Z · E Export ALL · O Options · T Cycle · − = Guide zoom · Home now
    </p>
  )
}
