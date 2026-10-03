import type { Channel } from '../types/channel.ts'
import type { Programme, ProgrammeSource } from '../types/programme.ts'

/**
 * GUIDES: viewer-made viewing sequences. NOW is TVN's scheduled television; a Guide is the viewer's own
 * ordered list of programmes from any channels, played one after another. A Guide is not a channel: it
 * never changes a schedule or a running order, and copies no media. Each item references a programme by
 * the channel it came from and its own identity (programme id, video id, source), with its title and
 * length kept for display. An item whose content has gone shows as unavailable; nothing is substituted.
 */
export const GUIDES_KEY = 'tvn.guides.v1'
export const GUIDES_FORMAT = 'tvn-guides-v1'
export const GUIDE_LIMITS = { items: 300, guides: 200, name: 60, sources: 12 } as const
export const DEFAULT_GUIDE_NAME = 'My Guide'
/** What + NEW MAP calls a Map until it is named, or built from words or channels that name it. */
export const NEW_MAP_NAME = 'New Map'

/** A Map still called what TVN called it, which BUILD may name after what it was built from. */
export function unnamedMap(guide: Pick<ViewingGuide, 'name'> | null | undefined): boolean {
  return guide?.name === DEFAULT_GUIDE_NAME || guide?.name === NEW_MAP_NAME
}

/** The programme as it was when added: enough to play it again, never its media. */
export type GuideProgramme = Pick<Programme, 'id' | 'title' | 'videoId' | 'durationSeconds' | 'source'> &
  Partial<Pick<Programme, 'description' | 'mediaDurationSeconds' | 'thumbnail' | 'year' | 'series' | 'episode' | 'kind' | 'playbackMode' | 'playback' | 'programmeType' | 'mediaKind' | 'sourceRef' | 'creator' | 'mediaUrl' | 'publishedAt'>>

export interface GuideItem {
  id: string
  channelNumber: number
  /** The channel's name when added, for display if the channel has since gone. */
  channelName: string
  programme: GuideProgramme
}

/**
 * A channel a Guide draws its programmes from: a reference to the channel's pool, never a copy of
 * it. Known by the channel's stable id, so a renumbered channel is still the same source; the number and
 * name are what it was called when added, shown if the channel has since gone.
 */
export interface GuideSource {
  channelId: string
  channelNumber: number
  channelName: string
}

export interface ViewingGuide {
  id: string
  name: string
  items: GuideItem[]
  /** MY GUIDE SOURCES: the channels BUILD MY GUIDE schedules from, in the viewer's order. */
  sources?: GuideSource[]
  /** Start again after the last item. Off unless the viewer asks for it. */
  loop?: boolean
  createdAt: number
  modifiedAt: number
}

/** The Guide being edited (which may also be saved) and the saved Guides. */
export interface GuideLibrary {
  current: ViewingGuide | null
  saved: ViewingGuide[]
}

export const EMPTY_LIBRARY: GuideLibrary = { current: null, saved: [] }

