import { describe, expect, it } from 'vitest'
import type { ChannelSource } from './services/channel-sources.ts'
import { addedFromOriginal, originalsToRead, type OriginalSource } from './services/original-sources.ts'

const original = (ref: string, name: string, url?: string, registered = true): OriginalSource => ({ ref, name, provider: 'YouTube', url, registered, videos: [] })
const added = (url: string, label = '', ref?: string): ChannelSource => ({ id: 's1', kind: 'youtube', url, label, enabled: true, ...(ref ? { ref } : {}) })

describe('LOAD MORE reads a TVN channel’s original publishers again', () => {
  const zero7 = original('src_zero_7', 'Zero 7', 'https://www.youtube.com/@zero7')
  const massive = original('src_massive_attack', 'Massive Attack', 'https://www.youtube.com/@massiveattack')
  const unsourced = original('tvn-catalogue', 'TVN catalogue · source unavailable')
  const website = original('src_site', 'A Site', 'https://example.com/videos')

  it('offers registered YouTube publishers only, and none the unsourced group or a website stands for', () => {
    expect(originalsToRead([zero7, massive, unsourced, website, original('src_x', 'X', 'https://www.youtube.com/@x', false)], []).map((item) => item.ref)).toEqual(['src_zero_7', 'src_massive_attack'])
  })

  it('skips a publisher an added source already carries, by address or name, and one the viewer switched off', () => {
    expect(originalsToRead([zero7, massive], [added('https://www.youtube.com/@MassiveAttack/')]).map((item) => item.ref)).toEqual(['src_zero_7'])
    expect(originalsToRead([zero7, massive], [added('https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa', 'zero 7')]).map((item) => item.ref)).toEqual(['src_massive_attack'])
    expect(originalsToRead([zero7, massive], [], [{ ref: 'src_zero_7', enabled: false, name: 'Zero 7', programmes: 60 }]).map((item) => item.ref)).toEqual(['src_massive_attack'])
  })

  it('names the new source after the publisher and keeps the viewer’s filter on it', () => {
    const filter = { include: { terms: ['live'] } }
    const made = addedFromOriginal(massive, added('https://www.youtube.com/@massiveattack'), { ref: 'src_massive_attack', enabled: true, filter, name: 'Massive Attack', programmes: 4 })
    expect(made).toMatchObject({ kind: 'youtube', label: 'Massive Attack', filter })
  })
})
