# TVN 2.0 — INFO Release Readiness

**Date:** 2026-10-18  
**Branch:** `main`  
**Release-prep base:** `1a3e072` (EL1↔PPL swap + this readiness doc introduced)  
**Production tip (origin/main):** `6aefa9f` — *v2.3*  
**This document does not authorise push or deploy.**  
Confirm tip with `git rev-parse --short HEAD` before push.

---

## 1. Release status

| Item | Status |
|------|--------|
| Phase B → B.3 code | Complete on local `main` |
| League allocation | **League One (EL1) replaces Primeira Liga (PPL)** in the active 12; PPL held aside in `DEFERRED_FOOTBALL_COMPETITIONS` |
| Unrelated logo assets | **Unstaged / untracked** — must not be included in the release push |
| Credentials in git | **None found** in INFO/CI paths (scan for embedded tokens clean) |
| TypeScript (`tsc -b`) | **Pass** |
| Production build (`npm run build`) | **Pass** |
| INFO + export regression tests | **46 passed** (see §2) |
| Live football entitlement | **Not verified here** — run Actions after push |
| INFO Blobs publish secrets | **Confirm before ingest** (`INFO_PUBLISH_*`) |
| Push / deploy | **Not performed** |

**Overall:** Ready for product-owner-approved push **after** configuring remaining publish secrets and excluding logos. Not production-verified until the post-deploy checklist below is completed.

---

## 2. Test results (executed)

```
npx tsc -b
npm run build
npx vitest run \
  src/tvn-info-b3.test.ts \
  src/tvn-info-football.test.ts \
  src/tvn-info-news.test.ts \
  src/tvn-info-weather.test.ts \
  src/tvn-2-0-info-centre.test.ts \
  src/tvn-2-0.test.ts
```

**Result:** Typecheck OK · Build OK · **46 tests passed**.

Smoke (SSR markup): INFO modules `news`, `sports`, `weather` present; football list length **12** including `EL1`, excluding `PPL`.

**Not claimed:** live audio/video playback in a browser session during this pass.

---

## 3. Repository readiness

### Branch and commits

- Branch: `main`, **ahead of `origin/main` by ~15+ commits** (Phase B–B.3 + this prep).
- Production/last known remote tip: **`6aefa9f` (`v2.3`)**.
- Phase B.2 end: `82e5c9e`. Phase B.3 end before prep: `65d38e9`.

### Uncommitted / excluded

| Path | Action |
|------|--------|
| `src/assets/logos/*.png` (untracked) | **Do not add** |
| `src/components/logos.ts`, `src/state/startup.test.ts` (logo limit churn) | **Do not commit** for this release unless deliberately approved |

### Blocking issues

| Severity | Issue | Resolution |
|----------|-------|------------|
| None blocking build | — | — |
| Pre-deploy config | `INFO_PUBLISH_SECRET` / `INFO_PUBLISH_URL` may be unset | Configure before first live ingest (§4) |
| Post-deploy | EL1 may be `unavailable` on free token | Run **INFO football verify**; if unavailable, decide product response — do not invent data |

---

## 4. Required secrets

| Secret | GitHub Actions | Netlify site env | Same value? |
|--------|----------------|------------------|-------------|
| `FOOTBALL_DATA_TOKEN` | **Yes** (already configured) | No | N/A — never needed by Netlify functions |
| `INFO_PUBLISH_SECRET` | **Yes** | **Yes** | **Yes — identical Bearer secret** |
| `INFO_PUBLISH_URL` | **Yes** | No | Full URL to publish endpoint on the live site |

### Precise setup

**1. Generate a long random secret** (e.g. 32+ bytes hex). This is `INFO_PUBLISH_SECRET`.

**2. Netlify** → Site configuration → Environment variables → Add:

- Key: `INFO_PUBLISH_SECRET`
- Value: *(the secret)*
- Scopes: include **Functions** / production (and preview if you want preview publish)
- Redeploy once after adding so functions see the variable

**3. GitHub** → Repository → Settings → Secrets and variables → Actions → Add:

- `FOOTBALL_DATA_TOKEN` — already set  
- `INFO_PUBLISH_SECRET` — **same string as Netlify**  
- `INFO_PUBLISH_URL` — `https://<your-production-hostname>/api/info/publish`  
  (custom domain or `*.netlify.app`; must match the site that has the publish function)

### Publishing authentication

`netlify/functions/info-publish.ts`:

- Method: **POST only**
- Requires `Authorization: Bearer <INFO_PUBLISH_SECRET>`
- Missing secret → **503**; wrong token → **401**
- Writes Netlify Blobs only; **does not** trigger an SPA rebuild

### Rebuilds

INFO ingest workflow (`INFO ingest`) runs `info:news` / `info:football` / `info:publish` and **does not** `git push`. Snapshot updates therefore **do not** trigger Netlify application rebuilds.

---

## 5. Football entitlement verification

Workflow: **`.github/workflows/info-football-verify.yml`** (`INFO football verify`)

