import type { CaptionPlayer } from '../player/captions.ts'

export interface YouTubePlayer extends CaptionPlayer {
  destroy(): void
  loadVideoById(args: { videoId: string; startSeconds?: number }): void
  playVideo(): void
  pauseVideo(): void
  stopVideo(): void
  mute(): void
  unMute(): void
  setVolume(volume: number): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getPlayerState(): number
  getCurrentTime(): number
  /** Official IFrame Player API. Seconds, or 0 before metadata is ready. */
  getDuration(): number
  cueVideoById(videoId: string | { videoId: string; startSeconds?: number }): void
  getVideoData?(): { video_id?: string; title?: string }
  setPlaybackQuality?(suggestedQuality: string): void
  /** Official IFrame Player API: the iframe that replaced the host element. */
  getIframe?(): HTMLIFrameElement
}

export interface YouTubePlayerOptions {
  width?: string | number
  height?: string | number
  playerVars?: Record<string, string | number>
  events?: {
    onReady?: (event: { target: YouTubePlayer }) => void
    onStateChange?: (event: { data: number; target: YouTubePlayer }) => void
    onError?: (event: { data: number; target: YouTubePlayer }) => void
    onApiChange?: (event: { target: YouTubePlayer }) => void
  }
}

declare global {
  interface Window {
    YT?: {
      Player: new (element: HTMLElement | string, options: YouTubePlayerOptions) => YouTubePlayer
      PlayerState: {
        UNSTARTED: -1
        ENDED: 0
        PLAYING: 1
        PAUSED: 2
        BUFFERING: 3
        CUED: 5
      }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

export {}