let counter = 0
export function guideId(prefix: 'g' | 'i', now: number): string {
  counter += 1
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${now.toString(36)}-${counter.toString(36)}-${random}`
}

const SOURCES: readonly ProgrammeSource[] = ['demo', 'youtube', 'imported']
const OPTIONAL_TEXT = ['description', 'thumbnail', 'series', 'episode', 'kind', 'playbackMode', 'playback', 'programmeType', 'mediaKind', 'sourceRef', 'creator', 'mediaUrl', 'publishedAt'] as const

/** The fields a Guide keeps of a programme, and nothing else. */
export function guideProgramme(programme: Programme | GuideProgramme): GuideProgramme {
  const raw = programme as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {
    id: programme.id,
    title: programme.title,
    videoId: programme.videoId,
    durationSeconds: programme.durationSeconds,
    source: programme.source,
  }
  for (const name of OPTIONAL_TEXT) if (typeof raw[name] === 'string' && raw[name]) out[name] = raw[name]
  for (const name of ['mediaDurationSeconds', 'year'] as const) if (typeof raw[name] === 'number' && Number.isFinite(raw[name])) out[name] = raw[name]
  return out as GuideProgramme
}

/** Why a programme cannot join a Guide, or null when it can. */
export function cannotAdd(channel: Pick<Channel, 'number' | 'origin'>, programme: Pick<Programme, 'videoId' | 'liveStream' | 'source' | 'durationSeconds' | 'mediaUrl'>): string | null {
  // Local files (1000 Local Media) last only for the session. YouTube programmes on imported user channels are also
  // `source: 'imported'`, and those can join.
  if (channel.origin === 'session') return 'Local files cannot join a Guide'
  if (channel.origin === 'tvn') return 'TVN chooses as it goes; add the programme from its own channel'
  if (programme.liveStream) return 'A live stream has no end, so it cannot join a Guide'
  if ((!programme.videoId && !programme.mediaUrl) || !(programme.durationSeconds > 0)) return 'Nothing to play there'
  return null
}

export function newGuide(name: string, now: number): ViewingGuide {
  return { id: guideId('g', now), name: cleanGuideName(name), items: [], createdAt: now, modifiedAt: now }
}

export function cleanGuideName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, GUIDE_LIMITS.name) || DEFAULT_GUIDE_NAME
}

const touched = (guide: ViewingGuide, now: number, patch: Partial<ViewingGuide>): ViewingGuide => ({ ...guide, ...patch, modifiedAt: now })

export function addToGuide(guide: ViewingGuide, channel: Pick<Channel, 'number' | 'name' | 'origin'>, programme: Programme, now: number): ViewingGuide {
  const refused = cannotAdd(channel, programme)
  if (refused) throw new Error(refused)
  if (guide.items.length >= GUIDE_LIMITS.items) throw new Error('This Guide is full')
  const item: GuideItem = { id: guideId('i', now), channelNumber: channel.number, channelName: channel.name, programme: guideProgramme(programme) }
  return touched(guide, now, { items: [...guide.items, item] })
}

export function moveItem(guide: ViewingGuide, itemId: string, delta: -1 | 1, now: number): ViewingGuide {
  const from = guide.items.findIndex((item) => item.id === itemId)
  const to = from + delta
  if (from < 0 || to < 0 || to >= guide.items.length) return guide
  const items = [...guide.items]
  ;[items[from], items[to]] = [items[to], items[from]]
  return touched(guide, now, { items })
}

export function removeItem(guide: ViewingGuide, itemId: string, now: number): ViewingGuide {
  return touched(guide, now, { items: guide.items.filter((item) => item.id !== itemId) })
}

export type GuideAction =
  | { type: 'new'; name?: string }
  | { type: 'rename'; name: string }
  | { type: 'move'; itemId: string; delta: -1 | 1 }
  | { type: 'remove'; itemId: string }
  | { type: 'clear' }
  | { type: 'loop'; loop: boolean }
  | { type: 'save' }
  /** With `id`, a saved Map other than the one being edited, which is left as it is. */
  | { type: 'duplicate'; id?: string }
  | { type: 'delete'; id?: string }
  | { type: 'load'; id: string }
  /** The current Guide's programmes replaced wholesale, as CREATE GUIDE FROM… and RESCAN do. */
  | { type: 'fill'; items: GuideItem[] }
  /** The current Guide's MY GUIDE SOURCES replaced (added to, removed from or reordered). */
  | { type: 'sources'; sources: GuideSource[] }

const copyGuide = (guide: ViewingGuide): ViewingGuide => structuredClone(guide)

/** Whether the Guide being edited differs from its saved copy (or has never been saved). */
export function unsaved(library: GuideLibrary): boolean {
  const current = library.current
  if (!current) return false
  const saved = library.saved.find((guide) => guide.id === current.id)
  return !saved || saved.modifiedAt !== current.modifiedAt || saved.name !== current.name
}

/** The Guide library after one editor action. Reads only; a new library is returned. */
export function applyGuideAction(library: GuideLibrary, action: GuideAction, now: number): GuideLibrary {
  const current = library.current
  switch (action.type) {
    case 'new':
      return { ...library, current: newGuide(action.name ?? DEFAULT_GUIDE_NAME, now) }
    case 'load': {
      const found = library.saved.find((guide) => guide.id === action.id)
      return found ? { ...library, current: copyGuide(found) } : library
    }
    case 'save': {
      if (!current) return library
      const exists = library.saved.some((guide) => guide.id === current.id)
      if (!exists && library.saved.length >= GUIDE_LIMITS.guides) throw new Error('Too many saved Guides')
      const copy = copyGuide(current)
      return { ...library, saved: exists ? library.saved.map((guide) => (guide.id === current.id ? copy : guide)) : [...library.saved, copy] }
    }
    case 'duplicate': {
      const other = action.id && action.id !== current?.id ? library.saved.find((guide) => guide.id === action.id) : undefined
      if (other) {
        if (library.saved.length >= GUIDE_LIMITS.guides) throw new Error('Too many saved Guides')
        const copy: ViewingGuide = { ...copyGuide(other), id: guideId('g', now), name: cleanGuideName(`${other.name} copy`), createdAt: now, modifiedAt: now }
        return { ...library, saved: [...library.saved, copy] }
      }
      if (!current) return library
      if (library.saved.length >= GUIDE_LIMITS.guides) throw new Error('Too many saved Guides')
      const copy: ViewingGuide = { ...copyGuide(current), id: guideId('g', now), name: cleanGuideName(`${current.name} copy`), createdAt: now, modifiedAt: now }
      return { current: copy, saved: [...library.saved, copyGuide(copy)] }
    }
    case 'delete':
      if (action.id && action.id !== current?.id) return { ...library, saved: library.saved.filter((guide) => guide.id !== action.id) }
      if (!current) return library
      return { current: null, saved: library.saved.filter((guide) => guide.id !== current.id) }
    case 'rename': {
      if (!current) return { ...library, current: newGuide(action.name, now) }
      const name = cleanGuideName(action.name)
      const inStep = !unsaved(library)
      // A saved Guide keeps its new name at once; the rest of an edit waits for SAVE.
      return {
        current: touched(current, now, { name }),
        saved: library.saved.map((guide) => (guide.id === current.id ? { ...guide, name, modifiedAt: inStep ? now : guide.modifiedAt } : guide)),
      }
    }
    case 'move':
      return current ? { ...library, current: moveItem(current, action.itemId, action.delta, now) } : library
    case 'remove':
      return current ? { ...library, current: removeItem(current, action.itemId, now) } : library
    case 'clear':
      return current ? { ...library, current: touched(current, now, { items: [] }) } : library
    case 'loop':
      return current ? { ...library, current: touched(current, now, { loop: action.loop || undefined }) } : library
    case 'fill':
      return current ? { ...library, current: touched(current, now, { items: action.items.slice(0, GUIDE_LIMITS.items).map((item) => structuredClone(item)) }) } : library
    case 'sources': {
      const unique = action.sources.filter((source, index) => action.sources.findIndex((other) => other.channelId === source.channelId) === index)
      if (unique.length > GUIDE_LIMITS.sources) throw new Error(`My Guide draws on at most ${GUIDE_LIMITS.sources} channels`)
      const sources = unique.map((source) => ({ ...source }))
      const guide = current ?? newGuide(DEFAULT_GUIDE_NAME, now)
      return { ...library, current: touched(guide, now, { sources: sources.length ? sources : undefined }) }
    }
  }
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadGuideLibrary(store: Store | null = browserStore()): GuideLibrary {
  if (!store) return EMPTY_LIBRARY
  try {
    const raw = JSON.parse(store.getItem(GUIDES_KEY) ?? 'null') as unknown
    const errors: string[] = []
    checkGuides({ format: GUIDES_FORMAT, ...(raw as object) }, 'guides', errors)
    return errors.length ? EMPTY_LIBRARY : libraryFrom(raw as GuideLibrary)
  } catch {
    return EMPTY_LIBRARY
  }
}

export function saveGuideLibrary(library: GuideLibrary, store: Store | null = browserStore()): void {
  try {
    store?.setItem(GUIDES_KEY, JSON.stringify(library))
  } catch {
    // A full store keeps the Guides in memory for this visit.
  }
}

export interface ItemLookup {
  channelByNumber: (number: number) => Channel | undefined
  programmesFor: (channelId: string) => readonly Programme[]
  refused: ReadonlySet<string>
}

export type ResolvedItem = { ok: true; channel: Channel; programme: Programme } | { ok: false; reason: string }

/**
 * What a Guide item plays now: the channel's own programme where it still lists it (by id, then by its
 * video), else the programme as it was added, so long as the channel is still here and the video still
 * plays. A channel that has gone, or a video that refuses, makes the item unavailable.
 */
export function resolveItem(item: GuideItem, lookup: ItemLookup): ResolvedItem {
  const channel = lookup.channelByNumber(item.channelNumber)
  if (!channel) return { ok: false, reason: 'Channel no longer available' }
  const videoId = item.programme.videoId
  const media = item.programme.mediaUrl
  if (!videoId && !media) return { ok: false, reason: 'Nothing to play' }
  if (videoId && lookup.refused.has(videoId)) return { ok: false, reason: 'Unavailable' }
  const listed = lookup.programmesFor(channel.id)
  const found =
    listed.find((programme) => programme.id === item.programme.id) ??
    listed.find((programme) => (videoId ? programme.videoId === videoId : programme.mediaUrl === media))
  if (found) return { ok: true, channel, programme: found }
  const programme: Programme = {
    description: '',
    kind: 'programme',
    playbackMode: 'linear',
    ...item.programme,
    channelId: channel.id,
    category: channel.category,
  }
  return { ok: true, channel, programme }
}

/**
 * The next item to play from `from` in `direction`, past any that cannot play; null when none is left.
 * With loop on, going on past the last item comes round to the first, once.
 */
export function nextPlayable(guide: ViewingGuide, from: number, direction: 1 | -1, playable: (item: GuideItem) => boolean): number | null {
  const count = guide.items.length
  let at = from
  for (let tries = 0; tries < count; tries += 1) {
    if (at >= count) {
      if (!guide.loop) return null
      at = 0
    }
    if (at < 0) return null
    if (playable(guide.items[at])) return at
    at += direction
  }
  return null
}

/** A Guide being played. ACTIVE follows it; SUSPENDED keeps it loaded while the viewer watches something else. */
export interface GuideRun {
  guide: ViewingGuide
  index: number
  state: 'active' | 'suspended'
  /** The programme the run asked for, so the end of it (or anything replacing it) is noticed. */
  programmeId: string | null
  /** When the item asked for ends, so RESUME after it has run its course goes on to the next. */
  endsAt: number | null
  /** Items that could not play in this run. They stay in the Guide. */
  skipped: string[]
}

// ── Complete export ───────────────────────────────────────────────────────────

export interface GuidesExport {
  format: typeof GUIDES_FORMAT
  current: ViewingGuide | null
  saved: ViewingGuide[]
}

export function buildGuidesExport(library: GuideLibrary): GuidesExport {
  return { format: GUIDES_FORMAT, current: library.current ? copyGuide(library.current) : null, saved: library.saved.map(copyGuide) }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const GUIDE_FIELDS = new Set(['id', 'name', 'items', 'sources', 'loop', 'createdAt', 'modifiedAt'])
const SOURCE_FIELDS = new Set(['channelId', 'channelNumber', 'channelName'])
const ITEM_FIELDS = new Set(['id', 'channelNumber', 'channelName', 'programme'])

function checkGuide(value: unknown, at: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at} is not a Guide`)
    return
  }
  for (const name of Object.keys(value)) if (!GUIDE_FIELDS.has(name)) errors.push(`${at}.${name} is not a Guide field`)
  if (typeof value.id !== 'string' || !value.id) errors.push(`${at}.id is missing`)
  if (typeof value.name !== 'string') errors.push(`${at}.name is not text`)
  if (value.loop !== undefined && typeof value.loop !== 'boolean') errors.push(`${at}.loop is not true or false`)
  for (const name of ['createdAt', 'modifiedAt'] as const) if (typeof value[name] !== 'number' || !Number.isFinite(value[name])) errors.push(`${at}.${name} is not a time`)
  if (value.sources !== undefined) {
    if (!Array.isArray(value.sources) || value.sources.length > GUIDE_LIMITS.sources) errors.push(`${at}.sources is not a list of at most ${GUIDE_LIMITS.sources}`)
    else
      value.sources.forEach((source, index) => {
        const where = `${at}.sources[${index}]`
        if (!isRecord(source)) return void errors.push(`${where} is not a channel source`)
        for (const name of Object.keys(source)) if (!SOURCE_FIELDS.has(name)) errors.push(`${where}.${name} is not a channel source field`)
        if (typeof source.channelId !== 'string' || !source.channelId || source.channelId.length > 220) errors.push(`${where}.channelId is not a channel id`)
        if (typeof source.channelNumber !== 'number' || !Number.isInteger(source.channelNumber) || source.channelNumber < 0 || source.channelNumber > 99_999) errors.push(`${where}.channelNumber is not a channel`)
        if (typeof source.channelName !== 'string') errors.push(`${where}.channelName is not text`)
      })
  }
  if (!Array.isArray(value.items) || value.items.length > GUIDE_LIMITS.items) {
    errors.push(`${at}.items is not a list of at most ${GUIDE_LIMITS.items}`)
    return
  }
  value.items.forEach((item, index) => {
    const where = `${at}.items[${index}]`
    if (!isRecord(item)) {
      errors.push(`${where} is not a Guide item`)
      return
    }
    for (const name of Object.keys(item)) if (!ITEM_FIELDS.has(name)) errors.push(`${where}.${name} is not a Guide item field`)
    if (typeof item.id !== 'string' || !item.id) errors.push(`${where}.id is missing`)
    if (typeof item.channelNumber !== 'number' || !Number.isInteger(item.channelNumber) || item.channelNumber < 1 || item.channelNumber > 99_999) errors.push(`${where}.channelNumber is not a channel`)
    if (typeof item.channelName !== 'string') errors.push(`${where}.channelName is not text`)
    const programme = item.programme
    if (!isRecord(programme)) {
      errors.push(`${where}.programme is missing`)
      return
    }
    if (typeof programme.id !== 'string' || typeof programme.title !== 'string') errors.push(`${where}.programme has no id or title`)
    const media = typeof programme.mediaUrl === 'string' && /^https?:\/\//i.test(programme.mediaUrl)
    if (programme.mediaUrl !== undefined && !media) errors.push(`${where}.programme.mediaUrl is not a web address`)
    if (!media && (typeof programme.videoId !== 'string' || !programme.videoId)) errors.push(`${where}.programme.videoId is not a video id`)
    if (typeof programme.durationSeconds !== 'number' || !(programme.durationSeconds > 0)) errors.push(`${where}.programme.durationSeconds is not a length`)
    if (!SOURCES.includes(programme.source as ProgrammeSource)) errors.push(`${where}.programme.source is not a portable source`)
    if ('liveStream' in programme) errors.push(`${where}.programme is a live stream`)
  })
}

