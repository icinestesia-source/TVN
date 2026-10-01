/**
 * Creative Commons demonstration pictures.
 * These are stand-in films for the receiver. They are not the scheduled programmes.
 * Longer slots loop the picture; the schedule boundaries stay fixed.
 */
export interface DemoFilm {
  videoId: string
  mediaDurationSeconds: number
  title: string
  credit: string
}

export const DEMO_FILMS: readonly DemoFilm[] = [
  {
    videoId: 'aqz-KE-bpKQ',
    mediaDurationSeconds: 600,
    title: 'Big Buck Bunny',
    credit: 'Blender Foundation, CC BY',
  },
  {
    videoId: 'eRsGyueVLvQ',
    mediaDurationSeconds: 880,
    title: 'Sintel',
    credit: 'Blender Foundation, CC BY',
  },
  {
    videoId: '41hv2tW5Lc4',
    mediaDurationSeconds: 720,
    title: 'Tears of Steel',
    credit: 'Blender Foundation, CC BY',
  },
  {
    videoId: 'YE7VzlLtp-4',
    mediaDurationSeconds: 590,
    title: 'Big Buck Bunny',
    credit: 'Blender Foundation, CC BY',
  },
]

export function demoCredit(videoId: string | null | undefined): string | null {
  if (!videoId) return null
  const film = DEMO_FILMS.find((entry) => entry.videoId === videoId)
  if (!film) return null
  return `${film.title} · ${film.credit}`
}
