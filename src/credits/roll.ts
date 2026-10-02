import { DEMO_FILMS } from '../data/media.ts'
import { USER_NUMBER_START } from '../data/network.ts'
import type { MediaItem } from '../director/types.ts'
import { liveCams, liveEndpoint } from '../dynamic/providers.ts'
import { sourcesOf } from '../services/channel-editor.ts'
import { isStreamSource, type ChannelSource } from '../services/channel-sources.ts'
import type { StoredSource } from '../services/channels-import.ts'
import type { Channel } from '../types/channel.ts'
import { padChannel } from '../utils/time.ts'
import {
  channelSourceUrl,
  hostOf,
  LOCAL_SESSION_NOTE,
  sourceIdOf,
  sourceTypeLabel,
  webUrl,
  youtubeChannelUrl,
  type SourceRegister,
} from './provenance.ts'
import { linkLabel } from './source-info.ts'

export interface RollLink {
  label: string
  url: string
}

/** One line of the credit roll. Every line has a fixed height, so the roll can be drawn a screenful at a time. */
export type RollLine =
  | { kind: 'now' }
  | { kind: 'title'; text: string }
  | { kind: 'subtitle'; text: string }
  | { kind: 'channel'; number: string; name: string }
  | { kind: 'source'; name: string; detail: string; links: RollLink[] }
  | { kind: 'note'; text: string }
  | { kind: 'space' }

export const LINE_HEIGHT: Record<RollLine['kind'], number> = {
  now: 520,
  title: 112,
  subtitle: 44,
  channel: 92,
  source: 64,
  note: 40,
  space: 56,
}

export interface RollInput {
  /** Every channel listed in this TVN, shipped and the viewer's own. */
  channels: readonly Channel[]
  /** A shipped channel's own programming, as the director draws it (getChannelMedia). */
  poolOf: (channelNumber: number) => readonly MediaItem[]
  register: SourceRegister
  stored: readonly StoredSource[]
  curated: Readonly<Record<string, { name: string; sources: readonly ChannelSource[] }>>
}

