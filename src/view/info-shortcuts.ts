import { isSessionProgramme } from '../session/session-channel.ts'
import type { TvContextValue } from '../state/tv-context.ts'
import type { TvCommand } from '../types/input.ts'
import type { Programme } from '../types/programme.ts'
import { openTvnSettings } from './tvn-settings-store.ts'

/** The actions that may sit in the corners of the information overlay's control pad. */
export type ShortcutId = 'remote' | 'source' | 'tvn' | 'random' | 'fullscreen' | 'captions'

export type Corner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'

/** One action per corner, never the same action twice. */
export type ShortcutAssignment = Record<Corner, ShortcutId>

export const SHORTCUT_IDS: readonly ShortcutId[] = ['remote', 'source', 'tvn', 'random', 'fullscreen', 'captions']

export const CORNERS: readonly Corner[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']

export const CORNER_LABELS: Record<Corner, string> = {
  topLeft: 'Top left',
  topRight: 'Top right',
  bottomLeft: 'Bottom left',
  bottomRight: 'Bottom right',
}

export const DEFAULT_SHORTCUTS: ShortcutAssignment = {
  topLeft: 'remote',
  topRight: 'source',
  bottomLeft: 'tvn',
  bottomRight: 'random',
}

/** What a corner needs to know about the programme on screen and the television. */
export interface ShortcutContext {
  /** The provider's own address for the programme, when TVN has it on record. */
  original: string | null
  /** The programme plays through a player whose captions TVN can switch. */
  captionsAvailable: boolean
  fullscreenAvailable: boolean
  subtitles: boolean
  remoteOpen: boolean
  surfing: boolean
  /** Opens the TVN settings dialog. */
  openSettings: () => void
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

/** A corner that runs a television command. */
export interface ActionShortcut extends ShortcutBase {
  kind: 'action'
  run: (context: ShortcutContext) => void
  pressed?: (context: ShortcutContext) => boolean
  /** A right-click or a touch hold. */
  hold?: (context: ShortcutContext) => void
}

/** A corner that is a link out of TVN, to an address already on record (never one built here). */
export interface LinkShortcut extends ShortcutBase {
  kind: 'link'
  href: (context: ShortcutContext) => string | null
}

export type ShortcutDefinition = ActionShortcut | LinkShortcut

export const SHORTCUTS: Record<ShortcutId, ShortcutDefinition> = {
  remote: {
    id: 'remote',
    kind: 'action',
    label: 'Remote',
    name: 'Remote control',
    unavailable: 'The remote is not available',
    available: () => true,
    run: (context) => context.dispatch({ type: 'remote' }),
    pressed: (context) => context.remoteOpen,
  },
  tvn: {
    id: 'tvn',
    kind: 'action',
    label: 'TVN',
    name: 'TVN surf',
    title: 'Surf random channels · right-click or hold for TVN settings',
    unavailable: 'TVN surf is not available',
    available: () => true,
    run: (context) => context.dispatch({ type: 'surf' }),
    pressed: (context) => context.surfing,
    hold: (context) => context.openSettings(),
  },
  fullscreen: {
    id: 'fullscreen',
    kind: 'action',
    label: '⛶',
    name: 'Fullscreen',
    unavailable: 'Fullscreen is not available in this browser',
    available: (context) => context.fullscreenAvailable,
    run: (context) => context.dispatch({ type: 'fullscreen' }),
  },
  source: {
    id: 'source',
    kind: 'link',
    label: '↗',
    name: 'Open original source',
    unavailable: 'No original source on record for this programme',
    available: (context) => context.original !== null,
    href: (context) => context.original,
  },
  captions: {
    id: 'captions',
    kind: 'action',
    label: 'CC',
    name: 'Subtitles/captions',
    unavailable: 'Subtitles are not available for this programme',
    available: (context) => context.captionsAvailable,
    run: (context) => context.dispatch({ type: 'subtitles' }),
    pressed: (context) => context.subtitles,
  },
  random: {
    id: 'random',
    kind: 'action',
    label: 'R',
    name: 'Random channel',
    unavailable: 'Random channel is not available',
    available: () => true,
    run: (context) => context.dispatch({ type: 'random-channel' }),
  },
}

/** What the control pad over the picture takes from the television for its corners. */
export type CornerActions = {
  assignment: ShortcutAssignment
  subtitles: boolean
  remoteOpen: boolean
  surfing: boolean
  openSettings: () => void
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
    // The settings take the remote's place, as they did from the TVN button.
    openSettings: () => {
      if (tv.remoteOpen) tv.dispatch({ type: 'remote' })
      openTvnSettings()
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
  const picked = CORNERS.map((corner) => record[corner])
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
