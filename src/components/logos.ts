/**
 * Every PNG dropped into src/assets/logos (1 to 30 of them, square) is a TVN logo. Only the URLs are bundled, so a
 * page load fetches just the one it picks.
 */
export const LOGOS: readonly string[] = Object.values(
  import.meta.glob<string>('../assets/logos/*.png', { eager: true, import: 'default' }),
)

export function pickLogo(logos: readonly string[] = LOGOS, random: () => number = Math.random): string {
  return logos[Math.min(logos.length - 1, Math.floor(random() * logos.length))]
}

/** Chosen once per page load, so the loading and sleep screens show the same logo. */
export const SESSION_LOGO = pickLogo()
