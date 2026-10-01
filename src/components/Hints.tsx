import { useTv } from '../state/tv-context.ts'

export function Hints() {
  const { hintsOn, guideOpen } = useTv()
  if (!hintsOn || guideOpen) return null

  return (
    <p className="hints">
      ↑↓ Channel · G Guide · I Info · 0–9 Tune · ⌫ Last · R Random · T Surf · B/N Prev/Next · Home now
    </p>
  )
}
