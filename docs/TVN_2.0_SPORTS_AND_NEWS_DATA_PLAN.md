# TVN 2.0 — Sports and News Data Plan

**Status:** plan only — no implementation  
**Depends on:** architecture audit, INFO plan, hosting comparison

---

## 1. Current repository state (confirmed)

| Area | Finding |
|------|---------|
| News ingestion | **Absent.** `src/data/news-sources.ts` always yields `sources: []` |
| News channels | Many curated *video* news identities (900–949 band + others) |
| Football data API | **Absent** |
| Football channels | Video catalogue (e.g. Football, Football Classics, English Football…) |
| RSS capability | **Present for podcasts** via `/api/feed` (`server/podcast-feed.ts`) — reusable pattern, not news-specific |
| Scheduled jobs | **None** in Netlify production |
| Client secrets | Forbidden — keys must stay server-side |

---

## 2. Design principles

1. **Provider-independent** domain models in TVN; adapters per vendor.  
2. **Ingest → normalise → cache → publish compact JSON** consumed by the browser.  
3. Browser never holds sports/news API keys.  
4. Television never blocks on INFO fetches.  
5. Always expose **lastUpdated**; never label delayed scores as Live.  
6. Do not scrape sites that forbid it; do not invent results.  
7. One module failure must not blank INFO.

---

## 3. Shared information plane

### 3.1 Proposed artefacts

| Artefact | Role |
|----------|------|
| `InfoRecord` / `NewsItem` / `FootballMatch` / `LeagueTable` | Normalised types in `src/info/` (new) |
| `public/info/news.json` (or CDN/Blob equivalent) | Compact published news snapshot |
| `public/info/football.json` | Compact fixtures/results/tables snapshot |
| Server ingest (Netlify scheduled fn **or** Railway worker **or** offline CI job) | Builds those JSON files |
| `GET /api/info/news`, `GET /api/info/football` (optional) | Freshness proxy if static publish is insufficient |

### 3.2 Client load pattern

```
InfoCentre module
  → fetch('/info/football.json', { cache: 'no-store' }) or /api/info/…
  → validate schema
  → render; on failure show last good from sessionStorage if any
```

Prefetch only when INFO → module is opened (not at startup).

### 3.3 Cache policy (proposed)

| Dataset | Refresh cadence | Stale warning |
|---------|-----------------|---------------|
| News headlines | every 15–30 min | > 2 h |
| Fixtures / tables | every 30–60 min (matchday tighter) | > 3 h |
| “Live” scores | only if paid live tier; else never show Live badge | n/a |

---

## 4. Football / Sports

### 4.1 UI navigation (product)

```
SPORTS → FOOTBALL
  TODAY | FIXTURES | RESULTS | TABLES | COMPETITIONS
```

Match presentation must distinguish: Scheduled · Live · Finished · Postponed/Cancelled.

### 4.2 Provider evaluation — football-data.org (primary candidate)

| Topic | Finding (public pricing/docs, 2026) |
|-------|-------------------------------------|
| Free tier | €0/mo · fixtures, delayed scores/schedules, league tables · **10 calls/min** |
| Live scores | **Not** on free · “Free w/ Livescores” from **€12/mo** |
| Auth | `X-Auth-Token` header — **server only** |
| Free competitions (examples) | Premier League, Championship, Champions League, La Liga, Serie A, Bundesliga, Ligue 1, Eredivisie, Primeira Liga, Brasileirão, World Cup, European Championship |
| **Not** on free (examples) | EFL League One / Two, FA Cup, Scottish Premiership — need higher tier or alternate source |

**Implication:** Phase B can ship PL + Championship + UCL (+ other free top leagues) honestly. League One/Two, FA Cup, Scottish Premiership require paid coverage or a second licensed source — do not pretend free tier includes them.

### 4.3 Provider-independent model (sketch)

```ts
interface FootballCompetition { id: string; name: string; area?: string }
interface FootballMatch {
  id: string
  competitionId: string
  kickoffIso: string
  status: 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled'
  home: string
  away: string
  score?: { home: number; away: number }
  matchday?: number
}
interface LeagueTable { competitionId: string; updatedIso: string; rows: … }
interface FootballSnapshot {
  updatedIso: string
  provider: string
  competitions: FootballCompetition[]
  matches: FootballMatch[]
  tables: LeagueTable[]
  liveReliable: boolean  // false on free delayed tier
}
```

Adapter: `src/info/football/providers/football-data-org.ts` (server-side ingest only).

