# TVN 2.0 — Phase E Release Candidate Report

**Date:** 2026-10-18  
**Branch:** `main` (local)  
**Status:** Release candidate ready for product-owner review — **not pushed**, **not deployed**, **no production ingest**

---

## 1. Starting and final commits

| | Commit |
|--|--------|
| **Phase E engineering start** | `373243c` — Record Phase D.1 final commit in the completion report. |
| **Phase E stabilisation** | `0b64f80` — Stabilise TVN 2.0 INFO for the Phase E release candidate. |
| **Sports empty-state fix** | `5e027e0` — Fix Sports fixtures empty state when football data is unpublished. |
| **Phase E end (this RC)** | *(recorded after final commit)* |

`origin/main` currently includes Phase E stabilisation through `c667a0f` (V1.98a). Local commits ahead incorporate the Sports diagnostic and snapshot-safety finalisation.

---

## 2. Git status (at Phase E finalisation)

| Item | Value |
|------|--------|
| Branch | `main` |
| History rewrite | **None** |
| Push / deploy / production ingest | **Not performed** |
| Sports diagnostic doc | `docs/TVN_2_0_SPORTS_FIXTURES_FIX.md` |

---

## 3. Changes made (Phase E + Sports incorporation)

| Area | Change |
|------|--------|
| TMDB auth | Shape-based credentials: JWT Read Access Token under `TMDB_API_TOKEN` → `Authorization: Bearer` |
| Finance | 30-minute server cache; Markets load once per panel session |
| Shopping | Empty-product copy; hide Official partners filter until partners exist |
| Sports UI | **DATA NOT YET PUBLISHED** / competition-unavailable / no-matches / provider-error; postponed on Fixtures; **Last update** time |
| Football safety | Merge prior competition rows when another competition fails; refuse empty Blob overwrite; skip empty football publish |
| Tests | Guide/Info/Options/Playback/`requestTune` expectations; TMDB; Phase E; Sports fixtures; snapshot-safety |
| Docs | This report; Sports fix report; `INFO_DATA_SOURCES.md` |

---

## 4. Known failures resolved (original three + suite)

| Failure | Classification | Resolution / status |
|---------|----------------|---------------------|
| Non-square logo assets | Local / tracked asset quality | Tracked `asfds.png` squared in Phase E; further logos shipped in `c667a0f` V1.98a |
| Options **Playback** card | Outdated test | Expectation updated (intentional Options card) |
| `requestTune` / `keepPick` regex | Outdated test | Assertion widened; production tune contract unchanged |
| Guide actions missing **Info** | Outdated tests | Expected order includes Info |
| Harvester/director timeouts | Load flake under parallel suite | `testTimeout` / `hookTimeout` 90s |

**Release blockers from those three:** **None remaining** after investigation and test updates.

---

## 5. Seven-module INFO status

| Module | Implemented | Locally tested |
|--------|-------------|----------------|
| News | Yes | Yes |
| Sports / Football | Yes (+ empty-state + snapshot safety) | Yes |
| Weather | Yes | Yes |
| Entertainment | Yes | Yes |
| Business | Yes | Yes |
| On This Day | Yes | Yes |
| Shopping | Yes | Yes |

Playback isolation: INFO tool `infocentre`; `PlayerStage` not keyed on guide tool; **V** / **I** shortcuts unchanged.

---

## 6. TMDB authentication verification

| Check | Result |
|-------|--------|
| `TMDB_API_TOKEN` holding API Read Access Token (JWT) | **Supported** — Bearer, not `api_key=` |
| `TMDB_READ_ACCESS_TOKEN` | **Supported** |
| Classic v3 API key | **Supported** via `api_key=` |
| Shape preferred over env var name | **Yes** (`tmdb-auth.ts` + unit tests) |
| Secrets in browser | **No** |
| Live Netlify verification | **Not production-verified** |

---

## 7. Financial data verification

| Check | Result |
|-------|--------|
| `ALPHA_VANTAGE_API_KEY` server-side | **Yes** |
| Cache ~30 min + once-per-session Markets | **Yes** |
| Delayed labelling; no invented prices | **Yes** |
| Live quotes | **Not production-verified** |

---

## 8. News and football publishing + snapshot safety

| Requirement | Result |
|-------------|--------|
| Failed ingest cannot replace last valid **local** snapshot with empty data | **Yes** — ingest keeps prior; `emitWrote(false)` |
| Failed/empty publish cannot wipe **Blobs** | **Yes** — `shouldWriteFootballBlob` refuses empty overwrite; publish script skips empty football |
| Unavailable competition cannot erase other competitions’ matches/tables | **Yes** — `mergeFootballSnapshots` retains prior rows for failed competition codes |
| CI `INFO_PUBLISH_FOOTBALL` from `wrote` output | **Yes** — false skips football publish |
| Sports shows last successful update time | **Yes** — “Last update {timestamp}”; “showing last successful data” when applicable |
| Production ingest this pass | **Not run** |