export interface Roll {
  lines: RollLine[]
  /** Offset of each line from the top, plus the total height as the last entry. */
  offsets: number[]
  totals: { channels: number; sources: number; programmes: number; cams: number }
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`
}

function registerLinks(sourceId: string | undefined, register: SourceRegister): RollLink[] {
  const entry = sourceId ? register.sources[sourceId] : undefined
  const links: RollLink[] = []
  const channel = webUrl(entry?.channelUrl)
  const website = webUrl(entry?.website)
  if (channel) links.push({ label: 'YouTube channel', url: channel })
  if (website) links.push({ label: 'Website', url: website })
  return links
}

/** A viewer's source: what it is, where it lives, and the public details the viewer typed in for it. */
function viewerSourceLines(source: ChannelSource): RollLine[] {
  const stream = isStreamSource(source)
  const count = source.videos?.length ?? 0
  const name = source.label || (source.url ? hostOf(source.url) : 'Untitled source')
  const detail = [sourceTypeLabel(source), stream ? 'live stream' : plural(count, 'programme'), source.enabled ? '' : 'disabled'].filter(Boolean).join(' · ')
  const links: RollLink[] = []
  const home = channelSourceUrl(source)
  if (home) links.push({ label: source.kind === 'youtube' ? 'YouTube' : stream ? 'Stream' : 'Source', url: home })
  const info = source.info
  if (info?.website) links.push({ label: 'Website', url: info.website })
  for (const link of info?.links ?? []) links.push({ label: linkLabel(link), url: link })
  if (info?.contactPage) links.push({ label: 'Contact page', url: info.contactPage })
  const lines: RollLine[] = [{ kind: 'source', name, detail, links }]
  const contact = [info?.email, info?.phone].filter(Boolean).join(' · ')
  if (contact) lines.push({ kind: 'note', text: `Public contact · ${contact}` })
  return lines
}

/**
 * The whole credit roll, generated from TVN's own records each time it opens: the shipped network by
 * channel, its demonstration pictures, then the viewer's own User Network and 1000 Local Media, kept apart.
 * Sources are grouped per channel with their programme counts rather than repeated per programme.
 */
export function buildRoll(input: RollInput): Roll {
  const lines: RollLine[] = [{ kind: 'now' }, { kind: 'space' }]
  const network: RollLine[] = []
  const allSources = new Set<string>()
  const allProgrammes = new Set<string>()
  let channelCount = 0
  let camCount = 0

  const shipped = input.channels
    .filter((channel) => channel.number >= 1 && channel.number <= 999 && channel.origin !== 'user-import' && channel.origin !== 'user-created')
    .sort((a, b) => a.number - b.number)
  for (const channel of shipped) {
    const counts = new Map<string, number>()
    for (const item of input.poolOf(channel.number)) {
      const sourceId = sourceIdOf(item)
      if (!sourceId?.startsWith('src_')) continue
      counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1)
      allSources.add(sourceId)
      allProgrammes.add(item.id)
    }
    const cams = new Map<string, { count: number; ref: string }>()
    for (const cam of liveCams(channel.number)) {
      const name = cam.publisher ?? cam.service
      cams.set(name, { count: (cams.get(name)?.count ?? 0) + 1, ref: cam.sourceId })
      camCount += 1
    }
    const live = liveEndpoint(channel.number)
    if (counts.size === 0 && cams.size === 0 && !live) continue
    channelCount += 1
    network.push({ kind: 'channel', number: `TVN Channel ${padChannel(channel.number)}`, name: channel.name })
    if (live) {
      const recorded = input.register.sources[live.sourceId]
      network.push({
        kind: 'source',
        name: recorded?.name ?? live.publisher ?? live.service,
        detail: `YouTube · live stream · ${live.service}`,
        links: registerLinks(live.sourceId, input.register),
      })
    }
    const ranked = [...counts].sort((a, b) => b[1] - a[1] || (input.register.sources[a[0]]?.name ?? a[0]).localeCompare(input.register.sources[b[0]]?.name ?? b[0]))
    for (const [sourceId, count] of ranked) {
      network.push({
        kind: 'source',
        name: input.register.sources[sourceId]?.name ?? sourceId,
        detail: `YouTube · ${plural(count, 'programme')}`,
        links: registerLinks(sourceId, input.register),
      })
    }
    for (const [name, { count, ref }] of [...cams].sort((a, b) => a[0].localeCompare(b[0]))) {
      const url = youtubeChannelUrl(ref)
      network.push({ kind: 'source', name, detail: `YouTube · ${plural(count, 'live webcam')}`, links: url ? [{ label: 'YouTube channel', url }] : [] })
    }
    network.push({ kind: 'space' })
  }

  lines.push(
    { kind: 'title', text: 'TVN Source Credits' },
    { kind: 'subtitle', text: 'Programmes on TVN channels 001–999, by channel, from the TVN catalogue.' },
    {
      kind: 'subtitle',
      text: `${plural(allSources.size, 'source')} · ${plural(allProgrammes.size, 'programme')} · ${plural(camCount, 'live webcam')} · ${plural(channelCount, 'channel')}`,
    },
    { kind: 'space' },
    ...network,
    { kind: 'note', text: 'Channels not listed carry only TVN presentation cards.' },
    { kind: 'space' },
    { kind: 'title', text: 'Demonstration Pictures' },
  )
  const films = new Map<string, string>()
  for (const film of DEMO_FILMS) films.set(film.title, film.credit)
  for (const [title, credit] of films) lines.push({ kind: 'source', name: title, detail: `${credit} · YouTube`, links: [] })
  lines.push({ kind: 'space' }, { kind: 'title', text: 'My Channel Sources' })
  lines.push({ kind: 'subtitle', text: 'Your own User Network (1001 and up), kept in this browser. Not part of TVN programming.' })

  const own = input.stored.filter((record) => record.channelNumber !== null && record.channelNumber >= USER_NUMBER_START).sort((a, b) => (a.channelNumber ?? 0) - (b.channelNumber ?? 0))
  const additions = Object.entries(input.curated)
    .map(([number, edit]) => ({ number: Number(number), name: edit.name, sources: edit.sources.filter((source) => source.kind !== 'tvn') }))
    .filter((edit) => edit.sources.length > 0)
    .sort((a, b) => a.number - b.number)
  if (own.length === 0 && additions.length === 0) lines.push({ kind: 'note', text: 'No channels or sources of your own yet.' })
  for (const record of own) {
    lines.push({ kind: 'channel', number: `My Channel ${record.channelNumber}`, name: record.name })
    for (const source of sourcesOf(record)) lines.push(...viewerSourceLines(source))
    lines.push({ kind: 'space' })
  }
  for (const edit of additions) {
    lines.push({ kind: 'channel', number: `TVN Channel ${padChannel(edit.number)} · your additions`, name: edit.name })
    for (const source of edit.sources) lines.push(...viewerSourceLines(source))
    lines.push({ kind: 'space' })
  }

  lines.push(
    { kind: 'space' },
    { kind: 'title', text: 'Channel 1000' },
    { kind: 'channel', number: 'Local Media', name: '' },
    { kind: 'note', text: LOCAL_SESSION_NOTE },
    { kind: 'space' },
    { kind: 'title', text: 'TVN' },
    { kind: 'note', text: 'Presentation, channel organisation, scheduling, Guide and navigation by TVN.' },
    { kind: 'note', text: 'TVN does not claim ownership of third-party programmes.' },
    { kind: 'note', text: 'Each remains attributable to its creator and is delivered by its provider.' },
    { kind: 'note', text: 'Third-party trademarks belong to their respective owners.' },
    { kind: 'space' },
    { kind: 'space' },
  )

  const offsets: number[] = []
  let at = 0
  for (const line of lines) {
    offsets.push(at)
    at += LINE_HEIGHT[line.kind]
  }
  offsets.push(at)
  return { lines, offsets, totals: { channels: channelCount, sources: allSources.size, programmes: allProgrammes.size, cams: camCount } }
}

/** The lines that cross the window [top, top + height), by binary search over the offsets. */
export function visibleRange(offsets: readonly number[], top: number, height: number): [number, number] {
  const count = offsets.length - 1
  let low = 0
  let high = count
  while (low < high) {
    const mid = (low + high) >> 1
    if (offsets[mid + 1] <= top) low = mid + 1
    else high = mid
  }
  let end = low
  while (end < count && offsets[end] < top + height) end += 1
  return [low, end]
}
