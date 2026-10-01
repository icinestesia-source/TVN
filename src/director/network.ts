/** Default network clock. Schedules are built in this zone, not in UTC. */
export const NETWORK_SEED = 'RETROTV'
export const POLICY_VERSION = 'policy-v1'
/**
 * Stage 4E discarded v3–v6. Stage 5A discards v7. v9 discards days that
 * still contain holding gaps left by block geometry. v10 discards 000–999
 * days compiled from user-network catalogues. v11 drops schedules that
 * still contain excluded space or religion programmes. v43 discards days
 * whose blocks looped a short clip or held where a fresh programme would fit.
 * The freeze rule itself is unchanged.
 */
export const CATALOGUE_VERSION = 'catalogue-v43'
export const DEFAULT_TIME_ZONE = 'Europe/London'
/** Television day opens at this local time. Overnight programmes stay on the previous day. */
export const BROADCAST_DAY_START = '06:00'
export const SCHEDULE_VERSION = 1

let timeZone = DEFAULT_TIME_ZONE
let catalogueVersion = CATALOGUE_VERSION

export function networkTimeZone(): string {
  return timeZone
}

export function setNetworkTimeZone(zone: string): void {
  timeZone = zone
}

export function resetNetwork(): void {
  timeZone = DEFAULT_TIME_ZONE
  catalogueVersion = CATALOGUE_VERSION
}

export function currentCatalogueVersion(): string {
  return catalogueVersion
}

/** Scheduling-relevant library identity. Empty library stays on the baseline version. */
export function setCatalogueVersion(version: string): void {
  catalogueVersion = version || CATALOGUE_VERSION
}

export function scheduleSeed(channelNumber: number, broadcastDate: string): string {
  return [NETWORK_SEED, String(channelNumber), broadcastDate, POLICY_VERSION, currentCatalogueVersion()].join('|')
}
