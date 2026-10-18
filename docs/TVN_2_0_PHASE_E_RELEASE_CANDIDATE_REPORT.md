# TVN 2.0 — Phase E Release Candidate Report

**Date:** 2026-10-18  
**Branch:** `main` (local)  
**Status:** Release candidate prepared — **not pushed**, **not deployed**

---

## 1. Starting and final commits

| | Commit |
|--|--------|
| **Phase E start** | `373243c` — Record Phase D.1 final commit in the completion report. |
| **Phase E end** | *(recorded after commit — see §2 / git log)* |

Prior INFO work included (local, ahead of `origin/main`): Phases B–D.1 (23 commits at Phase E start).

---

## 2. Git status (at Phase E completion)

| Item | Value |
|------|--------|
| Branch | `main` |
| Tracking | `origin/main` (ahead; exact count after Phase E commit) |
| History rewrite | **None** |
| Untracked WIP logos | Preserved, **not staged** (14 local PNGs including non-square `90s.png`) |
| Staged/committed logo fix | `asfds.png` centre-cropped to square (pre-existing tracked defect) |

---

## 3. Changes made in Phase E

| Area | Change |
|------|--------|
| TMDB auth | Shape-based credential resolution (`tmdb-auth.ts`): JWT Read Access Token → `Authorization: Bearer`; classic v3 key → `api_key=` — **env var name alone no longer selects mode** |
| Finance | In-process 30-minute cache on Netlify + local finance proxies; Business markets load once per panel session |
| Shopping polish | Clearer empty product copy; hide “Official partners only” until a verified partner exists |
| Football | Documented deferred PPL + post-deploy entitlement verification; free-tier 12 is provider limit, not architecture |
| Logos | `MAX_LOGOS=99`, Vite `?url` imports; square-crop tracked `asfds.png`; WIP untracked logos skipped in dimension gate |
| Tests | Updated obsolete Guide/Info/Options/Playback/`requestTune` expectations; TMDB + Phase E suites; vitest timeout 90s for catalogue load |
| Docs | `INFO_DATA_SOURCES.md` TMDB shape rules |

---

## 4. Known failures resolved

| Failure (from D.1 / suite) | Classification | Resolution |
|----------------------------|----------------|------------|
| Non-square `90s.png` | Unrelated **local untracked** WIP | Not staged; dimension gate skips listed WIP names |
| Non-square tracked `asfds.png` | Genuine logo defect | Centre-cropped to 626×626 |
| Options “Playback” card | Outdated test | Expectation updated (card is intentional) |
| `requestTune` / `keepPick` regex | Outdated test (guards added between signature and `clearManual`) | Regex window widened; production tune contract unchanged |
| Guide actions missing **Info** | Outdated tests after INFO header addition | Expected order: Network · Info · Guide · Options · Now · Add · Media |
| `gridShown` / Network Editor filter assertions | Outdated tests vs intentional INFO / `channelMatchesFilter` behaviour | Expectations aligned with current code |
| Harvester/director 30s timeouts under full suite | Load-related flake | `testTimeout` / `hookTimeout` → 90s; confirmed pass |

---

## 5. Seven-module INFO status

| Module | Implemented | Locally tested |
|--------|-------------|----------------|
| News | Yes | Yes (unit + navigation) |
| Sports / Football | Yes | Yes |
| Weather | Yes | Yes |
| Entertainment | Yes | Yes (proxy + normalisation tests) |
| Business | Yes | Yes (cache + panel load policy) |
| On This Day | Yes | Yes |
| Shopping | Yes | Yes (empty products, partners filter hidden) |

**Playback isolation (code review + regression tests):** INFO uses Guide tool `infocentre`; `PlayerStage` is not keyed on `guideTool`; opening Info does not retune. Shortcuts **V** (picture info) and **I** (Add) unchanged.

| Concern | Status |
|---------|--------|
| Does not remount player | **Locally tested** (static + Phase E tests) |
| Does not retune / change volume | **Implemented** (no tune/volume calls in InfoCentre) |
| Desktop / mobile layout | **Implemented** (existing Info CSS); full device QA is **production acceptance** |
| Browser UI smoke | **Not run in this pass** (see §14) |

---

## 6. TMDB authentication verification

