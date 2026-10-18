/**
 * Every PNG dropped into src/assets/logos (1 to 99 of them, square) is a TVN logo. The build keeps only
 * each file's URL in the script, never the image bytes, so a page load downloads just the one it picks.
 *
 * Local WIP logos may sit untracked in the folder; only commit square PNGs that pass startup tests.
 */
export const MAX_LOGOS = 99

export const LOGOS: readonly string[] = Object.values(
  import.meta.glob<string>('../assets/logos/*.png', { eager: true, query: '?url', import: 'default' }),
)

export function pickLogo(logos: readonly string[] = LOGOS, random: () => number = Math.random): string {
  if (logos.length === 0) return ''
  return logos[Math.min(logos.length - 1, Math.floor(random() * logos.length))]
}

/** Chosen once per page load, so the loading and sleep screens show the same logo. */
export const SESSION_LOGO = pickLogo()
