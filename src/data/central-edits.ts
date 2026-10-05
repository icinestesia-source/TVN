/**
 * Central channels TVN ships as made from public podcast feeds, laid over the shipped network as a default edit
 * (src/services/curated-edits.ts): the viewer's own edit of the same channel always comes first. Built by hand
 * with `node scripts/central-edits.ts <number>`, which reads each feed on the curator's machine; the site never
 * reads them to build the channel, so a publisher that turns servers away still airs here.
 */
import type { ChannelSource, OrderKind } from '../services/channel-sources.ts'
import type { CuratedEdit } from '../services/curated-edits.ts'
import { shippedBaseline, tvnSource } from '../services/curated-edits.ts'

export const CENTRAL_EDITS_FORMAT = 'tvn-central-edits-v1'

export interface CentralChannelEdit {
  name: string
  description?: string
  sources: ChannelSource[]
  order?: string[]
  orderKind?: OrderKind
  savedAt: number
}

export interface CentralEdits {
  format: typeof CENTRAL_EDITS_FORMAT
  channels: Record<string, CentralChannelEdit>
}

let installed: Record<string, CuratedEdit> = {}

/** The shipped default edits, as curated edits of their channels; TVN's own programming is switched off on each. */
export function centralEditsFrom(doc: unknown): Record<string, CuratedEdit> {
  const value = doc as Partial<CentralEdits> | null
  if (!value || value.format !== CENTRAL_EDITS_FORMAT || !value.channels || typeof value.channels !== 'object') return {}
  const out: Record<string, CuratedEdit> = {}
  for (const [key, channel] of Object.entries(value.channels)) {
    const channelNumber = Number(key)
    if (!Number.isInteger(channelNumber) || channelNumber < 1 || channelNumber > 999 || !Array.isArray(channel.sources)) continue
    const sources = channel.sources.filter((source) => source.kind !== 'tvn')
    if (!sources.some((source) => source.enabled && (source.videos?.length ?? 0) > 0)) continue
    out[key] = {
      channelNumber,
      name: channel.name,
      ...(channel.description ? { description: channel.description } : {}),
      sources: [tvnSource(false), ...sources],
      ...(channel.order?.length ? { order: [...channel.order], orderKind: channel.orderKind ?? 'random' } : {}),
      savedAt: channel.savedAt,
      baseline: shippedBaseline({ name: channel.name }, []),
    }
  }
  return out
}

export function installCentralEdits(doc: unknown): void {
  installed = centralEditsFrom(doc)
}

/** The shipped default edit of a channel, if TVN ships one. */
export function centralEdit(channelNumber: number): CuratedEdit | null {
  return installed[String(channelNumber)] ?? null
}

/** The viewer's own edits over TVN's shipped default edits: a channel the viewer has edited keeps theirs. */
export function withCentralEdits(viewer: Readonly<Record<string, CuratedEdit>>): Record<string, CuratedEdit> {
  return { ...installed, ...viewer }
}
