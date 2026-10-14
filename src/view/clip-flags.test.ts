import { describe, expect, it } from 'vitest'
import type { Programme } from '../types/programme.ts'
import { CLIP_FLAGS_KEY, clipFlag, dueFlag, flagBookmark, readClipFlags, toggledFlags } from './clip-flags.ts'

const MIN = 60_000
const programme = (title: string, durationSeconds: number) => ({ id: `p-${title}`, title, description: '', videoId: 'abcdefghijk', durationSeconds, channelId: 'c', category: 'x', source: 'youtube' }) as unknown as Programme
const at = (number: number, startMin: number, endMin: number) => clipFlag({ number, name: `Ch ${number}` }, programme(`Clip ${number}@${startMin}`, (endMin - startMin) * 60), startMin * MIN, endMin * MIN)

describe('clip flags', () => {
  it('sets and removes a flag, keeps them in time order, and refuses one already over', () => {
    const later = at(5, 30, 40)
    const sooner = at(7, 10, 20)
    let list = toggledFlags([], later, 0)
    list = toggledFlags(list, sooner, 0)
    expect(list.map((flag) => flag.key)).toEqual([sooner.key, later.key])
    expect(toggledFlags(list, sooner, 0).map((flag) => flag.key)).toEqual([later.key])
    expect(toggledFlags([], at(3, 1, 2), 5 * MIN)).toEqual([])
  })

  it('a new flag at the same moment replaces the old one', () => {
    const list = toggledFlags(toggledFlags([], at(5, 10, 20), 0), at(6, 10, 15), 0)
    expect(list.map((flag) => flag.channelNumber)).toEqual([6])
  })

  it('nothing fires before the first flag', () => {
    const list = [at(5, 10, 20), at(6, 30, 40)]
    expect(dueFlag(list, 5 * MIN)).toEqual({ fire: null, rest: list })
  })

  it('fires the flag on air and uses it up with every flag before it; the next stays', () => {
    const list = [at(4, 0, 5), at(5, 10, 20), at(6, 30, 40)]
    const { fire, rest } = dueFlag(list, 12 * MIN)
    expect(fire?.channelNumber).toBe(5)
    expect(rest.map((flag) => flag.channelNumber)).toEqual([6])
  })

  it('a flag missed while away goes without tuning', () => {
    const { fire, rest } = dueFlag([at(5, 10, 20)], 25 * MIN)
    expect(fire).toBeNull()
    expect(rest).toEqual([])
  })

  it('keeps what the clip plays, so flagged clips can be made into a channel', () => {
    const flag = at(5, 10, 20)
    expect(flag.programmeId).toBe('abcdefghijk')
    expect(flagBookmark(flag)).toMatchObject({ channelNumber: 5, programmeId: 'abcdefghijk', title: flag.title, durationSeconds: 600 })
  })

  it('reads back only well-formed flags, sorted', () => {
    const store = new Map<string, string>([[CLIP_FLAGS_KEY, JSON.stringify([at(6, 30, 40), { key: 'x' }, at(5, 10, 20)])]])
    const read = readClipFlags({ getItem: (key) => store.get(key) ?? null, setItem: () => {} })
    expect(read.map((flag) => flag.channelNumber)).toEqual([5, 6])
  })
})
