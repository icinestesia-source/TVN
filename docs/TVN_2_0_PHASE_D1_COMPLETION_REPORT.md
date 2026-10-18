# TVN 2.0 — Phase D.1 Completion Report

**Date:** 2026-10-18  
**Branch:** `main` (local; **not pushed**, **not deployed**)  
**Scope:** INFO → Shopping (seventh module) + Virtual Mall data foundation (no Three.js)

---

## 1. Starting and final commits

| | Commit |
|--|--------|
| **Start** | `ec78add` — Record Phase C final commit in the completion report. |
| **End** | `1aced43` — Add INFO Shopping module and Virtual Mall foundations (Phase D.1). |

---

## 2. Files added and modified

**Added**

- `src/info/shopping/types.ts` — departments, retailer/product models, user shops, mall shopfront meta, preferences shape
- `src/info/shopping/catalogue.ts` — curated public retailer directory; empty authorised product catalogue
- `src/info/shopping/validate.ts` — user-shop URL validation (no privileged fetch)
- `src/info/shopping/tvn-link.ts` — optional WATCH ON TVN when a real playable channel is referenced
- `src/info/shopping/mall.ts` — Virtual Mall department zones from the same catalogue (data only)
- `src/components/info/ShoppingPanel.tsx` — Shopping UI
- `src/tvn-info-shopping.test.ts` — Phase D.1 tests
- `docs/TVN_2_0_PHASE_D1_COMPLETION_REPORT.md` — this report

**Modified**

- `src/components/InfoCentre.tsx` — seventh module **Shopping**
- `src/info/preferences.ts` — prefs **v3** + `shopping` section; accept export versions 1–3
- `src/components/GuideAdd.tsx` — Info tooltip copy
- `netlify/functions/info-tmdb.ts`, `server/info-api.ts` — accept `TMDB_API_TOKEN` and/or `TMDB_READ_ACCESS_TOKEN`
- `docs/INFO_DATA_SOURCES.md` — env names + Shopping note
- INFO navigation / prefs tests (`tvn-2-0-info-centre`, `tvn-info-news`, `tvn-info-phase-c`, `tvn-info-b3`)

**Not included**

- Unrelated unstaged logo PNGs / `logos.ts` / `startup.test.ts` (pre-existing local assets; not part of D.1)

---

## 3. Shopping navigation

INFO modules:

**NEWS | SPORTS | WEATHER | ENTERTAINMENT | BUSINESS | ON THIS DAY | SHOPPING**

Within Shopping:

**DISCOVER | DEPARTMENTS | SHOPS | PRODUCTS | FAVOURITES | SHOPPING TV | MALL**

Uses existing Guide / Info Centre tabs and list styles (desktop, mobile, keyboard `keepKey`, touch). Opening Shopping does not retune or remount the player.

---

## 4. Retailer catalogue

Curated directory in `catalogue.ts` (public websites only). Each retailer has id, name, description, department, website, optional logo/feed/channel fields, `officialPartner` (all **false** — no invented partnerships), and mall shopfront metadata.

Browse + search; external links labelled **(external)**. Listings are directory entries, not TVN partners.

---

## 5. Product catalogue

Provider-independent `Product` model. `CATALOGUE_PRODUCTS` is **empty** until authorised feeds or manually configured rows are added. UI shows an empty state; **no invented prices, stock, or discounts**. No scraper or uncontrolled ingest.

---

## 6. User-added shops

Viewers can add / edit / remove / reorder shops (name, https URL, department, optional description). URLs validated client-side; private/local hosts rejected. Stored in INFO preferences (`localStorage`). No server-side website fetch. Not treated as official integrations.

---

## 7. Favourites

Favourite shops, products, and departments with dedicated **Favourites** view (reorder / remove). Persisted under `settings.info.shopping` with other INFO prefs.

---

## 8. Shopping television integration

Optional `channelNumber` on retailers. **Watch on TVN** only when that channel exists, is enabled, and is not an empty slot. No new shopping channels created; default network and User Network (1001+) untouched. Browse does not interrupt playback.