### 4.4 Attribution and licensing

- Display provider attribution in Sports footer as required by their terms.  
- Re-check redistribution rules before shipping a public JSON mirror.  
- Prefer caching for end users over exposing the upstream API to browsers.

### 4.5 Acceptance criteria — Football Phase B

1. TODAY lists matches for selected competitions with kickoff times.  
2. RESULTS show finished scores; FIXTURES show upcoming.  
3. TABLES render current standings.  
4. COMPETITIONS lists only competitions actually in the snapshot.  
5. If `liveReliable === false`, UI never shows a Live badge (or shows “Delayed”).  
6. Footer: “Updated … · provider …”.  
7. API token never appears in client bundles (secret scan).  
8. Football module failure leaves News and television intact.

### 4.6 Running costs (football)

| Option | Monthly (indicative) |
|--------|----------------------|
| Free delayed | €0 + hosting ingest compute |
| Live scores add-on | from €12 |
| Standard (more competitions) | from ~€49 (vendor list) |

Exact invoice depends on chosen tier and attribution obligations.

---

## 5. News

### 5.1 Categories (product)

UK · World · Technology · Culture · Entertainment · Business · Science · Local (only if a reliable feed exists)

### 5.2 Item fields

Headline · publisher · publishedAt · short description · category · canonical URL  

Rules:

- Description = publisher excerpt or empty — **not** AI-written “summary” presented as theirs  
- Link opens original article (new context); TVN does not host full text  

### 5.3 Source strategy

| Approach | Pros | Cons |
|----------|------|------|
| **RSS/Atom via existing feed machinery** | Fits `/api/feed` skills; many publishers offer RSS | Varying quality; some block bots |
| Documented news APIs | Structured | Cost, keys, ToS |
| Manual editorial JSON | Full control | Labour |

**Phase B recommendation:** allowlisted RSS feeds ingested server-side into `news.json`, reusing parse lessons from `server/podcast-feed.ts` without overloading podcast UX.

### 5.4 Ingest pipeline

1. Fetch allowlisted feeds (timeouts, size caps)  
2. Validate XML/JSON  
3. Normalise to `NewsItem`  
4. Deduplicate by URL / title fingerprint  
5. Stamp `updatedIso`  
6. Publish compact snapshot  
7. On failure: keep previous snapshot; mark `degraded: true`  

Never poll from every viewer browser.

### 5.5 Acceptance criteria — News Phase B

1. At least one category shows real headlines from allowlisted sources.  
2. Each item shows publisher + time + outbound link.  
3. Stale/unavailable states are explicit.  
4. Opening News does not delay channel tune or Guide open.  
5. No fabricated headlines in fixtures/tests beyond clearly marked mocks.

### 5.6 Running costs (news)

Prefer free RSS. Budget only if a paid API is later approved. Ingest compute is the main recurring cost (see hosting doc).

---

## 6. Files (proposed)

| Path | Role |
|------|------|
| `src/info/types.ts` | Shared types |
| `src/info/news/load.ts` | Client loader + schema check |
| `src/info/football/load.ts` | Client loader |
| `src/components/info/NewsPanel.tsx` | UI |
| `src/components/info/FootballPanel.tsx` | UI |
| `server/info-news.ts` / `server/info-football.ts` | Ingest + optional HTTP |
| `netlify/functions/info-*.ts` or Railway worker | Schedule |
| `public/info/*.json` | Published snapshots (or Blob) |
| `src/tvn-info-football.test.ts` / `tvn-info-news.test.ts` | Schema + UI markup |

---

## 7. Complexity

| Work | Complexity |
|------|------------|
| Types + static JSON fixtures for UI | Low |
| RSS ingest + dedupe | Medium |
| football-data.org adapter + cache | Medium |
| Live scores | Medium + € cost |
| League One/FA Cup/Scottish on free tier | **Blocked** without paid data |

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Key leak | Server-only env; secret scan in CI |
| Rate limits (10/min) | Aggregate ingest; single published JSON |
| Stale “live” | `liveReliable` flag |
| Feed ToS / scraping | Allowlist + written permission notes |
| Blocking TV | Lazy fetch; timeouts; never in startup critical path |

---

## 9. Hosting dependency

Phase B can start with **CI-generated static JSON** committed or uploaded on a timer (zero always-on server). Move to Netlify Scheduled Functions or Railway worker when cadence/secrets demand it — decision in `TVN_2.0_HOSTING_COMPARISON.md`.
