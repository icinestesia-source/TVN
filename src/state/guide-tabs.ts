import type { GuideFilter } from '../types/preferences.ts'
import { filterUserId, userFilter, userNetworkName, type NetworkUser } from '../data/user-network/users.ts'

/** The Guide's tabs in the order it shows them: All, the User Network, each named user, then Favourites. */
export function guideTabs(userIds: readonly string[]): GuideFilter[] {
  return ['all', 'user', ...userIds.map((id) => userFilter(id)), 'favourites']
}

/** What the R flash calls a tab, as its button reads. */
export function guideTabLabel(filter: GuideFilter, users: readonly NetworkUser[]): string {
  if (filter === 'all') return 'ALL'
  if (filter === 'favourites') return 'FAV'
  return userNetworkName(filter === 'user' ? undefined : (filterUserId(filter) ?? undefined), users).toUpperCase()
}

/** R: the tab after this one, round to All; a filter that is not a tab (a category from OPTIONS) goes to All. */
export function nextGuideTab(current: GuideFilter, userIds: readonly string[]): GuideFilter {
  const tabs = guideTabs(userIds)
  const index = tabs.indexOf(current)
  return index < 0 ? 'all' : tabs[(index + 1) % tabs.length]
}