| Check | Result |
|-------|--------|
| Netlify `TMDB_API_TOKEN` may hold Read Access Token (JWT) | **Supported** via shape detection |
| GitHub `TMDB_READ_ACCESS_TOKEN` Bearer | **Supported** |
| Classic v3 `api_key` | **Supported** |
| Prefer bearer-shaped when both set | **Yes** |
| Secrets never in browser bundle | **Yes** (proxy only) |
| Missing credentials → 503 | **Tested** |
| Rate limit / provider errors surfaced | **Tested** |
| Catalogue normalisation | **Tested** |
| Live Netlify call with real secret | **Not production-verified** (no deploy) |

**Env guidance:** Keep names `TMDB_API_TOKEN` (Netlify) and `TMDB_READ_ACCESS_TOKEN` (GitHub). No rename required. Do not put a JWT into `api_key=` — Phase E prevents that misclassification.

---

## 7. Financial data verification

| Check | Result |
|-------|--------|
| `ALPHA_VANTAGE_API_KEY` server-side only | **Yes** |
| Invalid symbol rejected | **Yes** |
| Delayed labelling on quotes | **Yes** (`delayed: true`) |
| No fabricated prices | **Yes** |
| Server cache ~30 min | **Implemented** |
| Markets auto-load once per panel session | **Implemented** |
| Free-tier daily limits | **Documented** — still tight; cache reduces multi-viewer burn |
| Index symbols (UKX, SPX, …) | May be unsupported on free tier — empty state, no invention |
| Currencies (Frankfurter) | Keyless; independent of Alpha Vantage |
| Live quote with real key | **Not production-verified** |

---

## 8. News and football publishing verification

| Check | Result |
|-------|--------|
| Workflow `.github/workflows/info-ingest.yml` | Scheduled + `workflow_dispatch` |
| Football verify workflow | Present (`info-football-verify.yml`) |
| Auth Bearer `INFO_PUBLISH_SECRET` | **Implemented**; secret not logged |
| Invalid snapshot rejected; valid sibling still writable | **Implemented** (partial write); invalid does not overwrite that key |
| Failed ingest does not clear Blobs on auth/JSON failure | **Yes** |
| Does not commit JSON / does not Netlify rebuild | **Yes** (documented in workflow) |
| `INFO_PUBLISH_URL` → production tvn.lol | **Configured by PO** — **not exercised** this pass |
| Production ingest | **Not run** (stop condition) |

---

## 9. Shopping refinements

| Item | Status |
|------|--------|
| Empty products explain authorised feeds | **Done** |
| Official partners filter hidden (zero partners) | **Done** |
| Watch on TVN only for playable channel refs | **Unchanged foundation** (no placeholder channels) |
| Virtual Mall metadata only / no Three.js | **Preserved** |

---

## 10. Preferences and export compatibility

| Item | Status |
|------|--------|
| Prefs v3 + shopping | **Implemented** |
| Migrate v1/v2 → v3 | **Locally tested** |
| Export/import via `settings.info` | **Locally tested** |
| Channel manifests untouched | **Yes** |
| User Network 1001+ | **Unaffected** by INFO prefs |

---

## 11. Television and radio regression results

| Area | Result |
|------|--------|
| Full automated suite (tune, guide, network, playback helpers, etc.) | **1860/1860 passed** locally |
| Player redesign / scheduler rewrite | **Not done** (by design) |
| Manual continuous playback / radio listen-through | **Not production-verified** / no browser smoke this pass |

---

## 12. Security findings

| Finding | Severity | Action |
|---------|----------|--------|
| TMDB JWT mis-sent as `api_key` when stored in `TMDB_API_TOKEN` | High (would break Entertainment) | **Fixed** (shape-based auth) |
| Alpha Vantage quota burn from repeated Markets visits | Medium | **Mitigated** (cache + once-per-session load) |
| Publish secret logging | — | Confirmed absent |
| Browser exposure of provider secrets | — | Proxies only; no Vite env for these keys |
| User-added shop URL SSRF | — | Client validation only; no privileged fetch |
| CORS / Blobs | — | Existing INFO pattern unchanged |

No speculative architecture changes.

---

## 13. API and Netlify cost considerations

