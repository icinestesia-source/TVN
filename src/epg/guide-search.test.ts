import { beforeAll, describe, expect, it } from 'vitest'
import { bandLabel, guideBandTarget, guideViewedChannel, searchGuideChannels } from './navigation.ts'
import { channelByNumber, listChannels } from '../data/catalogue.ts'
import { channelMatchesFilter } from '../data/network.ts'
import { commandFromKey, commandFromKeyEvent } from '../input/keyboard.ts'
import { isOnAir, refreshAiring } from '../network/airing.ts'
import type { GuideFilter } from '../types/preferences.ts'

const EXCLUDED = [64, 146, 480, 481, 482, 492, 667, 682, 683, 873, 874]

function guideRows(filter: GuideFilter = 'all', favourites: readonly number[] = []) {
  return listChannels().filter((channel) => channelMatchesFilter(channel, filter, favourites))
}

function key(value: string, tagName: string) {
  return { key: value, target: { tagName }, metaKey: false, ctrlKey: false, altKey: false }
}

describe('guide search', () => {
  beforeAll(() => refreshAiring([]))

  it('matches channel names case-insensitively by substring', () => {
    const rows = guideRows()
    const upper = searchGuideChannels(rows, 'HISTORY')
    const lower = searchGuideChannels(rows, 'history')
    expect(upper.length).toBeGreaterThan(5)
    expect(upper.map((channel) => channel.number)).toEqual(lower.map((channel) => channel.number))
    for (const channel of upper) expect(channel.name.toLowerCase()).toContain('history')
    const film = searchGuideChannels(rows, 'fil')
    expect(film.some((channel) => /film/i.test(channel.name))).toBe(true)
    for (const channel of film) expect(`${channel.number} ${channel.name}`.toLowerCase()).toMatch(/fil/)
  })

  it('finds a channel by number, padded or not', () => {
    const rows = guideRows()
    expect(searchGuideChannels(rows, '415').map((channel) => channel.number)).toContain(415)
    expect(searchGuideChannels(rows, '007').map((channel) => channel.number)).toContain(7)
    expect(searchGuideChannels(rows, ' 415 ').map((channel) => channel.number)).toContain(415)
  })

  it('restores the full guide when the query is cleared', () => {
    const rows = guideRows()
    expect(searchGuideChannels(rows, 'history').length).toBeLessThan(rows.length)
    expect(searchGuideChannels(rows, '')).toEqual(rows)
    expect(searchGuideChannels(rows, '   ')).toEqual(rows)
  })

  it('never brings back channels the guide hides', () => {
    const rows = guideRows()
    for (const number of EXCLUDED) {
      const name = channelByNumber(number)!.name
      const found = searchGuideChannels(rows, name).map((channel) => channel.number)
      expect(found, `${number} ${name}`).not.toContain(number)
      expect(searchGuideChannels(rows, String(number)).map((channel) => channel.number)).not.toContain(number)
    }
  })

  it('keeps defined off-air channels searchable', () => {
    const dormant = channelByNumber(9)!
    expect(isOnAir(dormant)).toBe(false)
    const found = searchGuideChannels(guideRows(), dormant.name).map((channel) => channel.number)
    expect(found).toContain(9)
  })

  it('searches only inside favourites when favourites is on', () => {
    const favourites = [415, 416, 502]
    const found = searchGuideChannels(guideRows('favourites', favourites), 'history').map((channel) => channel.number)
    expect(found.every((number) => favourites.includes(number))).toBe(true)
    expect(found).toContain(416)
    expect(found).not.toContain(502)
    expect(searchGuideChannels(guideRows('favourites', favourites), 'news')).toEqual([])
  })

  it('leaves R and digits to the search box instead of the television', () => {
    expect(commandFromKey('r', { meta: false, ctrl: false, alt: false }, false)).toEqual({ type: 'random-channel' })
    for (const guideOpen of [true, false]) {
      expect(commandFromKeyEvent(key('r', 'INPUT'), guideOpen)).toBeNull()
      expect(commandFromKeyEvent(key('R', 'INPUT'), guideOpen)).toBeNull()
      for (const digit of '0123456789') expect(commandFromKeyEvent(key(digit, 'INPUT'), guideOpen)).toBeNull()
    }
    expect(commandFromKeyEvent(key('R', 'DIV'), false)).toEqual({ type: 'random-channel' })
    expect(commandFromKeyEvent(key('4', 'DIV'), true)).toEqual({ type: 'digit', digit: 4 })
  })
})

