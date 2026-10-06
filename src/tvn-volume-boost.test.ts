import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VolumeOsd } from './components/VolumeOsd.tsx'
import { loadPreferences, PREFERENCES_KEY } from './services/preferences.ts'
import { boostableUrl, boostGain, elementVolume, volumeLimit } from './player/volume.ts'

const read = (path: string) => readFileSync(path, 'utf8')

describe('volume boost, 100 to 200, on 1000 Local Media only', () => {
  it('the element stops at full and the gain carries the rest, up to double', () => {
    expect([0, 50, 100, 150, 200].map(elementVolume)).toEqual([0, 0.5, 1, 1, 1])
    expect([0, 100, 150, 200, 260].map(boostGain)).toEqual([1, 1, 1.5, 2, 2])
    expect(volumeLimit(true)).toBe(200)
    expect(volumeLimit(false)).toBe(100)
  })

  it('only a file from this device is routed through the gain', () => {
    expect(boostableUrl('blob:http://localhost/abc')).toBe(true)
    expect(boostableUrl('https://archive.org/download/x.mp3')).toBe(false)
    expect(boostableUrl(undefined)).toBe(false)
    const stage = read('src/player/LocalStage.tsx')
    expect(stage).toContain('createMediaElementSource(own)')
    expect(stage.match(/createMediaElementSource\(/g)).toHaveLength(1)
  })

  it('the provider allows 200 only on 1000 in single view, and leaving 1000 brings it back to 100', () => {
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain("volumeLimit(channelRef.current === SESSION_CHANNEL_NUMBER && multiviewRef.current === '1')")
    expect(provider).toMatch(/if \(next\.channelNumber !== SESSION_CHANNEL_NUMBER && volumeRef\.current > VOLUME_FULL\) \{\s+volumeRef\.current = VOLUME_FULL/)
    expect(provider).toContain('volume: Math.min(VOLUME_FULL, volumeRef.current),')
    expect(read('src/player/YoutubeStage.tsx')).toContain('player.setVolume(Math.min(VOLUME_FULL, volume))')
  })

  it('the volume display shows boost above 100', () => {
    const boosted = renderToStaticMarkup(createElement(VolumeOsd, { volume: 150, muted: false }))
    expect(boosted).toContain('is-boost')
    expect(boosted).toContain('>Boost<')
    expect(boosted).toContain('width:50%')
    const normal = renderToStaticMarkup(createElement(VolumeOsd, { volume: 80, muted: false }))
    expect(normal).not.toContain('volume-boost')
  })
})

describe('no Mute carried into a new visit', () => {
  it('a saved Mute is not restored; the saved volume is, at no more than 100', () => {
    const store = new Map([[PREFERENCES_KEY, JSON.stringify({ version: 2, lastChannelNumber: 0, previousChannelNumber: null, muted: true, volume: 180 })]])
    const original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => store.get(key) ?? null, setItem: () => {} }, configurable: true })
    try {
      const loaded = loadPreferences()
      expect(loaded.muted).toBe(false)
      expect(loaded.volume).toBe(100)
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
    }
  })
})
