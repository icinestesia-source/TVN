import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileScale } from './player/file-scale.ts'
import { slowSource, sourceHostLabel } from './player/slow-source.ts'
import { playbackCommand } from './player/command.ts'
import type { Programme } from './types/programme.ts'

const programme = (patch: Partial<Programme>): Programme =>
  ({ id: 'p', title: 'Episode', durationSeconds: 3381, playbackMode: 'linear', source: 'imported', ...patch }) as Programme

describe('an MP3 Firefox measures short of the feed (777)', () => {
  it('seeks in proportion to the length the browser measured, so late in an episode is not past its end', () => {
    const scale = fileScale(3325.13, 3381)
    expect(scale).toBeCloseTo(3325.13 / 3381, 6)
    expect(3325 * scale).toBeLessThan(3325.13 - 50)
  })

  it('leaves agreeing lengths, unknown lengths and wild disagreements alone', () => {
    expect(fileScale(3381, 3381)).toBe(1)
    expect(fileScale(3380, 3381)).toBe(1)
    expect(fileScale(Number.NaN, 3381)).toBe(1)
    expect(fileScale(Infinity, 3381)).toBe(1)
    expect(fileScale(3325, undefined)).toBe(1)
    expect(fileScale(600, 3381)).toBe(1)
  })

  it('a file command carries its scheduled length; the local player seeks and reports through the scale', () => {
    const command = playbackCommand(programme({ mediaUrl: 'https://example.com/a.mp3' }), 3325, null)
    expect(command.localSeconds).toBe(3381)
    const stage = readFileSync('src/player/LocalStage.tsx', 'utf8')
    expect(stage).toContain('scaleRef.current = pending.live ? 1 : fileScale(video.duration, pending.scheduledSeconds)')
    expect(stage).toContain('video.currentTime = Math.max(0, seconds * scaleRef.current)')
    expect(stage).toContain('value / scaleRef.current')
  })
})

describe('a buffering title for slow sources', () => {
  it('is for a publisher’s own file or stream, never for YouTube', () => {
    expect(slowSource(programme({ videoId: 'abcdefghijk' }))).toBe(false)
    expect(slowSource(programme({ mediaUrl: 'https://player.odycdn.com/v6/streams/x.mp4' }))).toBe(true)
    expect(slowSource(programme({ mediaUrl: 'https://example.com/', programmeType: 'website' } as Partial<Programme>))).toBe(false)
    expect(slowSource(programme({}))).toBe(false)
  })

  it('names where the programme is coming from', () => {
    expect(sourceHostLabel('https://player.odycdn.com/v6/streams/x.mp4')).toBe('Odysee')
    expect(sourceHostLabel('https://odysee.com/@a:1/b:2')).toBe('Odysee')
    expect(sourceHostLabel('https://www.example.org/file.mp4')).toBe('example.org')
    expect(sourceHostLabel('not a url')).toBeNull()
  })

  it('waits before it shows, and stands over the waiting picture or a stalled one only', () => {
    const title = readFileSync('src/components/BufferingTitle.tsx', 'utf8')
    expect(title).toContain('window.setTimeout(() => setShown(true), BUFFERING_TITLE_DELAY_MS)')
    const screen = readFileSync('src/app/TvScreen.tsx', 'utf8')
    expect(screen).toContain("const slow = single && face === 'picture' && slowSource(programme)")
    expect(screen).toMatch(/slow && owner === 'video' && tv\.playerStatus === 'buffering' && !tv\.paused/)
  })
})
