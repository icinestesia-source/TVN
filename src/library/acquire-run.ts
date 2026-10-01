import { createYouTubeMetadataProbe } from '../player/youtube-metadata.ts'
import { librarySnapshot } from './store.ts'
import { resolveDiscoveryRecords, type DiscoveryRecord } from './youtube-resolve.ts'

const BRIDGE = 'http://127.0.0.1:8765'
let started = false

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** Pulls enumerated discovery records and resolves them with the existing player probe. */
export async function runQueuedAcquisition(): Promise<void> {
  if (started) return
  started = true
  const probe = createYouTubeMetadataProbe()
  try {
    for (;;) {
      const response = await fetch(`${BRIDGE}/batch`)
      if (!response.ok) {
        await wait(2000)
        continue
      }
      const body = (await response.json()) as { records: DiscoveryRecord[]; done: boolean }
      if (body.records.length === 0) {
        if (body.done) return
        await wait(1500)
        continue
      }
      const result = await resolveDiscoveryRecords(body.records, { probes: [probe] })
      const wanted = new Set(body.records.map((record) => record.providerItemId))
      const resolved = librarySnapshot().media.filter(
        (item) => wanted.has(item.externalId) && item.ingestedFrom === 'youtube-discovery',
      )
      await fetch(`${BRIDGE}/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: body.records.map((record) => record.providerItemId),
          resolved,
          errors: result.errors,
        }),
      })
    }
  } finally {
    probe.close?.()
  }
}
