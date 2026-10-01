import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'

let userChannels: readonly Channel[] = []
let userProgrammes = new Map<string, readonly Programme[]>()
const listeners = new Set<() => void>()

/** Replace the imported channel layer. Default channels are never stored here. */
export function installUserCatalogue(
  channels: readonly Channel[],
  programmes: ReadonlyMap<string, readonly Programme[]>,
): void {
  userChannels = channels
  userProgrammes = new Map(programmes)
  for (const listener of listeners) listener()
}

let curatedChannels: readonly Channel[] = []
let curatedProgrammes = new Map<string, readonly Programme[]>()

/** Replace the viewer's changes to curated channels, laid over the shipped ones in this browser only. */
export function installCuratedEdits(
  channels: readonly Channel[],
  programmes: ReadonlyMap<string, readonly Programme[]>,
): void {
  curatedChannels = channels
  curatedProgrammes = new Map(programmes)
  for (const listener of listeners) listener()
}

export function curatedEditList(): readonly Channel[] {
  return curatedChannels
}

export function curatedProgrammesFor(channelId: string): readonly Programme[] | undefined {
  return curatedProgrammes.get(channelId)
}

export function subscribeCatalogue(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function userChannelList(): readonly Channel[] {
  return userChannels
}

export function userProgrammesFor(channelId: string): readonly Programme[] | undefined {
  return userProgrammes.get(channelId)
}
