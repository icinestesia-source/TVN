import type { SourceRegister } from '../credits/provenance.ts'
import { shippedChannel, shippedProgrammes } from '../data/catalogue.ts'
import { mediaLibrary } from '../director/library.ts'
import { getChannelMedia } from '../library/query.ts'
import { eligibleOf } from '../services/channel-curation.ts'
import type { ChannelSource } from '../services/channel-sources.ts'
import { contributionOf, originalChannelSource, originalSourcesOf, poolEntryOf, UNSOURCED_REF, type Contribution, type OriginalOverride, type OriginalSource } from '../services/original-sources.ts'

/**
 * A TVN channel's original sources, from the library TVN schedules it from. A channel TVN ships with fixed
 * programmes of its own (they carry their media) is arranged by those programmes instead, and has none here.
 */
export function channelOriginals(number: number, register?: SourceRegister): OriginalSource[] {
  const shipped = shippedChannel(number)
  if (!shipped || shippedProgrammes(shipped.id).some((programme) => programme.videoId !== null)) return []
  return originalSourcesOf(getChannelMedia(mediaLibrary(), number).map(poolEntryOf), register)
}

/** "8h 32m", "45m": a contribution's running time at a glance. */
export function hoursMinutes(seconds: number): string {
  const minutes = Math.round(Math.max(0, seconds) / 60)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`
}

/** A source's part of the channel as a whole percentage of its running time; under 1% shows as "<1%". */
export function shareText(part: number, total: number): string {
  if (total <= 0 || part <= 0) return '0%'
  const share = Math.round((part / total) * 100)
  return share < 1 ? '<1%' : `${share}%`
}

/** "47 programmes · 8h 32m · 62%" */
export function contributionText(contribution: Contribution, total: number): string {
  const count = `${contribution.programmes} programme${contribution.programmes === 1 ? '' : 's'}`
  return `${count} · ${hoursMinutes(contribution.seconds)} · ${shareText(contribution.seconds, total)}`
}

export interface SourcedContribution extends Contribution {
  source: OriginalSource
  override?: OriginalOverride
}

/** Each original source's contribution to the channel as edited, and the total they make together. */
export function contributionsOf(originals: readonly OriginalSource[], overrides: readonly OriginalOverride[] | undefined): { rows: SourcedContribution[]; total: number } {
  const rows = originals.map((source) => {
    const override = overrides?.find((item) => item.ref === source.ref)
    return { source, override, ...contributionOf(source, override) }
  })
  return { rows, total: rows.reduce((sum, row) => sum + row.seconds, 0) }
}

/** The short name a running-order row shows for the source that supplied it. */
export function shortSourceName(source: Pick<OriginalSource, 'ref' | 'name'>): string {
  return source.ref === UNSOURCED_REF ? 'TVN catalogue' : source.name.replace(/ · not in the source register$/, '')
}

export interface LabelledVideo {
  id: string
  title: string
  durationSec: number
  /** The source that supplied it, briefly. */
  from: string
}

/** TVN's programmes from the original sources still switched on, through their filters, each labelled with its source. */
export function originalLineup(originals: readonly OriginalSource[], overrides: readonly OriginalOverride[] | undefined): LabelledVideo[] {
  return originals.flatMap((source) => {
    const made = originalChannelSource(
      source,
      overrides?.find((item) => item.ref === source.ref),
    )
    if (!made.enabled) return []
    const from = shortSourceName(source)
    return eligibleOf(made).map((video) => ({ id: video.id, title: video.title, durationSec: video.durationSec, from }))
  })
}

/** Which added source holds each programme, the first that lists it. */
export function addedSourceLabels(sources: readonly ChannelSource[], title: (source: ChannelSource) => string): Map<string, string> {
  const labels = new Map<string, string>()
  for (const source of sources) {
    if (source.kind === 'tvn') continue
    for (const video of source.videos ?? []) if (!labels.has(video.id)) labels.set(video.id, title(source))
  }
  return labels
}
