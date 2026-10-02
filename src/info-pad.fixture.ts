import { historyActions } from './components/InfoActions.tsx'
import type { TvCommand } from './types/input.ts'
import { channelActions, DEFAULT_SHORTCUTS, type CornerActions, type ShortcutAssignment } from './view/info-shortcuts.ts'

/** The props the information pad takes from the television, for tests; commands land in `sent`. */
export function padProps({
  canBack = true,
  canForward = true,
  assignment = DEFAULT_SHORTCUTS,
  subtitles = false,
  remoteOpen = false,
  surfing = false,
  multiview = false,
  sent = [] as TvCommand[],
  settings = [] as string[],
}: {
  canBack?: boolean
  canForward?: boolean
  assignment?: ShortcutAssignment
  subtitles?: boolean
  remoteOpen?: boolean
  surfing?: boolean
  multiview?: boolean
  sent?: TvCommand[]
  settings?: string[]
} = {}) {
  const dispatch = (command: TvCommand) => void sent.push(command)
  const corners: CornerActions = {
    assignment,
    subtitles,
    remoteOpen,
    surfing,
    openRandomSettings: () => void settings.push('open'),
    dispatch,
  }
  return {
    history: historyActions({ canGoBack: canBack, canGoForward: canForward, multiviewMode: multiview ? '4' : '1', dispatch }),
    corners,
    channels: channelActions({ dispatch }),
  }
}
