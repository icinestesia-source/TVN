import { describe, expect, it } from 'vitest'
import { authorPage, videoFromSearchPage } from './youtube-channel.ts'

describe('a video whose watch page YouTube withholds from the server', () => {
  it('reads the video and its length from the channel search page', () => {
    const data = {
      contents: [
        { videoRenderer: { videoId: 'aaaaaaaaaaa', title: { runs: [{ text: 'Other' }] }, lengthText: { simpleText: '10:00' } } },
        { videoRenderer: { videoId: 'TJiNnqZ0TlM', title: { runs: [{ text: 'Partido completo' }] }, lengthText: { simpleText: '1:46:03' } } },
      ],
    }
    expect(videoFromSearchPage(data, 'TJiNnqZ0TlM')).toEqual({ id: 'TJiNnqZ0TlM', title: 'Partido completo', durationSec: 6363 })
    expect(videoFromSearchPage(data, 'bbbbbbbbbbb')).toBeNull()
  })

  it('skips a listed video too short to schedule', () => {
    const data = { videoRenderer: { videoId: 'TJiNnqZ0TlM', title: { simpleText: 'Clip' }, lengthText: { simpleText: '0:30' } } }
    expect(videoFromSearchPage(data, 'TJiNnqZ0TlM')).toBeNull()
  })

  it('follows only a YouTube channel address from oEmbed', () => {
    expect(authorPage('https://www.youtube.com/@partidoscompletosdelfutbol')).toBe('https://www.youtube.com/@partidoscompletosdelfutbol')
    expect(authorPage('https://www.youtube.com/channel/UCelZX0--CM66erP7PiG2fSQ')).toBe('https://www.youtube.com/channel/UCelZX0--CM66erP7PiG2fSQ')
    expect(authorPage('http://www.youtube.com/@someone')).toBeNull()
    expect(authorPage('https://evil.example/@someone')).toBeNull()
    expect(authorPage('https://www.youtube.com/watch?v=TJiNnqZ0TlM')).toBeNull()
    expect(authorPage(null)).toBeNull()
  })
})
