# TVN 2.0 — Phase B Completion Report

**Date:** 2026-10-18  
**Branch:** `main` (local; not pushed by this work)

---

## 1. Starting commit

`6aefa9f` — `v2.3` (audit baseline)

## 2. Final commit

`3cc837c` — `Add INFO Football with delayed free-tier data.`

| Stage | Commit | Subject |
|-------|--------|---------|
| B1 | `e6dcb66` | Add INFO centre between Network and Guide. |
| B2 | `cfd1657` | Add INFO News with scheduled RSS ingest. |
| B3 | `3cc837c` | Add INFO Football with delayed free-tier data. |

---

## 3. Files added

| Path | Role |
|------|------|
| `src/components/InfoCentre.tsx` | INFO Guide panel |
| `src/components/info/NewsPanel.tsx` | News UI |
| `src/components/info/SportsPanel.tsx` | Sports → Football shell |
| `src/components/info/FootballPanel.tsx` | Football UI |
| `src/info/news/*` | News types, feeds, normalize, load |
| `src/info/football/*` | Football types, competitions, normalize, load, football-data.org adapter |
| `scripts/info/ingest-news.ts` | RSS ingest → `public/info/news.json` |
| `scripts/info/ingest-football.ts` | API ingest → `public/info/football.json` |
| `public/info/news.json` | Published news snapshot (403 headlines at ingest time) |
| `public/info/football.json` | Placeholder until `FOOTBALL_DATA_TOKEN` is set |
| `.github/workflows/info-ingest.yml` | Scheduled refresh + git push → Netlify rebuild |
| `docs/INFO_DATA_SOURCES.md` | Sources and secret setup |
| `docs/TVN_2.0_*.md` | Audit baseline (B1) |
| `src/tvn-2-0-info-centre.test.ts` | INFO shell tests |
| `src/tvn-info-news.test.ts` | News tests |
| `src/tvn-info-football.test.ts` | Football tests |
| `docs/TVN_2.0_PHASE_B_COMPLETION_REPORT.md` | This report |

## 4. Files modified

`src/types/input.ts`, `src/view/guide-tool.ts`, `src/state/TvProvider.tsx`, `src/components/GuideAdd.tsx`, `src/components/Guide.tsx`, `src/styles/guide.css`, `src/tvn-2-0-ordering.test.ts`, `package.json`

---

## 5. INFO functionality delivered

| Item | Status |
|------|--------|
| Header order Network → Info → Guide → Options → Now → Add → Media | **Implemented · Tested** |
| Tool id `infocentre` (not `info`) | **Implemented · Tested** |
| Opens/closes as Guide panel over picture | **Implemented · Tested** (architecture; no player remount) |
| V still picture info; I still Add; no new shortcut | **Implemented · Tested** |
| Modules: News, Sports only | **Implemented · Tested** |
| Deployed / verified in production | **Not deployed** (commits ahead of origin; not pushed) |

---

## 6. NEWS functionality delivered

| Item | Status |
|------|--------|
| Allowlisted BBC + Guardian RSS | **Implemented** |
| Ingest with timeout, validate, normalize, dedupe | **Implemented · Tested** |
| `public/info/news.json` with real headlines | **Implemented · Verified locally** (403 items on 2026-10-18) |
| UI: categories, publisher, time, description, link, updated/stale | **Implemented · Tested** (unit/markup) |
| GitHub Action publishes via commit → Netlify | **Implemented** (needs push + workflow permission) |
| Verified in production | **Not verified** |

---

## 7. FOOTBALL functionality delivered

| Item | Status |
|------|--------|
| Provider-independent model + football-data.org adapter | **Implemented · Tested** |
| UI: Today / Fixtures / Results / Tables / Competitions | **Implemented · Tested** (markup/unit) |
| Delayed labelling (`liveReliable: false` → never Live) | **Implemented · Tested** |
| Free competitions: PL, ELC, CL, BL1, SA, PD, FL1 | **Configured** |
| Live API snapshot with fixtures/tables | **Not populated** — awaiting `FOOTBALL_DATA_TOKEN` |
| Secret kept server/CI only | **Implemented · Tested** (scan) |
| Verified in production | **Not verified** |

---

## 8. Data sources selected

- **News:** BBC News and The Guardian public RSS (see `docs/INFO_DATA_SOURCES.md`).  
- **Football:** football-data.org free tier (delayed scores/schedules/tables).

## 9. Data update mechanism

1. `npm run info:news` / `npm run info:football` write `public/info/*.json`.  
2. `.github/workflows/info-ingest.yml` runs on a ~20 minute cron (and manually).  
3. Workflow commits changed JSON and pushes → Netlify rebuilds from `main`.  

This is an actual publish path (not CI-only artefacts). It requires the workflow’s `contents: write` push to succeed on the GitHub remote.

## 10. Environment variables required

| Name | Where | Required for |
|------|-------|----------------|
| `FOOTBALL_DATA_TOKEN` | GitHub Actions secret (and optional local env) | Football ingest |

No Vite/`import.meta.env` exposure. No news API key.

## 11. Test results

Targeted suite (2026-10-18):

```
src/tvn-2-0-info-centre.test.ts
src/tvn-info-news.test.ts
src/tvn-info-football.test.ts
src/tvn-2-0-ordering.test.ts
src/tvn-bookmarks-and-keys.test.ts
→ 5 files, 54 tests passed
```

`tsc -b` clean for Phase B changes.  
Secret scan for `AIza…` keys: clean (rg exit 1 = no matches).

Pre-existing logo dimension failures in `startup.test.ts` were **not** addressed (unrelated assets remain unstaged).

## 12. Known limitations

1. Football snapshot is a placeholder until the free API token is installed.  
2. Free football tier: no genuine Live badge; no League One/Two, FA Cup, Scottish Premiership.  
3. GitHub Actions cron is best-effort (not exact 15–30 minute guarantees).  
4. INFO open → playback continuity is guaranteed by mount architecture; not re-probed in a browser session in this Phase B pass.  
5. Commits are **local only** until someone pushes `main`.  
6. News descriptions are publisher excerpts truncated to 280 characters — not AI summaries.

## 13. Deployment status

| Step | Status |
|------|--------|
| Code committed locally | **Yes** (3 Phase B commits) |
| Pushed to GitHub | **No** (not performed) |
| Netlify production deploy of INFO | **No** |
| INFO ingest workflow enabled on remote | **After push** |
| Production verification of live news/football | **No** |

## 14. Remaining product-owner actions

1. **Push** the three Phase B commits (and this report) to GitHub when ready.  
2. Create free **football-data.org** token and add GitHub secret `FOOTBALL_DATA_TOKEN` (steps in `docs/INFO_DATA_SOURCES.md`).  
3. Run **Actions → INFO ingest → Run workflow** once and confirm `public/info/football.json` gains matches/tables.  
4. Confirm Netlify redeployed and spot-check Guide → Info → News / Sports in production.  
5. Optionally unstage or separately commit the pending logo asset changes (not part of Phase B).

---

## Distinction summary

| Capability | Implemented | Tested | Deployed | Verified in production |
|------------|-------------|--------|----------|------------------------|
| INFO tab | Yes | Yes | No | No |
| News (real RSS → JSON) | Yes | Yes (local ingest + unit) | No | No |
| Football UI + model | Yes | Yes | No | No |
| Football live free-tier data | Code ready | Unit only | No | No — needs token |

**Do not treat News or Football as production-verified until push, workflow, and a live browser check are done.**
