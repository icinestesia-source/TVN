/**
 * The last step of a tune. The provider is asked for the channel's airing at once, the static runs its
 * minimum, and then the channel commits: number, name, INFO, Guide and history move together whether or
 * not the player has answered. A slow or silent player (up to its load timeout) never holds the old
 * channel on screen, and a tune the viewer has already left commits nothing.
 */
export interface TuneCommitSteps {
  /** Still the tune the viewer asked for last. */
  current: () => boolean
  /** Asks the provider for the channel's airing; the picture follows the player's own state, not this. */
  load: () => Promise<unknown>
  /** What is left of the minimum static. */
  holdStatic: () => Promise<void>
  commit: () => void
  /** The viewer moved on before this tune committed. */
  abandon: () => void
}

export async function commitTune(steps: TuneCommitSteps): Promise<'committed' | 'abandoned'> {
  void steps.load().catch(() => 'error' as const)
  await steps.holdStatic()
  if (!steps.current()) {
    steps.abandon()
    return 'abandoned'
  }
  steps.commit()
  return 'committed'
}
