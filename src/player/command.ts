import { demoCredit } from '../data/media.ts'
import { sessionUrlFor } from '../session/session-channel.ts'
import type { Programme } from '../types/programme.ts'
import { mediaSeekSeconds } from './seek.ts'
import type { PlayerHandle, PlayerLoadRequest } from './types.ts'
import { notePlayback, type PictureKind } from './trace.ts'

export interface PlaybackCommand extends PlayerLoadRequest {
  programmeId: string
  programmeTitle: string
  mediaId: string | null
  kind: PictureKind
}

/**
 * The broadcast programme chooses the picture.
 * A demonstration film is used only when that programme is itself a seed listing.
 * It is never substituted for a resolved network video, and a missing video stays missing.
 */
export function playbackCommand(programme: Programme, scheduleSeekSeconds: number, override: string | null): PlaybackCommand {
  if (programme.liveStream) {
    return {
      videoId: null,
      streamUrl: programme.liveStream.url,
      hls: programme.liveStream.format === 'hls',
      live: true,
      startSeconds: 0,
      loop: false,
      programmeId: programme.id,
      programmeTitle: programme.title,
      mediaId: programme.sourceRef ?? null,
      kind: 'real',
    }
  }
  const localUrl = sessionUrlFor(programme) ?? programme.mediaUrl
  if (localUrl) {
    return {
      videoId: null,
      localUrl,
      startSeconds: mediaSeekSeconds(scheduleSeekSeconds, programme),
      loop: false,
      programmeId: programme.id,
      programmeTitle: programme.title,
      mediaId: programme.sourceRef ?? null,
      kind: 'real',
    }
  }
  const scheduled = programme.videoId
  const videoId = override ?? scheduled
  const seed = Boolean(scheduled && programme.source === 'demo' && demoCredit(scheduled))
  const kind: PictureKind = !videoId ? 'holding' : seed ? 'seed' : 'real'
  return {
    videoId,
    startSeconds: videoId ? mediaSeekSeconds(scheduleSeekSeconds, programme) : 0,
    loop: programme.playbackMode === 'loop-demo' && kind === 'seed',
    ...(programme.playback === 'live' && videoId === scheduled ? { live: true } : {}),
    programmeId: programme.id,
    programmeTitle: programme.title,
    mediaId: programme.sourceRef ?? null,
    kind,
  }
}

/** Ask the player to render a command. The seek belongs to this video, not the previous one. */
export async function deliver(player: PlayerHandle, command: PlaybackCommand): Promise<Awaited<ReturnType<PlayerHandle['load']>>> {
  notePlayback({
    programmeId: command.programmeId,
    programmeTitle: command.programmeTitle,
    mediaId: command.mediaId,
    expectedVideoId: command.videoId,
    resolvedVideoId: command.videoId,
    requestedVideoId: command.videoId,
    expectedSeek: command.startSeconds,
    lastLoad: command.videoId,
    lastCue: null,
    lastPlay: command.videoId,
    fallbackActive: command.kind !== 'real',
    fallbackReason: command.kind === 'holding' ? 'no playable source on this child' : command.kind === 'seed' ? 'demonstration picture' : null,
    kind: command.kind,
    playerState: 'loading',
  })
  return player.load(command)
}
