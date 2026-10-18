# TVN 2.0 — Hosting Comparison (Netlify vs Railway)

**Status:** assessment only — no migration  
**Current production shape (confirmed):** Netlify static `dist` + `netlify/functions` (`channel`, `feed`) · SPA redirects · Node 22

---

## 1. What must stay working

| Capability | Today | Constraint |
|------------|-------|------------|
| Static SPA + assets | Netlify CDN | Must remain fast globally |
| `/api/channel`, `/api/feed` | Serverless functions | Keyless; already server-side |
| Catalogue JSON | `/independent/*`, `/user-network/*` | Short cache headers already set |
| Secrets for new sports/news | **None today** | Must never ship in browser |
| Scheduled ingest | **None** | Needed for NEWS/SPORTS freshness |
| Chat (future) | Absent | Needs persistent connections or polled store + moderation |

Preserve the working Netlify deploy until any replacement is independently verified (rollback plan required).

---

## 2. Workload classification

| Workload | Needs server? | Needs schedule? | Needs persistent DB? | Fit |
|----------|---------------|-----------------|----------------------|-----|
| SPA + logos + catalogue | No | No | No | Static CDN (Netlify) |
| Channel/feed lookup | Yes (short) | No | No | Serverless OK |
| News/football ingest | Yes | **Yes** | Optional (Blob/JSON) | Scheduled fn **or** worker **or** CI |
| Published `info/*.json` | No (once built) | Producer only | Object storage | CDN |
| Chat | Yes | Soft | **Yes** | Always-on or managed realtime — **not** justified yet |
| Local media convert | No (client/Mac) | No | No | Keep off cloud |

---

## 3. Options

### Option H1 — Stay on Netlify (recommended default)

| Piece | Approach |
|-------|----------|
| Site | Unchanged |
| Ingest | Netlify **Scheduled Functions** (when available on plan) **or** GitHub Action cron that builds `public/info/*.json` and deploys |
| Secrets | Netlify env for `FOOTBALL_DATA_TOKEN`, feed allowlist config |
| Cache | Write snapshots to publish dir or Netlify Blobs |

**Pros:** No DNS/migration risk; matches current mental model; CDN excellent for SPA.  
**Cons:** Credit-based limits; long-running jobs awkward; chat later may still need another host.

### Option H2 — Hybrid (recommended if ingest grows)

| Piece | Host |
|-------|------|
| SPA + static catalogue | **Netlify** (unchanged) |
| Ingest worker + secrets | **Railway** (small service) or GitHub Action |
| Optional `/api/info/*` | Railway or Netlify fn reading shared Blob/S3 |

**Pros:** Best of both; migrate only what needs a clock.  
**Cons:** Two bills / two dashboards.

### Option H3 — Full move to Railway

| Piece | Approach |
|-------|----------|
| Serve `dist` + APIs + cron | Single Railway service or static+worker split |

**Pros:** Simpler “one server” mental model for developers.  
**Cons:** Re-implements CDN/SPA hosting TVN already has; domain cutover risk; **not free**; no strong reason while functions stay small.

**Do not migrate “because a traditional server is easier”.** Migrate when Scheduled ingest + secrets + runtime limits force it.

---

## 4. Cost sketch (indicative, 2026 public pricing)

Figures change; re-check before committing spend. Distinguish **free allowance**, **subscription**, and **usage**.

### 4.1 Netlify (credit-based plans)

| Plan | List price | Notes |
|------|------------|-------|
| Free | $0 | **300 credits/mo hard cap** — site can pause when exhausted |
| Personal | ~$9/mo | More credits |
| Pro | ~$20/mo | Team features, more credits |

Credit examples (vendor docs): bandwidth ~20 credits/GB; function compute ~10 credits/GB-hour; production deploys consume credits.

**TVN today:** static-heavy + two light functions → Free/Personal often enough until INFO ingest + traffic grow.  
**Risk:** large catalogue downloads + many function invocations on Free can hit the hard cap.

### 4.2 Railway

| Plan | List price | Notes |
|------|------------|-------|
| Free | $0 + small monthly credit | Limited; not a production assumption |
| Hobby | **$5/mo** subscription | Includes **$5** usage credit; **not free** |
| Pro | $20/mo | Includes $20 usage |

Usage examples: RAM ~$10/GB-month, CPU ~$20/vCPU-month, egress ~$0.05/GB.

**Small always-on ingest worker** can stay near Hobby floor if slept or run on cron-like schedule; a 24/7 fat instance will exceed $5 usage.

### 4.3 Sports / news data

| Item | Cost |
|------|------|
| football-data.org Free (delayed) | €0 |
| Live scores tier | from €12/mo |
| More English pyramid cups/leagues | paid tiers (see sports plan) |
| RSS news | €0 (bandwidth/compute only) |

### 4.4 Combined scenarios

| Scenario | Rough monthly |
|----------|----------------|
| Netlify Free + CI cron JSON + football free | **$0** (within credit caps) |
| Netlify Personal + scheduled fn + football free | ~**$9** |
| Netlify + Railway Hobby ingest + football free | ~**$5–14** |
| Above + football live | add **€12+** |
| Full Railway hosting + live football | **$5–20+** usage-dependent |

---

## 5. Secrets and env

| Secret | Where |
|--------|-------|
| `FOOTBALL_DATA_TOKEN` | Host env / CI secret — never Vite `define` into client |
| Future news API keys | Same |
| Existing | `/api/channel` and `/api/feed` remain keyless by design |

Mirror pattern of `COMMIT_REF` for build metadata only.

---

## 6. Deployment / rollback checklist (any migration)

1. Env vars documented and present in target  
2. Build: `npm run build` identical artefact test  
3. `/api/channel` and `/api/feed` smoke tests  
4. Custom domain + TLS  
5. Health URL for worker (if any)  
6. Monitoring / log access  
7. Cost alerts / credit caps  
8. **Rollback:** previous Netlify deploy restore within minutes  

---

## 7. Recommendation

1. **Phase B:** keep Netlify; publish INFO JSON via **CI schedule** or Netlify scheduled function if plan allows.  
2. Add Railway **only** for a dedicated ingest worker if CI/deploy cadence or secrets handling becomes painful (**H2**).  
3. Defer full Railway cutover (**H3**) and chat hosting until Phase F requirements are real.  
4. Re-evaluate costs after one month of INFO traffic metrics.

---

## 8. Acceptance criteria for “hosting decision”

- Written choice H1 / H2 / H3 with owner sign-off  
- Secret scan still clean  
- Rollback tested once  
- Budget line items listed (host + football tier)  
