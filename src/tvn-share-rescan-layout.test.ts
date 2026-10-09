import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { commandFromKey } from './input/keyboard.ts'
import type { ChannelSource } from './services/channel-sources.ts'
import { exportSource } from './services/user-network-export.ts'
import { channelSource } from './services/user-network-restore.ts'
import { sharedVideos, sourceShares } from './view/programme-order.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const plain = { meta: false, ctrl: false, alt: false }

/** A seeded random, so each draw is repeatable. */
function seeded(seed = 7) {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
}

const clips = (source: string, count: number, durationSec = 600) => Array.from({ length: count }, (_, index) => ({ id: `${source}${index}`, source, durationSec }))

describe('SHORTCUTS: comma and full stop step the programme, B and N the channels visited', () => {
  it('binds , . to programme Prev / Next and B N to channel Prev / Next', () => {
    expect(commandFromKey(',', plain, false)).toEqual({ type: 'step', direction: -1 })
    expect(commandFromKey('.', plain, false)).toEqual({ type: 'step', direction: 1 })
    expect(commandFromKey('b', plain, false)).toEqual({ type: 'history-back' })
    expect(commandFromKey('N', plain, false)).toEqual({ type: 'history-forward' })
  })
})

describe('SOURCE SHARE: the part of the airtime each source is given', () => {
  it('a source left unset takes an equal part of what the set ones leave, and the shares total 100', () => {
    expect(Object.fromEntries(sourceShares(['a', 'b', 'c'], new Map([['a', 50]])))).toEqual({ a: 50, b: 25, c: 25 })
    expect(Object.fromEntries(sourceShares(['a', 'b'], new Map([['a', 30], ['b', 30]])))).toEqual({ a: 50, b: 50 })
    expect(Object.fromEntries(sourceShares(['a', 'b'], new Map([['a', 100]])))).toEqual({ a: 100, b: 0 })
  })

  it('airs each source for its share of the time, all the way round the scheduled loop', () => {
    const videos = [...clips('a', 40), ...clips('b', 40)]
    const { videos: order, scheduled } = sharedVideos(videos, (video) => video.source, new Map([['a', 75]]), seeded())
    expect(order).toHaveLength(80)
    expect(new Set(order.map((video) => video.id)).size).toBe(80)
    const top = order.slice(0, scheduled)
    const a = top.filter((video) => video.source === 'a').length
    expect(a / top.length).toBeCloseTo(0.75, 1)
    // The mix stops where the shared source runs out: every one of its 40 programmes is scheduled.
    expect(a).toBe(40)
    expect(sharedVideos(videos, (video) => video.source, new Map([['a', 75]]), seeded()).short).toBe('a')
    expect(sharedVideos(clips('a', 4), (video) => video.source, new Map([['a', 75]]), seeded()).short).toBeUndefined()
    for (let at = 8; at <= top.length; at += 8) {
      const part = top.slice(0, at).filter((video) => video.source === 'a').length / at
      expect(Math.abs(part - 0.75)).toBeLessThanOrEqual(0.13)
    }
  })

  it('shares airtime, not programme counts: long programmes air less often', () => {
    const videos = [...clips('long', 30, 3600), ...clips('short', 60, 600)]
    const { videos: order, scheduled } = sharedVideos(videos, (video) => video.source, new Map([['long', 50]]), seeded(3))
    const top = order.slice(0, scheduled)
    const seconds = (source: string) => top.filter((video) => video.source === source).reduce((sum, video) => sum + video.durationSec, 0)
    expect(seconds('long') / (seconds('long') + seconds('short'))).toBeCloseTo(0.5, 1)
  })

  it('a source at 0% follows the schedule, not in it', () => {
    const videos = [...clips('a', 5), ...clips('b', 5)]
    const { videos: order, scheduled } = sharedVideos(videos, (video) => video.source, new Map([['b', 0]]), seeded())
    expect(scheduled).toBe(5)
    expect(order.slice(0, scheduled).every((video) => video.source === 'a')).toBe(true)
    expect(order.slice(scheduled).every((video) => video.source === 'b')).toBe(true)
  })

  it('is kept with the source, and travels through a channel file and back', () => {
    const source: ChannelSource = { id: 's1', kind: 'youtube', url: 'https://www.youtube.com/channel/UC0123456789012345678901', ref: 'UC0123456789012345678901', youtube: 'channel', label: 'A', enabled: true, videos: [], share: 60 }
    const exported = exportSource(source, () => null)
    expect(exported.share).toBe(60)
    expect(channelSource(exported, 0).share).toBe(60)
    expect(channelSource({ ...exported, share: 140 }, 0).share).toBeUndefined()
    expect(read('src/services/user-network-export.ts')).toContain('.share is not a percentage')
  })

  it('Edit Channel sets a share per source, and RESCHEDULE and REBUILD draw the schedule by it', () => {
    const editor = read('src/components/ChannelEditor.tsx')
    expect(editor).toContain('className="editor-pool-size editor-share"')
    expect(editor).toContain('const drawn = sharedVideos(kept, shareKeyOf, shareSet)')
    expect(editor).toMatch(/const reschedule = \(\) => \{[\s\S]{0,200}const shared = sharedOrder\(\)/)
    expect(editor).toMatch(/const rebuild = \(\) => \{[\s\S]{0,200}const shared = sharedOrder\(\)/)
    expect(editor.match(/\{shareControl\(source\)\}/g)).toHaveLength(2)
  })
})

describe('RESCAN CHANNEL: rescan, LOAD MORE, then RESCHEDULE, as one', () => {
  const editor = read('src/components/ChannelEditor.tsx')

  it('the toolbar button runs the whole chain; a source’s own rescan does not', () => {
    expect(editor).toContain('onClick={() => rescan(edit, undefined, true)}')
    expect(editor).toContain("if (whole) setRescanStep('load')")
    expect(editor).toContain('onRescan={(filter, mode) => rescan(edit, new Map([[source.id, { filter, mode }]]))}')
  })

  it('each step runs on the next render, from the rescanned channel, and the notes join into one', () => {
    const step = editor.slice(editor.indexOf('const rescanStep = () => {'), editor.indexOf('useEffect(() => rescanStepRef.current(), [busy, rescanStepState])'))
    expect(step).toContain('if (busy !== null || !rescanStepState || !edit) return')
    expect(step).toMatch(/rescanStepState === 'load' && !stopped && batchSize > 0\) \{\s*setRescanStep\('shuffle'\)\s*loadBatch\(\)/)
    expect(step).toMatch(/!stopped && canReschedule\) \{\s*setRescanStep\('done'\)\s*reschedule\(\)/)
    expect(step).toContain("setNote(rescanNotes.current.join(' · '))")
  })
})

describe('EDIT CHANNEL rises out of the information bar, as the Guide does', () => {
  const css = read('src/styles/guide.css')

  it('rises from the top of the bar and grows to the Guide’s height only when it needs to', () => {
    expect(css).toMatch(/\.guide-info\.guide-editor \{\s*max-height: 100%;[\s\S]{0,120}animation: editor-rise/)
    expect(css).toMatch(/@keyframes editor-rise \{\s*from \{ clip-path: inset\(calc\(100% - var\(--info-h, 96px\)\) 0 0 0\); \}/)
    expect(css).toContain('.info-bar.screen-editor > .guide-editor { max-height: calc(100vh - var(--safe) - var(--info-bottom));')
    expect(css).not.toContain('max-height: min(62vh, 560px)')
  })

  it('its SCHEDULE grows with it, past the old fixed height when there is room', () => {
    expect(css).toContain('.guide-editor .editor-lineup { max-height: max(220px, calc(100vh - var(--safe) - var(--info-bottom) - 260px));')
  })
})

describe('YOUTUBE: a pause TVN did not ask for is picked up again', () => {
  const stage = read('src/player/YoutubeStage.tsx')

  it('resumes a stray pause (Safari pausing under the Guide) so the play button never stays over the picture', () => {
    expect(stage).toMatch(/if \(event\.data === 2\) \{\s*onStatusRef\.current\('paused'\)\s*if \(!holdRef\.current\) resumeSoonRef\.current\(\)/)
    expect(stage).toContain("if (!player || holdRef.current || !requestedRef.current || player.getPlayerState?.() !== 2) return")
  })

  it('tries again when the picture is shown again: the Guide closing, a resize or the tab coming back', () => {
    expect(stage).toContain('const host = frameRef.current')
    expect(stage).toContain('new ResizeObserver(resume)')
    expect(stage).toContain("document.addEventListener('visibilitychange', visible)")
  })
})
