# INFO data sources and delivery (Phase B / B.1)

## Delivery architecture (no site rebuild)

```
RSS / football-data.org
  → GitHub Actions (npm run info:news / info:football)
  → POST /api/info/publish  (Bearer INFO_PUBLISH_SECRET)
  → Netlify Blobs (site-wide store `tvn-info`)
  → GET /api/info/news | /api/info/football
  → INFO panels in the browser
```

Static seeds `public/info/*.json` ship with application deploys as **fallback only**.  
Refreshing INFO **does not** commit to `main` and **does not** trigger a Netlify production rebuild.

Local/dev: Vite serves the same `/api/info/*` paths from `public/info/*.json`.

## News

Allowlisted public RSS/Atom feeds (`src/info/news/feeds.ts`):

| Id | Publisher | Category | Feed |
|----|-----------|----------|------|
| bbc-uk | BBC News | UK | https://feeds.bbci.co.uk/news/uk/rss.xml |
| bbc-world | BBC News | World | https://feeds.bbci.co.uk/news/world/rss.xml |
| bbc-tech | BBC News | Technology | https://feeds.bbci.co.uk/news/technology/rss.xml |
| bbc-science | BBC News | Science | https://feeds.bbci.co.uk/news/science_and_environment/rss.xml |
| bbc-business | BBC News | Business | https://feeds.bbci.co.uk/news/business/rss.xml |
| bbc-entertainment | BBC News | Entertainment / arts | https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml |
| guardian-uk | The Guardian | UK | https://www.theguardian.com/uk-news/rss |
| guardian-world | The Guardian | World | https://www.theguardian.com/world/rss |
| guardian-tech | The Guardian | Technology | https://www.theguardian.com/uk/technology/rss |
| guardian-culture | The Guardian | Culture | https://www.theguardian.com/uk/culture/rss |
| guardian-business | The Guardian | Business | https://www.theguardian.com/uk/business/rss |
| guardian-science | The Guardian | Science | https://www.theguardian.com/science/rss |

Headlines older than **14 days** are dropped at ingest. Descriptions are truncated to 280 characters. Full articles stay on the publisher site.

## Football

Provider: [football-data.org](https://www.football-data.org/) free tier (fixtures, delayed scores, tables).  
`liveReliable` is always `false` — UI shows **Delayed**, never **Live**.

Competitions (`src/info/football/competitions.ts`): PL, ELC, EL1, CL, BL1, SA, PD, FL1, DED, BSA, WC, EC (12).  
Primeira Liga (PPL) is deferred so League One fits the free-tier slot count.

### Secrets (GitHub Actions + Netlify)

| Secret | Where | Purpose |
|--------|-------|---------|
| `FOOTBALL_DATA_TOKEN` | GitHub Actions | football-data.org free API token |
| `INFO_PUBLISH_SECRET` | GitHub Actions **and** Netlify env | Bearer token for `/api/info/publish` |
| `INFO_PUBLISH_URL` | GitHub Actions | e.g. `https://<your-site>.netlify.app/api/info/publish` |
| `TMDB_API_TOKEN` | Netlify (functions) | TMDB v3 API key for `/api/info/tmdb` (Phase C Entertainment) |
| `ALPHA_VANTAGE_API_KEY` | Netlify (functions) | Alpha Vantage key for `/api/info/finance` (Phase C Business stocks/indices) |

Currencies use keyless Frankfurter. On This Day uses Wikimedia’s public feed (no secret).

### Product-owner setup

1. Register at https://www.football-data.org/client/register → free token.  
2. GitHub → Settings → Secrets → Actions: add `FOOTBALL_DATA_TOKEN`, `INFO_PUBLISH_SECRET`, `INFO_PUBLISH_URL`.  
3. Netlify → Site configuration → Environment variables: add `INFO_PUBLISH_SECRET` (same value).  
4. Deploy the application once so `/api/info/*` functions exist.  
5. Actions → **INFO ingest** → Run workflow.  
6. Open Guide → Info → News / Sports on the live site.

Never put tokens in the repo, Vite env, or chat.
