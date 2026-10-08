/**
 * Which channels show their sub-channels (one row per source) under them in the Guide, by channel id. The
 * viewer's choice is kept in this browser; every channel starts with its sub-channels hidden.
 */
export const SUB_CHANNELS_KEY = 'tvn.guide-sub-channels.v1'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadOpenSubChannels(store: Store | null = browserStore()): ReadonlySet<string> {
  try {
    const kept: unknown = JSON.parse(store?.getItem(SUB_CHANNELS_KEY) ?? '[]')
    return new Set(Array.isArray(kept) ? kept.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

export function saveOpenSubChannels(open: ReadonlySet<string>, store: Store | null = browserStore()): void {
  try {
    store?.setItem(SUB_CHANNELS_KEY, JSON.stringify([...open]))
  } catch {
    // A browser that keeps nothing still shows and hides them; it just forgets.
  }
}

/** The Guide's rows: each listed channel, followed by its sub-channels where they are shown. */
export type GuideRow<C> = { kind: 'channel'; channel: C } | { kind: 'sub'; channel: C; parent: C }

export function guideLayout<C extends { id: string }>(channels: readonly C[], open: ReadonlySet<string>, subsOf: (channelId: string) => readonly C[]): GuideRow<C>[] {
  return channels.flatMap((channel): GuideRow<C>[] => {
    const subs = open.has(channel.id) ? subsOf(channel.id) : []
    return [{ kind: 'channel', channel }, ...subs.map((sub) => ({ kind: 'sub' as const, channel: sub, parent: channel }))]
  })
}

/** Where a channel's own row is in the layout; -1 when it is not listed. */
export function rowIndexOf<C extends { number: number }>(rows: readonly GuideRow<C>[], number: number): number {
  return rows.findIndex((row) => row.kind === 'channel' && row.channel.number === number)
}
