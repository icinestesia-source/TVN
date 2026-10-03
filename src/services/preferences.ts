import type { GuideFilter, MultiviewMode, UserPreferences } from '../types/preferences.ts'
import { asSleepMinutes, DEFAULT_SLEEP_MINUTES } from '../state/sleep.ts'
import { clamp } from '../utils/time.ts'
import { clampGuideSplit } from '../view/guide-mode.ts'
import { DEFAULT_FAVOURITES } from './default-favourites.ts'
import { asShortcuts, DEFAULT_SHORTCUTS } from '../view/info-shortcuts.ts'

export const PREFERENCES_KEY = 'retrotv.preferences.v1'

const FILTERS: readonly GuideFilter[] = [
  'all',
  'retrotv',
  'dormant',
  'favourites',
  'user',
  'main',
  'films',
  'entertainment',
  'sport',
  'history',
  'music',
  'business',
  'lifestyle',
  'specialist',
  'live-world',
  'news',
  'radio',
  'documentary',
  'geography',
  'law',
  'science',
]

/** Where a viewer with no saved state starts: 000 TVN, which surfs the network itself. A returning viewer resumes their own channel. */
export const FIRST_CHANNEL_NUMBER = 0

export const DEFAULT_PREFERENCES: UserPreferences = {
  version: 2,
  lastChannelNumber: FIRST_CHANNEL_NUMBER,
  previousChannelNumber: null,
  volume: 80,
  muted: false,
  favouriteChannelNumbers: [...DEFAULT_FAVOURITES],
  guideFilter: 'all',
  guideSplit: 0.5,
  multiviewMode: '1',
  audioFocusIndex: 0,
  multiviewChannels: [],
  subtitles: false,
  sleepMinutes: DEFAULT_SLEEP_MINUTES,
  infoShortcuts: DEFAULT_SHORTCUTS,
  defaultFavouritesOffered: true,
}

function clampVolume(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(Math.round(value), 0, 100) : 80
}

function asFilter(value: unknown): GuideFilter {
  // The Guide no longer has a TVN-only tab; All lists those channels.
  if (value === 'retrotv') return 'all'
  if (typeof value === 'string' && /^user:u[a-z0-9]+$/.test(value)) return value as GuideFilter
  return typeof value === 'string' && FILTERS.includes(value as GuideFilter) ? (value as GuideFilter) : 'all'
}

function asMode(value: unknown): MultiviewMode {
  return value === '2' || value === '4' || value === '9' ? value : '1'
}

function asNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((item) => Number.isInteger(item) && item >= 1 && item < 100000)
}

/**
 * Whether this browser has ever saved preferences. A saved record always carries the favourites, so
 * this is what separates a new viewer from one whose Favourites are deliberately empty.
 */
export function preferencesSaved(): boolean {
  try {
    return localStorage.getItem(PREFERENCES_KEY) !== null
  } catch {
    return false
  }
}

/**
 * A saved record from before the starter Favourites existed carries no marker; if it also holds no favourites,
 * this browser was never offered them. A record with the marker is the viewer's own list, empty or not.
 */
function savedRecordDue(record: Partial<UserPreferences>): boolean {
  return record.defaultFavouritesOffered !== true && asNumbers(record.favouriteChannelNumbers).length === 0
}

/** Whether this load seeds the starter Favourites: a new viewer, or a browser never offered them. Seeds once. */
export function defaultFavouritesDue(): boolean {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY)
    if (raw === null) return true
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return false
    const record = parsed as Partial<UserPreferences>
    return (record.version === 1 || record.version === 2) && savedRecordDue(record)
  } catch {
    return false
  }
}

export function loadPreferences(): UserPreferences {
  // Something was saved but cannot be read: the viewer's favourites are unknown, not unset.
  const unreadable = (): UserPreferences => ({ ...DEFAULT_PREFERENCES, favouriteChannelNumbers: [], multiviewChannels: [] })
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY)
    if (raw === null) return { ...DEFAULT_PREFERENCES, favouriteChannelNumbers: [...DEFAULT_FAVOURITES], multiviewChannels: [] }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return unreadable()
    const record = parsed as Partial<UserPreferences>
    if (record.version !== 1 && record.version !== 2) return unreadable()
    return {
      version: 2,
      lastChannelNumber:
        typeof record.lastChannelNumber === 'number' ? record.lastChannelNumber : FIRST_CHANNEL_NUMBER,
      previousChannelNumber:
        typeof record.previousChannelNumber === 'number' ? record.previousChannelNumber : null,
      volume: clampVolume(record.volume),
      muted: Boolean(record.muted),
      favouriteChannelNumbers: savedRecordDue(record) ? [...DEFAULT_FAVOURITES] : asNumbers(record.favouriteChannelNumbers),
      guideFilter: asFilter(record.guideFilter),
      guideSplit: clampGuideSplit(record.guideSplit ?? 0.5),
      multiviewMode: asMode(record.multiviewMode),
      audioFocusIndex:
        typeof record.audioFocusIndex === 'number' && record.audioFocusIndex >= 0
          ? Math.floor(record.audioFocusIndex)
          : 0,
      multiviewChannels: asNumbers(record.multiviewChannels),
      subtitles: record.subtitles === true,
      sleepMinutes: asSleepMinutes(record.sleepMinutes),
      infoShortcuts: asShortcuts(record.infoShortcuts),
      defaultFavouritesOffered: true,
    }
  } catch {
    return unreadable()
  }
}

export function savePreferences(preferences: UserPreferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    // Private mode and blocked storage should not take the television down.
  }
}
