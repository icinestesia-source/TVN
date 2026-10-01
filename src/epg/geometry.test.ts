import { describe, expect, it } from 'vitest'
import {
  durationWidthPx,
  openScrollLeft,
  programmeFlags,
  slotFrame,
  timeX,
  visibleRowRange,
} from './geometry.ts'

describe('guide geometry', () => {
  it('makes a 60 minute programme twice as wide as a 30 minute programme', () => {
    const halfHour = durationWidthPx(30 * 60, 8)
    const hour = durationWidthPx(60 * 60, 8)
    expect(hour).toBe(halfHour * 2)
    expect(halfHour).toBe(240)
  })

  it('places a programme on the same axis as the half-hour ruler', () => {
    const windowStart = Date.parse('2026-09-26T09:00:00')
    const start = Date.parse('2026-09-26T10:00:00')
    const px = 8
    const frame = slotFrame(start, start + 30 * 60 * 1000, windowStart, px)
    expect(frame.left).toBe(timeX(start, windowStart, px))
    expect(frame.width).toBe(durationWidthPx(30 * 60, px) - 3)
    expect(timeX(start, windowStart, px)).toBe(60 * px)
  })

  it('puts the now line on the wall-clock minute', () => {
    const windowStart = Date.parse('2026-09-26T10:00:00')
    const now = windowStart + 75 * 60 * 1000
    expect(timeX(now, windowStart, 8)).toBe(75 * 8)
  })

  it('opens with the previous 45 minutes still in view', () => {
    const now = Date.parse('2026-09-26T11:00:00')
    const start = now - 60 * 60 * 1000
    const scroll = openScrollLeft(now, start, 8, 1000)
    const visibleLeadMinutes = (timeX(now, start, 8) - scroll) / 8
    expect(visibleLeadMinutes).toBe(45)
  })

  it('marks the airing programme separately from the selected programme', () => {
    const start = 1_000_000
    const end = start + 30 * 60 * 1000
    const now = start + 10 * 60 * 1000
    expect(programmeFlags(start, end, now, now).airing).toBe(true)
    expect(programmeFlags(start, end, now, now).selected).toBe(true)
    const future = start + 60 * 60 * 1000
    const later = programmeFlags(future, future + 30 * 60 * 1000, now, future + 1000)
    expect(later.airing).toBe(false)
    expect(later.selected).toBe(true)
  })

  it('windows channel rows with overscan', () => {
    expect(visibleRowRange(0, 480, 48, 60, 2)).toEqual({ start: 0, end: 12 })
    expect(visibleRowRange(48 * 20, 480, 48, 60, 2)).toEqual({ start: 18, end: 32 })
    expect(visibleRowRange(48 * 58, 480, 48, 60, 2).end).toBe(60)
  })
})
