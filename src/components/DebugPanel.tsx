import { useEffect, useState } from 'react'
import { lastBootstrapTimings } from '../data/user-network/bootstrap.ts'
import { networkRepetition, type RepetitionReport } from '../network/repetition.ts'
import { contentIntegrity } from '../player/integrity.ts'
import { playbackTrace, subscribePlaybackTrace } from '../player/trace.ts'
import { channelFeed } from '../network/airing.ts'
import { mediaLibrary } from '../director/library.ts'
import { coverageSummary, networkCoverage } from '../network/coverage.ts'
import { directorStats, inspectDirector, invalidateSchedule } from '../director/director.ts'
import { addCalendarDays } from '../director/time.ts'
import { resolveSource } from '../player/resolve.ts'
import { mediaSeekSeconds } from '../player/seek.ts'
import { useTv } from '../state/tv-context.ts'
import { onScreen } from '../player/manual.ts'
import { useClock } from '../utils/use-clock.ts'
import { formatElapsed, padChannel } from '../utils/time.ts'

/** Development-only schedule inspector. Omitted from production builds. */
export function DebugPanel() {
  const now = useClock(1000)
  const tv = useTv()
  const [rebuilt, setRebuilt] = useState(0)
  const snapshot = onScreen(tv.channel, now)
  const director = inspectDirector(tv.channel, now)
  const current = snapshot.current
  const playerSeek = mediaSeekSeconds(current.seekSeconds, current.programme)
  const source = resolveSource(current.programme, tv.channel.mediaKind ?? 'video')
  const actual = tv.playerRef.current?.currentTime() ?? 0
  const coverage = networkCoverage()
  const totals = coverageSummary(coverage)
  const here = coverage.find((row) => row.number === tv.channel.number)
  const [traceTick, setTraceTick] = useState(0)
  useEffect(() => subscribePlaybackTrace(() => setTraceTick((count) => count + 1)), [])
  const trace = playbackTrace()
  const integrity = contentIntegrity({
    displayedTitle: trace.programmeTitle || current.programme.title,
    scheduleTitle: current.programme.title,
    mediaId: trace.mediaId,
    scheduleMediaId: current.programme.sourceRef ?? null,
    expectedVideoId: trace.expectedVideoId,
    actualVideoId: trace.actualVideoId,
    contentKind: trace.kind,
  })
  const [repetition, setRepetition] = useState<RepetitionReport | null>(null)
  const timings = lastBootstrapTimings
  const feed = channelFeed(mediaLibrary(), tv.channel.number)
  const compiled = director
    ? director.blocks.reduce((sum, block) => sum + Math.max(0, block.children - block.fallbacks), 0)
    : null
  const feedNote =
    feed.eligible > 0 && compiled === 0
      ? 'scheduling bug: eligible media did not compile'
      : feed.eligible === 0
        ? 'classification: nothing on this channel is eligible'
        : 'programming compiled'

  return (
    <aside className="debug" data-rebuild={rebuilt} data-trace={traceTick}>
      <p className="debug-title">Playback</p>
      <dl>
        <dt>Expected</dt>
        <dd>{trace.expectedVideoId ?? '—'}</dd>
        <dt>Actual</dt>
        <dd>{trace.actualVideoId ?? '—'}</dd>
        <dt>Match</dt>
        <dd>{trace.expectedVideoId && trace.actualVideoId === trace.expectedVideoId ? 'yes' : 'no'}</dd>
        <dt>Kind</dt>
        <dd>{trace.kind}{trace.fallbackReason ? ` · ${trace.fallbackReason}` : ''}</dd>
        <dt>Integrity</dt>
        <dd>{integrity.ok ? 'ok' : integrity.reasons.join('; ')}</dd>
        <dt>Programme</dt>
        <dd>{trace.programmeTitle || '—'}</dd>
        <dt>State</dt>
        <dd>
          {trace.playerState} · seek {trace.expectedSeek.toFixed(0)}s · {trace.lastError ?? 'no error'}
        </dd>
        <dt>Last load</dt>
        <dd>{trace.lastLoad ?? '—'}</dd>
      </dl>
      <p className="debug-title">Repetition</p>
      <button type="button" onClick={() => setRepetition(networkRepetition(now))}>
        Measure network
      </button>
      {repetition ? (
        <p>
          {repetition.configured} channels · {repetition.uniqueVideoIds} unique videos · {repetition.duplicateVideoIds.length} duplicated now
        </p>
      ) : null}
      {timings ? (
        <p>
          Bootstrap {timings.skipped ? 'skipped' : 'ran'} · read {timings.read.toFixed(0)} · parse {timings.parse.toFixed(0)} · classify {timings.classify.toFixed(0)} · total {timings.total.toFixed(0)} ms
        </p>
      ) : null}
      <p className="debug-title">Director feed</p>
      <p>
        Library {feed.total} · built-in {feed.builtIn} · eligible {feed.eligible} · rejected {feed.rejected} · {feed.hours.toFixed(1)} h · {feed.sources} sources · compiled {compiled ?? '—'}
      </p>
      <p>{feedNote}</p>
      <p className="debug-title">Network</p>
      <p>
        {totals.populated} populated · {totals.thin} thin · {totals.empty} empty · {totals.media} programmes · {(totals.seconds / 3600).toFixed(1)} h
      </p>
      {here ? (
        <p>
          {here.number} {here.name} · {here.status} · {here.eligibleCount} eligible · {(here.eligibleSeconds / 3600).toFixed(1)} h
        </p>
      ) : null}
      <p className="debug-title">Schedule</p>
      <dl>
        <dt>Channel</dt>
        <dd>
          {padChannel(tv.channel.number)} {tv.channel.name}
        </dd>
        <dt>Programme</dt>
        <dd>{current.programme.title}</dd>
        <dt>Epoch</dt>
        <dd>{new Date(snapshot.epochMs).toISOString()}</dd>
        <dt>Start</dt>
        <dd>{new Date(current.startMs).toISOString()}</dd>
        <dt>End</dt>
        <dd>{Number.isFinite(current.endMs) ? new Date(current.endMs).toISOString() : 'live, no end'}</dd>
        <dt>Elapsed</dt>
        <dd>
          {current.elapsedSeconds.toFixed(1)}s · {formatElapsed(current.elapsedSeconds)}
        </dd>
        <dt>Seek</dt>
        <dd>{current.seekSeconds.toFixed(1)}s</dd>
        <dt>Player seek</dt>
        <dd>
          {playerSeek.toFixed(1)}s · {current.programme.playbackMode}
        </dd>
        <dt>Player time</dt>
        <dd>{actual.toFixed(1)}s</dd>
        <dt>Source</dt>
        <dd>
          {source.type} · {source.sourceId}
        </dd>
        <dt>Player</dt>
        <dd>
          {tv.playerStatus}
          {tv.playerDetail ? ` · ${tv.playerDetail}` : ''}
        </dd>
        <dt>Multiview</dt>
        <dd>
          {tv.multiviewMode} · focus {tv.audioFocus + 1}
          {tv.muted ? ' · muted' : ' · audio'}
        </dd>
        <dt>Next</dt>
        <dd>{snapshot.next.programme.title}</dd>
        {director ? (
          <>
            <dt>Director</dt>
            <dd>
              {director.policy} · {director.dayKind} · {director.cache}
            </dd>
            <dt>Date</dt>
            <dd>{director.broadcastDate}</dd>
            <dt>Seed</dt>
            <dd>{director.seed}</dd>
            <dt>Catalogue</dt>
            <dd>
              {director.catalogueVersion} · {director.policyVersion}
            </dd>
            <dt>Block</dt>
            <dd>
              {director.blockTitle ?? '—'}
              {director.eventHook ? ` · ${director.eventHook}` : ''}
            </dd>
            <dt>Child</dt>
            <dd>
              {director.childTitle ?? '—'}
              {director.fallback ? ' · fallback' : ''}
            </dd>
            <dt>Penalties</dt>
            <dd>{director.penalties.length ? director.penalties.join(', ') : 'none'}</dd>
            <dt>Compile</dt>
            <dd>
              {directorStats.lastCompileMs.toFixed(1)} ms · {directorStats.materialised} days · gen {director.generation}
            </dd>
          </>
        ) : null}
      </dl>
      {director ? (
        <button
          type="button"
          onClick={() => {
            invalidateSchedule(director.channelNumber, director.broadcastDate)
            setRebuilt((count) => count + 1)
          }}
        >
          Rebuild this day
        </button>
      ) : null}
      {director ? (
        <button
          type="button"
          onClick={() => {
            invalidateSchedule(director.channelNumber, addCalendarDays(director.broadcastDate, 1))
            setRebuilt((count) => count + 1)
          }}
        >
          Rebuild tomorrow
        </button>
      ) : null}
    </aside>
  )
}