| Property | Confirmed |
|----------|-----------|
| Manual trigger | `on: workflow_dispatch` only |
| Token exposure | Secret via env; log scrub for long hex; never echoed |
| Reports competitions | `competition_<CODE>=data_ok\|unavailable\|empty\|not_configured` |
| Deferred PPL | Logged as `deferred_PPL=held_aside` |
| API errors | Printed as redacted `error=` lines; ingest keeps prior snapshot on hard failure |
| Production data | **No `info:publish` step** — runner workspace only |

Do **not** assume League One is available until this workflow reports `competition_EL1=data_ok`.

---

## 6. Exact deployment sequence

1. **Configure secrets** (§4): Netlify `INFO_PUBLISH_SECRET`; GitHub `INFO_PUBLISH_SECRET` + `INFO_PUBLISH_URL` (confirm `FOOTBALL_DATA_TOKEN`).
2. **Confirm clean release tree:** no logo files staged (`git status`). Commit only intentional release prep if still uncommitted.
3. **Push** (product-owner action):  
   `git push origin main`  
   *(Not done in this pass.)*
4. **Wait for Netlify** production deploy of the new commit to finish (SPA + functions).
5. **Run INFO football verify** (Actions → workflow_dispatch). Record EL1/BSA/WC/EC statuses.
6. **Run INFO ingest** (Actions → **INFO ingest** → Run workflow). Prefer force-football on first run.
7. **Confirm snapshots:** open `https://<site>/api/info/news` and `/api/info/football` (or INFO UI). Check update timestamps, headlines, tables/fixtures. Confirm EL1 behaviour matches verify result.
8. **Check weather:** INFO → Weather → Today / Locations / units (Open-Meteo).
9. **Check television:** tune a channel, open Guide → Info (playback continuity); confirm **V** still picture info and **I** still Add — no INFO keyboard steal.
10. **Netlify usage:** Site → Usage — confirm function/Blob traffic, **no** rebuild storm from ingest.

---

## 7. Manual acceptance checklist

- [ ] Logos / unrelated assets not in the pushed commit  
- [ ] Netlify + GitHub publish secrets configured (same secret value)  
- [ ] Production deploy green  
- [ ] INFO → News loads; Sources prefs persist after reload  
- [ ] INFO → Sports → Football: My Football / Today / Results / Fixtures / Tables / Leagues  
- [ ] League One visible; data matches verify outcome (no invented table)  
- [ ] Favourite team/league survive reload  
- [ ] INFO → Weather units/locations persist  
- [ ] Complete TVN export/import restores `settings.info` without breaking User Network  
- [ ] Older export without `settings.info` still imports  
- [ ] Radio/TV continue when INFO opens *(operator check)*  
- [ ] Ingest run does not create a new Netlify **deploys** entry  

---

## 8. Rollback procedure (do not execute here)

**Last known production commit:** `6aefa9f` (`v2.3` on `origin/main`).

Safe approach if the new deploy causes serious regressions:

1. In Netlify: **Deploys** → select the last good production deploy → **Publish deploy** (instant rollback of SPA/functions to that build).  
2. Optionally reset git tip only with product-owner approval:  
   `git revert` of the INFO merge range (preferable to force-push), or Netlify-only rollback if Blobs already hold good news/football.  
3. Blobs: if a bad ingest overwrote football/news, re-run **INFO ingest** from a known-good commit, or republish previous local snapshots via authenticated publish.  
4. Do **not** `git push --force` to `main` unless explicitly ordered.

This pass **does not** perform rollback.

---

## 9. Football competition allocation (release prep)

| Active (12) | Deferred |
|-------------|----------|
| PL, ELC, **EL1**, CL, BL1, SA, PD, FL1, DED, BSA, WC, EC | **PPL** (Primeira Liga) — product choice so League One takes a free-tier slot |

Restore PPL later by swapping it back into `FOOTBALL_COMPETITIONS` and moving another code to `DEFERRED_FOOTBALL_COMPETITIONS` after entitlement review.

---

## 10. INFO functionality confirmation (code / tests)

| Area | Evidence |
|------|----------|
| NEWS / SPORTS / WEATHER open | `INFO_MODULES` + InfoCentre tests |
| Playback not remounted by INFO | `tvn-2-0-info-centre.test.ts` (player/Guide structure) |
| Football navigation | FootballPanel + fixture tests |
| Favourites / prefs persist | `preferences.ts` + B.3 tests |
| Export/import | `PortableSettings.info` + `validateTvnExport` / B.3 + `tvn-2-0` export tests |
| User Network compatibility | Existing `tvn-export-v1` version unchanged; `info` optional |

---

## 11. Distinguishing status

| | Implemented | Tested locally | Deployed | Production-verified |
|--|-------------|----------------|----------|---------------------|
| INFO Phase B–B.3 | Yes | Yes | No | No |
| EL1 for PPL allocation | Yes | Yes | No | Entitlement pending Actions |
| Blobs publish path | Yes | Partial (B.1) | No | Pending secrets + ingest |

---

**End of release-preparation pass. No push. No deploy.**
