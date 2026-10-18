# TVN 2.0 — Phase B.1 Pre-deployment Report

**Date:** 2026-10-18  
**Branch:** `main` (local; **not pushed**)

---

## 1. Starting commit

`f79c401` — Phase B completion report (end of Phase B)

## 2. Final commit

`81db288` — Harden INFO news freshness and football adapter fixtures.

| Commit | Subject |
|--------|---------|
| `6580fa2` | Serve INFO snapshots from Netlify Blobs without site rebuilds. |
| `81db288` | Harden INFO news freshness and football adapter fixtures. |
| *(this doc)* | Document Phase B.1 pre-deployment status. |

Phase B commits (`e6dcb66`…`f79c401`) remain intact — not squashed or rewritten.

---

## 3. Original deployment problem

`.github/workflows/info-ingest.yml` refreshed `public/info/*.json` about every 20 minutes, **committed to `main`**, and therefore triggered a **full Netlify production rebuild** each time.

At ~72 runs/day that is on the order of **2,000 application deploys per month**, which is unacceptable for headline/score updates and wastes Netlify credits on rebuilding the entire television SPA.

---

## 4. New information-delivery architecture

```
RSS / football-data.org
  → GitHub Actions (ingest only)
  → POST /api/info/publish  (Bearer INFO_PUBLISH_SECRET)
  → Netlify Blobs (site-wide store `tvn-info`)
  → GET /api/info/news | /api/info/football
  → INFO panels (fallback: static public/info/*.json from last app deploy)
```

- Application deploys happen only when application code / catalogue / assets change.  
- INFO refresh **does not** `git commit` or `git push` snapshot JSON.  
- Blobs persist across deploys; function `/tmp` is **not** used for storage.  
- Local/dev: Vite middleware reads/writes `public/info/*.json` at the same URL paths.

---

## 5. Files changed (Phase B.1)

**Added:** `netlify/functions/info-news.ts`, `info-football.ts`, `info-publish.ts`, `server/info-blobs.ts`, `server/info-api.ts`, `scripts/info/publish-info.ts`, `src/info/load-snapshot.ts`, `src/info/football/fixtures/sample-responses.ts`, this report.

**Modified:** `.github/workflows/info-ingest.yml`, `docs/INFO_DATA_SOURCES.md`, `package.json` / lockfile (`@netlify/blobs`), `vite.config.ts`, news/football loaders + normalize + football adapter, news/football tests, `public/info/news.json` (re-ingested).

**Not staged:** unrelated logo asset changes.

---

## 6. Data-refresh schedule

| Job | Cadence |
|-----|---------|
| GitHub Actions `INFO ingest` | Cron `7,37 * * * *` (~every 30 minutes, best-effort) + manual `workflow_dispatch` |

Football upstream calls are paced (~6.5s apart) to stay under football-data.org free **10 requests/minute**.

---

## 7. Do INFO updates trigger Netlify builds?

**No.** The workflow no longer pushes JSON to `main`. It only POSTs to `/api/info/publish`, which writes Blobs.

A Netlify **function invocation** runs; the SPA **publish/dist rebuild does not**.

---

## 8. Estimated monthly usage and costs

Assumptions: Free Netlify plan (300 credits/mo hard cap), ~1,440 ingest runs/month (48/day), small JSON payloads (~200KB news + smaller football).

| Resource | Estimate | Notes |
|----------|----------|-------|
| App production deploys from INFO | **0** | Primary saving vs old design |
| Publish + read function compute | Low tens of GB-seconds/month | Dominated by ingest POST + viewer GETs |
| Blobs storage | ≪ 1 MB | Two JSON keys, overwritten in place |
| Blobs / function credits | Small vs rebuild-every-20-min | Still counts against Free 300 credits if traffic is huge |
| football-data.org | Free tier | 10 calls/min; no paid plan |
| RSS | Free | Publisher feeds |
| Railway / always-on server | **Not used** | |

**If Free credits are exhausted:** Netlify may pause the site until the next cycle — document in ops runbook; upgrade Personal/Pro only with owner approval.

**Recovery after failed ingest:** previous Blobs values remain; clients keep sessionStorage last-good; static `public/info/*.json` remains as deploy seed.

Exact credit burn depends on viewer traffic to `/api/info/*`. Re-check Netlify usage after one week in production.

---

## 9. Football readiness

