export type DetailsLevel = 'compact' | 'full'

export const DETAILS_DEFAULT: DetailsLevel = 'compact'

export function toggleDetails(level: DetailsLevel): DetailsLevel {
  return level === 'compact' ? 'full' : 'compact'
}
