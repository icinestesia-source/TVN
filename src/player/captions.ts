/**
 * The caption surface of the embedded YouTube IFrame player. These functions live on the
 * player object but are absent from YouTube's IFrame API reference, so each one is optional.
 */
export interface CaptionPlayer {
  loadModule?(name: string): void
  unloadModule?(name: string): void
  getOptions?(module?: string): string[] | undefined
  getOption?(module: string, option: string): unknown
  setOption?(module: string, option: string, value: unknown): void
}

interface CaptionTrack {
  languageCode?: string
  kind?: string
}

export function subtitlesNotice(on: boolean): string {
  return on ? 'SUBTITLES ON' : 'SUBTITLES OFF'
}

function viewerLanguage(): string {
  const language = typeof navigator === 'undefined' ? '' : navigator.language
  return (language || 'en').slice(0, 2).toLowerCase()
}

function pickTrack(tracks: CaptionTrack[], language: string): CaptionTrack | undefined {
  const written = tracks.filter((track) => track.kind !== 'asr')
  const matches = (track: CaptionTrack) => track.languageCode?.toLowerCase().startsWith(language)
  return written.find(matches) ?? tracks.find(matches) ?? written[0] ?? tracks[0]
}

function attempt(action: () => void): void {
  try {
    action()
  } catch {
    // A player that cannot take the request plays on without captions.
  }
}

/** Applies RetroTV's global subtitle preference to every video the player loads. */
export class CaptionController {
  private on: boolean
  private applied = false
  private readonly language: string

  constructor(on: boolean, language = viewerLanguage()) {
    this.on = on
    this.language = language
  }

  get enabled(): boolean {
    return this.on
  }

  /** A new video was requested; its captions follow the preference once it plays. */
  loadRequested(): void {
    this.applied = false
  }

  setPreference(on: boolean, player: CaptionPlayer | null): void {
    this.on = on
    this.applied = false
    if (player) this.videoPlaying(player)
  }

  videoPlaying(player: CaptionPlayer): void {
    if (this.applied) return
    this.applied = true
    if (this.on) {
      attempt(() => player.loadModule?.('captions'))
      this.chooseTrack(player)
    } else {
      this.hide(player)
    }
  }

  /** YouTube loaded or changed a player module, which it may do from its own remembered caption setting. */
  modulesChanged(player: CaptionPlayer): void {
    if (this.on) this.chooseTrack(player)
    else if (this.captionsLoaded(player)) this.hide(player)
  }

  private captionsLoaded(player: CaptionPlayer): boolean {
    let modules: string[] | undefined
    attempt(() => {
      modules = player.getOptions?.()
    })
    return Array.isArray(modules) && modules.includes('captions')
  }

  private hide(player: CaptionPlayer): void {
    attempt(() => player.setOption?.('captions', 'track', {}))
    attempt(() => player.unloadModule?.('captions'))
  }

  private chooseTrack(player: CaptionPlayer): void {
    let current: unknown
    let list: unknown
    attempt(() => {
      current = player.getOption?.('captions', 'track')
      list = player.getOption?.('captions', 'tracklist')
    })
    if ((current as CaptionTrack | undefined)?.languageCode) return
    if (!Array.isArray(list) || list.length === 0) return
    const track = pickTrack(list as CaptionTrack[], this.language)
    if (track?.languageCode) attempt(() => player.setOption?.('captions', 'track', { languageCode: track.languageCode }))
  }
}
