export type PlayerStatus =
  | 'loading-api'
  | 'playing'
  | 'buffering'
  | 'paused'
  | 'slate'
  | 'ended'
  | 'error'

export type LoadResult = 'playing' | 'slate' | 'error'

export interface PlayerLoadRequest {
  videoId: string | null
  startSeconds: number
  loop: boolean
  /** An official continuous stream: joined at the live edge, and an error if it is no longer live. */
  live?: boolean
  /** A session-channel file, played by the local media element instead of YouTube. */
  localUrl?: string
  /** How long the schedule takes that file to be, so a browser that measures it differently is seeked in proportion. */
  localSeconds?: number
  /** A direct or HLS live stream, also played by the local media element; always joined live. */
  streamUrl?: string
  hls?: boolean
  /** A website or public post: the page shown in a sandboxed frame for its slot, never played as media. */
  webUrl?: string
}

export interface PlayerHandle {
  load(request: PlayerLoadRequest): Promise<LoadResult>
  play(): void
  pause(): void
  seek(seconds: number): void
  setAudible(audible: boolean, volume: number, muted: boolean): void
  currentTime(): number
  actualVideoId(): string | null
}
