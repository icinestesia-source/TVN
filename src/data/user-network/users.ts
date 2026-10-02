/**
 * Named users: each is its own User Network tab in the Guide (ALL · TVN · users… · + · FAV), holding the user
 * channels it owns. Channels with no owner belong to TVN, the first User Network. Kept in this browser only.
 */
export const USERS_KEY = 'tvn.users.v1'
export const USER_FILTER_PREFIX = 'user:'
export const USER_NAME_MAX = 24
/** The built-in owner of every user channel no named user holds. Never a NetworkUser, never deleted. */
export const TVN_OWNER = 'tvn'
export const USER_ID = /^u[a-z0-9]+$/
const RESERVED = ['all', 'tvn', 'fav', 'favourites']

export interface NetworkUser {
  id: string
  name: string
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadUsers(store: Store | null = browserStore()): NetworkUser[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(USERS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is NetworkUser =>
        typeof item?.id === 'string' && USER_ID.test(item.id) && typeof item?.name === 'string' && item.name.trim() !== '',
    )
  } catch {
    return []
  }
}

export function saveUsers(users: readonly NetworkUser[], store: Store | null = browserStore()): void {
  try {
    store?.setItem(USERS_KEY, JSON.stringify(users))
  } catch {
    // Storage full or blocked: the users stand for this session.
  }
}

/** A name as the tab shows it, or the reason it cannot be one. */
export function checkUserName(raw: string, users: readonly NetworkUser[]): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.replace(/\s+/g, ' ').trim()
  if (!name) return { ok: false, error: 'Type a name for the new user' }
  if (name.length > USER_NAME_MAX) return { ok: false, error: `A user name is at most ${USER_NAME_MAX} characters` }
  const key = name.toLowerCase()
  if (RESERVED.includes(key)) return { ok: false, error: `${name.toUpperCase()} is already a Guide tab` }
  if (users.some((user) => user.name.toLowerCase() === key)) return { ok: false, error: `There is already a user called ${name}` }
  return { ok: true, name }
}

/** The first free form of `base` ("Name", "Name 2", …), for names that come from a file rather than the viewer. */
export function freeUserName(base: string, users: readonly NetworkUser[]): string {
  const clean = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, USER_NAME_MAX - 3).trim() || 'User'
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? clean : `${clean} ${n}`
    if (checkUserName(name, users).ok) return name
  }
}

export function addUser(users: readonly NetworkUser[], name: string, now: number): { users: NetworkUser[]; user: NetworkUser } {
  const checked = checkUserName(name, users)
  if (!checked.ok) throw new Error(checked.error)
  let id = `u${now.toString(36)}`
  while (users.some((user) => user.id === id)) id = `${id}x`
  const user = { id, name: checked.name }
  return { users: [...users, user], user }
}

export function userFilter(id: string): `user:${string}` {
  return `${USER_FILTER_PREFIX}${id}`
}

/** The user a Guide filter lists, or null for every other filter (TVN included). */
export function filterUserId(filter: string): string | null {
  return filter.startsWith(USER_FILTER_PREFIX) ? filter.slice(USER_FILTER_PREFIX.length) || null : null
}

/**
 * The stored channels after deleting a user. 'move': its channels pass to TVN (owner cleared), everything else
 * about them unchanged. 'remove': each of its channels becomes `clear(channel)` — an empty slot on the same
 * number, as deleting a single channel does — and the slot passes to TVN. Nothing is renumbered.
 */
export function releaseUserChannels<T extends { owner?: string }>(sources: readonly T[], id: string, mode: 'move' | 'remove', clear?: (source: T) => T): T[] {
  return sources.map((source) => {
    if (source.owner !== id) return source
    const moved = { ...(mode === 'remove' && clear ? clear(source) : source) }
    delete moved.owner
    return moved
  })
}

/** The owner a channel lists under: its named user while that user exists, otherwise TVN. No channel is ever orphaned. */
export function ownerOf(owner: string | undefined, users: readonly NetworkUser[] | ReadonlySet<string>): string {
  if (!owner || owner === TVN_OWNER) return TVN_OWNER
  const known = users instanceof Set ? users.has(owner) : (users as readonly NetworkUser[]).some((user) => user.id === owner)
  return known ? owner : TVN_OWNER
}