| Item | Note |
|------|------|
| INFO Blobs publish | Does **not** trigger site rebuilds |
| Alpha Vantage free tier | Strict daily caps — rely on 30m cache; avoid polling |
| TMDB | CDN `max-age=900` on proxy responses |
| Football-data.org | CI ingest only; not browser |
| Shopping | £0 incremental |
| Paid commerce / AV subscription | **Not introduced** |

---

## 14. Test results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` / `npm run build` | **Pass** |
| Full `npm test` | **167 files, 1860 tests passed, 0 failed, 0 skipped** |
| INFO / TMDB / Phase E suites | **Pass** |
| Browser automation smoke | **Not performed** — Cursor browser available, but local preview UI walkthrough was not run in this pass; treat Guide→Info module switching as **production acceptance** |
| Production API verification | **Not claimed** |

**Distinction**

| Label | Meaning |
|-------|---------|
| **Implemented** | Code present in this RC |
| **Locally tested** | Automated tests and/or static verification on this machine |
| **Provider-verified** | Live call to third-party API with configured secrets — **deferred to post-deploy** |
| **Production-verified** | Behaviour confirmed on tvn.lol — **not yet** |

---

## 15. Remaining limitations

1. Shopping product catalogue empty until authorised feeds exist.  
2. No official retail partners configured.  
3. No Shopping TV channel links configured.  
4. Virtual Mall is data/copy only.  
5. League One (EL1) entitlement not live-verified; PPL remains deferred.  
6. Alpha Vantage index symbols may return empty on free tier.  
7. Fourteen local untracked logo PNGs remain WIP (not in RC commit).  
8. Browser/device acceptance and production ingest still required.

---

## 16. Exact production deployment procedure

**Do not start until the product owner explicitly approves push and deploy.**

1. Confirm secrets (values never printed):  
   - Netlify: `TMDB_API_TOKEN`, `ALPHA_VANTAGE_API_KEY`, `INFO_PUBLISH_SECRET`  
   - GitHub Actions: `FOOTBALL_DATA_TOKEN`, `INFO_PUBLISH_SECRET`, `INFO_PUBLISH_URL` (`https://tvn.lol/.../api/info/publish`), `TMDB_READ_ACCESS_TOKEN`  
2. Push approved commits to GitHub `main` (or release branch per PO).  
3. Allow Netlify production deploy from that push (application build once).  
4. After deploy is live, run Actions → **INFO ingest** (manual) once.  
5. Run Actions → **INFO football verify** for entitlement.  
6. Do **not** expect ingest to rebuild the site.

---

## 17. Post-deployment acceptance checklist

- [ ] Site loads; default network tunes; User Network 1001+ intact  
- [ ] Radio and TV continuous playback while opening Guide → Info  
- [ ] All seven INFO tabs open; switching modules does not retune or change volume  
- [ ] News + Football snapshots show recent `updated` timestamps from Blobs  
- [ ] Entertainment lists load (TMDB Bearer/path working)  
- [ ] Business currencies load; stocks/indices only when AV returns data  
- [ ] On This Day loads  
- [ ] Shopping: shops browse; products empty state correct; no partners filter  
- [ ] Export/import preferences round-trip  
- [ ] Football: EL1 present or clear “requires API entitlement”; PPL not falsely claimed live  
- [ ] No Netlify rebuild storms from ingest  
- [ ] No secret leakage in function logs  

---

## 18. Rollback procedure

1. **Netlify:** Redeploy previous successful production deploy from Netlify UI (instant rollback of app bundle).  
2. **INFO Blobs:** Last valid news/football snapshots remain until a successful publish overwrites them; do not publish empty/invalid payloads.  
3. **Git:** Revert or redeploy prior commit on `main` if needed; do not force-push unless PO explicitly orders it.  
4. **Secrets:** Rotate `INFO_PUBLISH_SECRET` if exposure suspected; update Netlify + GitHub simultaneously.

---

## Release candidate verdict

**TVN 2.0 INFO release candidate is ready for product-owner review.**

- Local engineering stabilisation complete.  
- Full automated suite green (1860).  
- Critical TMDB auth misconfiguration fixed.  
- **Await explicit approval before push, deploy, or production ingest.**

---

*End of Phase E release candidate report.*
