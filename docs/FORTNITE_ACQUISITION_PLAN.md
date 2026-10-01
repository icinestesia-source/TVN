# 812 Fortnite — acquisition plan

Status: **holding (off air)**. Written for TVN 1.0.7; nothing in this plan has been run.

## Why 812

812 was *Arcade Archive*: no programmes, no publisher, and documented as redundant ("242 Arcade already holds the
available arcade material"). The gaming block 230–259 has no free numbers, and every channel in it airs. Renaming 812
removes nothing that aired and keeps Fortnite in the 001–999 curated network.

## What the network holds today

| Where | Programme | Length | Verdict |
| --- | --- | --- | --- |
| TVN catalogue | PC Gamer, *Fortnite Save the World PvE mode: Your complete guide* | 10:41 | qualifies (airs on 244, PC Gamer's home) |
| TVN catalogue | Folding Ideas, *Manufactured Discontent and Fortnite* | 21:19 | qualifies |
| TVN catalogue | Dead Meat horror news round-ups ×2, Mahogany on d4vd | — | mentions only; rejected |
| Harvester Gen 2 | Comic Tropes, *Comics for the Cure: Comic Book YouTubers Play Fortnite* | 2:59:07 | qualifies; PROPOSED, not approved |
| Harvester Gen 2 | five other titles | — | mentions or Shorts; rejected |

About 32 minutes are in TVN, below the three hours a channel needs. 812 stays off air rather than loop two programmes.

## Eligibility (already enforced in `src/director/fit.ts`, `SUBJECT_TITLES`)

- The title must be about Fortnite. News round-ups ("…and More", "News"), "from Fortnite" asides and questions such
  as "Fortnite?" are rejected.
- Generic gaming, battle-royale history without Fortnite, and other games do not qualify.
- The usual TVN rules apply: full programmes of 10 minutes or more, no Shorts, trailers, clips, live placeholders,
  paid, age-restricted, private, non-embeddable or UK-blocked videos.

## Targeted acquisition (for a future, separately approved Harvester run)

1. Official: Epic's *Fortnite* channel — season launch films, cinematic shorts gathered into full-length
   compilations, and documentary features. Long-form only; launch trailers stay off.
2. Competitive: *Fortnite Competitive* — full broadcast finals (FNCS, World Cup), recorded rather than live.
3. Creators and essayists: long-form video essays and documentaries (Folding Ideas style), charity creator events
   (Comic Tropes), and complete history and guide programmes from established games publishers.
4. Review each candidate by title and duration; route by programme (`programmeRoutes`) with a bounded
   `PROGRAMME_REUSE` pair only where a publisher has another home.

## Threshold to go on air

At least three hours of qualifying programmes from at least two publishers. Until then 812 shows its holding card
("OFF AIR · AWAITING FORTNITE PROGRAMMING").
