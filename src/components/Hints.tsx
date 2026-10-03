import { useTv } from '../state/tv-context.ts'

export function Hints() {
  const { hintsOn, guideOpen } = useTv()
  if (!hintsOn || guideOpen) return null

  return (
    <p className="hints">
      ↑↓ Channel · G Guide · I Info · 0–9 Tune · ⌫ Last · , . Prev/Next · M Mute · / Multi · A Add · R Random · T Surf · − = Guide zoom · Home now
    </p>
  )
}