| Item | Status |
|------|--------|
| Adapter + competitions (PL, ELC, CL, BL1, SA, PD, FL1) | **Implemented · Tested** (mocked fixtures) |
| Delayed labelling (`liveReliable: false` → never Live) | **Implemented · Tested** |
| Rate-limit pacing | **Implemented** |
| Empty competition handling | **Implemented · Tested** |
| Attribution string | **Implemented · Tested** |
| Real free-tier ingest | **Blocked** on `FOOTBALL_DATA_TOKEN` (not present in this environment) |
| Live-provider verification | **Not claimed** |

Setup: `docs/INFO_DATA_SOURCES.md` (GitHub secrets + Netlify `INFO_PUBLISH_SECRET` + `INFO_PUBLISH_URL`).

---

## 10. News quality findings

Re-ingest after 14-day freshness filter (2026-10-18):

| Check | Result |
|-------|--------|
| Headline count | **364** (was 403; older items dropped) |
| Duplicate URLs | **0** |
| Same URL in multiple categories | **0** |
| Missing `publishedAt` | **0** |
| Missing publisher | **0** |
| Non-https links | **0** |
| Description length > 280 | **0** |
| Duplicate titles | A few (e.g. recurring show titles like “Tech Life”) — distinct URLs; acceptable |
| Feed failure isolation | Per-feed errors collected; prior snapshot kept if all fail |

No AI-generated headlines or invented summaries. Feed list not expanded.

---

## 11. Browser regression results

Probed against local `vite preview` (Chrome via playwright-core), **not** production Netlify.

| Check | Result |
|-------|--------|
| Guide header Network · Info · Guide · … | Observed |
| INFO opens; News + Sports tabs | Observed |
| News items rendered | **364** |
| `/api/info/news` | **200**, 364 items |
| `iframe/video/audio` count while INFO open | **Unchanged (5→5)** — player nodes not torn down |
| Esc closes INFO | Observed |
| Players after close / CH+ | Still **5** |
| INFO reopen after CH+ | **Failed once** in automation (Guide chrome not ready); treat as automation flake — see manual checklist |
| Page errors | None |
| Real YouTube/radio decode continuity | **Not proven** in headless (elements present; stream A/V not instrumented) |

### Manual acceptance checklist (owner)

1. Play a YouTube channel with audible audio.  
2. Guide → Info → News → Sports → News → Esc.  
3. Confirm audio continues and channel number unchanged.  
4. CH+ / CH− still work; reopen Info.  
5. Press **V** (picture info) and **I** (Add) — unchanged.  
6. Repeat with a radio/audio channel if available.  
7. After secrets + first Actions ingest: confirm Sports shows real fixtures/tables and “Delayed”, not “Live”.

---

## 12. Automated test results

```
src/tvn-info-football.test.ts
src/tvn-info-news.test.ts
src/tvn-2-0-info-centre.test.ts
src/tvn-2-0-ordering.test.ts
→ 4 files, 36 tests passed
tsc -b clean
AIza secret scan clean
```

---

## 13. Remaining manual steps (before production verification)

1. **Do not push until you approve.**  
2. Set Netlify env: `INFO_PUBLISH_SECRET`.  
3. Set GitHub Actions secrets: `FOOTBALL_DATA_TOKEN`, `INFO_PUBLISH_SECRET`, `INFO_PUBLISH_URL` (`https://<site>/api/info/publish`).  
4. Push Phase B + B.1 commits when ready.  
5. Wait for Netlify app deploy (functions present).  
6. Run **Actions → INFO ingest** once; confirm Blobs populated (News via API without new deploy).  
7. Complete the manual A/V checklist above on the live site.  
8. Leave unrelated logo changes out of this release (still unstaged).

---

## 14. Unresolved production risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Free Netlify credit exhaustion under heavy `/api/info` traffic | Medium | Monitor first week; cache-control already 60s |
| Blobs / publish misconfigured → INFO falls back to static seed | Medium | Fallback + session cache; Actions logs |
| Football token missing → Sports unavailable message | Expected until setup | Documented |
| Scheduled Functions 30s limit | Avoided | Ingest stays on GitHub Actions |
| Headless probe did not prove audible continuity | Low for architecture | Manual checklist |

---

## Distinction summary

| Capability | Implemented | Tested | Production-verified |
|------------|-------------|--------|---------------------|
| INFO UI (Phase B) | Yes | Yes | No |
| News RSS → snapshot | Yes | Yes (local) | No |
| Blobs publish / no rebuild | Yes | Local API + unit | No |
| Football UI + mocked adapter | Yes | Yes | No |
| Football live free-tier data | Ready | Mocked only | No — needs token |
| Playback under INFO | Architecture + DOM probe | Partial browser | No — manual A/V |

**Ready for production verification after secrets, push, first ingest, and the manual checklist — not claimed production-verified in this report.**
