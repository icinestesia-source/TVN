import { handleChannelRequest } from '../server/youtube-channel.ts'
import { handleFeedRequest } from '../server/podcast-feed.ts'
import { USER_AGENT } from '../server/web-read.ts'
import { lookUpBatch, lookUpChannel, playlistUrl } from '../src/services/add-channel.ts'
import { lookUpFeed } from '../src/services/podcast-source.ts'
import type { Pacing } from './config.ts'
import type { Reader } from './importer.ts'
import type { FreshProgramme } from './merge.ts'

/** How a source's last visit went. Never a reason to delete it. */
export const SOURCE_OUTCOMES = ['OK', 'NO CHANGE', 'NEW CONTENT', 'TEMPORARY FAILURE', 'NOT FOUND', 'PRIVATE/RESTRICTED', 'EMBED REFUSED', 'UNSUPPORTED', 'DISABLED'] as const
export type SourceOutcome = (typeof SOURCE_OUTCOMES)[number]
export type FailureOutcome = Extract<SourceOutcome, 'TEMPORARY FAILURE' | 'NOT FOUND' | 'PRIVATE/RESTRICTED' | 'EMBED REFUSED' | 'UNSUPPORTED'>

/** STOP was pressed: whatever was in flight is abandoned and nothing from it is kept. */
export class Stopped extends Error {
  constructor() {
    super('Stopped')
  }
}

export class ReadFailure extends Error {
  readonly outcome: FailureOutcome
  constructor(outcome: FailureOutcome, message: string) {
    super(message)
    this.outcome = outcome
  }
}

/** A wait that STOP cuts short. */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Stopped())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Stopped())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

const YOUTUBE_HOSTS = /(^|\.)(youtube\.com|youtu\.be|ytimg\.com|googlevideo\.com|youtube-nocookie\.com)$/

/** Requests are paced per provider: all of YouTube is one provider, anything else its own host. */
export function providerOf(url: string): string {
  try {
    const host = new URL(url).hostname
    return YOUTUBE_HOSTS.test(host) ? 'youtube' : host
  } catch {
    return 'other'
  }
}

interface Lane {
  active: number
  waiting: (() => void)[]
  lastStart: number
  coolUntil: number
}

/**
 * Every provider request goes through here: at most `concurrency` in flight per provider, at least `gapMs`
 * between starts, a timeout on each, a cool-down when a provider answers 429, and STOP aborting the lot.
 */
export class Pacer {
  private readonly lanes = new Map<string, Lane>()
  requests = 0
  private readonly pacing: Pacing
  private readonly signal: AbortSignal
  private readonly base: typeof fetch
  private readonly clock: () => number

  constructor(pacing: Pacing, signal: AbortSignal, base: typeof fetch = fetch, clock: () => number = Date.now) {
    this.pacing = pacing
    this.signal = signal
    this.base = base
    this.clock = clock
  }

  private lane(name: string): Lane {
    let lane = this.lanes.get(name)
    if (!lane) {
      lane = { active: 0, waiting: [], lastStart: 0, coolUntil: 0 }
      this.lanes.set(name, lane)
    }
    return lane
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const lane = this.lane(providerOf(url))
    if (this.signal.aborted) throw new Stopped()
    while (lane.active >= Math.max(1, this.pacing.concurrency)) await new Promise<void>((resolve) => lane.waiting.push(resolve))
    lane.active += 1
    try {
      for (let attempt = 0; ; attempt += 1) {
        // Each request reserves its own start, so requests waiting together still go out `gapMs` apart.
        const startAt = Math.max(this.clock(), lane.coolUntil, lane.lastStart + this.pacing.gapMs)
        lane.lastStart = startAt
        if (startAt > this.clock()) await pause(startAt - this.clock(), this.signal)
        this.requests += 1
        const signal = AbortSignal.any([this.signal, AbortSignal.timeout(this.pacing.requestTimeoutMs), ...(init?.signal ? [init.signal] : [])])
        const response = await this.base(input, { ...init, signal })
        if (response.status !== 429 || attempt >= 2) return response
        lane.coolUntil = this.clock() + this.pacing.cooldownMs
      }
    } finally {
      lane.active -= 1
      lane.waiting.shift()?.()
    }
  }
}

