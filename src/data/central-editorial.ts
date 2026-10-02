import { cleanEditorial, type ChannelEditorial } from '../services/channel-curation.ts'
import central from './central-sources.json'

const channels: Record<string, { editorial?: unknown }> = central.channels

/** The editorial notes TVN ships with a centrally defined channel, if it has any. */
export function shippedEditorial(channelNumber: number): ChannelEditorial | undefined {
  return cleanEditorial(channels[String(channelNumber)]?.editorial)
}

/** Whether the notes are exactly what TVN ships, so keeping them needs no override. */
export function isShippedEditorial(channelNumber: number, notes: ChannelEditorial | undefined): boolean {
  const shipped = shippedEditorial(channelNumber)
  return Boolean(shipped && notes && JSON.stringify(shipped) === JSON.stringify(cleanEditorial(notes)))
}
