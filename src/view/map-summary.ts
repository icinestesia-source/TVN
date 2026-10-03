import type { ViewingGuide } from '../services/viewing-guides.ts'

function minutes(seconds: number): string {
  const total = Math.max(1, Math.round(seconds / 60))
  return total >= 60 ? `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m` : `${total}m`
}

/** A Map in one line: how long it runs and how many programmes it holds. */
export function mapSummary(guide: Pick<ViewingGuide, 'items'>): string {
  const seconds = guide.items.reduce((total, item) => total + (item.programme.durationSeconds || 0), 0)
  const count = guide.items.length
  return `${count === 0 ? 'Empty' : minutes(seconds)} · ${count} ${count === 1 ? 'programme' : 'programmes'}`
}

/** Where a Map's programmes come from: its channel sources, or else the channels its programmes are on. */
export function mapSources(guide: Pick<ViewingGuide, 'items' | 'sources'>): string {
  const names = guide.sources?.length
    ? guide.sources.map((source) => source.channelName)
    : guide.items.map((item) => item.channelName).filter((name, index, all) => all.indexOf(name) === index)
  if (names.length === 0) return ''
  return names.length > 3 ? `${names.slice(0, 3).join(' · ')} · +${names.length - 3}` : names.join(' · ')
}