/**
 * TVN's own lookups, answered in process: the client functions the viewer uses (lookUpChannel, lookUpFeed)
 * call `/api/channel` and `/api/feed`, and these hand those calls to the same server handlers Netlify runs.
 * Every answer's status and body is kept, so a failure can be told apart and refusals counted.
 */
export function localApi(read: typeof fetch): { fetch: typeof fetch; calls: { status: number; body: unknown }[] } {
  const calls: { status: number; body: unknown }[] = []
  const local: typeof fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, 'http://harvester.local')
    const handler = url.pathname === '/api/channel' ? handleChannelRequest : url.pathname === '/api/feed' ? handleFeedRequest : null
    const answer = handler ? await handler(url, read) : { status: 404, body: { error: 'Not a TVN lookup' } }
    calls.push(answer)
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })
  }
  return { fetch: local, calls }
}

export interface ReadSource {
  reader: Reader
  sourceType: string
  url: string
  providerId: string | null
  uploaderChannelId: string | null
}

export interface ReadResult {
  programmes: FreshProgramme[]
  /** Videos the provider listed but refused for embedded playback. */
  refused: number
  /** How many the provider says it lists, when it says. */
  listed?: number
  /** Provider requests made. */
  requests: number
  /** A source that can only be checked, not listed: it answered. */
  checked?: boolean
}

/** Where a YouTube source is read again: its canonical channel or playlist address, as TVN's rescan does. */
export function youTubeAddress(source: ReadSource): string {
  if (source.reader === 'collection') return `https://www.youtube.com/channel/${source.uploaderChannelId}`
  const id = source.providerId ?? ''
  if (/^UC[\w-]{22}$/.test(id)) return `https://www.youtube.com/channel/${id}`
  if (/^(PL|OL|UU|FL)[\w-]{10,64}$/.test(id)) return playlistUrl(id)
  return source.url
}

function failureOf(calls: readonly { status: number; body: unknown }[], error: unknown): ReadFailure {
  const last = [...calls].reverse().find((call) => call.status !== 200)
  const message = (last?.body as { error?: unknown } | undefined)?.error
  const text = typeof message === 'string' ? message : error instanceof Error ? error.message : 'The source could not be read'
  const status = last?.status ?? 0
  if (status === 404) return new ReadFailure('NOT FOUND', text)
  if (status === 401 || status === 403 || /sign-in|subscription|private|members/i.test(text)) return new ReadFailure('PRIVATE/RESTRICTED', text)
  if (status === 422 && /outside YouTube|embed/i.test(text)) return new ReadFailure('EMBED REFUSED', text)
  if (status === 400 || status === 422) return new ReadFailure('UNSUPPORTED', text)
  return new ReadFailure('TEMPORARY FAILURE', text)
}

const refusedIn = (calls: readonly { status: number; body: unknown }[]) =>
  calls.reduce((sum, call) => sum + (typeof (call.body as { refused?: unknown } | null)?.refused === 'number' ? ((call.body as { refused: number }).refused) : 0), 0)

/**
 * Read one source the way TVN reads it. An audit reads wide (TVN's ALL: several listing pages); an
 * incremental read takes the newest page and, only while everything on it is new, follows the list on
 * until it meets a programme already held.
 */
