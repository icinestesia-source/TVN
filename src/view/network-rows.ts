import { isOnAir } from '../network/airing.ts'
import type { StoredSource } from '../services/channels-import.ts'
import { isOwnNumber } from '../data/network.ts'
import { TVN_CHANNEL_NUMBER } from '../tvn/tvn-channel.ts'
import type { Channel } from '../types/channel.ts'

/** A stored User Network channel with nothing to schedule yet: its source address has not been read. */
export type Unloaded = Channel & { unloaded: true }

export const unloaded = (channel: Channel): channel is Unloaded => (channel as Partial<Unloaded>).unloaded === true

/** The row for a stored channel the network does not list yet: kept in the editor, which edits what is stored. */
function unloadedRow(source: StoredSource, users: ReadonlySet<string>): Unloaded {
  const number = source.channelNumber as number
  return {
    id: `user-${source.id}`,
    number,
    name: source.name,
    shortName: '',
    description: '',
    logo: '',
    color: '',
    category: 'User',
    categoryId: 'user',
    enabled: true,
    origin: 'user-import',
    mediaKind: 'video',
    sources: [],
    scheduleMode: 'loop',
    phaseOffsetSeconds: 0,
    ...(source.owner && users.has(source.owner) ? { owner: source.owner } : {}),
    unloaded: true,
  }
}

/** Every channel the network holds: those it lists, and stored User channels it cannot list yet, in number order. */
export function networkRows(listed: readonly Channel[], stored: readonly StoredSource[], users: ReadonlySet<string>): Channel[] {
  const numbers = new Set(listed.map((channel) => channel.number))
  const pending = stored.filter((source) => isOwnNumber(source.channelNumber) && !numbers.has(source.channelNumber)).map((source) => unloadedRow(source, users))
  return pending.length ? [...listed, ...pending].sort((a, b) => a.number - b.number) : [...listed]
}

export function networkStatus(channel: Channel): string {
  if (channel.number === TVN_CHANNEL_NUMBER) return 'Surfing'
  if (unloaded(channel)) return 'Source not loaded'
  if (channel.emptySlot) return 'Empty'
  if (!channel.enabled) return 'Disabled'
  if (channel.origin === 'session') return 'This device'
  return isOnAir(channel) ? 'On air' : 'Off air'
}