---

## 9. Shopping refinements

Unchanged from Phase E polish: empty authorised-product state; partners filter hidden; Mall foundation only; no Three.js.

---

## 10. Preferences and export compatibility

Prefs v3 + shopping; v1/v2 migrate; export/import via `settings.info`; channel manifests and User Network 1001+ untouched.

---

## 11. Television and radio regression

| Area | Result |
|------|--------|
| Full automated suite | **167 files, 1864 tests passed, 0 failed, 0 skipped** |
| Player / scheduler redesign | **Not done** (by design) |
| Manual browser smoke | **Not performed** this finalisation |

---

## 12. Security findings

| Finding | Action |
|---------|--------|
| TMDB JWT as `api_key` | **Fixed** (shape-based auth) |
| AV quota burn | **Mitigated** (cache + session load) |
| Empty football Blob wipe | **Fixed** (publish guard + merge) |
| Publish secret logging | Confirmed absent |

---

## 13. API and Netlify cost considerations

INFO Blobs publish does not rebuild the site. Alpha Vantage free tier remains strict. Football ingest is CI-only. Shopping has £0 incremental API cost.

---

## 14. Test results (finalisation pass)

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **Pass** |
| `npm run build` | **Pass** |
| Full `npm test` | **167 files · 1864 passed · 0 failed · 0 skipped** |
| INFO football / TMDB / Phase E / Shopping suites | **Pass** |
| Live provider / production API | **Not claimed** |

| Label | Meaning |
|-------|---------|
| **Implemented** | In this RC |
| **Locally tested** | Automated / static on this machine |
| **Provider-verified** | Deferred to post-deploy live football / TMDB / AV checks |
| **Production-verified** | Not yet |

---

## 15. Remaining limitations (non-blockers for RC review)

1. Shopping products empty until authorised feeds.  
2. No official retail partners.  
3. Virtual Mall is data/copy only.  
4. EL1 entitlement and live football Blobs need post-deploy verify + ingest.  
5. Alpha Vantage indices may be empty on free tier.  
6. Browser/device acceptance still required after deploy.  
7. Live TMDB/AV/football-data responses not exercised in this pass.

---

## 16. Exact production deployment procedure

**Only after explicit product-owner authorisation.**

1. Confirm secrets (never print values):  
   - **Netlify:** `TMDB_API_TOKEN` (Read Access Token JWT is correct), `ALPHA_VANTAGE_API_KEY`, `INFO_PUBLISH_SECRET`  
   - **GitHub Actions:** `FOOTBALL_DATA_TOKEN`, `INFO_PUBLISH_SECRET`, `INFO_PUBLISH_URL` (production publish on tvn.lol), `TMDB_READ_ACCESS_TOKEN`  
2. Push the approved RC commit(s) to GitHub `main`.  
3. Allow the Netlify production application deploy from that push.  
4. When the new deploy is live, run Actions → **INFO ingest** (manual) once.  
5. Run Actions → **INFO football verify**.  
6. Confirm Sports shows fixtures/results (or accurate entitlement messages) and a fresh **Last update** time.  
7. Do not expect ingest to trigger another Netlify app rebuild.

---

## 17. Post-deployment acceptance checklist

- [ ] Default network + User Network 1001+ intact  
- [ ] TV/radio continuous playback while using Guide → Info  
- [ ] All seven INFO modules open without retune/volume change  
- [ ] News + Football Blobs timestamps fresh after ingest  
- [ ] Entertainment loads (TMDB Bearer via `TMDB_API_TOKEN`)  
- [ ] Business currencies; stocks only when AV returns data  
- [ ] On This Day loads  
- [ ] Shopping empty products / no partners filter  
- [ ] Sports: Last update visible; unpublished/unavailable messaging correct if ingest incomplete  
- [ ] Failed football ingest does not clear previously good Blobs  
- [ ] No secret leakage in logs  

---

## 18. Rollback procedure

1. **Netlify:** Redeploy previous successful production deploy.  
2. **INFO Blobs:** Empty football publishes are refused when a valid snapshot exists; avoid force-publishing empty JSON.  
3. **Git:** Revert or redeploy prior commit if needed (no force-push unless explicitly ordered).  
4. **Secrets:** Rotate `INFO_PUBLISH_SECRET` on Netlify and GitHub together if exposure is suspected.

---

## Release candidate verdict

**TVN 2.0 Phase E release candidate is complete for product-owner review.**

- Sports empty-state diagnostic incorporated.  
- Snapshot safety hardened (local ingest + Blobs publish).  
- TMDB Read Access Token under `TMDB_API_TOKEN` supported.  
- Full suite green: **1864 / 1864**.  
- **Next step:** PO review → explicitly authorised push/deploy → live football-data verification.

---

*End of Phase E release candidate report.*
