/** The volume every source reaches; above it is boost, which only 1000 Local Media's own files can take. */
export const VOLUME_FULL = 100
export const VOLUME_BOOST_MAX = 200

/** The loudest the viewer may set on this channel: 200 on 1000 Local Media, 100 everywhere else. */
export function volumeLimit(boostable: boolean): number {
  return boostable ? VOLUME_BOOST_MAX : VOLUME_FULL
}

/** A media element's own volume, which stops at 1. */
export function elementVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume / VOLUME_FULL))
}

/** The gain added after the element: 1 up to full volume, then up to 2 at the boost maximum. */
export function boostGain(volume: number): number {
  return Math.min(VOLUME_BOOST_MAX, Math.max(VOLUME_FULL, volume)) / VOLUME_FULL
}

/** Only a file from this device (an object URL) can be boosted: the browser hands its sound to the page. */
export function boostableUrl(url: string | undefined): boolean {
  return Boolean(url?.startsWith('blob:'))
}
