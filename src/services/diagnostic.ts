import { mediaLibrary } from '../director/library.ts'
import { CATALOGUE_VERSION, POLICY_VERSION } from '../director/network.ts'
import { dynamicChannel, DYNAMIC_VERSION } from '../dynamic/providers.ts'
import { originalCard, originalFormat, ORIGINALS_VERSION } from '../originals/originals.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import { onScreen } from '../player/manual.ts'

export interface DiagnosticContext {
  playerStatus: string
  playerDetail?: string
  viewport?: { width: number; height: number; ratio: number }
  userAgent?: string
}

/** What the viewer is looking at, in the terms the runtime audit uses. */
export function airingClass(channel: Channel, programme: Programme): string {
  if (channel.number > 999) return 'USER_CHANNEL'
  if (programme.playback === 'live') return 'LIVE'
  const format = originalFormat(channel.number)
  if (format) return format.kind === 'night-block' && programme.videoId ? 'RETROTV_ORIGINAL' : 'GENERATED'
  if (!programme.videoId) return programme.caption ? (originalCard(channel.number)?.class ?? 'CARD') : 'HOLDING'
  return dynamicChannel(channel.number) ? 'REAL_DYNAMIC' : 'REAL_STATIC'
}

const iso = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString() : 'live, no end')
const pad = (number: number) => String(number).padStart(3, '0')

/**
 * A plain-text block a tester can copy into a report. It is built on the device and never sent
 * anywhere; it holds no credentials because the application has none.
 */
export function userTestDiagnostic(channel: Channel, nowMs: number, context: DiagnosticContext): string {
  const snapshot = onScreen(channel, nowMs)
  const { programme, startMs, endMs, seekSeconds } = snapshot.current
  const source = programme.videoId
    ? ((mediaLibrary().find((item) => item.externalId === programme.videoId) as { sourceId?: string } | undefined)?.sourceId ?? programme.source)
    : 'none'
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const lines = [
    'TVN DIAGNOSTIC · LOCAL ONLY · NOTHING IS SENT',
    `Time: ${iso(nowMs)} (${zone})`,
    `Versions: ${CATALOGUE_VERSION} · ${DYNAMIC_VERSION} · ${ORIGINALS_VERSION} · ${POLICY_VERSION}`,
    `Channel: ${pad(channel.number)} ${channel.name}`,
    `Airing: ${airingClass(channel, programme)}`,
    `Programme: ${programme.title}`,
    `Programme id: ${programme.id}`,
    `Video: ${programme.videoId ?? 'none'}`,
    ...(programme.liveStream ? [`Stream: ${programme.liveStream.format} · ${programme.liveStream.url}`] : []),
    `Source: ${source}`,
    `Slot: ${iso(startMs)} to ${iso(endMs)}`,
    `Offset: ${Math.round(seekSeconds)} s of ${Math.round(programme.durationSeconds)} s`,
    ...(programme.caption ? [`Caption: ${programme.caption}`] : []),
    `Next: ${snapshot.next.programme.title} at ${iso(snapshot.next.startMs)}`,
    `Player: ${context.playerStatus}${context.playerDetail ? ` · ${context.playerDetail}` : ''}`,
    ...(context.viewport ? [`Viewport: ${context.viewport.width}x${context.viewport.height} @${context.viewport.ratio}`] : []),
    ...(context.userAgent ? [`Browser: ${context.userAgent}`] : []),
  ]
  return lines.join('\n')
}
