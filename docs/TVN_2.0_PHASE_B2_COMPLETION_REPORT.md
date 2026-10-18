# TVN 2.0 — Phase B.2 Completion Report

**Date:** 2026-10-18  
**Branch:** `main` (local; **not pushed**, **not deployed**)

---

## 1. Starting and final commits

| | Commit | Subject |
|---|--------|---------|
| **Start** | `db51a78` | Document Phase B.1 pre-deployment architecture and checks. |
| **End** | *(this phase’s commits on `main`, local)* | Phase B.2 News / Football / Weather expansion |

Phase B and B.1 history is preserved. Logo asset churn was left unstaged.

---

## 2. News sources integrated

Allowlisted publisher feeds (headlines + links only; not full-article republication):

| Publisher | Categories covered |
|-----------|-------------------|
| BBC News | top, uk, world, europe, technology, science, business, culture, entertainment |
| The Guardian | top, uk, world, europe, technology, science, business, culture, entertainment |
| Sky News | top, uk, world, business, entertainment |
| The Independent | top, uk |
| Al Jazeera English | world |
| France 24 | world |
| Deutsche Welle | europe |
| Euronews | europe |
| Ars Technica | technology |
| The Register | technology |
| New Scientist | science |

**Not integrated as publisher feeds (no suitable free official RSS for TVN’s terms):** Reuters (public RSS closed), Associated Press (no free official redistributable feed used).

**Excluded by product rule:** space-specialty and religious feeds.

Local ingest verification (2026-10-18): **814** headlines written to `public/info/news.json` with **no feed errors** after correcting the Guardian Europe URL.

---

## 3. News source failures

| Feed | Status | Notes |
|------|--------|-------|
| `guardian-europe` (old URL `…/world/europe/rss`) | Failed (404) | Replaced with `https://www.theguardian.com/world/europe-news/rss` |
| Current allowlist | OK on last local ingest | Failures are recorded in snapshot `errors[]`; previous valid snapshot is kept if all feeds fail |

---

## 4. News categories

Implemented tabs (empty categories hidden):

`TOP STORIES | UK | WORLD | EUROPE | TECHNOLOGY | SCIENCE | BUSINESS | CULTURE | ENTERTAINMENT`

`LOCAL` is defined in the type system but has **no default feeds**, so it does not appear until sources exist.

| Behaviour | Detail |
|-----------|--------|
| Top Stories initial | ~12 headlines (`NEWS_TOP_LIMIT`) |
| Other categories initial | ~6 headlines (`NEWS_CATEGORY_LIMIT`) |
| More stories | Expands to 24; collapse via “Show fewer” |
| Selection | Deterministic: recent-first, URL/id dedupe, near-duplicate title filter, publisher round-robin |

Displayed per item: headline, publisher, publication time, short description (when present), original link. Panel shows last successful update (and stale / last-good-copy markers).

---

## 5. Football competitions supported

**Implemented against football-data.org free tier (existing adapter):**

| Code | Competition | Region |
|------|-------------|--------|
| PL | Premier League | United Kingdom |
| ELC | Championship | United Kingdom |
| CL | UEFA Champions League | Europe |
| BL1 | Bundesliga | Europe |
| SA | Serie A | Europe |
| PD | La Liga | Europe |
| FL1 | Ligue 1 | Europe |
| DED | Eredivisie | Europe |
| PPL | Primeira Liga | Europe |

**Not claimed on free plan:** English League One/Two, Scottish Premiership, FA Cup, Europa League, Conference League, women’s competitions. Free-tier coverage list also includes BSA / WC / EC — not wired into the default TVN list (priority European club focus).

---

## 6. Football API verification status

| Layer | Status |
|-------|--------|
| Adapter + fixtures | **Implemented and tested** (`sample-responses.ts`, mocked fetch) |
| Live API with `FOOTBALL_DATA_TOKEN` | **Configured in GitHub Actions secrets** — not available in this local agent environment |
| Production Blobs publish | **Not verified** — requires `INFO_PUBLISH_URL` + `INFO_PUBLISH_SECRET` and a successful Actions run after push (push not performed) |

Manual admin refresh: GitHub Actions `workflow_dispatch` sets `FOOTBALL_INGEST_FORCE=1` (credentials never exposed to the browser).

---

## 7. Football refresh schedule

Slots in **Europe/London** (GMT/BST aware via `Intl`):

| Day | Local time |
|-----|------------|
| Mon–Fri | 22:00 |
| Saturday | 17:00 and 22:30 |
| Sunday | 22:00 |

Mechanism:

- Cron fires in UTC windows covering both GMT and BST evenings (`16–17`, `21–23` UTC, every 15 minutes in those hours) plus the existing news cadence.
- `footballSlotDue()` gates ingest; slot keys prevent duplicate runs across clock-change windows.
- Skipped football runs **do not** republish stale checkout JSON over live Blobs (`INFO_PUBLISH_FOOTBALL` / step output).

Best-effort only (GitHub schedule is not minute-exact).

---

## 8. Weather provider

