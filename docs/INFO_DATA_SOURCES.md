# INFO data sources (Phase B)

## News

Allowlisted public RSS/Atom feeds (see `src/info/news/feeds.ts`):

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

TVN stores **headline, publisher, time, short description, category, and link** only. Full articles remain on the publisher site.

Ingest: `npm run info:news` → `public/info/news.json`.  
Scheduled: `.github/workflows/info-ingest.yml` commits updated JSON so Netlify redeploys.

## Football

Provider: [football-data.org](https://www.football-data.org/) free tier (fixtures, delayed scores, tables).  
Auth: `FOOTBALL_DATA_TOKEN` as a **GitHub Actions secret** and optional local env var — never in the browser.

### Product-owner setup

1. Register at https://www.football-data.org/client/register for a free token.  
2. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**  
   - Name: `FOOTBALL_DATA_TOKEN`  
   - Value: the token  
3. Run **Actions → INFO ingest → Run workflow**, or wait for the schedule.  
4. Locally (optional): `FOOTBALL_DATA_TOKEN=… npm run info:football`

Competitions (free tier codes in `src/info/football/competitions.ts`): PL, ELC, CL, BL1, SA, PD, FL1.  
Not on free tier (excluded): EFL League One/Two, FA Cup, Scottish Premiership.

`liveReliable` is always `false` on this tier — the UI shows **Delayed**, never **Live**.

Ingest: `npm run info:football` → `public/info/football.json`.
