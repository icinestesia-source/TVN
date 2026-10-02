/** Saturated colours that read against the grey noise; one is picked each time TVN loads. Gold stays the percentage's. */
export const RING_COLOURS = ['#4fd8ff', '#ff5fa2', '#7dff6a', '#ff8a3d', '#b48cff', '#ff4b4b', '#3dffd0'] as const

export function ringColour(random: () => number = Math.random): string {
  return RING_COLOURS[Math.floor(random() * RING_COLOURS.length) % RING_COLOURS.length]
}
