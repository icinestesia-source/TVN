import { isSessionProgramme } from '../session/session-channel.ts'
import type { TvContextValue } from '../state/tv-context.ts'
import type { TvCommand } from '../types/input.ts'
import type { Programme } from '../types/programme.ts'
import { openRandomSettings } from './tvn-settings-store.ts'

/** The actions that may sit in the corners of the information overlay's control pad. */
export type ShortcutId = 'remote' | 'settings' | 'random' | 'fullscreen' | 'captions'

export type Corner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'

/** One action per corner, never the same action twice. */
export type ShortcutAssignment = Record<Corner, ShortcutId>

export const SHORTCUT_IDS: readonly ShortcutId[] = ['remote', 'fullscreen', 'settings', 'random', 'captions']

export const CORNERS: readonly Corner[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']

export const CORNER_LABELS: Record<Corner, string> = {
  topLeft: 'Top left',
  topRight: 'Top right',
  bottomLeft: 'Bottom left',
  bottomRight: 'Bottom right',
}

export const DEFAULT_SHORTCUTS: ShortcutAssignment = {
  topLeft: 'remote',
  topRight: 'fullscreen',
  bottomLeft: 'settings',
  bottomRight: 'random',
}

/** What a corner needs to know about the programme on screen and the television. */
export interface ShortcutContext {
  /** The programme plays through a player whose captions TVN can switch. */
  captionsAvailable: boolean
  fullscreenAvailable: boolean
  subtitles: boolean
  remoteOpen: boolean
  surfing: boolean
  /** Opens the Random settings: the Random Cycle's timing. */
  openRandomSettings: () => void
  dispatch: (command: TvCommand) => void
}

interface ShortcutBase {
  id: ShortcutId
  /** The short mark shown in the corner. */
  label: string
  /** The accessible name, also the choice in Settings. */
  name: string
  available: (context: ShortcutContext) => boolean
  /** Shown when the action cannot be used for this programme or on this device. */
  unavailable: string
  /** The tooltip, when it says more than the name. */
  title?: string
}

/** A corner runs a television command. */
export interface ShortcutDefinition extends ShortcutBase {
  run: (context: ShortcutContext) => void
  pressed?: (context: ShortcutContext) => boolean
  /** A long press, by touch or mouse. */
  hold?: (context: ShortcutContext) => void
  /** A right-click. Touch has none: the same options are in Settings. */
  menu?: (context: ShortcutContext) => void
}

export const SHORTCUTS: Record<ShortcutId, ShortcutDefinition> = {
  remote: {
    id: 'remote',
    label: 'Remote',
    name: 'Remote control',
    unavailable: 'The remote is not available',
    available: () => true,
    run: (context) => context.dispatch({ type: 'remote' }),
    pressed: (context) => context.remoteOpen,
  },
  settings: {
    id: 'settings',
    label: '⚙',
    name: 'Settings',
    unavailable: 'Settings are not available',
    available: () => true,
    run: (context) => context.dispatch({ type: 'guide-tool', tool: 'options' }),
  },
  fullscreen: {
    id: 'fullscreen',
    label: '⛶',
    name: 'Fullscreen',
    unavailable: 'Fullscreen is not available in this browser',
    available: (context) => context.fullscreenAvailable,
    run: (context) => context.dispatch({ type: 'fullscreen' }),
  },
  captions: {
    id: 'captions',
    label: 'CC',
    name: 'Subtitles/captions',
    unavailable: 'Subtitles are not available for this programme',
    available: (context) => context.captionsAvailable,
    run: (context) => context.dispatch({ type: 'subtitles' }),
    pressed: (context) => context.subtitles,
  },
  random: {
    id: 'random',
    label: 'TVN',
    name: 'Random channel',
    title: 'Random channel · hold to start or stop Random Cycle · right-click for Random settings',
    unavailable: 'Random channel is not available',
    available: () => true,
    run: (context) => context.dispatch({ type: 'random-channel' }),
    // Lit while the Random Cycle runs.
    pressed: (context) => context.surfing,
    hold: (context) => context.dispatch({ type: 'surf' }),
    menu: (context) => context.openRandomSettings(),
  },
}

/** What the control pad over the picture takes from the television for its corners. */
export type CornerActions = {
  assignment: ShortcutAssignment
  subtitles: boolean
  remoteOpen: boolean
  surfing: boolean
  openRandomSettings: () => void
  dispatch: (command: TvCommand) => void
}

export function cornerActions(
  tv: Pick<TvContextValue, 'infoShortcuts' | 'subtitles' | 'remoteOpen' | 'surfing' | 'dispatch'>,
): CornerActions {
  return {
    assignment: tv.infoShortcuts,
    subtitles: tv.subtitles,
    remoteOpen: tv.remoteOpen,
    surfing: tv.surfing,
    // The Random settings take the remote's place.
    openRandomSettings: () => {
      if (tv.remoteOpen) tv.dispatch({ type: 'remote' })
      openRandomSettings()
    },
    dispatch: tv.dispatch,
  }
}

/** CH+ and CH− along the channel numbers, beside ↑ and ↓ through the watched channels. */
export type ChannelActions = { onUp: () => void; onDown: () => void }

export function channelActions(tv: Pick<TvContextValue, 'dispatch'>): ChannelActions {
  return {
    onUp: () => tv.dispatch({ type: 'channel-up' }),
    onDown: () => tv.dispatch({ type: 'channel-down' }),
  }
}

/**
 * Puts an action in a corner. An action already in another corner swaps places with the one it displaces;
 * an action not yet on the pad simply replaces it.
 */
export function assignShortcut(current: ShortcutAssignment, corner: Corner, id: ShortcutId): ShortcutAssignment {
  const from = CORNERS.find((other) => current[other] === id)
  const next = { ...current, [corner]: id }
  if (from && from !== corner) next[from] = current[corner]
  return next
}

/** A stored assignment, kept only when every corner holds a known action and no action is repeated. */
export function asShortcuts(value: unknown): ShortcutAssignment {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SHORTCUTS }
  const record = value as Partial<Record<Corner, unknown>>
  const stored = CORNERS.map((corner) => record[corner])
  // TVN (Random surf) became Settings when Random moved onto R.
  const renamed = stored.map((id) => (id === 'tvn' ? 'settings' : id))
  // The original-source corner moved to the Channel Editor's programme lists; its corner takes the free action.
  const free = SHORTCUT_IDS.find((id) => !renamed.includes(id))
  const picked = renamed.map((id) => (id === 'source' ? free : id))
  const valid = picked.every((id) => SHORTCUT_IDS.includes(id as ShortcutId)) && new Set(picked).size === CORNERS.length
  if (!valid) return { ...DEFAULT_SHORTCUTS }
  return Object.fromEntries(CORNERS.map((corner, index) => [corner, picked[index]])) as ShortcutAssignment
}

/** Captions are switched in the YouTube player; local files, direct streams and radio carry none TVN can switch. */
export function captionsAvailable(programme: Pick<Programme, 'videoId' | 'liveStream' | 'sourceRef'>): boolean {
  return programme.videoId !== null && programme.liveStream === undefined && !isSessionProgramme(programme)
}

/** The page can be put into fullscreen (iPhone Safari, for one, cannot). */
export function fullscreenAvailable(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): boolean {
  if (!doc) return false
  return doc.fullscreenEnabled === true && typeof doc.documentElement?.requestFullscreen === 'function'
}