**Open-Meteo** (`https://open-meteo.com/`) — no API key for qualifying non-commercial use.

- Attribution shown in UI: “Weather data by Open-Meteo.com”.
- Client-side geocoding + forecast for the **selected** location only (no prefetch of all towns).
- Local cache ~2.5 hours; saved locations in `localStorage`.
- Default location: London (neutral configuration default — not a personal home).
- Device geolocation is **not** requested automatically.
- Commercial licensing must be re-checked before any commercial production use; MET Norway remains a documented fallback if Open-Meteo terms become unsuitable.

---

## 9. Weather functionality

INFO navigation: **News | Sports | Weather**

Weather sections: **Today | Hourly | 7 days | Locations**

Today shows: temperature, conditions, feels-like, wind (km/h), precipitation probability, today’s high, tonight’s low, update time + attribution.

Locations: search, select, save, switch, remove — remembered locally; no viewer accounts.

Failures stay inside the Weather panel and do not affect television/radio playback or News/Sports.

---

## 10. Tests passed

Targeted suites (local):

```
src/tvn-info-news.test.ts
src/tvn-info-football.test.ts
src/tvn-info-weather.test.ts
src/tvn-2-0-info-centre.test.ts
```

**Result:** all passed (21 tests in the INFO-focused run after Guardian Europe fix).

Coverage includes: source diversity / Top Stories / dedupe / attribution / freshness; competition list / fixtures / results / tables / schedule GMT·BST / missing credentials path / fixture recovery; weather search / defaults / forecast parse / attribution; INFO module list including Weather; keyboard shortcuts unchanged (V = picture info, I = Add).

---

## 11. Infrastructure changes

| Area | Change |
|------|--------|
| Workflow | UK-aware football cron windows; slot cache; `workflow_dispatch` force football; publish football only when ingest wrote |
| Blobs path | Unchanged architecture from B.1 — news + football via `/api/info/publish` |
| Weather | Browser → Open-Meteo (no Blobs publish required) |
| Credentials | `FOOTBALL_DATA_TOKEN` server/CI only; never in client bundles |

---

## 12. Estimated operating costs

| Item | Estimate |
|------|----------|
| football-data.org free | €0 / month (12 competitions, delayed scores, 10 req/min) |
| Open-Meteo (non-commercial qualifying use) | €0 / month |
| RSS news | €0 / month (publisher feed bandwidth only) |
| GitHub Actions | Low — news ~48 runs/day + football window polls; ingest skips when outside slots |
| Netlify Blobs + function invokes | Small; **no** SPA rebuild per INFO refresh |
| Paid football upgrade | Optional — see §14 recommendation |

---

## 13. Remaining product-owner actions

1. Confirm **`INFO_PUBLISH_URL`** and **`INFO_PUBLISH_SECRET`** are set in GitHub Actions (and matching Netlify env for the publish function).
2. **Approve push** of Phase B.2 commits (not done here).
3. After push: run **INFO ingest** via `workflow_dispatch` once; confirm Blobs serve fresh news + football.
4. Optionally set local `FOOTBALL_DATA_TOKEN` for developer ingest — never commit it.
5. Before commercial launch: confirm Open-Meteo (or switch to MET Norway) licensing for the intended use.
6. Decide whether to spend free-tier remaining competition slots on BSA / WC / EC, or keep the current nine.

---

## 14. Production verification status

| Capability | Implemented | Tested (local/fixtures) | Production-verified |
|------------|-------------|-------------------------|---------------------|
| Expanded news catalogue + categories | Yes | Yes | No |
| Top Stories / More stories / diversity | Yes | Yes | No |
| Football UI (Today / Results / Fixtures / Tables / Leagues) | Yes | Yes (UI + fixtures) | No |
| Live football-data.org ingest | Yes (CI token ready) | Fixtures only locally | No |
| UK schedule gating | Yes | Yes | No |
| Weather (Open-Meteo) | Yes | Yes | No |
| Blobs publish without rebuild | Yes (B.1) | Partial (B.1) | Pending owner secrets + push |

---

## Provider comparison (brief)

| Provider | Free coverage | Notes |
|----------|---------------|-------|
| **football-data.org** (selected) | 12 competitions, delayed scores, 10/min | Fits current adapter; League One/Two / cups / women’s need paid tiers |
| API-Football | Broad free catalogue but **100 req/day** | Too tight for multi-competition scheduled refresh without careful budgeting |
| Paid football-data.org “Free w/ Livescores” | Same 12 comps + live | **€12/month** — only if live scores become a product requirement |
| Higher football-data.org tiers | League One/Two, FA Cup, Europa, etc. | From **€49/month** coverage tiers — recommend only if English lower leagues / cups are product-critical |

**Recommendation:** Stay on football-data.org free until production proves the nine competitions. Do not purchase anything yet. Revisit paid tiers only if product requires cups, League One/Two, Scottish football, or true live scores.

---

## Delivery note

Phase B.2 software is complete locally. **No push. No deploy.** Television playback paths were not redesigned; INFO modules remain independently failure-isolated.
