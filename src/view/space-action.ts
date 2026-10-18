import type { TvCommand } from '../types/input.ts'

/** What a short press of Space does over the picture. Surf remains the default. */
export type SpaceAction = 'surf' | 'next' | 'previous' | 'guide' | 'pause' | 'favourite' | 'info' | 'infocentre' | 'mute'

export const SPACE_ACTIONS: readonly { id: SpaceAction; label: string }[] = [
  { id: 'surf', label: 'Surf to another channel' },
  { id: 'next', label: 'Next channel' },
  { id: 'previous', label: 'Previous channel' },
  { id: 'guide', label: 'Open the Guide' },
  { id: 'pause', label: 'Pause' },
  { id: 'favourite', label: 'Make the channel a favourite' },
  { id: 'info', label: 'Picture information' },
  { id: 'infocentre', label: 'Info' },
  { id: 'mute', label: 'Mute' },
]

export function asSpaceAction(value: unknown): SpaceAction {
  return SPACE_ACTIONS.some((action) => action.id === value) ? (value as SpaceAction) : 'surf'
}

export function commandForSpace(action: SpaceAction): TvCommand {
  switch (action) {
    case 'next':
      return { type: 'channel-up' }
    case 'previous':
      return { type: 'channel-down' }
    case 'guide':
      return { type: 'guide' }
    case 'pause':
      return { type: 'play-pause' }
    case 'favourite':
      return { type: 'favourite' }
    case 'info':
      return { type: 'info' }
    case 'infocentre':
      return { type: 'guide-tool', tool: 'infocentre' }
    case 'mute':
      return { type: 'mute' }
    default:
      return { type: 'random-channel' }
  }
}
