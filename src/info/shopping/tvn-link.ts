import { channelByNumber, listChannels } from '../../data/catalogue.ts'
import type { Retailer } from './types.ts'

export interface ShoppingTvLink {
  channelNumber: number
  channelName: string
}

/**
 * Only when a configured channel number exists, is enabled, and is not an empty slot.
 * Does not create channels or invent shopping networks.
 */
export function shoppingTvLink(retailer: Pick<Retailer, 'channelNumber'>): ShoppingTvLink | null {
  const number = retailer.channelNumber
  if (typeof number !== 'number' || !Number.isFinite(number)) return null
  const channel = channelByNumber(number) ?? listChannels().find((entry) => entry.number === number)
  if (!channel || !channel.enabled || channel.emptySlot) return null
  return { channelNumber: channel.number, channelName: channel.name }
}