describe('guide hundred-band navigation', () => {
  const numbers = [4, 23, 101, 150, 317, 399, 402, 435, 499, 502, 573, 610, 1001, 1004]

  it('moves to the next band', () => {
    expect(guideBandTarget(numbers, 435, 1)).toBe(502)
    expect(guideBandTarget(numbers, 573, 1)).toBe(610)
    expect(guideBandTarget(numbers, 610, 1)).toBe(1001)
    expect(guideBandTarget(numbers, 1004, 1)).toBeNull()
  })

  it('moves to the previous band', () => {
    expect(guideBandTarget(numbers, 435, -1)).toBe(317)
    expect(guideBandTarget(numbers, 573, -1)).toBe(402)
    expect(guideBandTarget(numbers, 4, -1)).toBeNull()
  })

  it('skips bands with no guide rows instead of inventing them', () => {
    expect(guideBandTarget([4, 317, 902], 4, 1)).toBe(317)
    expect(guideBandTarget([4, 317, 902], 902, -1)).toBe(317)
    expect(guideBandTarget([4, 317, 902], 317, 1)).toBe(902)
  })

  it('only picks a guide row: the target is a listed channel, never a tune', () => {
    const rows = guideRows().map((channel) => channel.number)
    const next = guideBandTarget(rows, 435, 1)!
    expect(Math.floor(next / 100)).toBe(5)
    expect(rows).toContain(next)
    const previous = guideBandTarget(rows, 435, -1)!
    expect(Math.floor(previous / 100)).toBe(3)
    expect(bandLabel(next)).toBe('500–599')
    expect(bandLabel(1004)).toBe('1000–1099')
    expect(bandLabel(4)).toBe('000–099')
  })

  it('steps 700s back to the 600s and forward again even when every 600s channel is off air', () => {
    refreshAiring([])
    const directory = guideRows()
    const numbers = directory.map((channel) => channel.number)
    const sixHundreds = directory.filter((channel) => channel.number >= 600 && channel.number < 700)
    expect(sixHundreds.length).toBeGreaterThan(0)
    expect(sixHundreds.every((channel) => !isOnAir(channel))).toBe(true)
    for (const from of [700, 735, 799].filter((number) => numbers.includes(number))) {
      const back = guideBandTarget(numbers, from, -1)!
      expect(back, `${from}`).toBe(sixHundreds[0].number)
    }
    expect(guideBandTarget(numbers, sixHundreds[0].number, 1)! >= 700).toBe(true)
    expect(guideBandTarget(numbers, sixHundreds[0].number, 1)! < 800).toBe(true)
    expect(guideBandTarget(numbers, sixHundreds[0].number, -1)! >= 500).toBe(true)
    expect(guideBandTarget(numbers, sixHundreds[0].number, -1)! < 600).toBe(true)
  })

  it('takes the band in view from the top visible row, not a highlighted row elsewhere on screen', () => {
    refreshAiring([])
    const numbers = guideRows().map((channel) => channel.number)
    const rowHeight = 50
    const top = numbers.findIndex((number) => number >= 700)
    const viewed = guideViewedChannel(numbers, top * rowHeight, rowHeight, null)!
    expect(Math.floor(viewed / 100)).toBe(7)
    expect(Math.floor(guideBandTarget(numbers, viewed, -1)! / 100)).toBe(6)
    const partly = guideViewedChannel(numbers, (top - 1) * rowHeight + 10, rowHeight, null)!
    expect(partly).toBe(numbers[top])
    const anchor = { channelNumber: 902, scrollTop: 1234 }
    expect(guideViewedChannel(numbers, 1234, rowHeight, anchor)).toBe(902)
    expect(guideViewedChannel(numbers, 1300, rowHeight, anchor)).toBe(numbers[26])
  })

  it('is disabled while a search is active, leaving the query intact', () => {
    const query = 'history'
    expect(guideBandTarget(numbers, 435, 1, query)).toBeNull()
    expect(guideBandTarget(numbers, 435, -1, query)).toBeNull()
    expect(query).toBe('history')
    expect(guideBandTarget(numbers, 435, 1, '  ')).toBe(502)
  })
})
