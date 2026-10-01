export type ContentKind = 'real' | 'seed' | 'holding'

export interface ContentIntegrityInput {
  displayedTitle: string
  scheduleTitle: string
  mediaId: string | null
  scheduleMediaId: string | null
  expectedVideoId: string | null
  actualVideoId: string | null
  contentKind: ContentKind
}

export interface ContentIntegrity {
  ok: boolean
  reasons: string[]
}

/**
 * The title on screen, the schedule child, and the player must be one programme.
 * A holding card has no video underneath it. A real programme plays its own id.
 */
export function contentIntegrity(input: ContentIntegrityInput): ContentIntegrity {
  const reasons: string[] = []
  if (input.displayedTitle !== input.scheduleTitle) {
    reasons.push('displayed title does not match the schedule child')
  }
  if (input.mediaId !== input.scheduleMediaId) {
    reasons.push('media id does not match the schedule child')
  }
  if (input.contentKind === 'holding') {
    if (input.expectedVideoId) reasons.push('holding card still names a video')
    if (input.actualVideoId) reasons.push('holding card has a video playing underneath')
  }
  if (input.contentKind === 'real') {
    if (!input.expectedVideoId) reasons.push('real programme has no video id')
    else if (input.actualVideoId !== input.expectedVideoId) {
      reasons.push('player video id does not match the schedule child')
    }
  }
  return { ok: reasons.length === 0, reasons }
}
