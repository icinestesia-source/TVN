import { channelByNumber } from './data/catalogue.ts'

declare const __TVN_BUILD__: string | undefined
declare const __TVN_COMMIT__: string | undefined
declare const __TVN_BUILT_AT__: string | undefined

/** Which application this is, fixed when it was built: the commit it came from and when. */
export const BUILD_INFO = {
  app: 'TVN',
  commit: typeof __TVN_COMMIT__ === 'string' && __TVN_COMMIT__ ? __TVN_COMMIT__ : 'dev',
  builtAt: typeof __TVN_BUILT_AT__ === 'string' && __TVN_BUILT_AT__ ? __TVN_BUILT_AT__ : 'dev',
  build: typeof __TVN_BUILD__ === 'string' ? __TVN_BUILD__ : 'dev',
}

/** The reserved and recently reassigned positions, as this running application resolves them. */
export const CANARY_CHANNELS = [0, 555, 586, 1000]

export function channelIdentityLine(): string {
  return CANARY_CHANNELS.map((number) => `${String(number).padStart(3, '0')} ${channelByNumber(number)?.name ?? 'missing'}`).join(' · ')
}
