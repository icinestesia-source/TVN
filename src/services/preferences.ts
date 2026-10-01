import type { GuideFilter, MultiviewMode, UserPreferences } from '../types/preferences.ts'
import { asSleepMinutes, DEFAULT_SLEEP_MINUTES } from '../state/sleep.ts'
import { clamp } from '../utils/time.ts'
import { clampGuideSplit } from '../view/guide-mode.ts'
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

/** Where a viewer with no saved state starts; a returning viewer resumes their own channel. */
export const FIRST_CHANNEL_NUMBER = 225

export const DEFAULT_PREFERENCES: UserPreferences = {
  version: 2,
  lastChannelNumber: FIRST_CHANNEL_NUMBER,
  previousChannelNumber: null,
  volume: 80,
  muted: false,
  favouriteChannelNumbers: [],
  guideFilter: 'all',
  guideSplit: 0.5,
  multiviewMode: '1',
  audioFocusIndex: 0,
  multiviewChannels: [],
  subtitles: false,
  sleepMinutes: DEFAULT_SLEEP_MINUTES,
  infoShortcuts: DEFAULT_SHORTCUTS,
}

function clampVolume(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(Math.round(value), 0, 100) : 80
}

function asFilter(value: unknown): GuideFilter {
  return typeof value === 'string' && FILTERS.includes(value as GuideFilter) ? (value as GuideFilter) : 'all'
}

function asMode(value: unknown): MultiviewMode {
  return value === '2' || value === '4' || value === '9' ? value : '1'
}

function asNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((item) => Number.isInteger(item) && item >= 1 && item < 100000)
}

export function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY)
    if (!raw) return { ...DEFAULT_PREFERENCES, favouriteChannelNumbers: [], multiviewChannels: [] }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_PREFERENCES, favouriteChannelNumbers: [], multiviewChannels: [] }
    }
    const record = parsed as Partial<UserPreferences>
    if (record.version !== 1 && record.version !== 2) {
      return { ...DEFAULT_PREFERENCES, favouriteChannelNumbers: [], multiviewChannels: [] }
    }
    return {
      version: 2,
      lastChannelNumber:
        typeof record.lastChannelNumber === 'number' ? record.lastChannelNumber : FIRST_CHANNEL_NUMBER,
      previousChannelNumber:
        typeof record.previousChannelNumber === 'number' ? record.previousChannelNumber : null,
      volume: clampVolume(record.volume),
      muted: Boolean(record.muted),
      favouriteChannelNumbers: asNumbers(record.favouriteChannelNumbers),
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
    }
  } catch {
    return { ...DEFAULT_PREFERENCES, favouriteChannelNumbers: [], multiviewChannels: [] }
  }
}

export function savePreferences(preferences: UserPreferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    // Private mode and blocked storage should not take the television down.
  }
}