export async function readSource(source: ReadSource, depth: 'audit' | 'incremental', known: ReadonlySet<string>, pacer: Pacer, catchUp: number, signal: AbortSignal): Promise<ReadResult> {
  const before = pacer.requests
  const api = localApi(pacer.fetch)
  const done = (result: Omit<ReadResult, 'requests'>): ReadResult => {
    if (signal.aborted) throw new Stopped()
    return { ...result, requests: pacer.requests - before }
  }
  try {
    if (source.reader === 'youtube' || source.reader === 'collection') {
      let found
      try {
        found = await lookUpChannel(youTubeAddress(source), api.fetch, depth === 'audit' ? { mode: 'all' } : {})
      } catch (error) {
        if (signal.aborted) throw new Stopped()
        // A list that answers but holds nothing TVN can schedule is an empty read, not a failure.
        if (api.calls.at(-1)?.status === 200) return done({ programmes: [], refused: refusedIn(api.calls) })
        throw failureOf(api.calls, error)
      }
      const programmes: FreshProgramme[] = [...found.videos]
      let next = found.next
      for (let batch = 0; depth === 'incremental' && next && batch < catchUp && programmes.every((video) => !known.has(video.id)); batch += 1) {
        if (signal.aborted) throw new Stopped()
        const more = await lookUpBatch(next, api.fetch).catch(() => null)
        if (!more) break
        programmes.push(...more.videos)
        next = more.next
      }
      return done({ programmes, refused: refusedIn(api.calls), ...(found.listed !== undefined ? { listed: found.listed } : {}) })
    }
    if (source.reader === 'podcast') {
      let feed
      try {
        feed = await lookUpFeed(source.url, api.fetch, depth === 'audit' ? { mode: 'all' } : {})
      } catch (error) {
        if (signal.aborted) throw new Stopped()
        throw failureOf(api.calls, error)
      }
      // A recording's media address is read again on restore and never kept.
      const programmes = feed.episodes.map(({ id, title, durationSec, published, summary, image, page }) => ({
        id,
        title,
        durationSec,
        ...(published ? { published } : {}),
        ...(summary ? { summary } : {}),
        ...(image ? { image } : {}),
        ...(page ? { page } : {}),
      }))
      return done({ programmes, refused: 0 })
    }
    if (source.reader === 'website' || source.reader === 'stream') return done(await checkAddress(source, pacer))
    throw new ReadFailure('UNSUPPORTED', 'Nothing to read')
  } catch (error) {
    if (error instanceof Stopped || signal.aborted) throw new Stopped()
    if (error instanceof ReadFailure) throw error
    throw new ReadFailure('TEMPORARY FAILURE', error instanceof Error ? error.message : 'The source could not be read')
  }
}

/** A website or stream has no list to read: Harvester checks it answers, and for a page, that it may be framed. */
async function checkAddress(source: ReadSource, pacer: Pacer): Promise<Omit<ReadResult, 'requests'>> {
  let response: Response
  try {
    response = await pacer.fetch(source.url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' })
  } catch (error) {
    if (error instanceof Stopped) throw error
    throw new ReadFailure('TEMPORARY FAILURE', 'The address did not answer')
  }
  await response.body?.cancel().catch(() => undefined)
  if (response.status === 404 || response.status === 410) throw new ReadFailure('NOT FOUND', `The address answers ${response.status}`)
  if (response.status === 401 || response.status === 403) throw new ReadFailure('PRIVATE/RESTRICTED', `The address answers ${response.status}`)
  if (!response.ok) throw new ReadFailure('TEMPORARY FAILURE', `The address answers ${response.status}`)
  if (source.reader === 'website') {
    const frame = (response.headers.get('x-frame-options') ?? '').toLowerCase()
    const ancestors = /frame-ancestors\s+([^;]*)/i.exec(response.headers.get('content-security-policy') ?? '')?.[1]?.trim().toLowerCase()
    if (frame === 'deny' || frame === 'sameorigin' || ancestors === "'none'" || ancestors === "'self'") throw new ReadFailure('EMBED REFUSED', 'The page does not allow framing')
  }
  return { programmes: [], refused: 0, checked: true }
}