/** The Guides section of a complete export, or the stored library: all of it valid or none of it used. */
export function checkGuides(value: unknown, at: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at} is not a set of Guides`)
    return
  }
  if (value.format !== GUIDES_FORMAT) errors.push(`${at}.format is not ${GUIDES_FORMAT}`)
  if (value.current !== null && value.current !== undefined) checkGuide(value.current, `${at}.current`, errors)
  if (!Array.isArray(value.saved) || value.saved.length > GUIDE_LIMITS.guides) {
    errors.push(`${at}.saved is not a list of at most ${GUIDE_LIMITS.guides}`)
    return
  }
  const seen = new Set<string>()
  value.saved.forEach((guide, index) => {
    checkGuide(guide, `${at}.saved[${index}]`, errors)
    const id = isRecord(guide) ? guide.id : undefined
    if (typeof id === 'string') {
      if (seen.has(id)) errors.push(`${at}.saved[${index}] repeats Guide ${id}`)
      seen.add(id)
    }
  })
}

const cleanGuide = (guide: ViewingGuide): ViewingGuide => ({
  id: guide.id,
  name: cleanGuideName(guide.name),
  items: guide.items.map((item) => ({ id: item.id, channelNumber: item.channelNumber, channelName: item.channelName, programme: guideProgramme(item.programme) })),
  ...(guide.sources?.length ? { sources: guide.sources.map(({ channelId, channelNumber, channelName }) => ({ channelId, channelNumber, channelName })) } : {}),
  ...(guide.loop ? { loop: true } : {}),
  createdAt: guide.createdAt,
  modifiedAt: guide.modifiedAt,
})

/** A checked library in its canonical shape: only the fields a Guide keeps. */
export function libraryFrom(doc: { current?: ViewingGuide | null; saved: ViewingGuide[] }): GuideLibrary {
  return { current: doc.current ? cleanGuide(doc.current) : null, saved: doc.saved.map(cleanGuide) }
}

/** The channel a source names now: by its stable id, whatever number it has been given since. */
export function sourceChannel<T extends { id: string }>(source: GuideSource, channels: readonly T[]): T | undefined {
  return channels.find((channel) => channel.id === source.channelId)
}
