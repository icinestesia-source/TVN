import type { GuideRun } from '../services/viewing-guides.ts'

/**
 * What the information bar says while a viewing Guide is followed: only an active run counts (a suspended
 * one, or the Guide screen merely being open, leaves the ordinary yellow/manual look). Next is the Guide's
 * next item, wrapping when the Guide loops.
 */
export function followingInfo(run: GuideRun | null): { next: { title: string; channelNumber: number } | null } | null {
  if (!run || run.state !== 'active') return null
  const items = run.guide.items
  let at = run.index + 1
  if (at >= items.length) at = run.guide.loop && items.length > 1 ? 0 : -1
  const item = at >= 0 ? items[at] : undefined
  return { next: item ? { title: item.programme.title, channelNumber: item.channelNumber } : null }
}
