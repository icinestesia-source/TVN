import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyFilter, filterVerdict, isShort, SHORTS_SECONDS } from './services/channel-curation.ts'
import type { ImportedVideo } from './services/channels-import.ts'

const video = (id: string, durationSec: number, title = id): ImportedVideo => ({ id, title, durationSec })

describe('Edit Channel: leaving out Shorts', () => {
  it('a Short is three minutes or less, or tagged #shorts', () => {
    expect(SHORTS_SECONDS).toBe(180)
    expect(isShort(video('a', 45))).toBe(true)
    expect(isShort(video('b', 170))).toBe(true)
    expect(isShort(video('c', 600, 'Long one #shorts'))).toBe(true)
    expect(isShort(video('d', 600))).toBe(false)
  })

  it('only when the source asks for it', () => {
    const list = [video('a', 40), video('b', 1800)]
    expect(applyFilter(list, undefined).map((item) => item.id)).toEqual(['a', 'b'])
    expect(applyFilter(list, { exclude: { shorts: true } }).map((item) => item.id)).toEqual(['b'])
  })

  it('is a labelled choice in the source filter', () => {
    const panel = readFileSync('src/components/ChannelCuration.tsx', 'utf8')
    expect(panel).toContain('Leave out YouTube Shorts · portrait clips of {SHORTS_SECONDS / 60} minutes or less, or tagged #shorts')
  })
})

describe('Edit Channel: shortest and longest length', () => {
  it('leaves out programmes under the shortest or over the longest', () => {
    const filter = { include: { minSeconds: 10 * 60, maxSeconds: 60 * 60 } }
    expect(filterVerdict(video('a', 5 * 60), filter)).toBe('Too short')
    expect(filterVerdict(video('b', 90 * 60), filter)).toBe('Too long')
    expect(filterVerdict(video('c', 30 * 60), filter)).toBeNull()
  })

  it('has its own Length section with Shortest and Longest', () => {
    const panel = readFileSync('src/components/ChannelCuration.tsx', 'utf8')
    expect(panel).toContain("field('Shortest (minutes)', 'minMinutes'")
    expect(panel).toContain("field('Longest (minutes)', 'maxMinutes'")
  })
})

describe('Edit Channel: LOAD MORE schedules what it loads; RESCHEDULE shuffles the schedule', () => {
  const editor = readFileSync('src/components/ChannelEditor.tsx', 'utf8')

  it('LOAD MORE no longer holds new programmes back for RESCAN', () => {
    const batch = editor.slice(editor.indexOf('const loadBatch = () => {'), editor.indexOf('const noteDraft'))
    expect(batch).not.toContain('holdNew')
    expect(batch).toContain('admitted(next.sources)')
    expect(batch).toContain('compiled: eligibilityKey(loaded)')
  })

  it('RESCHEDULE fetches nothing: it shuffles what is scheduled into a new random order and saves it', () => {
    const reschedule = editor.slice(editor.indexOf('const reschedule = () => {'), editor.indexOf('const loadMore = ('))
    expect(reschedule).toContain('shuffledVideos(')
    expect(reschedule).toContain("orderKind: 'random'")
    expect(reschedule).toContain('keepOrder(')
    expect(reschedule).not.toContain('onLoadMore')
    expect(reschedule).not.toContain('onRescan')
  })

  it('LOAD MORE on a TVN channel reads its original publishers again before the next batch', () => {
    const batch = editor.slice(editor.indexOf('const loadBatch = () => {'), editor.indexOf('const noteDraft'))
    expect(batch.indexOf('toRead.entries()')).toBeGreaterThan(-1)
    expect(batch.indexOf('toRead.entries()')).toBeLessThan(batch.indexOf('loadable.entries()'))
    expect(batch).toContain('onAcquire(made)')
  })
})
