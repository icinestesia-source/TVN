/** Shared On This Day events for INFO → On This Day and Entertainment → On This Day. */

export type HistoryCategory =
  | 'news'
  | 'film-television'
  | 'music'
  | 'broadcasting'
  | 'sport'
  | 'science'
  | 'arts'
  | 'births'
  | 'anniversaries'
  | 'other'

export interface HistoryEvent {
  id: string
  year: number
  title: string
  description: string
  category: HistoryCategory
  source: string
  url: string | null
  imageUrl: string | null
  uncertain: boolean
}

export const HISTORY_CATEGORIES: { id: HistoryCategory; label: string }[] = [
  { id: 'news', label: 'Historical news' },
  { id: 'film-television', label: 'Film and television' },
  { id: 'music', label: 'Music' },
  { id: 'broadcasting', label: 'Broadcasting' },
  { id: 'sport', label: 'Sport' },
  { id: 'science', label: 'Science and technology' },
  { id: 'arts', label: 'Arts and culture' },
  { id: 'births', label: 'Notable births' },
  { id: 'anniversaries', label: 'Significant anniversaries' },
]

export const HISTORY_ATTRIBUTION = 'Historical events from Wikipedia / Wikimedia (CC BY-SA).'
