// Find the catalogue videos whose publisher refuses playback outside YouTube.
//
// YouTube's `embeddable` flag misses videos blocked by a rights holder or limited to chosen sites, so each
// video is loaded in a real embedded player, as TVN plays it. No key and no API: only the public player.
//
// Safe by construction (decisions in scripts/embed-probe-core.ts):
//   - few players (default 2) and a start rate limit (default 30 a minute);
//   - a circuit breaker pauses the run when refusals or timeouts spike, distrusts the results around the
//     spike, backs off, and halts after repeated trips;
//   - a refusal is only SUSPECTED until an isolated recheck after a cool-down, beside a control video that
//     plays, refuses again; timeouts and throttled results never confirm anything;
//   - checkpoints after every few results and on Ctrl-C; a rerun resumes where it stopped.
//
//   node scripts/embed_probe.ts --channels 225 [--limit 500] [--workers 2] [--per-minute 30]
//                               [--max-minutes 60] [--recheck-only] [--control <playable id>] [--port 5190]
//   then open http://127.0.0.1:5190/ in one browser tab and leave it open.
//
// Results: scripts/data/embed-probe.json (every observation, with run provenance).
// TVN reads public/independent/playback.json: confirmed refusals only.
import { createServer } from 'node:http'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CircuitBreaker,
  distrustLast,
  migrateCheckpoint,
  observe,
  planBatch,
  planRechecks,
  playbackManifest,
  RateLimiter,
  stateCounts,
  type ProbeCheckpoint,
  type ProbeRun,
} from './embed-probe-core.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECKPOINT = join(ROOT, 'scripts/data/embed-probe.json')
const OUT = join(ROOT, 'public/independent/playback.json')

const argv = process.argv.slice(2)
const option = (name: string, fallback: string) => {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback
}
const flag = (name: string) => argv.includes(`--${name}`)
const PORT = Number(option('port', '5190'))
const CHANNELS = option('channels', '').split(',').filter(Boolean).map(Number)
const LIMIT = option('limit', '') ? Number(option('limit', '')) : undefined
const WORKERS = Math.min(Number(option('workers', '2')), 4)
const PER_MINUTE = Math.min(Number(option('per-minute', '30')), 90)
const MAX_MINUTES = Number(option('max-minutes', '60'))
const RECHECK_ONLY = flag('recheck-only')
if (!CHANNELS.length && !flag('whole-catalogue')) {
  console.error('Name the channels to probe (--channels 225), or pass --whole-catalogue deliberately.')
  process.exit(1)
}

const catalogue = JSON.parse(readFileSync(join(ROOT, 'public/independent/playable.json'), 'utf8'))
const routed = new Map<string, number[]>()
for (const [channel, list] of Object.entries(catalogue.programmeRoutes ?? {}) as [string, string[]][]) {
  for (const id of list) routed.set(id, [...(routed.get(id) ?? []), Number(channel)])
}
const rows = catalogue.items as [string, string, number, string, number[]][]
const channelsById = new Map(rows.map((row) => [row[0], [...(row[4] ?? []), ...(routed.get(row[0]) ?? [])]]))
const ids = rows.map((row) => row[0])
const channelsOf = (id: string) => channelsById.get(id) ?? []

const started = Date.now()
const run: ProbeRun = {
  id: `run-${new Date(started).toISOString()}`,
  startedAt: started,
  args: { channels: CHANNELS, limit: LIMIT ?? 'none', workers: WORKERS, perMinute: PER_MINUTE, maxMinutes: MAX_MINUTES, recheckOnly: RECHECK_ONLY },
  trips: 0,
  observed: 0,
}
const checkpoint: ProbeCheckpoint = existsSync(CHECKPOINT)
  ? migrateCheckpoint(JSON.parse(readFileSync(CHECKPOINT, 'utf8')), { ...run, id: 'legacy-batch', args: { note: 'migrated batch results' } })
  : { format: 'tvn-embed-probe-v2', updatedAt: started, runs: [], records: {} }
checkpoint.runs.push(run)

const scope = { channelsOf, channels: CHANNELS, limit: LIMIT }
const batch = RECHECK_ONLY ? [] : planBatch(ids, checkpoint.records, scope)
const leased = new Set<string>()
const breaker = new CircuitBreaker()
const limiter = new RateLimiter(PER_MINUTE)
const control = option('control', ids.find((id) => checkpoint.records[id]?.state === 'PLAYABLE' && channelsOf(id).some((c) => !CHANNELS.length || CHANNELS.includes(c))) ?? '')
let sinceSave = 0
let stopped: string | null = null

function save() {
  checkpoint.updatedAt = Date.now()
  run.endedAt = checkpoint.updatedAt
  run.trips = breaker.trips
  const temp = `${CHECKPOINT}.tmp`
  writeFileSync(temp, JSON.stringify(checkpoint))
  renameSync(temp, CHECKPOINT)
  const out = `${OUT}.tmp`
  writeFileSync(out, `${JSON.stringify(playbackManifest(ids, checkpoint), null, 2)}\n`)
  renameSync(out, OUT)
  sinceSave = 0
}

