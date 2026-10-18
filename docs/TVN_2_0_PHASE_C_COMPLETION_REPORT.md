# TVN 2.0 — Phase C Completion Report

**Date:** 2026-10-18  
**Branch:** `main` (local; **not pushed**, **not deployed**)

---

## 1. Starting and final commits

| | Commit |
|--|--------|
| **Start** | `7108ba2` — Avoid self-referential HEAD SHA in the release readiness report. |
| **End** | Tip of local Phase C commits (see `git log`) |

---

## 2. Files changed

**Added:** Entertainment / Business / History modules; `EntertainmentPanel`, `BusinessPanel`, `OnThisDayPanel`; Netlify proxies `info-tmdb`, `info-finance`; Phase C tests; this report.

**Modified:** `InfoCentre`, `preferences` (v2), `vite.config` / `server/info-api` proxies, INFO tests, `INFO_DATA_SOURCES.md`.

---

## 3. Entertainment functionality

| Feature | Status |
|---------|--------|
| Sections Discover / Popular / Films / Television / News / On this day / Watchlist | Implemented |
| TMDB proxy + parsing (popular, trending, search, discover moods) | Implemented |
| Watchlist (add/remove/watched/favourite) + export via INFO prefs | Implemented |
| Entertainment news from existing snapshot categories | Implemented |
| Shared On This Day (entertainment filter) | Implemented |
| WATCH ON TVN exact channel-name match only | Implemented |
| Live TMDB catalogue | **Requires** `TMDB_API_TOKEN` on Netlify |

Attribution shown: TMDB required notice.

---

## 4. Business functionality

| Feature | Status |
|---------|--------|
| Markets / Stocks / Currencies / Commodities / News / Watchlist | Implemented |
| Currencies via Frankfurter (ECB daily reference, delayed) | Implemented & keyless |
| Stocks/indices via Alpha Vantage proxy | Implemented; needs `ALPHA_VANTAGE_API_KEY` |
| Commodities listed; quotes only when provider returns data | Implemented (no invented prices) |
| Business news from existing `business` category | Implemented |
| Watchlist + default view + base currency in prefs/export | Implemented |
| Trading / advice | **Not** offered — disclaimer shown |

---

## 5. Historical information functionality

| Feature | Status |
|---------|--------|
| First-class INFO → On this day | Implemented |
| Wikimedia onthisday feed (no API key) | Implemented |
| Date prev/next/today/picker | Implemented |
| Categories + entertainment filter | Implemented |
| Deduped events, deaths excluded from default stream | Implemented |
| AI-invented events | **Not** used |

---

## 6. Provider choices

| Domain | Provider | Why |
|--------|----------|-----|
| Entertainment metadata | **TMDB** | Industry standard; free non-commercial with attribution; proxied |
| Currencies | **Frankfurter** | Free, keyless, ECB-backed daily rates |
| Stocks / indices | **Alpha Vantage** | Legitimate free tier; proxied; delayed labels |
| On This Day | **Wikimedia** | Documented public feed; CC BY-SA attribution |

Rejected for default use: undocumented scrapers; paid-only market feeds without approval.

---

## 7. API credentials required

| Secret | Where | Purpose |
|--------|-------|---------|
| `TMDB_API_TOKEN` | Netlify functions env | Entertainment proxy |
| `ALPHA_VANTAGE_API_KEY` | Netlify functions env | Business quote proxy |

Do not put these in browser/Vite env. Do not paste into chat.

Existing INFO secrets (`FOOTBALL_DATA_TOKEN`, `INFO_PUBLISH_*`) unchanged.

---

## 8. Data licensing limitations

- **TMDB:** Free for non-commercial with attribution; commercial use needs TMDB agreement; cache ≤ 6 months per terms.
- **Alpha Vantage:** Free tier ~25 requests/day — heavy market polling is unsuitable; cache aggressively; delayed data.
- **Frankfurter / ECB:** Daily reference rates, not live FX trading quotes.
- **Wikimedia:** CC BY-SA; attribute Wikipedia/Wikimedia.

---

## 9. Tests passed

Executed:

```
npx tsc -b
npx vitest run src/tvn-info-phase-c.test.ts src/tvn-info-b3.test.ts \
  src/tvn-info-news.test.ts src/tvn-2-0-info-centre.test.ts src/tvn-2-0.test.ts
```

**Typecheck:** pass (after fixes). **Targeted tests:** pass (Phase C suite + updated INFO navigation).

**Not claimed:** live TMDB / Alpha Vantage verification (no keys in this environment). Wikimedia + Frankfurter probed successfully during development.

---

## 10. Known limitations

- Without `TMDB_API_TOKEN`, Entertainment lists stay empty with a clear configure message.
- Without `ALPHA_VANTAGE_API_KEY`, stock/index quotes unavailable; currencies still work.
- Free Alpha Vantage quota is low — markets fetch is capped and sequential.
- Commodity prices not fabricated when entitlement missing.
- TVN match is exact channel-name only (conservative).
- Space/religious historical feeds not added as defaults.

---

## 11. Monthly cost estimates

| Item | Estimate |
|------|----------|
| TMDB non-commercial | €0 (commercial licence TBD if TVN commercialises) |
| Frankfurter | €0 |
| Wikimedia feed | €0 (respectful UA / caching) |
| Alpha Vantage free | €0 (25 req/day); premium if markets must be richer |
| Netlify function invokes | Low if cached (15–30 min CDN/browser cache headers) |

---

## 12. Remaining product-owner actions

1. Register TMDB API key → set Netlify `TMDB_API_TOKEN`.
2. Register Alpha Vantage key → set Netlify `ALPHA_VANTAGE_API_KEY` (optional until stocks/markets needed).
3. Confirm commercial vs non-commercial TMDB posture before public launch.
4. Approve push/deploy when ready (not done here).
5. Do not start Virtual Mall until product owner schedules it.

---

## 13. Production readiness

| Area | Implemented | Tested | Provider-verified | Production-verified |
|------|-------------|--------|-------------------|---------------------|
| Entertainment UI + prefs | Yes | Yes (fixtures) | Partial (needs key) | No |
| Business UI + FX | Yes | Yes | FX yes; AV no | No |
| On This Day | Yes | Yes | Wikimedia yes | No |
| INFO nav six modules | Yes | Yes | — | No |

**Delivery:** working Phase C software locally. **No push. No deploy. No Virtual Mall.**
