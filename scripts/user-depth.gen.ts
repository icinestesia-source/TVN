import { readFileSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { calculateSchedule } from '../src/scheduler/calculate.ts'
import { SCHEDULE_EPOCH_MS } from '../src/scheduler/epoch.ts'
import { channelsFromSources, mergeParsedExports, parseChannelsExport, planImport } from '../src/services/channels-import.ts'
import { parsePlaybackManifest } from '../src/services/embed-refusals.ts'
import { setShippedArchive, uploaderArchive } from '../src/services/user-archive.ts'
import type { Channel } from '../src/types/channel.ts'
import type { Programme } from '../src/types/programme.ts'

const DAY = Date.UTC(2026, 8, 30, 5, 0, 0)

function day(channel: Channel, programmes: readonly Programme[]) {
  const aired: string[] = []
  const lastStart = new Map<string, number>()
  let minRepeatMinutes = Infinity
  let at = DAY
  while (at < DAY + 86_400_000) {
    const snap = calculateSchedule({ channelId: channel.id, phaseOffsetSeconds: channel.phaseOffsetSeconds, programmes, epochMs: SCHEDULE_EPOCH_MS, nowMs: at })
    const id = snap.current.programme.videoId ?? ''
    const previous = lastStart.get(id)
    if (previous !== undefined) minRepeatMinutes = Math.min(minRepeatMinutes, (snap.current.startMs - previous) / 60_000)
    lastStart.set(id, snap.current.startMs)
    aired.push(id)
    at = snap.current.endMs + 1
  }
  const cycleMinutes = programmes.reduce((sum, programme) => sum + programme.durationSeconds, 0) / 60
  let backToBack = 0
  for (let index = 1; index < aired.length; index += 1) if (aired[index] === aired[index - 1]) backToBack += 1
  const counts = new Map<string, number>()
  for (const id of aired) counts.set(id, (counts.get(id) ?? 0) + 1)
  return {
    airings: aired.length,
    unique: counts.size,
    backToBack,
    maxAirings: Math.max(...counts.values()),
    minRepeatShare: Number.isFinite(minRepeatMinutes) ? +(minRepeatMinutes / cycleMinutes).toFixed(2) : null,
  }
}

it('measures User Network depth before and after', () => {
  const texts = ['public/user-network/channels.txt', 'public/user-network/more-channels.txt'].map((path) => readFileSync(path, 'utf8'))
  const merged = mergeParsedExports(texts.map((text) => parseChannelsExport(text)))
  const sources = planImport([], merged, { library: true, automatic: true }, [], 1).sources
  const refused = new Set(parsePlaybackManifest(JSON.parse(readFileSync('public/user-network/playback.json', 'utf8'))))
  const before = new Map<string, Programme[]>()
  for (const source of sources) {
    if (source.channelNumber === null) continue
    before.set(
      `user-${source.id}`,
      source.videos.map((video, index) => ({
        id: `p${index}`,
        title: video.title,
        videoId: video.id,
        durationSeconds: video.durationSec,
      })) as Programme[],
    )
  }
  setShippedArchive(JSON.parse(readFileSync('public/user-network/uploaders.json', 'utf8')))
  const after = channelsFromSources(sources, { refused, archive: uploaderArchive })
  const rows = after.channels.map((channel) => {
    const source = sources.find((entry) => `user-${entry.id}` === channel.id)!
    const list = after.programmes.get(channel.id) ?? []
    const was = before.get(channel.id) ?? []
    const distinct = new Set(list.map((programme) => programme.videoId))
    const own = list.filter((programme) => !programme.id.includes('-a-'))
    const uploader = uploaderArchive(source)
    const allowed = new Set([...source.videos.map((video) => video.id), ...(uploader?.videos ?? []).map((video) => video.id)])
    return {
      number: channel.number,
      name: channel.name,
      eligibleOwn: source.videos.length,
      refused: source.videos.filter((video) => refused.has(video.id)).length,
      beforePool: was.length,
      beforeDay: day(channel, was),
      afterDistinct: distinct.size,
      afterOwnDistinct: new Set(own.map((programme) => programme.videoId)).size,
      uploader: uploader?.title ?? null,
      uploaderArchivePlayable: uploader?.videos.length ?? 0,
      afterEarlierUploads: new Set(list.filter((programme) => programme.id.includes('-a-')).map((programme) => programme.videoId)).size,
      otherUploaders: list.filter((programme) => !allowed.has(programme.videoId ?? '')).length,
      afterCycleHours: +(list.reduce((sum, programme) => sum + programme.durationSeconds, 0) / 3600).toFixed(2),
      afterDay: day(channel, list),
    }
  })
  writeFileSync(process.env.USER_DEPTH_OUT ?? 'docs/user-network-depth.json', `${JSON.stringify(rows, null, 2)}\n`)
})
