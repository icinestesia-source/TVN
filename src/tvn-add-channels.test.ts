import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AddChannelForm } from './components/GuideAdd.tsx'
import { isPlaylistsLink, isYouTubeChannelLink, lookUpChannelPlaylists } from './services/add-channel.ts'

describe('ADD CHANNELS reads the playlists through TVN’s lookup', () => {
  it('the client asks for that mode and keeps only well-formed rows', async () => {
    const asked: string[] = []
    const read = (async (input: string | URL | Request) => {
      asked.push(String(input))
      return new Response(JSON.stringify({ title: 'Classic Sports', more: false, playlists: [{ id: 'PLa', title: 'A', videos: 3 }, { id: 4 }] }))
    }) as typeof fetch
    const found = await lookUpChannelPlaylists('https://www.youtube.com/@classicsportsfanatic7183/playlists', read)
    expect(asked[0]).toContain('mode=list-playlists')
    expect(found).toEqual({ title: 'Classic Sports', more: false, playlists: [{ id: 'PLa', title: 'A', videos: 3 }] })
  })
})

describe('ADD CHANNELS in the Add row', () => {
  it('recognises a channel’s Playlists tab, and channel links it can list', () => {
    expect(isPlaylistsLink('https://www.youtube.com/@classicsportsfanatic7183/playlists')).toBe(true)
    expect(isPlaylistsLink('youtube.com/channel/UCsport0000000000000000a/playlists/')).toBe(true)
    expect(isPlaylistsLink('https://www.youtube.com/@classicsportsfanatic7183')).toBe(false)
    expect(isPlaylistsLink('https://www.youtube.com/playlist?list=PLsport0000000001')).toBe(false)
    expect(isYouTubeChannelLink('@classicsportsfanatic7183')).toBe(true)
    expect(isYouTubeChannelLink('https://www.youtube.com/@classicsportsfanatic7183/videos')).toBe(true)
    expect(isYouTubeChannelLink('https://www.youtube.com/watch?v=TJiNnqZ0TlM')).toBe(false)
    expect(isYouTubeChannelLink('https://example.org/feed.xml')).toBe(false)
  })

  it('"Add channels…" follows "New channel…", only where many can be added', () => {
    const form = (many: boolean) =>
      renderToStaticMarkup(createElement(AddChannelForm, { nextNumber: 1001, onAdd: async () => '', onNewChannel: async () => {}, ...(many ? { onAddMany: async () => ({ message: '', placed: [] }) } : {}) }))
    const markup = form(true)
    expect(markup).toContain('Add channels…')
    expect(markup.indexOf('Add channels…')).toBeGreaterThan(markup.indexOf('New channel…'))
    expect(form(false)).not.toContain('Add channels…')
  })

  it('IMPORT of a Playlists tab asks one channel or one per playlist; each playlist is added as its own channel', () => {
    const panel = readFileSync('src/components/GuideAdd.tsx', 'utf8')
    expect(panel).toMatch(/if \(!single && onAddMany && isPlaylistsLink\(link\)\)/)
    expect(panel).toContain('A channel per playlist')
    expect(panel).toContain('One channel')
    expect(panel).toContain('.map((playlist) => playlistUrl(playlist.id))')
    const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')
    expect(provider).toMatch(/const result = addChannelSource\(sources, outcome\.value, Date\.now\(\), uploaderIdFor\)/)
    expect(readFileSync('src/components/Guide.tsx', 'utf8').match(/onAddMany=\{addMany\}/g)).toHaveLength(2)
  })
})
