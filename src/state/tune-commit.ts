/**
 * The last step of a tune. The provider is asked for the channel's airing at once, the static runs its
 * minimum, and then the channel commits: number, name, INFO, Guide and history move together whether or
 * not the player has answered. A slow or silent player (up to its load timeout) never holds the old
 * channel on screen, and a tune the viewer has already left commits nothing.
 */
export interface TuneCommitSteps {
  /** Still the tune the viewer asked for last. */
  current: () => boolean
  /** Asks the provider for the channel's airing; settles when the player answers, whatever it answers. */
  load: () => Promise<unknown>
  /** What is left of the minimum static. */
  holdStatic: () => Promise<void>
  commit: () => void
  /** The viewer moved on before this tune committed. */
  abandon: () => void
  /** The channel committed before its player answered. */
  awaitPicture: (answer: Promise<unknown>) => void
}

export async function commitTune(steps: TuneCommitSteps): Promise<'committed' | 'abandoned'> {
  let answered = false
  const answer = steps
    .load()
    .catch(() => 'error' as const)
    .finally(() => {
      answered = true
    })
  await steps.holdStatic()
  if (!steps.current()) {
    steps.abandon()
    return 'abandoned'
  }
  steps.commit()
  if (!answered) steps.awaitPicture(answer)
  return 'committed'
}

/** Only the latest tune's answer may lift the waiting picture; an earlier channel's late answer cannot. */
export function createPictureWait(set: (waiting: boolean) => void) {
  let latest = 0
  return {
    wait(answer: Promise<unknown>) {
      const mine = ++latest
      set(true)
      void answer.finally(() => {
        if (latest === mine) set(false)
      })
    },
    stop() {
      latest += 1
      set(false)
    },
  }
}