function next(now: number): { id: string; mode: 'batch' | 'recheck'; control?: string } | { wait: number } | { done: string } {
  if (stopped) return { done: stopped }
  if (now - started > MAX_MINUTES * 60_000) return { done: (stopped = 'time limit reached') }
  const state = breaker.state(now)
  if (state === 'halted') return { done: (stopped = 'halted: the breaker tripped repeatedly; YouTube is probably throttling') }
  if (state === 'open') return { wait: breaker.resumesAt() - now }
  const wait = limiter.take(now)
  if (wait > 0) return { wait }
  const recheck = planRechecks(ids, checkpoint.records, now, scope).find((id) => !leased.has(id))
  if (recheck && control) {
    leased.add(recheck)
    return { id: recheck, mode: 'recheck', control }
  }
  const id = batch.find((item) => !leased.has(item) && checkpoint.records[item]?.state !== 'PLAYABLE')
  if (!id) return { done: (stopped = RECHECK_ONLY ? 'rechecks done' : 'queue empty') }
  batch.splice(batch.indexOf(id), 1)
  leased.add(id)
  return { id, mode: 'batch' }
}

function accept(result: { id: string; verdict: string; mode: 'batch' | 'recheck'; control?: 'ok' | 'failed' }, origin?: string, agent?: string) {
  const now = Date.now()
  leased.delete(result.id)
  run.observed += 1
  run.origin ??= origin
  run.userAgent ??= agent
  if (result.mode === 'recheck' && result.control !== 'ok') {
    // The control did not play either: this player cannot be trusted right now.
    checkpoint.records[result.id] = observe(checkpoint.records[result.id], { at: now, verdict: result.verdict, mode: 'recheck', run: run.id, control: 'failed' }, true)
    breaker.record(result.id, 'control-failed', now)
  } else {
    const throttled = result.mode === 'batch' && breaker.state(now) !== 'closed'
    checkpoint.records[result.id] = observe(checkpoint.records[result.id], { at: now, ...result, run: run.id }, throttled)
    if (result.mode === 'batch') {
      const { tripped, distrust } = breaker.record(result.id, result.verdict, now)
      if (tripped) {
        for (const id of distrust) {
          const record = checkpoint.records[id]
          if (!record) continue
          checkpoint.records[id] = distrustLast(record, run.id)
          if (!batch.includes(id)) batch.push(id)
        }
        console.log(`breaker tripped (${breaker.trips}); ${distrust.length} results distrusted; paused until ${new Date(breaker.resumesAt()).toISOString()}`)
      }
    }
  }
  if (++sinceSave >= 10) save()
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>TVN embed probe</title>
<style>body{font:13px system-ui;background:#111;color:#ddd}#players{display:flex;gap:6px}#players>*{width:200px;height:112px}</style>
<pre id="log">starting…</pre><div id="players"></div>
<script>
const WORKERS = ${WORKERS}, TIMEOUT_MS = 20000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function makePlayer() {
  const host = document.createElement('div'); document.getElementById('players').appendChild(host)
  return new Promise((ready) => {
    const made = new YT.Player(host, { width: 200, height: 112,
      playerVars: { autoplay: 1, mute: 1, controls: 0, playsinline: 1, rel: 0 },
      events: { onReady: () => { made.mute(); ready(made) },
        onStateChange: (e) => { if (e.data === 1) made.__done?.('ok') },
        onError: (e) => made.__done?.(String(e.data)) } })
  })
}
function play(player, id) {
  return new Promise((resolve) => {
    const finish = (v) => { clearTimeout(t); player.__done = null; player.stopVideo(); resolve(v) }
    const t = setTimeout(() => finish('timeout'), TIMEOUT_MS)
    player.__done = finish
    player.loadVideoById(id)
  })
}
async function worker() {
  const player = await makePlayer()
  for (;;) {
    const job = await (await fetch('/next')).json()
    if (job.done) { document.getElementById('log').textContent += '\\nstopped: ' + job.done; return }
    if (job.wait) { await sleep(Math.min(job.wait, 60000)); continue }
    let control
    if (job.mode === 'recheck') control = (await play(player, job.control)) === 'ok' ? 'ok' : 'failed'
    const verdict = await play(player, job.id)
    await fetch('/result', { method: 'POST', body: JSON.stringify({ id: job.id, verdict, mode: job.mode, control }) })
  }
}
window.onYouTubeIframeAPIReady = () => {
  for (let i = 0; i < WORKERS; i += 1) worker()
  setInterval(async () => { document.getElementById('log').textContent = JSON.stringify(await (await fetch('/status')).json(), null, 1) }, 5000)
}
</script><script src="https://www.youtube.com/iframe_api"></script>`

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`)
  const json = (value: unknown) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(value))
  }
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html' })
    return response.end(PAGE)
  }
  if (url.pathname === '/status') {
    const scoped = CHANNELS.length ? ids.filter((id) => channelsOf(id).some((c) => CHANNELS.includes(c))) : ids
    return json({ run: run.id, breaker: breaker.state(Date.now()), trips: breaker.trips, queued: batch.length, stopped, scope: stateCounts(scoped, checkpoint.records) })
  }
  if (url.pathname === '/next') return json(next(Date.now()))
  if (url.pathname === '/result' && request.method === 'POST') {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      accept(JSON.parse(body), request.headers.origin, request.headers['user-agent'])
      json({ ok: true })
    })
    return
  }
  response.writeHead(404)
  response.end()
})

process.on('SIGINT', () => {
  save()
  process.exit(0)
})
server.listen(PORT, '127.0.0.1', () => {
  save()
  console.log(`embed probe ${run.id} on http://127.0.0.1:${PORT}/ · ${batch.length} queued · control ${control || 'none (rechecks wait)'}`)
})
