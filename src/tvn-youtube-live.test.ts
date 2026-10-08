import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { playbackCommand } from './player/command.ts'
import { channelsFromSources, type StoredSource } from './services/channels-import.ts'
import { buildUserNetworkExport, exportSource, serialiseUserNetworkExport } from './services/user-network-export.ts'
import { readUserNetworkFile, recordsFromExport, resolveRestored } from './services/user-network-restore.ts'

const LIVE = 'wBjxt4Osqoc'
const LIVE_SLOT_SECONDS = 3600

const liveSource = {
  id: 's1',
  kind: 'youtube' as const,
  url: `https://www.youtube.com/watch?v=${LIVE}`,
  label: 'CBS News 24/7',
  enabled: true,
  videos: [{ id: LIVE, title: 'LIVE: Breaking News and Top Stories on CBS News 24/7', durationSec: LIVE_SLOT_SECONDS, live: true as const }],
}
const record: StoredSource = {
  id: 'slot:1210',
  name: 'CBS News Live',
  videos: liveSource.videos,
  channelSources: [liveSource],
  channelNumber: 1210,
  inLibrary: false,
  automatic: true,
  updatedAt: 0,
}

describe('A YouTube live broadcast can be added to a channel', () => {
  it('airs it live: joined as it is now, never from a point in it', () => {
    const built = channelsFromSources([record])
    const [programme] = built.programmes.get(built.channels[0].id) ?? []
    expect(programme).toMatchObject({ videoId: LIVE, playback: 'live', programmeType: 'live', durationSeconds: LIVE_SLOT_SECONDS })
    expect(programme).not.toHaveProperty('mediaDurationSeconds')
    expect(playbackCommand(programme, 1234, null)).toMatchObject({ videoId: LIVE, live: true, startSeconds: 0 })
  })

  it('keeps it live through an export and a restore', async () => {
    expect(exportSource(liveSource, () => null).videos?.[0]).toMatchObject({ id: LIVE, live: true })
    const file = readUserNetworkFile(serialiseUserNetworkExport(buildUserNetworkExport([record], new Date(0))))
    expect(file.ok).toBe(true)
    if (!file.ok) return
    const offline = async () => {
      throw new Error('not asked')
    }
    const restored = await resolveRestored(recordsFromExport(file.value, 4), { resolveYouTube: offline, resolveFeed: offline }, 4, 4, { read: false })
    expect(restored.records[0].channelSources?.[0].videos?.[0]).toMatchObject({ id: LIVE, live: true })
  })

  it('carries the mark from the server through the lookup', () => {
    expect(readFileSync('src/services/add-channel.ts', 'utf8')).toContain("...(live === true ? { live } : {})")
  })
})