---

## 9. Virtual Mall foundation

`MallShopfrontMeta` + `mallDepartmentZones()` reuse retailer catalogue data (department zone, shopfront label, catalogue retailer id, optional future asset ref). **MALL** explains the immersive experience is planned and is **not** a 3D mall. Three.js not installed; no placeholder 3D scene.

---

## 10. Preferences and export/import

| Field | Storage |
|-------|---------|
| Favourite shops / products / departments | `info.shopping.*` |
| User-added shops | `info.shopping.userShops` |
| Department order | `info.shopping.departmentOrder` |
| Display: official partners only | `info.shopping.showOfficialOnly` |

- Prefs version **3**; older v1/v2 exports still validate and migrate (missing shopping → defaults).
- Channel manifests unchanged.
- No accounts / remote personal DB.

---

## 11. Tests passed

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| `npm run build` | Pass |
| `vitest` Shopping + INFO suites (shopping, b3, phase-c, info-centre, news, football, weather) | **39 passed** |
| Shopping opens; other modules listed | Pass |
| User shops / favourites persist (memory `localStorage`) | Pass |
| Empty product catalogue (no fabrication) | Pass |
| Channel link helper returns null without valid channel | Pass |

**Known unrelated local failures** (not introduced by D.1; observed on full `npm test`): non-square logo asset `90s.png`, Options “Playback” card expectation drift, one guide-refinement `requestTune` assertion. Logo assets remain unstaged.

---

## 12. Known limitations

- No live product feeds yet — products empty by design.
- No official retailer partnerships configured.
- No Shopping TV channel links configured (foundation only).
- Virtual Mall is metadata + copy only — no 3D.
- No payments, affiliates, or commerce checkout.
- “Official partners only” filter currently shows an empty directory (all `officialPartner: false`).

---

## 13. API or licensing requirements

| Name | Where | Purpose |
|------|-------|---------|
| `TMDB_API_TOKEN` | Netlify functions | Entertainment TMDB proxy (v3 key; preferred) |
| `TMDB_READ_ACCESS_TOKEN` | GitHub Actions (optional Netlify) | Entertainment TMDB proxy (v4 Bearer) |
| `ALPHA_VANTAGE_API_KEY` | Netlify functions | Business quotes |
| `INFO_PUBLISH_SECRET` | Netlify **and** GitHub Actions | Blobs publish Bearer |
| `INFO_PUBLISH_URL` | GitHub Actions | Publish URL (production `tvn.lol`) |
| `FOOTBALL_DATA_TOKEN` | GitHub Actions | Football ingest |

**Shopping adds no new secrets.** Implementation uses these **exact** names (verified in proxies and docs). Secret values are never logged or requested in chat.

---

## 14. Estimated operating costs

| Item | Estimate |
|------|----------|
| Shopping module | **£0** incremental (static catalogue + local prefs) |
| Virtual Mall foundation | **£0** (no Three.js, no assets CDN) |
| Existing INFO APIs | Unchanged free-tier usage (football-data, TMDB, Alpha Vantage, Frankfurter, Wikimedia) |

Do not introduce paid commerce or affiliate networks without product-owner approval.

---

## 15. Release readiness

| Item | Status |
|------|--------|
| Seventh INFO module implemented locally | **Yes** |
| Retailer / product / mall foundations | **Yes** (products empty until authorised data) |
| Prefs v3 + export compatibility | **Yes** |
| Three.js Virtual Mall | **Not started** (by design) |
| Push / deploy | **Not done** (awaiting final seven-module integration pass) |
| Channel / User Network safety | **Preserved** |

**Implemented now:** Shopping INFO module, curated retailer directory, user shops, favourites, Shopping TV link helper, mall data foundation, prefs/export.

**Future work:** Authorised product feeds; official partner flags when real; optional shopping-channel refs for existing playable channels; Three.js Virtual Mall using shared catalogue models; final integration/release-prep across all seven INFO modules before deployment authorisation.

---

*End of Phase D.1 completion report.*
