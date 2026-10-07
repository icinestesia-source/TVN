import type { Channel } from '../types/channel.ts'
import type { MediaKind, Programme, ProgrammeType } from '../types/programme.ts'
import { canonicalChannels, filterIdForCategory, type CanonicalChannel } from './canonical.ts'

/**
 * Working schedules that must survive the canonical lineup.
 * 101 keeps its name as well as its programmes. 001–060 keep their clock
 * programmes as a fallback, but the manifest supplies their identity.
 * The relocated radio schedules keep their programmes; the manifest supplies the name.
 */
const PROTECTED_NAMES = new Set<number>([101])

const KEPT_SCHEDULES = new Set<number>([
  ...Array.from({ length: 60 }, (_, index) => index + 1),
  ...PROTECTED_NAMES,
  950,
  990,
  992,
  999,
])

const PALETTE = ['#1d4e89', '#0f5f5a', '#6b3f1d', '#3d4c1e', '#5c2d4a', '#1e3d6e', '#7a2e2e', '#2c4a3e']

const SLATES = ['Off air', 'Station identification', 'Interval', 'Awaiting source', 'Network card', 'Closedown card']

const PATTERNS: number[][] = [
  [25, 40, 15, 55, 30, 18],
  [50, 12, 36, 22, 44, 28],
  [18, 62, 24, 33, 47, 16],
  [42, 19, 70, 14, 26, 38],
]

const CATEGORY_LABEL: Record<string, string> = {
  main: 'Main',
  film: 'Films',
  entertainment: 'Entertainment',
  sport: 'Sport',
  knowledge: 'History',
  music: 'Music',
  'business-tech': 'Business',
  lifestyle: 'Lifestyle',
  specialist: 'Specialist',
  webcams: 'Live World',
  news: 'News',
  radio: 'Radio',
}

/**
 * Names the canonical plan uses for protected channels differ from the working
 * stations. Those working names are kept. This list is the discrepancy.
 */
export function protectedNameDiscrepancies(
  channels: readonly Channel[],
): { number: number; workingName: string; manifestName: string }[] {
  const found: { number: number; workingName: string; manifestName: string }[] = []
  for (const entry of canonicalChannels()) {
    if (!PROTECTED_NAMES.has(entry.number)) continue
    const working = channels.find((channel) => channel.number === entry.number)
    if (!working || working.name === entry.name) continue
    found.push({ number: entry.number, workingName: working.name, manifestName: entry.name })
  }
  return found
}

export function reconcileWithCanonical(
  seedChannels: readonly Channel[],
  seedProgrammes: readonly Programme[],
): { channels: Channel[]; programmes: Programme[] } {
  const seedByNumber = new Map(seedChannels.map((channel) => [channel.number, channel]))
  const programmesByChannel = new Map<string, Programme[]>()
  for (const programme of seedProgrammes) {
    const list = programmesByChannel.get(programme.channelId) ?? []
    list.push(programme)
    programmesByChannel.set(programme.channelId, list)
  }

  const channels: Channel[] = []
  const programmes: Programme[] = []

  for (const entry of canonicalChannels()) {
    if (!entry.enabled || entry.number < 1 || entry.number > 999) continue
    const seed = seedByNumber.get(entry.number)
    if (seed && KEPT_SCHEDULES.has(entry.number)) {
      channels.push(overlay(seed, entry, PROTECTED_NAMES.has(entry.number)))
      programmes.push(...(programmesByChannel.get(seed.id) ?? []))
      continue
    }
    const built = generatedStation(entry)
    channels.push(built.channel)
    programmes.push(...built.programmes)
  }

  return { channels, programmes }
}

function overlay(seed: Channel, entry: CanonicalChannel, keepName: boolean): Channel {
  const mediaKind = entry.mediaKind === 'audio' ? 'audio' : 'video'
  return {
    ...seed,
    name: keepName ? seed.name : entry.name,
    shortName: keepName ? seed.shortName : shortMark(entry.name, 8),
    logo: keepName ? seed.logo : shortMark(entry.name, 2),
    category: CATEGORY_LABEL[entry.category] ?? entry.category,
    categoryId: filterIdForCategory(entry.category),
    canonicalCategory: entry.category,
    group: entry.group,
    mediaKind,
    origin: 'default',
    enabled: true,
    channelType: entry.channelType,
    sourceStrategy: entry.sourceStrategy,
    sourcePolicy: entry.sourcePolicy,
    sourceCapabilities: entry.sourceCapabilities.slice(),
    providerHint: entry.providerHint,
  }
}

function generatedStation(entry: CanonicalChannel): { channel: Channel; programmes: Programme[] } {
  const id = `ch-${String(entry.number).padStart(3, '0')}`
  const mediaKind: MediaKind = entry.mediaKind === 'audio' ? 'audio' : 'video'
  const channel: Channel = {
    id,
    number: entry.number,
    name: entry.name,
    shortName: shortMark(entry.name, 8),
    description: offAirCopy(entry),
    logo: shortMark(entry.name, 2),
    color: PALETTE[entry.number % PALETTE.length] ?? PALETTE[0],
    category: CATEGORY_LABEL[entry.category] ?? entry.category,
    categoryId: filterIdForCategory(entry.category),
    canonicalCategory: entry.category,
    group: entry.group,
    origin: 'default',
    mediaKind,
    enabled: true,
    sources: [{ kind: 'demo', id: `off-air-${id}`, label: 'Off air until a source is configured' }],
    scheduleMode: 'loop',
    phaseOffsetSeconds: ((entry.number * 83) % 360) * 60 + entry.number * 17,
    channelType: entry.channelType,
    sourceStrategy: entry.sourceStrategy,
    sourcePolicy: entry.sourcePolicy,
    sourceCapabilities: entry.sourceCapabilities.slice(),
    providerHint: entry.providerHint,
  }
  const minutes = PATTERNS[entry.number % PATTERNS.length] ?? PATTERNS[0]
  const programmeType = programmeTypeFor(entry)
  const programmes = minutes.map((length, index) => ({
    id: `${id}-p${index + 1}`,
    title: SLATES[index % SLATES.length] ?? 'Off air',
    description: offAirCopy(entry),
    videoId: null,
    durationSeconds: length * 60,
    channelId: id,
    category: channel.category,
    source: 'demo' as const,
    kind: 'programme' as const,
    programmeType,
    mediaKind,
    playbackMode: 'linear' as const,
    playback: 'generated' as const,
    sourceRef: `generated:${id}-p${index + 1}`,
  }))
  return { channel, programmes }
}

function offAirCopy(entry: CanonicalChannel): string {
  if (entry.providerHint) {
    return `${entry.name} is scheduled. No playable source is configured.`
  }
  return `${entry.name} is on the air with no playable source configured.`
}

function programmeTypeFor(entry: CanonicalChannel): ProgrammeType {
  if (entry.category === 'radio') return 'radio'
  if (entry.category === 'news') return 'news'
  if (entry.category === 'sport') return 'sport'
  if (entry.category === 'music') return 'music'
  if (entry.category === 'film') return 'film'
  return 'episode'
}

function shortMark(name: string, length: number): string {
  const compact = name.replace(/[^A-Za-z0-9]/g, '')
  return (compact.slice(0, length) || 'TV').toUpperCase()
}
