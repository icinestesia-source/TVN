# Remaining channel production triage (000–999)

The authoritative working queue for the 324 NEEDS_CONTENT channels at catalogue-v30. This is planning only: no statuses, routing, ownership or catalogue data changed. The historical Pass 7–12 notes remain in `docs/needs-content-triage.md`.

Each channel has one primary production class, descriptive secondary tags and, for classes A–E, an expected acquisition yield. Yield means how likely the current RetroTV acquisition system is to populate the channel credibly with reasonable effort; it is not a quality score. Named publisher types are research leads, not verified sources.

## Primary production classes (324)

| Class | Meaning | Channels |
|---|---|---|
| A | NEW_DEDICATED_SOURCES | 152 |
| B | NEW_BROAD_SOURCE_CURATION | 44 |
| C | FREE_FILM_ACQUISITION | 18 |
| D | EXISTING_CATALOGUE_MANUAL_CURATION | 34 |
| E | ADDITIONAL_EXTERNAL_METADATA | 10 |
| F | CURRENT_AFFAIRS_OR_LIVE_MODEL | 37 |
| G | AUDIO_OR_RADIO_MODEL | 1 |
| H | RETROTV_ORIGINAL_OR_GENERATED_CANDIDATE | 4 |
| I | PRESENTATION_OR_FORMAT_CHANNEL | 22 |
| J | NO_CREDIBLE_FREE_PATH | 2 |
| | **Total** | **324** |

## Expected yield (classes A–E)

| Yield | A | B | C | D | E | Total |
|---|---|---|---|---|---|---|
| HIGH | 55 | 7 | 0 | 7 | 0 | 69 |
| MEDIUM | 75 | 25 | 12 | 25 | 10 | 147 |
| LOW | 22 | 12 | 6 | 2 | 0 | 42 |

## Secondary tags

| Tag | Channels |
|---|---|
| PROGRAMME_LEVEL | 84 |
| HIGH_EXPECTED_YIELD | 69 |
| KNOWLEDGE | 65 |
| FILM | 59 |
| MULTI_SOURCE | 41 |
| ARCHIVE | 40 |
| CURRENT | 40 |
| YEAR_DEPENDENT | 37 |
| LOW_EXPECTED_YIELD | 34 |
| TECH | 33 |
| LIFESTYLE | 30 |
| MUSIC | 25 |
| SPORT | 24 |
| ENTERTAINMENT | 23 |
| EDITORIAL_JUDGEMENT | 19 |
| SINGLE_SOURCE_POSSIBLE | 10 |
| FOOD | 6 |

## Acquisition families

Shared research is recorded so one publisher search can serve several channels. A publisher found for a family is still assigned to channels individually by explicit rule or route, never wholesale.

| Family | Channels | Classes | Numbers | Shared research |
|---|---|---|---|---|
| CURRENT AFFAIRS | 32 | F 32 | 073, 902, 903, 904, 905, 906, 907, 910, 911, 912, 913, 917, 919, 922, 926, 927, 928, 929, 930, 931, 932, 933, 934, 935, 936, 938, 939, 941, 942, 944, 946, 947 |  |
| FORMAT | 22 | I 22 | 078, 185, 187, 188, 189, 190, 191, 192, 292, 469, 499, 563, 564, 699, 729, 769, 799, 800, 882, 883, 898, 948 |  |
| BUSINESS | 19 | A 17, B 2 | 394, 600, 608, 610, 612, 613, 615, 616, 618, 620, 623, 624, 625, 626, 627, 628, 629, 694, 697 | broad business-documentary publishers serve 600 and 629; company-history creators serve 615 and 694 |
| FILM TRAILERS | 18 | A 8, E 9, F 1 | 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 134, 135, 136, 137, 138, 139 | one single-film trailer archive whose titles state "Title (YYYY)" serves 121-128 through existing year routing, and later 130-139 once external genre metadata exists |
| FILM GENRES | 16 | C 6, D 10 | 034, 037, 084, 116, 118, 142, 143, 149, 150, 151, 152, 153, 155, 157, 183, 184 | the Popcornflix structured genre field already supports 034, 143, 149-157 once a reuse policy is agreed (no acquisition) |
| ARCHIVE | 14 | A 1, B 13 | 019, 429, 801, 808, 809, 819, 833, 836, 839, 843, 844, 848, 849, 945 | official newsreel, news-agency, industrial-film and national archives serve 019, 429, 801, 808, 809, 836, 839, 945; Pathé stays owned by 805 |
| MUSIC ERAS | 14 | A 12, D 1, E 1 | 540, 541, 544, 547, 548, 549, 582, 586, 588, 589, 594, 595, 596, 597 | official legacy-artist and VEVO artist channels serve 540/541/548 and 594-597 through the existing era and description rules; each artist is added to explicit rule lists, not sprayed |
| FOOTBALL | 11 | A 10, D 1 | 303, 304, 306, 307, 308, 311, 313, 323, 325, 326, 327 | official league, confederation and club channels serve 303, 307, 308, 311, 313; duplicate identities 325/326/327 need a split first |
| TRAVEL | 9 | A 7, B 2 | 057, 448, 772, 773, 775, 776, 777, 778, 779 | creator-owned travel channels serve 057, 772-777 and overlap 095 Slow TV |
| FILM ERAS | 9 | C 9 | 111, 141, 145, 171, 172, 173, 175, 176, 199 | official studio vaults and verified public-domain archives serve 111, 141, 145, 171-176, 199; year routing already exists |
| TECH | 9 | A 8, D 1 | 635, 636, 643, 685, 686, 690, 691, 815, 818 |  |
| GEOGRAPHY | 8 | B 5, D 3 | 061, 434, 437, 438, 440, 441, 442, 449 |  |
| LAW | 8 | A 2, B 6 | 451, 454, 455, 456, 457, 458, 462, 463 | public lecture institutions serve most of 451-463 and also 423, 494, 495, 746 |
| RAIL | 8 | A 8 | 665, 678, 679, 774, 821, 822, 823, 824 | one rail research sweep (heritage railways, rail creators, cab rides) serves 665, 678, 679, 774, 821-824 and also 095 Slow TV |
| ENGINEERING / INDUSTRY | 7 | A 7 | 622, 653, 654, 657, 662, 663, 669 |  |
| FILM CULTURE | 6 | A 3, D 2, J 1 | 163, 166, 196, 197, 198, 297 |  |
| ANIME | 6 | A 5, C 1 | 228, 230, 231, 232, 233, 234 | official UK-available full-episode anime publishers serve 228-232 with editorial series-to-genre assignment |
| TV / BROADCAST ARCHIVE | 5 | B 5 | 288, 289, 891, 892, 893 | official broadcaster archive channels serve 288, 289, 891, 892, 893 and help 945/019 |
| HISTORY | 5 | A 2, D 3 | 407, 418, 422, 423, 424 |  |
| TRANSPORT | 5 | A 5 | 675, 832, 835, 837, 838 |  |
| HOME / GARDEN | 5 | A 5 | 764, 765, 767, 768, 789 |  |
| NATURE / WILDLIFE | 4 | A 4 | 023, 066, 784, 788 | one natural-history sweep serves 023, 066, 784, 788 |
| BOOKS / LITERATURE | 4 | A 3, D 1 | 092, 497, 840, 842 | publisher, literary-festival and poetry-organisation channels serve 092, 840, 842 |
| TV DRAMA | 4 | A 4 | 212, 213, 214, 215 | official full-episode drama channels serve 212-215 |
| OUTDOOR / ADVENTURE SPORT | 4 | A 4 | 356, 359, 384, 780 |  |
| FOOD | 4 | A 1, D 3 | 717, 723, 725, 726 |  |
| HEALTH / FITNESS | 4 | A 4 | 732, 742, 743, 744 |  |
| MEDICINE | 4 | A 2, B 2 | 746, 747, 748, 749 | medical-education channels serve 747 and 748 |
| EARTH SCIENCE | 3 | A 3 | 065, 431, 483 | one geoscience sweep serves 065, 431, 483 |
| CLASSIC TV | 3 | A 3 | 211, 219, 275 |  |
| SPORT ARCHIVES | 3 | A 2, D 1 | 329, 344, 397 |  |
| MUSIC GENRES | 3 | A 3 | 578, 598, 599 |  |
| CRAFT / MAKERS | 3 | A 1, D 2 | 688, 795, 798 |  |
| GENERATED | 3 | H 3 | 887, 895, 949 |  |
| PUBLIC DOMAIN FILM | 2 | C 2 | 087, 802 |  |
| COMMUNITY / LOCAL | 2 | F 1, H 1 | 088, 089 |  |
| AMBIENT / SLOW | 2 | A 2 | 094, 095 |  |
| TEEN / YOUNG ADULT | 2 | A 2 | 238, 239 |  |
| GAMING / ARCADE | 2 | D 2 | 242, 812 |  |
| COMICS / SUPERHEROES | 2 | A 2 | 252, 253 |  |
| CRICKET | 2 | A 2 | 360, 361 |  |
| SPORTS SCIENCE / MEDICINE | 2 | A 2 | 390, 391 |  |
| SCIENCE | 2 | A 2 | 478, 489 |  |
| SOCIAL SCIENCE | 2 | B 2 | 494, 495 |  |
| MUSIC CURRENT | 2 | F 2 | 550, 551 |  |
| MUSIC CULTURE | 2 | B 1, J 1 | 560, 579 |  |
| ADVERTISING | 2 | B 2 | 611, 806 |  |
| DESIGN | 2 | A 2 | 658, 659 |  |
| NEWS DOCUMENTARY | 2 | B 2 | 914, 943 |  |
| PEOPLE / BIOGRAPHY | 1 | B 1 | 027 |  |
| STAGE / PERFORMING ARTS | 1 | A 1 | 049 |  |
| WEATHER | 1 | F 1 | 074 |  |
| TALK / LATE NIGHT | 1 | A 1 | 076 |  |
| MUSIC FESTIVALS | 1 | D 1 | 085 |  |
| LEARNING | 1 | D 1 | 090 |  |
| ODDITIES | 1 | D 1 | 096 |  |
| SCI-FI CULTURE | 1 | D 1 | 254 |  |
| INTERNET CULTURE | 1 | B 1 | 290 |  |
| MOTORSPORT | 1 | A 1 | 345 |  |
| AUDIO | 1 | G 1 | 841 |  |
| ART | 1 | A 1 | 885 |  |

## Film gap analysis

Current full-film inventory: Movie Central (300 films, 106), Popcornflix (180, 102), KOFA (166, owned by 114), BFI (84), NFB (77), FilmRise (62, 101), MST3K (51), Alter/Dust shorts. No full film in any non-owned source carries an original year before 1980. The Popcornflix title carries a structured genre field; Movie Central titles are mostly plot hooks.

| # | Channel | Requires | Current material | Blocker | Class |
|---|---|---|---|---|---|
| 034 | Action | action films exist (Popcornflix genre field about 330 h) but are dedicated to 102/106; no genre reuse policy | yes: about 330 h Popcornflix/Movie Central action (dedicated) | OWNERSHIP/REUSE (inventory exists) | D |
| 037 | Fantasy | only about 19 h of fantasy films in the catalogue | thin: about 19 h fantasy | QUANTITY | C |
| 084 | Indie Screen | independent features absent; Omeleto/Dust/Alter are shorts with their own homes | no features (shorts only, dedicated) | RIGHTS/SOURCE | C |
| 087 | Public Domain | public-domain status must be verified per film; no verified PD publisher | no | RIGHTS/SOURCE | C |
| 111 | Golden Age | no 1930-59 full films in any non-owned free source | no pre-1960 films | RIGHTS/SOURCE | C |
| 116 | Experimental Film | experimental film is mostly on art-house platforms, NFB owned | no | RIGHTS/SOURCE | C |
| 118 | Family Film | only about 18 h of family films in current sources | thin: about 18 h | QUANTITY | C |
| 121 | Classic Trailers | no single-film trailer source; RT titles are weekly compilation reels | RT weekly compilation reels only | RIGHTS/SOURCE (single-film trailer source) | A |
| 122 | 1950s Trailers | no single-film trailer source; RT titles are weekly compilation reels | RT weekly compilation reels only | RIGHTS/SOURCE (single-film trailer source) | A |
| 123 | 1960s Trailers | no single-film trailer source; RT titles are weekly compilation reels | RT weekly compilation reels only | RIGHTS/SOURCE (single-film trailer source) | A |
| 124 | 1970s Trailers | no single-film trailer source; RT titles are weekly compilation reels | RT weekly compilation reels only | RIGHTS/SOURCE (single-film trailer source) | A |
| 125 | 1980s Trailers | no single-film trailer source; RT titles are weekly compilation reels | RT weekly compilation reels only | RIGHTS/SOURCE (single-film trailer source) | A |
| 126 | 1990s Trailers | no single-film trailer source; RT titles are weekly compilation reels | RT weekly compilation reels only | RIGHTS/SOURCE (single-film trailer source) | A |
| 127 | 2000s Trailers | no single-film trailer source; RT titles are weekly compilation reels | RT weekly compilation reels only | RIGHTS/SOURCE (single-film trailer source) | A |
| 128 | 2010s Trailers | no single-film trailer source; RT titles are weekly compilation reels | RT weekly compilation reels only | RIGHTS/SOURCE (single-film trailer source) | A |
| 129 | New Trailers | "new" requires a rolling window of current trailers | RT weekly compilation reels only | CURRENT | F |
| 130 | Horror Trailers | genre of each trailered film is not in YouTube metadata | no single-film trailers | GENRE CLASSIFICATION (external film metadata) | E |
| 131 | Sci-Fi Trailers | genre of each trailered film is not in YouTube metadata | no single-film trailers | GENRE CLASSIFICATION (external film metadata) | E |
| 132 | Action Trailers | genre of each trailered film is not in YouTube metadata | no single-film trailers | GENRE CLASSIFICATION (external film metadata) | E |
| 134 | Cult Trailers | genre of each trailered film is not in YouTube metadata | no single-film trailers | GENRE CLASSIFICATION (external film metadata) | E |
| 135 | Animation Trailers | genre of each trailered film is not in YouTube metadata | no single-film trailers | GENRE CLASSIFICATION (external film metadata) | E |
| 136 | Drama Trailers | genre of each trailered film is not in YouTube metadata | no single-film trailers | GENRE CLASSIFICATION (external film metadata) | E |
| 137 | Thriller Trailers | genre of each trailered film is not in YouTube metadata | no single-film trailers | GENRE CLASSIFICATION (external film metadata) | E |
| 138 | Fantasy Trailers | genre of each trailered film is not in YouTube metadata | no single-film trailers | GENRE CLASSIFICATION (external film metadata) | E |
| 139 | Documentary Trailers | genre of each trailered film is not in YouTube metadata | no single-film trailers | GENRE CLASSIFICATION (external film metadata) | E |
| 141 | Classic Horror | no pre-1980 horror films in non-owned free sources | no pre-1980 horror | RIGHTS/SOURCE | C |
| 142 | Gothic Horror | only a handful of gothic titles; gothic is not a structured genre | a handful | QUANTITY + GENRE CLASSIFICATION | C |
| 143 | Creature Features | about 16 h of creature films in Popcornflix/Movie Central, dedicated elsewhere | about 16 h | OWNERSHIP/REUSE (inventory exists) | D |
| 145 | Classic Sci-Fi | no pre-1980 sci-fi films in non-owned free sources | no pre-1980 sci-fi | RIGHTS/SOURCE | C |
| 149 | Adventure Cinema | about 66 h of adventure films exist, dedicated elsewhere | about 66 h | OWNERSHIP/REUSE (inventory exists) | D |
| 150 | Thriller | about 240 h of thrillers exist, dedicated elsewhere | about 240 h | OWNERSHIP/REUSE (inventory exists) | D |
| 151 | Crime Cinema | about 114 h of crime films exist, dedicated elsewhere | about 114 h | OWNERSHIP/REUSE (inventory exists) | D |
| 152 | Mystery Cinema | about 56 h of mystery films exist, dedicated elsewhere | about 56 h | OWNERSHIP/REUSE (inventory exists) | D |
| 153 | Comedy Cinema | about 71 h of comedy films exist, dedicated elsewhere (stand-up excluded) | about 71 h | OWNERSHIP/REUSE (inventory exists) | D |
| 155 | Drama Cinema | about 156 h of drama films exist, dedicated elsewhere | about 156 h | OWNERSHIP/REUSE (inventory exists) | D |
| 157 | Western | about 17 h (10 films) of westerns exist, dedicated elsewhere | about 17 h (10 films) | QUANTITY (inventory thin) | D |
| 163 | Actors | actor interviews/profiles are spread across Vanity Fair, BFI, Kermode & Mayo homes | interview programmes in several homes | GENRE CLASSIFICATION (editorial) | D |
| 166 | Film Editing | no film-editing craft publisher beyond StudioBinder (dedicated) | StudioBinder only (dedicated) | RIGHTS/SOURCE | A |
| 171 | Cinema 1920s | silent-era films need verified PD or archive publishers | no | RIGHTS/SOURCE | C |
| 172 | Cinema 1930s | no 1930s full films in non-owned sources | no | RIGHTS/SOURCE | C |
| 173 | Cinema 1940s | no 1940s full films in non-owned sources | no | RIGHTS/SOURCE | C |
| 175 | Cinema 1960s | no 1960s full films in non-owned sources | no | RIGHTS/SOURCE | C |
| 176 | Cinema 1970s | no 1970s full films in non-owned sources | no | RIGHTS/SOURCE | C |
| 183 | Cult Classics | "cult" is editorial; free cult films scarce | no clear set | GENRE CLASSIFICATION (editorial) + RIGHTS/SOURCE | C |
| 184 | B-Movies | low-budget genre films exist in Popcornflix/Movie Central; MST3K stays at its home | low-budget genre films exist; MST3K stays home | GENRE CLASSIFICATION (editorial) | D |
| 185 | Drive-In | drive-in is a presentation (double bill with intermission) | n/a (format) | FORMAT | I |
| 187 | Creature Night | a creature-feature scheduling block | n/a (format over 143) | FORMAT | I |
| 188 | Saturday Matinee | "Saturday Matinee" is a time-slot presentation | n/a (format) | FORMAT | I |
| 189 | Sunday Cinema | "Sunday Cinema" is a time-slot presentation | n/a (format) | FORMAT | I |
| 190 | Late Film | "Late Film" is a time-slot presentation | n/a (format) | FORMAT | I |
| 191 | Midnight Film | "Midnight Film" is a time-slot presentation | n/a (format) | FORMAT | I |
| 192 | Double Feature | "Double Feature" is a time-slot presentation | n/a (format) | FORMAT | I |
| 196 | Movie Culture | BFI is dedicated; other film-culture creators own homes | film-culture creators own homes | RIGHTS/SOURCE | A |
| 197 | Behind the Scenes | making-of material exists across Corridor Crew, Stan Winston, StudioBinder, Noclip homes | making-of programmes in several homes | GENRE CLASSIFICATION (editorial) | D |
| 198 | Deleted & Rare | deleted scenes are studio-held; "rare" cannot be verified | no | RIGHTS/SOURCE (unresolvable) | J |
| 199 | Cinema Archive | archival cinema needs pre-1980 film sources | no | RIGHTS/SOURCE | C |
| 233 | Anime Cinema | free full anime films are rare | no | RIGHTS/SOURCE | C |
| 297 | Fan Films | fan films carry third-party IP risk | no | RIGHTS/SOURCE | A |
| 802 | Public Domain | duplicate identity with 087; PD status per title | no | RIGHTS/SOURCE | C |

Film blockers: RIGHTS/SOURCE 26, GENRE CLASSIFICATION 13, OWNERSHIP/REUSE 8, FORMAT 7, QUANTITY 4, CURRENT 1.

## Music gap analysis

Description enrichment is complete and is not repeated. Remaining music gaps:

| Gap | Channels | Explanation |
|---|---|---|
| Genuinely missing source inventory | 578 Remixes, 598 VEVO Live & Performance, 599 VEVO Discover, 560 Music Documentary, 594 VEVO Classics, 595 VEVO 1980s | no source of the required kind in the catalogue (remix labels, VEVO live/discovery series, music documentaries, pre-1990 VEVO artists) |
| Insufficient hours | 540 1950s, 541 1960s, 548 Oldies, 588 Disco 79, 596 VEVO 1990s, 597 VEVO 2000s, 544 1990s | dated inventory exists but is under 3 h; 544 loses its 1990s recordings to the higher-priority 581/584/580 rules |
| Insufficient artist diversity | 582 Indie 2000, 586 Punk 90 | dated inventory is dominated by one artist or one label (over 60% or fewer than 3 sources) |
| Missing metadata | 547 2020s | copyright years equal the upload year; only external release metadata can establish 2020s releases |
| Editorial-definition problem | 549 Retro Hits, 589 Synth 84, 579 Rare Tracks, 563 Artists, 564 Bands | no structured definition of "retro hits", "synth", "rare", "artists", "bands" |
| Current/live model | 550 Chart, 551 New Music | identity is inherently current (chart, new releases) |

085 Festival (main band) is music-adjacent: festival sets exist across dedicated sources and need a reuse policy (class D).

## Channel queue

| # | Channel | Category | Class | Tags | Yield | Blocker | Next method | Rationale |
|---|---|---|---|---|---|---|---|---|
| 019 | Archive | main | B NEW_BROAD_SOURCE_CURATION | ARCHIVE MULTI_SOURCE PROGRAMME_LEVEL | MEDIUM | no reusable archive publisher (Pathé owned by 805) | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (official newsreel/TV archive channels) | archive identity is defined by the publisher being an archive, so no per-item year metadata is needed once a non-owned archive source exists |
| 023 | Nature | main | A NEW_DEDICATED_SOURCES | KNOWLEDGE MULTI_SOURCE | HIGH | existing nature publishers already form other channel identities (BBC Earth dedicated) | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official free natural-history channels) | natural-history publishers on YouTube are numerous; a main-band pool needs sources distinct from the existing nature homes |
| 027 | People | main | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL EDITORIAL_JUDGEMENT | MEDIUM | profiles are scattered across publishers; no biography publisher | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes | biography programmes exist inside broad documentary publishers; needs programme-level selection |
| 034 | Action | main | D EXISTING_CATALOGUE_MANUAL_CURATION | FILM PROGRAMME_LEVEL HIGH_EXPECTED_YIELD | HIGH | action films exist (Popcornflix genre field about 330 h) but are dedicated to 102/106; no genre reuse policy | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source using the Popcornflix structured genre field | large existing full-film inventory with a structured genre field; blocked only by ownership/reuse policy, not by source |
| 037 | Fantasy | main | C FREE_FILM_ACQUISITION | FILM LOW_EXPECTED_YIELD | MEDIUM | only about 19 h of fantasy films in the catalogue | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only | fantasy films are thin in the current free-film sources |
| 049 | Stage | main | A NEW_DEDICATED_SOURCES | ENTERTAINMENT MULTI_SOURCE | MEDIUM | National Theatre, Globe, Royal Ballet & Opera, Sadler's Wells already own homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (theatre companies publishing full productions or long excerpts) | a main-band stage pool needs companies distinct from the existing performing-arts homes |
| 057 | Travel | main | A NEW_DEDICATED_SOURCES | LIFESTYLE MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | Rick Steves and Lonely Planet already own travel homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (creator-owned travel series) | creator-owned travel series are abundant and plainly in scope |
| 061 | Geography Mix | main | D EXISTING_CATALOGUE_MANUAL_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | geography programmes are split across dedicated homes; pass 9 found no clean route | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing geography/explainer inventory can be selected editorially |
| 065 | Earth | main | A NEW_DEDICATED_SOURCES | KNOWLEDGE MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | Geology Hub and Shawn Willsey already dedicated to the geology home | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (geoscience lecturers, survey agencies, university geology channels) | one geoscience research sweep serves 065, 431 and 483 |
| 066 | Wildlife | main | A NEW_DEDICATED_SOURCES | KNOWLEDGE MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | existing wildlife inventory belongs to other homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official free wildlife-documentary channels) | wildlife documentary publishers are plentiful; same sweep as 023/784/788 |
| 073 | Business Today | main | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity is "today": needs fresh business news | live/current provider model | a static archive pool cannot be "Business Today" |
| 074 | Weather | main | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | weather is inherently current (Met Office already has a home) | live/current provider model | stale forecasts are not a weather channel |
| 076 | Talk | main | A NEW_DEDICATED_SOURCES | ENTERTAINMENT MULTI_SOURCE | MEDIUM | Colbert, Fallon, Seth Meyers, Team Coco and Kermode & Mayo already own homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official talk and interview programme channels) | more official talk-programme publishers exist; the main-band pool must be distinct from existing talk homes |
| 078 | Magazine | main | I PRESENTATION_OR_FORMAT_CHANNEL | EDITORIAL_JUDGEMENT | n/a | "magazine" is a presentation format, not a library | schedule format built from existing magazine-style programmes | no acquirable "magazine" subject |
| 084 | Indie Screen | main | C FREE_FILM_ACQUISITION | FILM | MEDIUM | independent features absent; Omeleto/Dust/Alter are shorts with their own homes | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only (independent-film distributors with free full features) | needs independent full features rather than shorts |
| 085 | Festival | main | D EXISTING_CATALOGUE_MANUAL_CURATION | MUSIC PROGRAMME_LEVEL MULTI_SOURCE | MEDIUM | festival sets exist (Coachella, Newport Folk, Afro Nation, Boiler Room) but each source is dedicated | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source (explicit festival-set selection) | inventory exists across several dedicated sources; needs a reuse policy and editorial selection |
| 087 | Public Domain | main | C FREE_FILM_ACQUISITION | FILM ARCHIVE | MEDIUM | public-domain status must be verified per film; no verified PD publisher | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only (verified public-domain archives only) | lawful but rights verification is per title |
| 088 | Community | main | H RETROTV_ORIGINAL_OR_GENERATED_CANDIDATE | EDITORIAL_JUDGEMENT | n/a | no community-access publisher with a national identity | RetroTV original/generated community slot | community TV is inherently local; a generated community-notice format fits better than acquisition |
| 089 | Local | main | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | local means the viewer's locality and current events | live/current provider model (location-aware) | cannot be a single static archive pool |
| 090 | Learning | main | D EXISTING_CATALOGUE_MANUAL_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | education publishers exist but own their subject homes | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | broad learning pool can be selected editorially across existing education sources |
| 092 | Books | main | A NEW_DEDICATED_SOURCES | KNOWLEDGE MULTI_SOURCE | MEDIUM | no books/author-talk publisher in the catalogue | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (publishers, literary festivals, library author talks) | author talks and literary festivals publish freely; same sweep serves 840, 842, 497 |
| 094 | Ambient TV | main | A NEW_DEDICATED_SOURCES | LIFESTYLE SINGLE_SOURCE_POSSIBLE | MEDIUM | no ambient publisher; quality varies widely | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (creator-owned ambient/nature-sound films) | plenty of creator-owned ambient video; editorial quality bar matters |
| 095 | Slow TV | main | A NEW_DEDICATED_SOURCES | LIFESTYLE MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | National Rail Scenic and Cruising the Cut own other homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (cab rides, walking tours, canal/boat journeys, broadcaster slow-TV releases) | long-form real-time journeys are abundant and creator-owned; overlaps the rail and walking families |
| 096 | Oddities | main | D EXISTING_CATALOGUE_MANUAL_CURATION | ENTERTAINMENT PROGRAMME_LEVEL EDITORIAL_JUDGEMENT | LOW | "odd" is an editorial judgement; no structured field | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | only editorial picks can define it |
| 111 | Golden Age | film | C FREE_FILM_ACQUISITION | FILM YEAR_DEPENDENT ARCHIVE | MEDIUM | no 1930-59 full films in any non-owned free source | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only; original year from title/credit block under the existing year rules | rights/source is the blocker; year routing is already built |
| 116 | Experimental Film | film | C FREE_FILM_ACQUISITION | FILM ARCHIVE LOW_EXPECTED_YIELD | LOW | experimental film is mostly on art-house platforms, NFB owned | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only (artist-film distributors on YouTube) | little lawful free experimental cinema on YouTube |
| 118 | Family Film | film | C FREE_FILM_ACQUISITION | FILM | MEDIUM | only about 18 h of family films in current sources | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only (free family-film channels from official distributors) | official free family-film channels exist; current catalogue thin |
| 121 | Classic Trailers | film | A NEW_DEDICATED_SOURCES | FILM YEAR_DEPENDENT SINGLE_SOURCE_POSSIBLE HIGH_EXPECTED_YIELD | HIGH | no single-film trailer source; RT titles are weekly compilation reels | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official single-film trailer archive whose titles state "Title (YYYY)"), routed by the existing title-year rules | one single-film trailer publisher with film years in titles populates every decade-trailer channel through existing year routing |
| 122 | 1950s Trailers | film | A NEW_DEDICATED_SOURCES | FILM YEAR_DEPENDENT SINGLE_SOURCE_POSSIBLE HIGH_EXPECTED_YIELD | HIGH | no single-film trailer source; RT titles are weekly compilation reels | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official single-film trailer archive whose titles state "Title (YYYY)"), routed by the existing title-year rules | one single-film trailer publisher with film years in titles populates every decade-trailer channel through existing year routing |
| 123 | 1960s Trailers | film | A NEW_DEDICATED_SOURCES | FILM YEAR_DEPENDENT SINGLE_SOURCE_POSSIBLE HIGH_EXPECTED_YIELD | HIGH | no single-film trailer source; RT titles are weekly compilation reels | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official single-film trailer archive whose titles state "Title (YYYY)"), routed by the existing title-year rules | one single-film trailer publisher with film years in titles populates every decade-trailer channel through existing year routing |
| 124 | 1970s Trailers | film | A NEW_DEDICATED_SOURCES | FILM YEAR_DEPENDENT SINGLE_SOURCE_POSSIBLE HIGH_EXPECTED_YIELD | HIGH | no single-film trailer source; RT titles are weekly compilation reels | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official single-film trailer archive whose titles state "Title (YYYY)"), routed by the existing title-year rules | one single-film trailer publisher with film years in titles populates every decade-trailer channel through existing year routing |
| 125 | 1980s Trailers | film | A NEW_DEDICATED_SOURCES | FILM YEAR_DEPENDENT SINGLE_SOURCE_POSSIBLE HIGH_EXPECTED_YIELD | HIGH | no single-film trailer source; RT titles are weekly compilation reels | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official single-film trailer archive whose titles state "Title (YYYY)"), routed by the existing title-year rules | one single-film trailer publisher with film years in titles populates every decade-trailer channel through existing year routing |
| 126 | 1990s Trailers | film | A NEW_DEDICATED_SOURCES | FILM YEAR_DEPENDENT SINGLE_SOURCE_POSSIBLE HIGH_EXPECTED_YIELD | HIGH | no single-film trailer source; RT titles are weekly compilation reels | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official single-film trailer archive whose titles state "Title (YYYY)"), routed by the existing title-year rules | one single-film trailer publisher with film years in titles populates every decade-trailer channel through existing year routing |
| 127 | 2000s Trailers | film | A NEW_DEDICATED_SOURCES | FILM YEAR_DEPENDENT SINGLE_SOURCE_POSSIBLE HIGH_EXPECTED_YIELD | HIGH | no single-film trailer source; RT titles are weekly compilation reels | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official single-film trailer archive whose titles state "Title (YYYY)"), routed by the existing title-year rules | one single-film trailer publisher with film years in titles populates every decade-trailer channel through existing year routing |
| 128 | 2010s Trailers | film | A NEW_DEDICATED_SOURCES | FILM YEAR_DEPENDENT SINGLE_SOURCE_POSSIBLE HIGH_EXPECTED_YIELD | HIGH | no single-film trailer source; RT titles are weekly compilation reels | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official single-film trailer archive whose titles state "Title (YYYY)"), routed by the existing title-year rules | one single-film trailer publisher with film years in titles populates every decade-trailer channel through existing year routing |
| 129 | New Trailers | film | F CURRENT_AFFAIRS_OR_LIVE_MODEL | FILM CURRENT | n/a | "new" requires a rolling window of current trailers | current-feed model over official trailer publishers | freshness is the identity |
| 130 | Horror Trailers | film | E ADDITIONAL_EXTERNAL_METADATA | FILM PROGRAMME_LEVEL | MEDIUM | genre of each trailered film is not in YouTube metadata | after a single-film trailer source exists, attach film genre from external film metadata (e.g. Wikidata/TMDB) with provenance | trailers will exist after 121-128 acquisition, but genre needs non-YouTube metadata |
| 131 | Sci-Fi Trailers | film | E ADDITIONAL_EXTERNAL_METADATA | FILM PROGRAMME_LEVEL | MEDIUM | genre of each trailered film is not in YouTube metadata | after a single-film trailer source exists, attach film genre from external film metadata (e.g. Wikidata/TMDB) with provenance | trailers will exist after 121-128 acquisition, but genre needs non-YouTube metadata |
| 132 | Action Trailers | film | E ADDITIONAL_EXTERNAL_METADATA | FILM PROGRAMME_LEVEL | MEDIUM | genre of each trailered film is not in YouTube metadata | after a single-film trailer source exists, attach film genre from external film metadata (e.g. Wikidata/TMDB) with provenance | trailers will exist after 121-128 acquisition, but genre needs non-YouTube metadata |
| 134 | Cult Trailers | film | E ADDITIONAL_EXTERNAL_METADATA | FILM PROGRAMME_LEVEL | MEDIUM | genre of each trailered film is not in YouTube metadata | after a single-film trailer source exists, attach film genre from external film metadata (e.g. Wikidata/TMDB) with provenance | trailers will exist after 121-128 acquisition, but genre needs non-YouTube metadata |
| 135 | Animation Trailers | film | E ADDITIONAL_EXTERNAL_METADATA | FILM PROGRAMME_LEVEL | MEDIUM | genre of each trailered film is not in YouTube metadata | after a single-film trailer source exists, attach film genre from external film metadata (e.g. Wikidata/TMDB) with provenance | trailers will exist after 121-128 acquisition, but genre needs non-YouTube metadata |
| 136 | Drama Trailers | film | E ADDITIONAL_EXTERNAL_METADATA | FILM PROGRAMME_LEVEL | MEDIUM | genre of each trailered film is not in YouTube metadata | after a single-film trailer source exists, attach film genre from external film metadata (e.g. Wikidata/TMDB) with provenance | trailers will exist after 121-128 acquisition, but genre needs non-YouTube metadata |
| 137 | Thriller Trailers | film | E ADDITIONAL_EXTERNAL_METADATA | FILM PROGRAMME_LEVEL | MEDIUM | genre of each trailered film is not in YouTube metadata | after a single-film trailer source exists, attach film genre from external film metadata (e.g. Wikidata/TMDB) with provenance | trailers will exist after 121-128 acquisition, but genre needs non-YouTube metadata |
| 138 | Fantasy Trailers | film | E ADDITIONAL_EXTERNAL_METADATA | FILM PROGRAMME_LEVEL | MEDIUM | genre of each trailered film is not in YouTube metadata | after a single-film trailer source exists, attach film genre from external film metadata (e.g. Wikidata/TMDB) with provenance | trailers will exist after 121-128 acquisition, but genre needs non-YouTube metadata |
| 139 | Documentary Trailers | film | E ADDITIONAL_EXTERNAL_METADATA | FILM PROGRAMME_LEVEL | MEDIUM | genre of each trailered film is not in YouTube metadata | after a single-film trailer source exists, attach film genre from external film metadata (e.g. Wikidata/TMDB) with provenance | trailers will exist after 121-128 acquisition, but genre needs non-YouTube metadata |
| 141 | Classic Horror | film | C FREE_FILM_ACQUISITION | FILM YEAR_DEPENDENT | MEDIUM | no pre-1980 horror films in non-owned free sources | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only; original year from title/credit block under the existing year rules | classic horror needs pre-1980 films; routing already exists |
| 142 | Gothic Horror | film | C FREE_FILM_ACQUISITION | FILM LOW_EXPECTED_YIELD | LOW | only a handful of gothic titles; gothic is not a structured genre | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only | thin and editorially defined |
| 143 | Creature Features | film | D EXISTING_CATALOGUE_MANUAL_CURATION | FILM PROGRAMME_LEVEL | MEDIUM | about 16 h of creature films in Popcornflix/Movie Central, dedicated elsewhere | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | enough existing inventory for activation with explicit selection |
| 145 | Classic Sci-Fi | film | C FREE_FILM_ACQUISITION | FILM YEAR_DEPENDENT | MEDIUM | no pre-1980 sci-fi films in non-owned free sources | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only; original year from title/credit block under the existing year rules | rights/source is the blocker |
| 149 | Adventure Cinema | film | D EXISTING_CATALOGUE_MANUAL_CURATION | FILM PROGRAMME_LEVEL HIGH_EXPECTED_YIELD | HIGH | about 66 h of adventure films exist, dedicated elsewhere | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source using the Popcornflix genre field | existing inventory, needs reuse policy |
| 150 | Thriller | film | D EXISTING_CATALOGUE_MANUAL_CURATION | FILM PROGRAMME_LEVEL HIGH_EXPECTED_YIELD | HIGH | about 240 h of thrillers exist, dedicated elsewhere | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source using the Popcornflix genre field | existing inventory, needs reuse policy |
| 151 | Crime Cinema | film | D EXISTING_CATALOGUE_MANUAL_CURATION | FILM PROGRAMME_LEVEL HIGH_EXPECTED_YIELD | HIGH | about 114 h of crime films exist, dedicated elsewhere | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source using the Popcornflix genre field | existing inventory, needs reuse policy |
| 152 | Mystery Cinema | film | D EXISTING_CATALOGUE_MANUAL_CURATION | FILM PROGRAMME_LEVEL HIGH_EXPECTED_YIELD | HIGH | about 56 h of mystery films exist, dedicated elsewhere | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source using the Popcornflix genre field | existing inventory, needs reuse policy |
| 153 | Comedy Cinema | film | D EXISTING_CATALOGUE_MANUAL_CURATION | FILM PROGRAMME_LEVEL HIGH_EXPECTED_YIELD | HIGH | about 71 h of comedy films exist, dedicated elsewhere (stand-up excluded) | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source using the Popcornflix genre field | existing inventory, needs reuse policy |
| 155 | Drama Cinema | film | D EXISTING_CATALOGUE_MANUAL_CURATION | FILM PROGRAMME_LEVEL HIGH_EXPECTED_YIELD | HIGH | about 156 h of drama films exist, dedicated elsewhere | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source using the Popcornflix genre field | existing inventory, needs reuse policy |
| 157 | Western | film | D EXISTING_CATALOGUE_MANUAL_CURATION | FILM PROGRAMME_LEVEL | MEDIUM | about 17 h (10 films) of westerns exist, dedicated elsewhere | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source; supplement with find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only | enough to activate, thin for variety |
| 163 | Actors | film | D EXISTING_CATALOGUE_MANUAL_CURATION | FILM PROGRAMME_LEVEL EDITORIAL_JUDGEMENT | MEDIUM | actor interviews/profiles are spread across Vanity Fair, BFI, Kermode & Mayo homes | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing interview inventory can be selected |
| 166 | Film Editing | film | A NEW_DEDICATED_SOURCES | FILM KNOWLEDGE | MEDIUM | no film-editing craft publisher beyond StudioBinder (dedicated) | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (editing-craft creators, editor guild talks) | craft channels exist; small niche |
| 171 | Cinema 1920s | film | C FREE_FILM_ACQUISITION | FILM YEAR_DEPENDENT ARCHIVE LOW_EXPECTED_YIELD | LOW | silent-era films need verified PD or archive publishers | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only; original year from title/credit block under the existing year rules | very few lawful free 1920s films on official channels |
| 172 | Cinema 1930s | film | C FREE_FILM_ACQUISITION | FILM YEAR_DEPENDENT ARCHIVE | MEDIUM | no 1930s full films in non-owned sources | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only; original year from title/credit block under the existing year rules | rights/source blocker |
| 173 | Cinema 1940s | film | C FREE_FILM_ACQUISITION | FILM YEAR_DEPENDENT ARCHIVE | MEDIUM | no 1940s full films in non-owned sources | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only; original year from title/credit block under the existing year rules | rights/source blocker |
| 175 | Cinema 1960s | film | C FREE_FILM_ACQUISITION | FILM YEAR_DEPENDENT | MEDIUM | no 1960s full films in non-owned sources | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only; original year from title/credit block under the existing year rules | official studio vaults publish 1960s films; rights/source blocker |
| 176 | Cinema 1970s | film | C FREE_FILM_ACQUISITION | FILM YEAR_DEPENDENT | MEDIUM | no 1970s full films in non-owned sources | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only; original year from title/credit block under the existing year rules | official studio vaults publish 1970s films; rights/source blocker |
| 183 | Cult Classics | film | C FREE_FILM_ACQUISITION | FILM EDITORIAL_JUDGEMENT LOW_EXPECTED_YIELD | LOW | "cult" is editorial; free cult films scarce | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only plus editorial selection | needs both films and judgement |
| 184 | B-Movies | film | D EXISTING_CATALOGUE_MANUAL_CURATION | FILM PROGRAMME_LEVEL EDITORIAL_JUDGEMENT | MEDIUM | low-budget genre films exist in Popcornflix/Movie Central; MST3K stays at its home | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing inventory; editorial definition of "B-movie" needed |
| 185 | Drive-In | film | I PRESENTATION_OR_FORMAT_CHANNEL | FILM | n/a | drive-in is a presentation (double bill with intermission) | schedule format over film channels | no independent library |
| 187 | Creature Night | film | I PRESENTATION_OR_FORMAT_CHANNEL | FILM | n/a | a creature-feature scheduling block | schedule format over 143 | presentation of another channel's pool |
| 188 | Saturday Matinee | film | I PRESENTATION_OR_FORMAT_CHANNEL | FILM | n/a | "Saturday Matinee" is a time-slot presentation | schedule format over existing film channels | no independent library |
| 189 | Sunday Cinema | film | I PRESENTATION_OR_FORMAT_CHANNEL | FILM | n/a | "Sunday Cinema" is a time-slot presentation | schedule format over existing film channels | no independent library |
| 190 | Late Film | film | I PRESENTATION_OR_FORMAT_CHANNEL | FILM | n/a | "Late Film" is a time-slot presentation | schedule format over existing film channels | no independent library |
| 191 | Midnight Film | film | I PRESENTATION_OR_FORMAT_CHANNEL | FILM | n/a | "Midnight Film" is a time-slot presentation | schedule format over existing film channels | no independent library |
| 192 | Double Feature | film | I PRESENTATION_OR_FORMAT_CHANNEL | FILM | n/a | "Double Feature" is a time-slot presentation | schedule format over existing film channels | no independent library |
| 196 | Movie Culture | film | A NEW_DEDICATED_SOURCES | FILM KNOWLEDGE MULTI_SOURCE | MEDIUM | BFI is dedicated; other film-culture creators own homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (film-essay and film-culture creators) | more film-culture creators exist |
| 197 | Behind the Scenes | film | D EXISTING_CATALOGUE_MANUAL_CURATION | FILM PROGRAMME_LEVEL | MEDIUM | making-of material exists across Corridor Crew, Stan Winston, StudioBinder, Noclip homes | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing inventory; needs selection |
| 198 | Deleted & Rare | film | J NO_CREDIBLE_FREE_PATH | FILM EDITORIAL_JUDGEMENT | n/a | deleted scenes are studio-held; "rare" cannot be verified | none without lowering standards | no lawful structured pool |
| 199 | Cinema Archive | film | C FREE_FILM_ACQUISITION | FILM ARCHIVE YEAR_DEPENDENT | LOW | archival cinema needs pre-1980 film sources | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only; original year from title/credit block under the existing year rules | same blocker as the pre-1980 era channels |
| 211 | Classic Drama | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT YEAR_DEPENDENT | MEDIUM | no classic TV drama publisher with full episodes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (rights-holder channels publishing full classic episodes) | official full-episode classic TV exists on YouTube in limited catalogues |
| 212 | Crime Drama | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT MULTI_SOURCE | MEDIUM | no official full-episode drama publisher in the catalogue | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official free full-episode drama channels) | official full-episode crime/mystery drama channels exist; one sweep serves 212-215 |
| 213 | Detective | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT MULTI_SOURCE | MEDIUM | no official full-episode drama publisher in the catalogue | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official free full-episode drama channels) | official full-episode crime/mystery drama channels exist; one sweep serves 212-215 |
| 214 | Mystery | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT MULTI_SOURCE | MEDIUM | no official full-episode drama publisher in the catalogue | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official free full-episode drama channels) | official full-episode crime/mystery drama channels exist; one sweep serves 212-215 |
| 215 | Thriller TV | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT MULTI_SOURCE | MEDIUM | no official full-episode drama publisher in the catalogue | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official free full-episode drama channels) | official full-episode crime/mystery drama channels exist; one sweep serves 212-215 |
| 219 | Cult TV | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT EDITORIAL_JUDGEMENT LOW_EXPECTED_YIELD | LOW | "cult" is editorial; no source | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | needs full episodes plus judgement |
| 228 | Anime Action | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT MULTI_SOURCE | MEDIUM | only TMS/It's Anime/Gundam; genre split needs series-level assignment; regional availability risk | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official free full-episode anime publishers available in the UK), series assigned to genre editorially | official anime channels exist but UK geo-availability must be checked |
| 230 | Anime Fantasy | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT MULTI_SOURCE | MEDIUM | only TMS/It's Anime/Gundam; genre split needs series-level assignment; regional availability risk | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official free full-episode anime publishers available in the UK), series assigned to genre editorially | official anime channels exist but UK geo-availability must be checked |
| 231 | Anime Drama | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT MULTI_SOURCE | MEDIUM | only TMS/It's Anime/Gundam; genre split needs series-level assignment; regional availability risk | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official free full-episode anime publishers available in the UK), series assigned to genre editorially | official anime channels exist but UK geo-availability must be checked |
| 232 | Anime Comedy | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT MULTI_SOURCE | MEDIUM | only TMS/It's Anime/Gundam; genre split needs series-level assignment; regional availability risk | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official free full-episode anime publishers available in the UK), series assigned to genre editorially | official anime channels exist but UK geo-availability must be checked |
| 233 | Anime Cinema | entertainment | C FREE_FILM_ACQUISITION | FILM ENTERTAINMENT LOW_EXPECTED_YIELD | LOW | free full anime films are rare | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only | rights blocker |
| 234 | Manga Culture | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT | LOW | no manga-culture publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | niche; small pool |
| 238 | Teen | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT | MEDIUM | no official teen-series publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official full-episode teen series channels) | some teen dramas publish full episodes officially |
| 239 | Young Adult | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT | MEDIUM | no young-adult series publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | same sweep as 238 |
| 242 | Arcade | entertainment | D EXISTING_CATALOGUE_MANUAL_CURATION | TECH PROGRAMME_LEVEL | MEDIUM | arcade items exist in MVG, 8-Bit Guy, Gaming Historian homes (about 14 h) | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing inventory; selection needed |
| 252 | Comics | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT | MEDIUM | only Screen Junkies commentary items | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official comics publishers and comics-history creators) | official publishers post free programmes; same sweep as 253 |
| 253 | Superheroes | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT | MEDIUM | no superhero publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | same sweep as 252 |
| 254 | Science Fiction Culture | entertainment | D EXISTING_CATALOGUE_MANUAL_CURATION | ENTERTAINMENT PROGRAMME_LEVEL | MEDIUM | sci-fi culture items spread across Doctor Who, essay and film homes | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source (fiction only; factual space excluded) | existing inventory; exclusion filter essential |
| 275 | Classic Game Shows | entertainment | A NEW_DEDICATED_SOURCES | ENTERTAINMENT YEAR_DEPENDENT | MEDIUM | Buzzr dated shows under 3 h and Buzzr is dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official classic game-show vaults) | official game-show vault channels exist |
| 288 | TV Archive | entertainment | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL HIGH_EXPECTED_YIELD | HIGH | RI lectures are 091's identity; no broadcaster archive source | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (official broadcaster archive channels) | official broadcaster archives are a single research target serving 288, 289, 891-893, 945 |
| 289 | Retro Television | entertainment | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL HIGH_EXPECTED_YIELD | HIGH | no broadcaster archive source | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (official broadcaster archive channels) | same research as 288 |
| 290 | Internet Classics | entertainment | B NEW_BROAD_SOURCE_CURATION | ENTERTAINMENT EDITORIAL_JUDGEMENT LOW_EXPECTED_YIELD | LOW | internet-native classics are scattered original uploads | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (original uploaders of landmark internet videos) | publication date is valid here, but each classic is a separate editorial pick |
| 292 | Creators | entertainment | I PRESENTATION_OR_FORMAT_CHANNEL | ENTERTAINMENT | n/a | "creators" describes most of the catalogue | showcase format over existing creator channels | no distinct library |
| 297 | Fan Films | entertainment | A NEW_DEDICATED_SOURCES | FILM LOW_EXPECTED_YIELD | LOW | fan films carry third-party IP risk | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (fan-film makers whose work is tolerated/licensed) | rights ambiguity limits yield |
| 303 | Football Classics | sport | A NEW_DEDICATED_SOURCES | SPORT YEAR_DEPENDENT ARCHIVE HIGH_EXPECTED_YIELD | HIGH | FIFA dated matches under 3 h; no club/league archive source | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official club and league channels publishing full classic matches with years in titles) | official classic-match uploads carry the season/year in titles |
| 304 | Football Documentary | sport | A NEW_DEDICATED_SOURCES | SPORT | MEDIUM | COPA90 is dedicated; no football-documentary source | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official club/league documentary series) | official documentaries exist |
| 306 | Football History | sport | A NEW_DEDICATED_SOURCES | SPORT KNOWLEDGE | MEDIUM | no football-history publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (football-history creators) | creator-owned football history exists |
| 307 | English Football | sport | A NEW_DEDICATED_SOURCES | SPORT MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | no official English football publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official english league/confederation channels) | official league and confederation channels publish free highlights and features |
| 308 | European Football | sport | A NEW_DEDICATED_SOURCES | SPORT MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | no official European football publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official european league/confederation channels) | official league and confederation channels publish free highlights and features |
| 311 | International Football | sport | A NEW_DEDICATED_SOURCES | SPORT MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | no official International football publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official international league/confederation channels) | official league and confederation channels publish free highlights and features |
| 313 | Football Analysis | sport | A NEW_DEDICATED_SOURCES | SPORT HIGH_EXPECTED_YIELD | HIGH | no tactics/analysis publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (tactics-analysis creators and coach-led channels) | football analysis creators are abundant |
| 323 | FIFA | sport | D EXISTING_CATALOGUE_MANUAL_CURATION | SPORT SINGLE_SOURCE_POSSIBLE | MEDIUM | src_fifa already exists but is dedicated to its current home | ownership decision: explicit reuse policy or move of src_fifa | the named publisher is already in the catalogue; blocker is ownership, not source |
| 325 | Football Classics | sport | A NEW_DEDICATED_SOURCES | SPORT YEAR_DEPENDENT ARCHIVE | MEDIUM | same identity name as 303; needs a distinct split before acquisition | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (e.g. international vs club classics) | duplicate identity must be resolved first |
| 326 | Football Documentary | sport | A NEW_DEDICATED_SOURCES | SPORT | MEDIUM | duplicate identity with 304 | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | needs a distinct split from 304 |
| 327 | Football Analysis | sport | A NEW_DEDICATED_SOURCES | SPORT | MEDIUM | duplicate identity with 313 | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | needs a distinct split from 313 |
| 329 | Wrestling Classics | sport | A NEW_DEDICATED_SOURCES | SPORT YEAR_DEPENDENT ARCHIVE HIGH_EXPECTED_YIELD | HIGH | WWE main channel dedicated; no classic-match vault source | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official wrestling vault channels with event years in titles) | official vault channels publish full classic matches free |
| 344 | Classic Motorsport | sport | A NEW_DEDICATED_SOURCES | SPORT YEAR_DEPENDENT ARCHIVE | MEDIUM | no classic motorsport source | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official series/heritage channels with classic races) | some series publish full classic races |
| 345 | Motorsport Documentary | sport | A NEW_DEDICATED_SOURCES | SPORT | MEDIUM | no motorsport documentary source | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | official series documentaries exist |
| 356 | Snow Sports | sport | A NEW_DEDICATED_SOURCES | SPORT HIGH_EXPECTED_YIELD | HIGH | no snow-sports publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (federation and ski/snowboard film publishers) | official federation and ski-film channels are plentiful |
| 359 | Adventure Sport | sport | A NEW_DEDICATED_SOURCES | SPORT | MEDIUM | no adventure-sport publisher; aviation (paragliding, skydiving, wingsuit) must be excluded | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (climbing, surfing, paddling film publishers) | plentiful, but the aviation exclusion needs careful filtering |
| 360 | Cricket | sport | A NEW_DEDICATED_SOURCES | SPORT HIGH_EXPECTED_YIELD | HIGH | ICC airs elsewhere and must not be moved | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (national cricket boards and official broadcasters' free channels) | several official cricket publishers besides ICC; do not repeat the ICC replacement mistake |
| 361 | Cricket Classics | sport | A NEW_DEDICATED_SOURCES | SPORT YEAR_DEPENDENT ARCHIVE | MEDIUM | no classic-match cricket source | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official boards publishing classic matches with years in titles) | same sweep as 360 |
| 384 | Outdoor Sport | sport | A NEW_DEDICATED_SOURCES | SPORT | MEDIUM | outdoor creators already own lifestyle homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | new outdoor-sport publishers needed |
| 390 | Sports Science | sport | A NEW_DEDICATED_SOURCES | SPORT KNOWLEDGE LOW_EXPECTED_YIELD | LOW | no sports-science publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (university/institute sports-science channels) | niche; small pool |
| 391 | Sports Medicine | sport | A NEW_DEDICATED_SOURCES | SPORT KNOWLEDGE LOW_EXPECTED_YIELD | LOW | no sports-medicine publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | niche |
| 394 | Sports Business | sport | A NEW_DEDICATED_SOURCES | SPORT LOW_EXPECTED_YIELD | LOW | no sports-business publisher; duplicate of 626 | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | niche and duplicated |
| 397 | Great Athletes | sport | D EXISTING_CATALOGUE_MANUAL_CURATION | SPORT PROGRAMME_LEVEL EDITORIAL_JUDGEMENT | MEDIUM | athlete stories exist across Olympic, NFL Films, Top Rank homes | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing inventory; selection needed |
| 407 | Renaissance | knowledge | D EXISTING_CATALOGUE_MANUAL_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | Renaissance items in National Gallery/British Museum homes | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing inventory |
| 418 | African History | knowledge | A NEW_DEDICATED_SOURCES | KNOWLEDGE | MEDIUM | no African-history publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (history creators and museum channels on African history) | creator-owned African history exists |
| 422 | Social History | knowledge | D EXISTING_CATALOGUE_MANUAL_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | English Heritage, Bernadette Banner items dedicated | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing inventory |
| 423 | Political History | knowledge | A NEW_DEDICATED_SOURCES | KNOWLEDGE | MEDIUM | no political-history publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (lecture institutions and history creators) | lecture institutions cover it; same sweep as law/economics |
| 424 | Economic History | knowledge | D EXISTING_CATALOGUE_MANUAL_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | Economics Explained items dedicated; duplicate of 616 | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing inventory; resolve duplicate with 616 |
| 429 | History Archive | knowledge | B NEW_BROAD_SOURCE_CURATION | ARCHIVE KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | Pathé owned; no other history archive | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (official newsreel archives) | archive research serves 019, 429, 801, 945 |
| 431 | Earth | knowledge | A NEW_DEDICATED_SOURCES | KNOWLEDGE HIGH_EXPECTED_YIELD | HIGH | geology sources dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (geoscience lecturers, survey agencies) | same sweep as 065/483 |
| 434 | Nations | knowledge | D EXISTING_CATALOGUE_MANUAL_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | country profiles in Geography Now and travel homes | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing inventory |
| 437 | Mountains | knowledge | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | no mountain documentary source | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (broad documentary publishers) | subject programmes sit inside broad documentary publishers |
| 438 | Rivers | knowledge | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | no river documentary source | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (broad documentary publishers) | subject programmes sit inside broad documentary publishers |
| 440 | Deserts | knowledge | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL LOW_EXPECTED_YIELD | LOW | very few desert programmes | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes | thin subject |
| 441 | Forests | knowledge | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | no forest documentary source | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (broad documentary publishers) | subject programmes sit inside broad documentary publishers |
| 442 | Polar World | knowledge | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL | LOW | polar programmes are thin and often overlap exclusions (satellites, aviation) | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes | exclusion filtering limits yield |
| 448 | Travel Documentary | knowledge | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL HIGH_EXPECTED_YIELD | HIGH | travel-documentary items belong to Rick Steves/Lonely Planet homes | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (broad documentary publishers with travel strands) | broad documentary publishers carry long travel documentaries |
| 449 | World Cultures | knowledge | D EXISTING_CATALOGUE_MANUAL_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | culture programmes spread across homes; pass 9 unresolved | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing inventory |
| 451 | Legal History | knowledge | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | Court TV/LegalEagle dedicated | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (public lecture institutions) | one lecture-institution publisher serves most of the law family |
| 454 | Criminal Law | knowledge | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | Court TV/LegalEagle dedicated | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (public lecture institutions) | same |
| 455 | Civil Law | knowledge | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL LOW_EXPECTED_YIELD | LOW | civil law is rarely programmed | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes | thin |
| 456 | Human Rights | knowledge | A NEW_DEDICATED_SOURCES | KNOWLEDGE | MEDIUM | no human-rights publisher; advocacy vs programming line needed | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (UN and human-rights institution channels) | official institutions publish free programmes |
| 457 | International Law | knowledge | A NEW_DEDICATED_SOURCES | KNOWLEDGE | LOW | no international-law publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (international courts and UN channels) | institution channels exist but are dry/short |
| 458 | Constitutional Law | knowledge | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL | LOW | constitutional law thin | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes | thin |
| 462 | Criminology | knowledge | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | criminology lectures absent; crime films are not criminology | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (public lecture institutions) | lectures carry criminology |
| 463 | Policing History | knowledge | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE ARCHIVE PROGRAMME_LEVEL LOW_EXPECTED_YIELD | LOW | no policing-history source | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes | thin |
| 469 | Law Extra | knowledge | I PRESENTATION_OR_FORMAT_CHANNEL | KNOWLEDGE | n/a | "Extra" overflow channel for the law band | overflow presentation of the law band | not an independent library |
| 478 | Evolution | knowledge | A NEW_DEDICATED_SOURCES | KNOWLEDGE | MEDIUM | PBS Eons dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (evolution/palaeontology creators, natural-history museums) | more science creators exist |
| 483 | Planet Earth | knowledge | A NEW_DEDICATED_SOURCES | KNOWLEDGE HIGH_EXPECTED_YIELD | HIGH | BBC Earth dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (earth-science and natural-history publishers) | same sweep as 065/431 |
| 489 | Environment | knowledge | A NEW_DEDICATED_SOURCES | KNOWLEDGE HIGH_EXPECTED_YIELD | HIGH | no environment publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (environment explainer and documentary channels) | environment explainer channels are abundant |
| 494 | Anthropology | knowledge | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | no anthropology publisher | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (university/lecture publishers) | lectures carry anthropology |
| 495 | Sociology | knowledge | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | no sociology publisher | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (university/lecture publishers) | lectures carry sociology |
| 497 | Literature | knowledge | D EXISTING_CATALOGUE_MANUAL_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | literature items in Globe, School of Life homes | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing inventory |
| 499 | Knowledge Extra | knowledge | I PRESENTATION_OR_FORMAT_CHANNEL | KNOWLEDGE | n/a | "Extra" overflow channel | overflow presentation of the knowledge band | not an independent library |
| 540 | 1950s | music | A NEW_DEDICATED_SOURCES | MUSIC YEAR_DEPENDENT MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | under 3 h of dated 1950s recordings/performances | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official legacy-artist and classic TV-music archive channels); years from existing title/description rules | official legacy archives carry dated performances; era routing is already built |
| 541 | 1960s | music | A NEW_DEDICATED_SOURCES | MUSIC YEAR_DEPENDENT MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | under 3 h of dated 1960s material | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official legacy-artist and classic TV-music archive channels) | same sweep as 540 |
| 544 | 1990s | music | A NEW_DEDICATED_SOURCES | MUSIC YEAR_DEPENDENT MULTI_SOURCE | MEDIUM | dated 1990s recordings are taken by higher-priority 581/584/580 rules | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official 1990s pop/R&B/dance artists outside the alternative and metal lists) | needs 1990s artists not already absorbed by genre-era rules |
| 547 | 2020s | music | E ADDITIONAL_EXTERNAL_METADATA | MUSIC YEAR_DEPENDENT | MEDIUM | 2020s copyright years equal the upload year and cannot prove the original release | attach release dates from external music metadata (e.g. MusicBrainz) with provenance | inventory exists; only external release metadata can establish it |
| 548 | Oldies | music | A NEW_DEDICATED_SOURCES | MUSIC YEAR_DEPENDENT MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | under 3 h of 1950-69 material | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (same legacy archives as 540/541) | same sweep as 540 |
| 549 | Retro Hits | music | D EXISTING_CATALOGUE_MANUAL_CURATION | MUSIC EDITORIAL_JUDGEMENT | MEDIUM | "retro hits" has no structured definition | define an explicit era rule (e.g. dated official recordings 1970-1999) over existing dated inventory | dated inventory already exists; the blocker is the definition |
| 550 | Chart | music | F CURRENT_AFFAIRS_OR_LIVE_MODEL | MUSIC CURRENT | n/a | chart position is current external data | current-feed model with an external chart source | a static pool is not a chart |
| 551 | New Music | music | F CURRENT_AFFAIRS_OR_LIVE_MODEL | MUSIC CURRENT | n/a | "new" requires a rolling window of current releases | current-feed model over official artist channels | freshness is the identity |
| 560 | Music Documentary | music | B NEW_BROAD_SOURCE_CURATION | MUSIC PROGRAMME_LEVEL | MEDIUM | music documentaries sit inside broad documentary publishers | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes | selection from broad publishers |
| 563 | Artists | music | I PRESENTATION_OR_FORMAT_CHANNEL | MUSIC | n/a | "Artists" describes every music channel | profile presentation over existing music channels | no distinct library |
| 564 | Bands | music | I PRESENTATION_OR_FORMAT_CHANNEL | MUSIC | n/a | "Bands" describes most music channels | presentation over existing music channels | no distinct library |
| 578 | Remixes | music | A NEW_DEDICATED_SOURCES | MUSIC MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | remixes are rejected from artist channels; no remix label source | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official dance/remix label channels) | official remix labels publish large catalogues |
| 579 | Rare Tracks | music | J NO_CREDIBLE_FREE_PATH | MUSIC EDITORIAL_JUDGEMENT | n/a | "rare" cannot be established from metadata | none without lowering standards | editorial rarity is unverifiable |
| 582 | Indie 2000 | music | A NEW_DEDICATED_SOURCES | MUSIC YEAR_DEPENDENT MULTI_SOURCE | MEDIUM | dated 2000s indie inventory under 3 h / one artist dominant | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (more official 2000s indie artist channels) added to the INDIE rule list | needs artist diversity, not metadata |
| 586 | Punk 90 | music | A NEW_DEDICATED_SOURCES | MUSIC YEAR_DEPENDENT MULTI_SOURCE | MEDIUM | only Epitaph dated 1990s punk; single label | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official 1990s punk artist/label channels) added to the PUNK list | needs artist diversity |
| 588 | Disco 79 | music | A NEW_DEDICATED_SOURCES | MUSIC YEAR_DEPENDENT MULTI_SOURCE | MEDIUM | dated disco 1970-81 under 3 h | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official disco-era artist channels) added to the DISCO list | needs more sources |
| 589 | Synth 84 | music | A NEW_DEDICATED_SOURCES | MUSIC YEAR_DEPENDENT EDITORIAL_JUDGEMENT | MEDIUM | no synth rule; synth-pop is an artist-level editorial list | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official synth-pop artist channels) plus an explicit SYNTH source list | artist-level genre list, same pattern as the metal/punk rules |
| 594 | VEVO Classics | music | A NEW_DEDICATED_SOURCES | MUSIC YEAR_DEPENDENT MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | VEVO-rule sources have too few dated pre-1980 official videos | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official VEVO artist channels with pre-1980 catalogues and label copyright lines) added to the VEVO list | label copyright lines on older official videos already resolve under the v29 rules; the gap is source count |
| 595 | VEVO 1980s | music | A NEW_DEDICATED_SOURCES | MUSIC YEAR_DEPENDENT MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | VEVO-rule sources have too few dated 1980s official videos | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official VEVO artist channels with 1980s catalogues and label copyright lines) added to the VEVO list | label copyright lines on older official videos already resolve under the v29 rules; the gap is source count |
| 596 | VEVO 1990s | music | A NEW_DEDICATED_SOURCES | MUSIC YEAR_DEPENDENT MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | VEVO-rule sources have too few dated 1990s official videos | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official VEVO artist channels with 1990s catalogues and label copyright lines) added to the VEVO list | label copyright lines on older official videos already resolve under the v29 rules; the gap is source count |
| 597 | VEVO 2000s | music | A NEW_DEDICATED_SOURCES | MUSIC YEAR_DEPENDENT MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | VEVO-rule sources have too few dated 2000s official videos | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official VEVO artist channels with 2000s catalogues and label copyright lines) added to the VEVO list | label copyright lines on older official videos already resolve under the v29 rules; the gap is source count |
| 598 | VEVO Live & Performance | music | A NEW_DEDICATED_SOURCES | MUSIC HIGH_EXPECTED_YIELD | HIGH | no VEVO live-session source | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official VEVO live/performance series channels) | official VEVO performance series publish large catalogues |
| 599 | VEVO Discover | music | A NEW_DEDICATED_SOURCES | MUSIC HIGH_EXPECTED_YIELD | HIGH | no VEVO discovery source | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (official VEVO emerging-artist series) | official VEVO discovery series exist |
| 600 | Business | business-tech | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL HIGH_EXPECTED_YIELD | HIGH | Modern MBA and finance creators own homes | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (broad business-documentary publishers) | broad business-documentary publishers carry long programmes |
| 608 | Management | business-tech | A NEW_DEDICATED_SOURCES | KNOWLEDGE | MEDIUM | no management publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (business-school lecture channels) | business schools publish free lectures |
| 610 | Marketing | business-tech | A NEW_DEDICATED_SOURCES | KNOWLEDGE LOW_EXPECTED_YIELD | LOW | marketing channels are mostly promotional | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | editorial quality risk |
| 611 | Advertising | business-tech | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL | MEDIUM | no advertising-history publisher | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (advertising archives and museum channels) | shares research with 806 |
| 612 | Retail | business-tech | A NEW_DEDICATED_SOURCES | KNOWLEDGE LOW_EXPECTED_YIELD | LOW | no retail publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | niche |
| 613 | Small Business | business-tech | A NEW_DEDICATED_SOURCES | KNOWLEDGE | MEDIUM | Y Combinator dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (small-business and founder channels) | founder channels exist |
| 615 | Business History | business-tech | A NEW_DEDICATED_SOURCES | KNOWLEDGE HIGH_EXPECTED_YIELD | HIGH | no company-history publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (company-history creators) | company-history creators are abundant |
| 616 | Economic History | business-tech | A NEW_DEDICATED_SOURCES | KNOWLEDGE | MEDIUM | duplicate identity with 424 | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (economic-history lecturers) | resolve duplicate with 424 first |
| 618 | Banking | business-tech | A NEW_DEDICATED_SOURCES | KNOWLEDGE | MEDIUM | no banking publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (central-bank and finance-history channels) | central banks publish explainers and lectures |
| 620 | Property | business-tech | A NEW_DEDICATED_SOURCES | LIFESTYLE LOW_EXPECTED_YIELD | LOW | property content is mostly promotional | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | editorial risk |
| 622 | Manufacturing | business-tech | A NEW_DEDICATED_SOURCES | TECH HIGH_EXPECTED_YIELD | HIGH | no manufacturing publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (factory-process and manufacturing channels) | factory-process channels are abundant |
| 623 | Supply Chain | business-tech | A NEW_DEDICATED_SOURCES | KNOWLEDGE | MEDIUM | no logistics publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (logistics explainer creators) | explainer creators exist |
| 624 | Energy Business | business-tech | A NEW_DEDICATED_SOURCES | KNOWLEDGE | MEDIUM | no energy-business publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (energy explainer channels, excluding corporate adverts) | explainer channels exist |
| 625 | Media Business | business-tech | A NEW_DEDICATED_SOURCES | KNOWLEDGE LOW_EXPECTED_YIELD | LOW | no media-business publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | niche |
| 626 | Sports Business | business-tech | A NEW_DEDICATED_SOURCES | SPORT LOW_EXPECTED_YIELD | LOW | duplicate identity with 394 | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | niche and duplicated |
| 627 | Fashion Business | business-tech | A NEW_DEDICATED_SOURCES | LIFESTYLE | MEDIUM | Vogue dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (fashion-industry publishers) | fashion-industry channels exist |
| 628 | Food Business | business-tech | A NEW_DEDICATED_SOURCES | FOOD | MEDIUM | Eater dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (food-industry documentary channels) | food-business series exist |
| 629 | Business Documentary | business-tech | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL HIGH_EXPECTED_YIELD | HIGH | no business-documentary publisher | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (broad business-documentary publishers) | same research as 600 |
| 635 | Open Source | business-tech | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | no open-source publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (open-source foundations and conference channels) | conference talks publish freely |
| 636 | Internet | business-tech | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | no internet-culture/tech publisher distinct from Computerphile | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | more tech explainers exist |
| 643 | Automation | business-tech | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | James Bruton dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (robotics/automation creators) | robotics creators exist |
| 653 | Civil Engineering | business-tech | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | Practical Engineering, B1M dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (civil-engineering creators and institutions) | engineering institutions publish lectures |
| 654 | Chemical Engineering | business-tech | A NEW_DEDICATED_SOURCES | TECH LOW_EXPECTED_YIELD | LOW | no chemical-engineering publisher; rocket-propellant content excluded | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | niche with exclusion risk |
| 657 | Marine Engineering | business-tech | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | Casual Navigation dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (maritime engineering channels) | maritime creators exist |
| 658 | Industrial Design | business-tech | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | no industrial-design publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (design museums and design publications) | design institutions publish free programmes; serves 659/849 |
| 659 | Product Design | business-tech | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | no product-design publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | same sweep as 658 |
| 662 | Infrastructure | business-tech | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | no infrastructure publisher distinct from B1M | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | infrastructure creators exist |
| 663 | Megaprojects | business-tech | A NEW_DEDICATED_SOURCES | TECH HIGH_EXPECTED_YIELD | HIGH | no megaprojects publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (megaproject documentary creators; filter aviation/space entries) | large creator catalogues exist; exclusion filter needed |
| 665 | Rail Technology | business-tech | A NEW_DEDICATED_SOURCES | TECH MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | Sam's Trains and National Rail Scenic dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (rail-engineering creators, rail operators, rail museums) | rail enthusiasm is one of the richest creator ecosystems on YouTube |
| 669 | Renewables | business-tech | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | no renewables publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | explainer creators exist |
| 675 | Trucks | business-tech | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | no trucking publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | trucking creators exist |
| 678 | Railways | business-tech | A NEW_DEDICATED_SOURCES | TECH MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | rail sources dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | same rail sweep |
| 679 | Trains | business-tech | A NEW_DEDICATED_SOURCES | TECH MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | rail sources dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | same rail sweep |
| 685 | Future Tech | business-tech | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | future-tech content often strays into space/aerospace (excluded) | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | exclusion filter limits yield |
| 686 | Inventions | business-tech | A NEW_DEDICATED_SOURCES | TECH | LOW | no inventions publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | niche |
| 688 | Workshop | business-tech | A NEW_DEDICATED_SOURCES | LIFESTYLE HIGH_EXPECTED_YIELD | HIGH | maker sources already own craft homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (workshop/maker creators) | maker creators are abundant |
| 690 | Digital Culture | business-tech | D EXISTING_CATALOGUE_MANUAL_CURATION | TECH PROGRAMME_LEVEL | LOW | digital-culture items are scattered; pass 9 unresolved | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | editorial |
| 691 | Tech Interviews | business-tech | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | no tech-interview publisher; CHM debt must not be recreated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (oral-history and tech-conference interview channels) | interview channels exist |
| 694 | Market History | business-tech | A NEW_DEDICATED_SOURCES | KNOWLEDGE | MEDIUM | no market-history publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | finance-history creators exist |
| 697 | Careers | business-tech | A NEW_DEDICATED_SOURCES | LIFESTYLE LOW_EXPECTED_YIELD | LOW | careers content is mostly promotional | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | editorial risk |
| 699 | Business Extra | business-tech | I PRESENTATION_OR_FORMAT_CHANNEL | KNOWLEDGE | n/a | "Extra" overflow channel | overflow presentation | not an independent library |
| 717 | Seafood | lifestyle | D EXISTING_CATALOGUE_MANUAL_CURATION | FOOD PROGRAMME_LEVEL | MEDIUM | seafood items exist across food homes | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing inventory |
| 723 | Budget Cooking | lifestyle | A NEW_DEDICATED_SOURCES | FOOD HIGH_EXPECTED_YIELD | HIGH | no budget-cooking publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (budget-cooking creators) | budget-cooking creators are abundant |
| 725 | Slow Cooking | lifestyle | D EXISTING_CATALOGUE_MANUAL_CURATION | FOOD PROGRAMME_LEVEL | MEDIUM | slow-cooking items in food homes | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing inventory |
| 726 | Regional Food | lifestyle | D EXISTING_CATALOGUE_MANUAL_CURATION | FOOD PROGRAMME_LEVEL | MEDIUM | regional food items in Mark Wiens/Best Ever Food homes | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing inventory |
| 729 | Food Extra | lifestyle | I PRESENTATION_OR_FORMAT_CHANNEL | FOOD | n/a | "Extra" overflow channel | overflow presentation | not an independent library |
| 732 | Fitness | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE HIGH_EXPECTED_YIELD | HIGH | fitness creators already own fitness homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (fitness creators) | fitness creators are abundant |
| 742 | Wellbeing | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE | MEDIUM | no wellbeing publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (secular wellbeing channels) | religious practice must be excluded |
| 743 | Mindfulness | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE | MEDIUM | no mindfulness publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (secular mindfulness channels) | religious practice must be excluded |
| 744 | Healthy Ageing | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE LOW_EXPECTED_YIELD | LOW | no healthy-ageing publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | niche |
| 746 | Medical History | lifestyle | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | no medical-history publisher | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (lecture institutions and medical museums) | lecture institutions cover it |
| 747 | Anatomy | lifestyle | A NEW_DEDICATED_SOURCES | KNOWLEDGE HIGH_EXPECTED_YIELD | HIGH | no anatomy publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (medical-education channels) | medical-education channels are abundant; serves 748 |
| 748 | Physiology | lifestyle | A NEW_DEDICATED_SOURCES | KNOWLEDGE HIGH_EXPECTED_YIELD | HIGH | no physiology publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (medical-education channels) | same sweep as 747 |
| 749 | Health Documentary | lifestyle | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | health documentaries sit inside broad documentary publishers | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes | selection needed |
| 764 | Landscape | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE | MEDIUM | garden sources already own homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (landscape-design creators) | landscape creators exist |
| 765 | Home Restoration | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE HIGH_EXPECTED_YIELD | HIGH | restoration sources already own homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (restoration creators) | restoration creators are abundant |
| 767 | Property Life | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE LOW_EXPECTED_YIELD | LOW | property-life content mostly promotional | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | editorial risk |
| 768 | Organisation | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE | LOW | no organisation publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | niche |
| 769 | Home Extra | lifestyle | I PRESENTATION_OR_FORMAT_CHANNEL | LIFESTYLE | n/a | "Extra" overflow channel | overflow presentation | not an independent library |
| 772 | City Breaks | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE HIGH_EXPECTED_YIELD | HIGH | travel sources already own homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (city-guide creators) | city-guide creators are abundant |
| 773 | Road Trips | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE | MEDIUM | no road-trip publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | road-trip series exist |
| 774 | Rail Travel | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE HIGH_EXPECTED_YIELD | HIGH | rail travel sources dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (rail-travel creators) | same rail sweep |
| 775 | Walking Travel | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE HIGH_EXPECTED_YIELD | HIGH | no walking-travel publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (walking-tour creators) | walking tours are abundant; overlaps 095 |
| 776 | Adventure Travel | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE | MEDIUM | no adventure-travel publisher; aviation excluded | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | exclusion filtering needed |
| 777 | Budget Travel | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE | MEDIUM | no budget-travel publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | creators exist |
| 778 | Luxury Travel | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE LOW_EXPECTED_YIELD | LOW | luxury travel is dominated by first-class flight reviews (aviation excluded) | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | exclusion removes most inventory |
| 779 | Travel History | lifestyle | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL LOW_EXPECTED_YIELD | LOW | no travel-history source | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes | thin |
| 780 | Outdoors | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE | MEDIUM | outdoor creators already own homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | new outdoor creators needed |
| 784 | Nature Life | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE HIGH_EXPECTED_YIELD | HIGH | nature sources dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | same nature sweep as 023/066 |
| 788 | Animals | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE HIGH_EXPECTED_YIELD | HIGH | no animal-care/animal-life publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (animal-life channels) | same nature sweep |
| 789 | Rural Life | lifestyle | A NEW_DEDICATED_SOURCES | LIFESTYLE | MEDIUM | no rural-life publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (farming and rural-life creators) | creators exist |
| 795 | Collecting | lifestyle | D EXISTING_CATALOGUE_MANUAL_CURATION | LIFESTYLE PROGRAMME_LEVEL | MEDIUM | collecting items in Antiques Roadshow and other homes | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing inventory |
| 798 | Everyday Skills | lifestyle | D EXISTING_CATALOGUE_MANUAL_CURATION | LIFESTYLE PROGRAMME_LEVEL | MEDIUM | how-to items across many homes | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | existing inventory; editorial |
| 799 | Lifestyle Extra | lifestyle | I PRESENTATION_OR_FORMAT_CHANNEL | LIFESTYLE | n/a | "Extra" overflow channel | overflow presentation | not an independent library |
| 800 | Specialist | specialist | I PRESENTATION_OR_FORMAT_CHANNEL | EDITORIAL_JUDGEMENT | n/a | band-head "Specialist" channel | band showcase presentation | not an independent library |
| 801 | Archive | specialist | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL | MEDIUM | Pathé owned; no other archive | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (newsreel and film archives) | archive family |
| 802 | Public Domain | specialist | C FREE_FILM_ACQUISITION | FILM ARCHIVE | MEDIUM | duplicate identity with 087; PD status per title | find lawful free full-film publishers (official studio vaults, licensed free-film channels, verified public-domain archives), full films only (verified public-domain archives only) | resolve duplicate with 087 |
| 806 | Advertising Archive | specialist | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL | MEDIUM | vintage advertising mostly unofficial uploads | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (official ad archives and broadcaster archives) | rights are the blocker |
| 808 | Government Film Archive | specialist | A NEW_DEDICATED_SOURCES | ARCHIVE HIGH_EXPECTED_YIELD | HIGH | no government film archive source | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (national archives and government film units' official channels) | national archives publish public-sector film freely; filter aviation/space items |
| 809 | Industrial Film Archive | specialist | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL | MEDIUM | no industrial-film archive source | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (industrial/sponsored-film archives) | archive family |
| 812 | Arcade Archive | specialist | D EXISTING_CATALOGUE_MANUAL_CURATION | TECH ARCHIVE PROGRAMME_LEVEL | MEDIUM | arcade history exists in retro-gaming homes | explicit editorial programme selection from the existing catalogue into programmeRoutes, with an explicit reuse policy for any dedicated source | same inventory as 242 |
| 815 | Internet History | specialist | A NEW_DEDICATED_SOURCES | TECH ARCHIVE LOW_EXPECTED_YIELD | LOW | CHM debt; no other internet-history publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | must not recreate the CHM debt |
| 818 | Radio History | specialist | A NEW_DEDICATED_SOURCES | TECH ARCHIVE LOW_EXPECTED_YIELD | LOW | video about radio history (not an audio channel); no source | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (radio museums and broadcast-engineering channels) | niche |
| 819 | Tech Archive | specialist | B NEW_BROAD_SOURCE_CURATION | TECH ARCHIVE PROGRAMME_LEVEL | MEDIUM | CHM debt; no other technology archive; year of archive footage needed | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (technology museum and corporate film archives) | archive family; must not recreate the CHM debt |
| 821 | Steam Railways | specialist | A NEW_DEDICATED_SOURCES | TECH MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | no steam publisher distinct from the existing rail homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (heritage railways, rail creators, cab-ride channels) | same rail sweep |
| 822 | Modern Railways | specialist | A NEW_DEDICATED_SOURCES | TECH MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | no modern rail publisher distinct from the existing rail homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (heritage railways, rail creators, cab-ride channels) | same rail sweep |
| 823 | Rail Journeys | specialist | A NEW_DEDICATED_SOURCES | TECH MULTI_SOURCE HIGH_EXPECTED_YIELD | HIGH | no rail journey publisher distinct from the existing rail homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (heritage railways, rail creators, cab-ride channels) | same rail sweep |
| 824 | Stations | specialist | A NEW_DEDICATED_SOURCES | TECH MULTI_SOURCE HIGH_EXPECTED_YIELD | MEDIUM | no station publisher distinct from the existing rail homes | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (heritage railways, rail creators, cab-ride channels) | same rail sweep |
| 832 | Ships | specialist | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | Casual Navigation dedicated | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (ship-spotting and maritime creators) | maritime creators exist |
| 833 | Sailing Archive | specialist | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL LOW_EXPECTED_YIELD | LOW | archive plus sailing subject | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes | thin intersection |
| 835 | Road Transport | specialist | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | no road-transport publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | transport enthusiasts exist |
| 836 | Classic Cars Archive | specialist | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL | MEDIUM | Hagerty/Jay Leno own homes; archive motoring film absent | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (motor museums and heritage archives) | archive family |
| 837 | Buses | specialist | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | no bus publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (bus-enthusiast creators and museums) | enthusiast creators exist |
| 838 | Trams | specialist | A NEW_DEDICATED_SOURCES | TECH | MEDIUM | no tram publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (tram museums and enthusiasts) | enthusiast creators exist |
| 839 | Transport Archive | specialist | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL | MEDIUM | no transport archive source | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (transport and film archives) | archive family |
| 840 | Books | specialist | A NEW_DEDICATED_SOURCES | KNOWLEDGE | MEDIUM | no books publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source | same sweep as 092 |
| 841 | Audiobooks | specialist | G AUDIO_OR_RADIO_MODEL | MUSIC | n/a | audiobooks are an audio product; the video pipeline cannot represent them well | audio provider path alongside the existing NEEDS_AUDIO_PROVIDER channels | genuine audio identity |
| 842 | Poetry | specialist | A NEW_DEDICATED_SOURCES | KNOWLEDGE | MEDIUM | no poetry publisher | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (poetry organisations and performance-poetry channels) | same sweep as 092 |
| 843 | Literature Archive | specialist | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL LOW_EXPECTED_YIELD | LOW | archive plus literature subject | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes | thin intersection |
| 844 | Theatre Archive | specialist | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL LOW_EXPECTED_YIELD | LOW | archive theatre productions rarely free; NT/Globe dedicated | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes | rights blocker |
| 848 | Architecture Archive | specialist | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL LOW_EXPECTED_YIELD | LOW | archive plus architecture subject | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes | thin intersection |
| 849 | Design Archive | specialist | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL LOW_EXPECTED_YIELD | LOW | archive plus design subject | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes | thin intersection |
| 882 | Independent TV | specialist | I PRESENTATION_OR_FORMAT_CHANNEL | EDITORIAL_JUDGEMENT | n/a | "Independent TV" is a production-model label | presentation | no distinct library |
| 883 | Creator TV | specialist | I PRESENTATION_OR_FORMAT_CHANNEL | EDITORIAL_JUDGEMENT | n/a | "Creator TV" describes most of the catalogue | presentation | no distinct library |
| 885 | Video Art | specialist | A NEW_DEDICATED_SOURCES | ARCHIVE LOW_EXPECTED_YIELD | LOW | video art sits on gallery platforms | find official or creator-owned YouTube publishers for the identity, verify ownership and free access, ingest as a dedicated source (gallery and artist-film channels) | little free video art on YouTube |
| 887 | Test Card | specialist | H RETROTV_ORIGINAL_OR_GENERATED_CANDIDATE | EDITORIAL_JUDGEMENT | n/a | a test card is generated, not acquired | RetroTV generated channel | natural generated identity |
| 891 | Trailers & Promos | specialist | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL | MEDIUM | promos/idents mostly unofficial uploads | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (official broadcaster archives) | same research as 288 |
| 892 | Station Archive | specialist | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL | MEDIUM | station continuity mostly unofficial uploads | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (official broadcaster archives) | same research as 288 |
| 893 | Broadcast History | specialist | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL HIGH_EXPECTED_YIELD | HIGH | no broadcast-history source | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (official broadcaster archives) | same research as 288 |
| 895 | Weather Maps | specialist | H RETROTV_ORIGINAL_OR_GENERATED_CANDIDATE | CURRENT | n/a | weather maps are a generated presentation of weather data | RetroTV generated channel from open weather data | natural generated identity |
| 898 | Night Network | specialist | I PRESENTATION_OR_FORMAT_CHANNEL | EDITORIAL_JUDGEMENT | n/a | overnight presentation block | schedule format | no distinct library |
| 902 | US News | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 903 | Europe News | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 904 | Asia News | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 905 | Africa News | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 906 | Middle East News | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 907 | Business News | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 910 | Weather | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 911 | World Weather | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 912 | Current Affairs | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 913 | News Analysis | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 914 | News Documentary | news | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL HIGH_EXPECTED_YIELD | HIGH | no long-form news documentary publisher | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (official public-broadcaster documentary strands) | official documentary strands publish full films; serves 943 |
| 917 | Economy Today | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 919 | Global Affairs | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 922 | Fox Weather | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 926 | International News 5 | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 927 | International News 6 | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 928 | International News 7 | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 929 | International News 8 | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 930 | US News Network | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 931 | European News Network | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 932 | Asia-Pacific News | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 933 | Africa Report | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 934 | Middle East Report | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 935 | Americas Report | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 936 | World Business | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 938 | World Science | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 939 | Environment News | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 941 | Culture News | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 942 | Media News | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 943 | Longform News | news | B NEW_BROAD_SOURCE_CURATION | KNOWLEDGE PROGRAMME_LEVEL | MEDIUM | same as 914 | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes | same research as 914 |
| 944 | News Interviews | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 945 | News Archive | news | B NEW_BROAD_SOURCE_CURATION | ARCHIVE PROGRAMME_LEVEL | MEDIUM | Pathé owned; no news archive | add a broad official publisher as BROAD_PROGRAMME_ROUTED and select programmes into programmeRoutes (official news-agency archive channels) | archive family |
| 946 | Newsroom | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 947 | Headlines | news | F CURRENT_AFFAIRS_OR_LIVE_MODEL | CURRENT | n/a | identity requires current news/weather | live/current provider model | a static archive pool cannot represent current news |
| 948 | News Extra | news | I PRESENTATION_OR_FORMAT_CHANNEL | CURRENT | n/a | "Extra" overflow channel | overflow presentation | not an independent library |
| 949 | Information | news | H RETROTV_ORIGINAL_OR_GENERATED_CANDIDATE | CURRENT | n/a | an information service (teletext-style) is generated | RetroTV generated information channel | natural generated identity |

## Recommended next acquisition batch (not executed)

44 channels, all class A with HIGH expected yield, in six research families where one publisher search typically serves several channels:

- **Film trailers by decade (one single-film trailer archive with film years in titles; existing year routing)**: 121 Classic Trailers, 122 1950s Trailers, 123 1960s Trailers, 124 1970s Trailers, 125 1980s Trailers, 126 1990s Trailers, 127 2000s Trailers, 128 2010s Trailers
- **Music eras and VEVO (official legacy-artist and VEVO channels; existing era rules and description rules)**: 540 1950s, 541 1960s, 548 Oldies, 594 VEVO Classics, 595 VEVO 1980s, 596 VEVO 1990s, 597 VEVO 2000s, 598 VEVO Live & Performance, 599 VEVO Discover, 578 Remixes
- **Rail (heritage railways, rail creators, cab-ride channels)**: 665 Rail Technology, 678 Railways, 679 Trains, 774 Rail Travel, 821 Steam Railways, 822 Modern Railways, 823 Rail Journeys
- **Nature, wildlife and earth science (natural-history publishers, geoscience lecturers)**: 023 Nature, 065 Earth, 066 Wildlife, 431 Earth, 483 Planet Earth, 784 Nature Life, 788 Animals
- **Football and sport (official leagues, confederations, clubs, boards, federations, vault channels)**: 303 Football Classics, 307 English Football, 308 European Football, 311 International Football, 313 Football Analysis, 329 Wrestling Classics, 356 Snow Sports, 360 Cricket
- **Travel and slow TV (creator-owned travel, walking-tour and journey channels)**: 057 Travel, 095 Slow TV, 772 City Breaks, 775 Walking Travel

Why this batch: every channel needs only new dedicated official/creator-owned sources, which the ingest pipeline already handles; no new architecture, metadata model or ownership decision is required. Trailers and music eras reuse the existing year routing, so a single good source can fill several decade channels. Rail, nature/earth, football and travel are among the densest official/creator ecosystems on YouTube, so research yield per query is high.

Parallel no-acquisition option (needs an ownership/reuse decision, not research): film genres 034, 149, 150, 151, 152, 153, 155 (and MEDIUM 143, 157) from the Popcornflix structured genre field.

Following waves: broad-source curation of the HIGH class B channels (288, 289, 893 broadcaster archives; 914 news documentary; 448 travel documentary; 600, 629 business documentary), then the remaining HIGH class A channels (489, 615, 622, 663, 688, 723, 732, 747, 748, 765, 808).

## Realistic remaining network (planning estimate)

| Path | Channels | Likely fillable (HIGH or MEDIUM) |
|---|---|---|
| New video acquisition (A, C) | 170 | 142 |
| Broad/manual curation (B, D) | 78 | 64 |
| External metadata (E) | 10 | 10 |
| Live/current, audio, original/generated, format (F, G, H, I) | 64 | n/a (different model) |
| No credible current free path (J) | 2 | n/a (different model) |

## Baseline

Triage only. catalogue-v30, 66,700 programmes, about 32,469 hours, 516 channels on air, 324 NEEDS_CONTENT, 1000/1000 manifest records, unchanged.

## Pass 13 outcome (catalogue-v31)

The recommended batch above and the Popcornflix genre option were executed. The sections above are the pre-Pass-13 triage and are kept as history.

Result: 84,961 programmes, about 40,610 hours, 566 channels on air (516 before), 274 NEEDS_CONTENT (324 before), 1000/1000 manifest records, no channel lost.

**Part A, film genres from Popcornflix structured genre metadata (programme-level reuse, no global DEDICATED_HOME change):** 034 Action, 149 Adventure Cinema, 150 Thriller, 151 Crime Cinema, 152 Mystery Cinema, 153 Comedy Cinema, 155 Drama Cinema, 157 Western now air. 143 has no matching genre in the metadata and 154 has one film (under 3 hours); both stay NEEDS_CONTENT.

**Part B, 42 of 44 activated:**

- Trailers 121–128: Rotten Tomatoes Classic Trailers, era-only. Individual single-film trailers dated by the bracketed original film year; compilations, re-release, anniversary, restoration, remaster, 4K/3D/IMAX and special-edition trailers rejected, as is any year later than the upload.
- Music 540, 541 (Ed Sullivan Show performances dated by broadcast, plus official Beatles, Rolling Stones, Roy Orbison, Beach Boys channels, all era-only); 595–597 (Vevo-owned decade playlists and 17 official classic-artist VEVO channels, feeding only 594–597); 598 Vevo live/performance; 599 Vevo DSCVR; 578 Ultra, Spinnin', Monstercat, Armada remixes. 542 and 543 also gained hours. Multi-artist archives count each performer separately for the diversity rule (≥3 h, ≥3 artists, no artist over 60%).
- Rail: 665 HS2; 678 Jago Hazzard; 679 National Railway Museum; 774 All The Stations; 821 Severn Valley, Bluebell, Keighley & Worth Valley; 822 Network Rail; 823 Rail Relaxation.
- Nature/earth: 023 Free Documentary Nature; 065 Nick Zentner; 066 Real Wild, Brave Wilderness; 431 IRIS, USGS; 483 PBS Terra; 784 Terra Mater; 788 The Dodo. Space/astronomy/aviation exclusions unchanged.
- Sport: 303 dated historical full matches (England 1994–2012, FIFA classics; 1930–2015 only); 307 Premier League; 308 Bundesliga, UEFA; 311 Concacaf, England; 313 The Coaches' Voice (analysis titles only); 329 WWE Vault, official WCW (WWE-owned; no reupload channels); 356 FIS Alpine, Teton Gravity Research; 360 ECB, cricket.com.au. ICC unchanged.
- Travel: 057 Kara and Nate, Lost LeBlanc; 095 RailCowGirl, J Utah (45 min minimum); 772 Wolters World; 775 Prowalk, Rambalac, Wind Walk.

**Unresolved:**

- 548 Oldies: its only viable pool is the Ed Sullivan/legacy material that fills 541 (Jaccard about 0.67), so the overlap rule drops it. Needs a distinct oldies source.
- 594 VEVO Classics: only about 1.2 hours of pre-1980 recordings across official VEVO channels, dominated by ABBA; below the diversity rule.

**Sources rejected:** Nat Geo Animals and Love Nature (blocked or ineligible in GB); Train Driver's POV (operator rights objection); Rail Engineer and Spinnin' Remixes channel (too small); @ourplanet (not the official publisher); NYMR (members tier, paid); VevoCtrl (about 10 videos).

**Recorded debt, not fixed:** collision pairs 303/325, 304/326, 313/327 (325 and 327 deliberately not acquired). maxSync is 4 in five slots, all coincidences between pre-existing broad sources (an NFB film on 25, 270, 430, 794; Clover Chaos on 201, 221, 270, 298); no Pass 13 source is involved. Fallback filler about 45 hours across the network, at most about 1.2 hours per channel per day.

## POST-PASS-13 ACTIVE QUEUE

Planning refresh at catalogue-v31 (84,961 programmes, about 40,610 hours, 566 on air, 1000/1000 manifest records). No acquisition, API call, routing, ownership, status or catalogue change was made. The pre-Pass-13 channel queue above stays as history; its per-channel class, blocker and method still apply except where this section changes the yield.

**Active queue: 274 NEEDS_CONTENT.** The 50 channels activated in Pass 13 (Part A: 8, Part B: 42) have left the queue. Every one of the 274 appears in the triage table above and in exactly one bucket below.

### Primary classes (274)

| Class | Meaning | Channels |
|---|---|---|
| A | NEW_DEDICATED_SOURCES | 110 |
| B | NEW_BROAD_SOURCE_CURATION | 44 |
| C | FREE_FILM_ACQUISITION | 18 |
| D | EXISTING_CATALOGUE_MANUAL_CURATION | 26 |
| E | ADDITIONAL_EXTERNAL_METADATA | 10 |
| F | CURRENT_AFFAIRS_OR_LIVE_MODEL | 37 |
| G | AUDIO_OR_RADIO_MODEL | 1 |
| H | RETROTV_ORIGINAL_OR_GENERATED_CANDIDATE | 4 |
| I | PRESENTATION_OR_FORMAT_CHANNEL | 22 |
| J | NO_CREDIBLE_FREE_PATH | 2 |
| | **Total** | **274** |

### Expected yield, classes A–E (208)

| Yield | A | B | C | D | E | Total |
|---|---|---|---|---|---|---|
| HIGH | 15 | 9 | 0 | 0 | 7 | 31 |
| MEDIUM | 71 | 23 | 12 | 23 | 3 | 132 |
| LOW | 24 | 12 | 6 | 3 | 0 | 45 |

### Yield changes from Pass 13 evidence

| # | Channel | Was | Now | Reason |
|---|---|---|---|---|
| 094 | Ambient TV | MEDIUM | HIGH | Pass 13 proved long-form creator ecosystems (Rail Relaxation 614 h, walking 1,171 h); fresh ambient creators needed, not reuse |
| 130 | Horror Trailers | MEDIUM | HIGH | 3,461 dated single-film trailers now exist (133 h); the only remaining blocker is film genre metadata |
| 131 | Sci-Fi Trailers | MEDIUM | HIGH | 3,461 dated single-film trailers now exist (133 h); the only remaining blocker is film genre metadata |
| 132 | Action Trailers | MEDIUM | HIGH | 3,461 dated single-film trailers now exist (133 h); the only remaining blocker is film genre metadata |
| 135 | Animation Trailers | MEDIUM | HIGH | 3,461 dated single-film trailers now exist (133 h); the only remaining blocker is film genre metadata |
| 136 | Drama Trailers | MEDIUM | HIGH | 3,461 dated single-film trailers now exist (133 h); the only remaining blocker is film genre metadata |
| 137 | Thriller Trailers | MEDIUM | HIGH | 3,461 dated single-film trailers now exist (133 h); the only remaining blocker is film genre metadata |
| 138 | Fantasy Trailers | MEDIUM | HIGH | 3,461 dated single-film trailers now exist (133 h); the only remaining blocker is film genre metadata |
| 143 | Creature Features | MEDIUM | LOW | Popcornflix structured genres have no creature genre; the 16 h estimate was title-based |
| 438 | Rivers | MEDIUM | HIGH | about 51 h of river-titled programmes now exist in the Pass 13 nature/earth sources; programme-level route decision only |
| 441 | Forests | MEDIUM | HIGH | about 36 h of forest-titled programmes now exist in the Pass 13 nature sources; programme-level route decision only |
| 548 | Oldies | HIGH | LOW | Pass 13 showed its only pool is the 541 Ed Sullivan/legacy pool (overlap about 0.67); needs a distinct oldies source |
| 594 | VEVO Classics | HIGH | LOW | Pass 13 exhausted official VEVO: about 1.2 h of pre-1980 recordings, ABBA-dominated |
| 773 | Road Trips | MEDIUM | HIGH | driving/road-trip creators proved abundant (J Utah 337 h); fresh sources needed, J Utah stays with 095 |
| 777 | Budget Travel | MEDIUM | HIGH | creator travel ecosystem proved abundant (057 and 772 activated from first-choice creators) |
| 824 | Stations | MEDIUM | HIGH | about 27 h of station-titled programmes now exist in the Pass 13 rail sources (Jago Hazzard, All The Stations); reuse decision only |

### Buckets (reconciliation)

| Bucket | Channels |
|---|---|
| NEXT_BATCH | 21 |
| PASS13_REUSE_CANDIDATE | 15 |
| IDENTITY_DEBT | 9 |
| DEMONSTRATED_BLOCKER | 3 |
| BACKLOG | 160 |
| NON_STANDARD | 66 |
| **Total** | **274** |

**NEXT_BATCH (21):** 094 Ambient TV, 288 TV Archive, 289 Retro Television, 448 Travel Documentary, 489 Environment, 600 Business, 615 Business History, 622 Manufacturing, 629 Business Documentary, 663 Megaprojects, 688 Workshop, 723 Budget Cooking, 732 Fitness, 747 Anatomy, 748 Physiology, 765 Home Restoration, 773 Road Trips, 777 Budget Travel, 808 Government Film Archive, 893 Broadcast History, 914 News Documentary

**PASS13_REUSE_CANDIDATE (15):** 130 Horror Trailers, 131 Sci-Fi Trailers, 132 Action Trailers, 135 Animation Trailers, 136 Drama Trailers, 137 Thriller Trailers, 138 Fantasy Trailers, 361 Cricket Classics, 437 Mountains, 438 Rivers, 441 Forests, 442 Polar World, 544 1990s, 588 Disco 79, 824 Stations

**IDENTITY_DEBT (9):** 304 Football Documentary, 323 FIFA, 325 Football Classics, 326 Football Documentary, 327 Football Analysis, 616 Economic History, 626 Sports Business, 802 Public Domain, 943 Longform News

**DEMONSTRATED_BLOCKER (3):** 143 Creature Features, 548 Oldies, 594 VEVO Classics

**BACKLOG (160):** 019 Archive, 027 People, 037 Fantasy, 049 Stage, 061 Geography Mix, 076 Talk, 084 Indie Screen, 085 Festival, 087 Public Domain, 090 Learning, 092 Books, 096 Oddities, 111 Golden Age, 116 Experimental Film, 118 Family Film, 134 Cult Trailers, 139 Documentary Trailers, 141 Classic Horror, 142 Gothic Horror, 145 Classic Sci-Fi, 163 Actors, 166 Film Editing, 171 Cinema 1920s, 172 Cinema 1930s, 173 Cinema 1940s, 175 Cinema 1960s, 176 Cinema 1970s, 183 Cult Classics, 184 B-Movies, 196 Movie Culture, 197 Behind the Scenes, 199 Cinema Archive, 211 Classic Drama, 212 Crime Drama, 213 Detective, 214 Mystery, 215 Thriller TV, 219 Cult TV, 228 Anime Action, 230 Anime Fantasy, 231 Anime Drama, 232 Anime Comedy, 233 Anime Cinema, 234 Manga Culture, 238 Teen, 239 Young Adult, 242 Arcade, 252 Comics, 253 Superheroes, 254 Science Fiction Culture, 275 Classic Game Shows, 290 Internet Classics, 297 Fan Films, 306 Football History, 344 Classic Motorsport, 345 Motorsport Documentary, 359 Adventure Sport, 384 Outdoor Sport, 390 Sports Science, 391 Sports Medicine, 394 Sports Business, 397 Great Athletes, 407 Renaissance, 418 African History, 422 Social History, 423 Political History, 424 Economic History, 429 History Archive, 434 Nations, 440 Deserts, 449 World Cultures, 451 Legal History, 454 Criminal Law, 455 Civil Law, 456 Human Rights, 457 International Law, 458 Constitutional Law, 462 Criminology, 463 Policing History, 478 Evolution, 494 Anthropology, 495 Sociology, 497 Literature, 547 2020s, 549 Retro Hits, 560 Music Documentary, 582 Indie 2000, 586 Punk 90, 589 Synth 84, 608 Management, 610 Marketing, 611 Advertising, 612 Retail, 613 Small Business, 618 Banking, 620 Property, 623 Supply Chain, 624 Energy Business, 625 Media Business, 627 Fashion Business, 628 Food Business, 635 Open Source, 636 Internet, 643 Automation, 653 Civil Engineering, 654 Chemical Engineering, 657 Marine Engineering, 658 Industrial Design, 659 Product Design, 662 Infrastructure, 669 Renewables, 675 Trucks, 685 Future Tech, 686 Inventions, 690 Digital Culture, 691 Tech Interviews, 694 Market History, 697 Careers, 717 Seafood, 725 Slow Cooking, 726 Regional Food, 742 Wellbeing, 743 Mindfulness, 744 Healthy Ageing, 746 Medical History, 749 Health Documentary, 764 Landscape, 767 Property Life, 768 Organisation, 776 Adventure Travel, 778 Luxury Travel, 779 Travel History, 780 Outdoors, 789 Rural Life, 795 Collecting, 798 Everyday Skills, 801 Archive, 806 Advertising Archive, 809 Industrial Film Archive, 812 Arcade Archive, 815 Internet History, 818 Radio History, 819 Tech Archive, 832 Ships, 833 Sailing Archive, 835 Road Transport, 836 Classic Cars Archive, 837 Buses, 838 Trams, 839 Transport Archive, 840 Books, 842 Poetry, 843 Literature Archive, 844 Theatre Archive, 848 Architecture Archive, 849 Design Archive, 885 Video Art, 891 Trailers & Promos, 892 Station Archive, 945 News Archive

**NON_STANDARD (66):** 073 Business Today, 074 Weather, 078 Magazine, 088 Community, 089 Local, 129 New Trailers, 185 Drive-In, 187 Creature Night, 188 Saturday Matinee, 189 Sunday Cinema, 190 Late Film, 191 Midnight Film, 192 Double Feature, 198 Deleted & Rare, 292 Creators, 469 Law Extra, 499 Knowledge Extra, 550 Chart, 551 New Music, 563 Artists, 564 Bands, 579 Rare Tracks, 699 Business Extra, 729 Food Extra, 769 Home Extra, 799 Lifestyle Extra, 800 Specialist, 841 Audiobooks, 882 Independent TV, 883 Creator TV, 887 Test Card, 895 Weather Maps, 898 Night Network, 902 US News, 903 Europe News, 904 Asia News, 905 Africa News, 906 Middle East News, 907 Business News, 910 Weather, 911 World Weather, 912 Current Affairs, 913 News Analysis, 917 Economy Today, 919 Global Affairs, 922 Fox Weather, 926 International News 5, 927 International News 6, 928 International News 7, 929 International News 8, 930 US News Network, 931 European News Network, 932 Asia-Pacific News, 933 Africa Report, 934 Middle East Report, 935 Americas Report, 936 World Business, 938 World Science, 939 Environment News, 941 Culture News, 942 Media News, 944 News Interviews, 946 Newsroom, 947 Headlines, 948 News Extra, 949 Information

### Next recommended acquisition batch (21 targets, not executed)

Every remaining HIGH class A/B channel whose method is already supported (dedicated source, or broad source plus `programmeRoutes`), with no product-definition decision outstanding:

| Family | Channels | Class | Method | Research together | Programme-level | API cost |
|---|---|---|---|---|---|---|
| Broadcast and news archive | 288 TV Archive, 289 Retro Television, 893 Broadcast History, 914 News Documentary, 808 Government Film Archive | B, B, B, B, A | official broadcaster archive channels and long-form news-documentary publishers as BROAD_PROGRAMME_ROUTED with explicit routes; official national/government film archives as dedicated | yes: one archive sweep serves 288/289/893; 914 and 808 separate publishers | yes for 288, 289, 893, 914 | MEDIUM |
| Business and industry | 600 Business, 615 Business History, 629 Business Documentary, 622 Manufacturing, 663 Megaprojects | B, A, B, A, A | business-documentary and company-history publishers; factory-process and megaproject creators | yes: one business-documentary sweep serves 600/615/629; one engineering sweep serves 622/663 | yes for 600, 629 | MEDIUM |
| Travel and slow | 448 Travel Documentary, 773 Road Trips, 777 Budget Travel, 094 Ambient TV | B, A, A, A | creator-owned travel, driving and ambient channels (the Pass 13 ecosystem, new publishers only); broad travel-documentary publisher with routes for 448 | yes | yes for 448 | LOW |
| Science and medicine | 489 Environment, 747 Anatomy, 748 Physiology | A | environmental-science publishers; medical-education channels | 747/748 together | no (distinct publishers per channel to avoid overlap) | LOW |
| Lifestyle and makers | 688 Workshop, 723 Budget Cooking, 732 Fitness, 765 Home Restoration | A | creator-owned channels distinct from existing homes | partly | no | LOW |

Why this batch: it is fresh territory (none of these families was touched in Pass 13), it activates new channels rather than thickening programmed ones, and it uses only the supported dedicated and broad-routed ingestion paths. Pass 13 processed 44 targets for about 2,200 API units; 21 targets with perhaps 45–60 sources should cost about 1,000–1,800 units, well within one quota day, with the archive and business families costing most because of wider scans for programme-level selection.

Standing constraints for the batch: no space, astronomy, rocket, satellite, aircraft or aerospace programmes (663 megaprojects must exclude airports and launch sites; 489 must exclude satellite missions; 808 must exclude aviation and space-agency films); no religious broadcasting; official publishers only; 914 will make 943 a duplicate identity, which stays deferred. Keep 288, 289 and 893 distinct by programme selection, and 600, 615 and 629 by publisher.

Not in the batch although HIGH: the ten PASS13_REUSE_CANDIDATE channels, because each needs an explicit reuse or metadata decision first (a possible Part A).

### PASS13_REUSE_CANDIDATE (15, decision required)

Hours are rough title-keyword estimates from the v31 catalogue and would shrink under editorial review.

| # | Channel | Pass 13 reservoir | Est. hours | Why automatic routing does not activate it | Decision required |
|---|---|---|---|---|---|
| 130, 131, 132, 135, 136, 137, 138 | Horror, Sci-Fi, Action, Animation, Drama, Thriller, Fantasy Trailers | Rotten Tomatoes Classic Trailers (3,461 trailers, 133 h, film title and year known) | about 5–20 h each | YouTube metadata carries no film genre; trailers are era-only | approve one free external film-metadata source (for example Wikidata) matched by title and year, and genre routing for the trailer source as Popcornflix has |
| 824 | Stations | Jago Hazzard, All The Stations (dedicated to 678, 774) | about 27 h | the rail sources are DEDICATED to their homes | approve programme-level reuse of station-titled items from those two sources |
| 438 | Rivers | Free Documentary Nature, Real Wild, Terra Mater, Nick Zentner, USGS | about 51 h | nature/earth sources are DEDICATED to 023, 066, 784, 065, 431 | approve those sources as BROAD_PROGRAMME_ROUTED for explicit geography routes |
| 441 | Forests | same | about 36 h | same | same |
| 437 | Mountains | same | about 23 h (half Nick Zentner geology lectures) | same | same |
| 442 | Polar World | same (mainly Real Wild) | about 25 h | same; polar material also risks satellite and aviation exclusions | same, with exclusion review |
| 361 | Cricket Classics | ECB, cricket.com.au | about 26 h keyword matches, none dated | no original-year evidence for classic matches | extend the full-match year rule to the cricket sources and approve their reuse on 361 |
| 588 | Disco 79 | Gloria Gaynor, VEVO Donna Summer, Barry White, Earth Wind & Fire, Diana Ross | about 4 h dated 1970–81 | the new VEVO artist sources feed only 594–597, by the Pass 13 overlap decision | approve adding named disco artists to the 588 rule; marginal hours and diversity |
| 544 | 1990s | Rockpalast, Nirvana, VEVO 1990s, R.E.M., Radiohead (over 25 h dated 1990s) | over 25 h | 1990s recordings are taken first by the 580/581/584 rules (era limit) | approve a priority or limit change for 544, which is a routing decision |

Not flagged: 397 Great Athletes (the WWE Vault "legend" pool is wrestling, not athlete biography); 306 Football History (the matching items are goal compilations, not history); 094 and 773 (the matching long-form items are the identities of 823, 775 and 095, so fresh sources are planned instead).

### Existing-catalogue manual curation (class D)

No HIGH class D channel remains: all seven were the Popcornflix genre channels activated in Pass 13. The 24 remaining class D channels are MEDIUM or LOW with the blockers recorded above. The closest no-API equivalents of the Pass 13 Part A are the reuse candidates above (824, 438, 441 and the trailer genres).

### Remaining film gaps

| Blocker | Channels |
|---|---|
| Needs a new lawful full-film source | 084 Indie Screen, 087 Public Domain, 116 Experimental Film, 233 Anime Cinema (802 is a duplicate of 087) |
| Insufficient quantity | 037 Fantasy (about 19 h), 118 Family Film (about 18 h) |
| Missing genre | 143 Creature Features (no creature genre in Popcornflix metadata), 142 Gothic Horror (not a structured genre) |
| Pre-1980 inventory gap | 111 Golden Age, 141 Classic Horror, 145 Classic Sci-Fi, 171–173 Cinema 1920s–1940s, 175–176 Cinema 1960s–1970s, 199 Cinema Archive |
| Editorial or format identity | 183 Cult Classics, 184 B-Movies, 163 Actors, 197 Behind the Scenes, 166 Film Editing, 196 Movie Culture, 297 Fan Films; formats 185, 187–192; 198 Deleted & Rare (no path) |
| External metadata | 130–132, 134–139 genre trailers (129 New Trailers is current, class F) |

154 Romantic Comedy is PLAYABLE_THIN (0.2 h), not NEEDS_CONTENT. No class C film channel is HIGH: the pre-1980 and full-film gaps still need verified public-domain or official vault publishers, which Pass 13 did not change. The strongest film opportunity is the trailer-genre metadata decision, not acquisition.

### Identity debt (9, deferred)

303/325, 304/326 and 313/327 stay recorded. 303 and 313 are programmed; 325 and 327 are not to be acquired until distinguished. 304 and 326 are both NEEDS_CONTENT and need a product-definition decision before either is acquired. Also deferred as duplicate definitions: 323 FIFA (301 Football is already the FIFA channel), 802 (087), 616 (424), 626 (394), 943 (914).

### Demonstrated blockers (3)

548 Oldies and 594 VEVO Classics (Pass 13 blockers above; not for immediate retry) and 143 Creature Features (no structured genre).

### Remaining backlog (160, classes A–E, MEDIUM/LOW)

Largest families: business (14), archive (13), film eras (9), tech (9), law (8), film genres (7), anime (6), history (5), music eras (5), engineering (5), transport (5), film culture (5). The next HIGH-yield candidates after this batch are likely to come from yield reviews of transport (837 Buses, 838 Trams, by analogy with the heritage-rail result), TV drama (212–215) and books (092, 840, 842).

### Non-standard models (66, tracked separately)

F current affairs/live 37, G audio 1, H original/generated 4, I presentation/format 22, J no credible free path 2. Not part of ordinary acquisition.

## Pass 14 outcome (catalogue-v32)

The 21-channel high-yield batch recommended in the POST-PASS-13 ACTIVE QUEUE was executed. The sections above are kept as history.

Result: 94,498 programmes, about 44,645 hours, 587 channels on air (566 before), 253 NEEDS_CONTENT (274 before), 1000/1000 manifest records, no channel lost. All 64 new sources are DEDICATED_HOME to a single channel; no BROAD_PROGRAMME_ROUTED source was added and no ownership rule was weakened.

**All 21 activated:**

- Broadcast/news archive: 288 BBC Archive, Thames TV (plus the existing 1950–99 era routing); 289 Johnny Carson, Carol Burnett Show; 808 US National Archives (films only, no lectures, aircraft or space), IWM, The National Archives UK, Yorkshire Film Archive; 893 Television Academy Foundation interviews, Paley Center (retrospectives and reunions only), BBC Archive broadcasting-history titles; 914 FRONTLINE, ABC News In-depth (Four Corners, Australian Story, Foreign Correspondent, Compass), CNA Insider (20 min minimum).
- Business/industry: 600 Stanford GSB (no events or ceremonies), HBR, CNBC Make It; 615 Company Man, Business Casual, Logically Answered (history titles); 622 Business Insider, Insider and CNBC factory/"how it is made" titles; 629 Bloomberg Originals, CNBC documentaries (25 min minimum), The Economist (business films only); 663 Megaprojects (construction only; no aviation, space or military), The B1M's The Build.
- Travel/ambient: 094 Nature Relaxation Films, Balu, Relaxation Film, Scenic Nature Relaxation (30 min minimum; no music-only, static, fireplace or screensaver uploads); 448 Free Documentary travel, ARTE travel; 773 Itchy Boots, Kombi Life; 777 OlderBackpacker, Holiday Expert, Hopscotch the Globe, Nomadic Matt, Travel on a Tiny Budget.
- Science/medicine: 489 Just Have a Think, UNEP (no conference sessions), Our Changing Climate, Climate Town; 747 Kenhub, AnatomyZone, Ninja Nerd anatomy; 748 Khan Academy Medicine physiology, Armando Hasudungan physiology, Osmosis physiology, Ninja Nerd physiology. 747 (structure) and 748 (function) share no source rows.
- Lifestyle/makers: 688 Jimmy DiResta, Laura Kampf, Paul Sellers, Steve Ramsey; 723 Joshua Weissman "But Cheaper", Budget Bytes, Miguel Barclay (PLAYABLE, about 15 hours); 732 Fitness Blender, PS Fit, The Body Coach; 765 Belgrave Villa, Restoring Number Four, The Chateau Diaries (restoration titles only).

**Routing note:** 288, 289, 688 and 914 are home-only channels (`HOME_ONLY_CHANNELS` in `src/director/fit.ts`): older broad rows that nominate them no longer air there, so they keep to their dedicated publishers (plus era routing on 288). Without this, general entertainment and short news clips leaked in and created 61 new overlap pairs.

**Sources rejected:** a budget food and travel channel (off-topic regional packages and shopping); ProcessX (Japanese-only titles); "How It's Made"-style factory compilation channels (unknown provenance, likely reuploads); impostor or wrong handles for Company Man, Bloomberg Originals, Megaprojects, FT, Paul Sellers, Miguel Barclay and others; DW Documentary (already dedicated to 108).

**Thin but kept:** Scenic Nature Relaxation (1 programme), IWM (4), TNA UK (5), Osmosis (7), Ninja Nerd physiology (3); each home channel is carried by its other sources.

**Recorded debt, not fixed:** 943 is a duplicate identity of 914 and is now more duplicative. Overlap pairs 542 → 542 (no new pairs), maxSync 3 (no four-way slots), fallback filler about 44 hours network-wide (41 before). Owners preserved: British Pathé 805, KOFA 114, Orbital Bacon 225, ICC.

## PASS 15A — EXISTING-CATALOGUE REUSE OUTCOME (catalogue-v33)

Programme-level reuse only: no new YouTube source, no API key, no YouTube search. Dedicated sources stay DEDICATED_HOME; a reused programme reaches a target channel only if its id is listed in `programmeRoutes` (from `scripts/programme_reuse.py`) and fit.ts `PROGRAMME_REUSE` approves that source for that channel. The rest of each source stays on its homes. Trailer genres come from Wikidata (CC0), matched on exact title and original year; the result is cached in `scripts/data/wikidata-trailer-films.json` and shipped in `playable.json` `trailerGenres`, so runtime makes no metadata calls.

Result: 598 channels on air (587 before), 242 NEEDS_CONTENT (253), 94,498 unique programmes and about 44,645 unique hours (unchanged: reuse adds airings, not programmes), 1000/1000 records, no channel lost. One new overlap pair (678 Railways ~ 824 Stations, containment 0.92, Jaccard 0.30) because Stations is a hand-picked subset of Jago Hazzard. maxSync still 3.

| Target | Outcome | Reason |
|---|---|---|
| 130 Horror Trailers | ACTIVATED | 389 trailers, 13.2 h, Wikidata genre |
| 131 Sci-Fi Trailers | ACTIVATED | 337, 11.7 h |
| 132 Action Trailers | ACTIVATED | 616, 22.7 h |
| 135 Animation Trailers | REMAINS NEEDS_CONTENT | only 55 matched animated films, 1.9 h (< 3 h) |
| 136 Drama Trailers | ACTIVATED | 1,349, 53.2 h |
| 137 Thriller Trailers | ACTIVATED | 513, 19.1 h |
| 138 Fantasy Trailers | ACTIVATED | 294, 10.5 h |
| 437 Mountains | ACTIVATED | 75 reviewed programmes, 57.0 h, 9 sources |
| 438 Rivers | ACTIVATED | 56, 37.9 h, 9 sources |
| 441 Forests | ACTIVATED | 38, 25.9 h, 8 sources |
| 442 Polar World | ACTIVATED | 50, 24.6 h, 9 sources (no space, satellite or aviation) |
| 824 Stations | ACTIVATED | 99 station-subject programmes, 19.9 h (Jago Hazzard 91 / 18.1 h, All The Stations 8 / 1.8 h) |
| 361 Cricket Classics | REMAINS NEEDS_CONTENT | blocked: the channel has no authoritative classic cutoff (identity is only "cricket only"), and ECB / cricket.com.au rows carry no original-year provenance |
| 588 Disco 79 | REMAINS NEEDS_CONTENT | about 0.6 h of credible 1979 disco in the catalogue; rule narrowed to 1979 only, still dormant |

Trailer duplication control: a trailer joins at most 3 genre channels, keeping the scarcer genres first (Animation, Fantasy, Sci-Fi, Horror, Thriller, Action, Drama); 89 trailers were capped. 32 ambiguous titles (more than one film with that title and year) and 377 unmatched trailers route to no genre channel. 544 was not processed; 580, 581 and 584 are unchanged.

## PASS 15B — CONTENT ACQUISITION OUTCOME (catalogue-v34)

Selected from the Pass 13 BACKLOG (MEDIUM, classes A/B), excluding the Pass 15A leftovers (135, 361, 588), 544, the demonstrated blockers (143, 548, 594), identity debt and non-standard models. 27 channels were targeted with 36 named official, institutional or creator-owned publishers; 30 verified sources were acquired, all DEDICATED_HOME to one channel. No BROAD_PROGRAMME_ROUTED source and no programme-level reuse was added.

Result: 99,669 programmes (94,498 before), about 46,511 hours (about 44,645), 623 channels on air (598), 217 NEEDS_CONTENT (242), 1000/1000 records, no channel lost programming. Overlap pairs 543 → 543. Owners preserved: British Pathé 805, KOFA 114, Orbital Bacon 225, ICC. About 2,200 API units used.

**Activated (25):**

| Channel | Sources | Programmes | Hours |
|---|---|---|---|
| 092 Books | Hay Festival | 120 | 95.6 |
| 252 Comics | ComicTropes (analysis only, no art streams), Strip Panel Naked | 269 | 93.9 |
| 344 Classic Motorsport | Goodwood Road & Racing (Revival, Members' Meeting, historic races) | 269 | 131.5 |
| 345 Motorsport Documentary | Josh Revell | 166 | 45.4 |
| 359 Adventure Sport | World Surf League | 221 | 117.6 |
| 478 Evolution | Ben G Thomas (palaeontology/evolution titles), Clint's Reptiles (evolution titles) | 245 | 102.8 |
| 608 Management | London Business School (management titles) | 102 | 53.0 |
| 613 Small Business | Starter Story | 184 | 46.5 |
| 618 Banking | Bank of England (no speeches, press conferences or hearings) | 162 | 91.7 |
| 623 Supply Chain | Wendover Productions (logistics titles only) | 35 | 9.9 |
| 627 Fashion Business | The Business of Fashion | 300 | 187.8 |
| 657 Marine Engineering | Chief MAKOi | 72 | 12.1 |
| 658 Industrial Design | Design Museum | 32 | 10.4 |
| 659 Product Design | Eric Strebel | 275 | 50.4 |
| 669 Renewables | Engineering with Rosie | 77 | 18.7 |
| 742 Wellbeing | Dr. Tracey Marks | 300 | 55.4 |
| 743 Mindfulness | Headspace (meditation/mindfulness titles) | 170 | 38.6 |
| 780 Outdoors | Steve Wallis | 233 | 92.9 |
| 789 Rural Life | Dianxi Xiaoge, Li Ziqi | 414 | 154.5 |
| 809 Industrial Film Archive | Huntley Film Archives (industry films) | 116 | 18.9 |
| 832 Ships | Oceanliner Designs (no warships) | 300 | 176.2 |
| 835 Road Transport | Road Guy Rob | 92 | 25.6 |
| 839 Transport Archive | Huntley Film Archives (transport films) | 182 | 26.7 |
| 842 Poetry | Button Poetry, Poetry Foundation | 422 | 105.1 |
| 945 News Archive | British Movietone, AP Archive (no entertainment rushes or junkets) | 405 | 103.2 |

**Unresolved selected target:** 662 Infrastructure — Tomorrow's Build has no verifiable official channel (handle absent; channel search found only unrelated or empty channels) and The Build is already 663's source.

**Rejected or not found:** Bank of England @BankofEngland, Josh Revell @JoshRevell, Steve Wallis @SteveWallis and Joe Robinet @JoeRobinet (impostor or placeholder accounts with 0–11 videos; the real channels were used where found), Goodwood @Goodwood (empty); not found: Undecided with Matt Ferrell, What's Going On With Shipping, London Transport Museum, Magnus Midtbø (second sources only, not needed); The School of Life and TA Outdoors were already in the catalogue.

**Routing change:** the NBC News NOW / LiveNOW feed no longer reaches channels named as archives (`except` on the feed), so 945 carries archive publishers only.

**Recorded, not fixed:** schedule reseeding at v34 produces one 10-minute four-way slot (68, 630, 647, 811) of a Computer History Museum lecture already routed to nine channels before this pass; maxSync 3 → 4 for that slot only. Fallback filler 46 h network-wide, unchanged.

## PASS 16 — CONTENT ACQUISITION OUTCOME

Catalogue v34 → v35. Programmes 99,669 → 101,133; hours 46,511 → 46,822; on air 623 → 630; NEEDS_CONTENT 217 → 210. Manifest 1000/1000, no channel lost programming, overlap pairs 543 → 543, fallback 46 h unchanged.

**Selected (32 sources, 27 channels):** Huntley Film Archives subject splits (836, 833, 848, 422, 429), Travel Film Archive (779), Chicago Film Archives (801), Gresham College splits (451, 462, 746, 423), Royal Anthropological Institute and LSE (494, 495), SAG-AFTRA Foundation and BAFTA (163), Vashi Visuals and American Cinema Editors (166), Patrick Willems and Thomas Flight (196), Comicstorian (253), Trash Theory (560), Linux Foundation (635), Brick Immortar (653), Mellow (384), Indigo Traveller and Eva zu Beck (776), Dr Brad Stanfield (744), Clutterbug (768), Cannes Lions (611), Patrick Boyle (694), 92NY (840).

**Activated:**

| Channel | Source | Programmes | Hours |
|---|---|---|---|
| 422 Social History | Huntley Film Archives (social life films) | 299 | 61.8 |
| 429 History Archive | Huntley Film Archives (events and ceremonies) | 294 | 33.1 |
| 779 Travel History | Travel Film Archive | 298 | 122.3 |
| 801 Archive | Chicago Film Archives | 169 | 46.1 |
| 833 Sailing Archive | Huntley Film Archives (sail craft) | 29 | 3.3 |
| 836 Classic Cars Archive | Huntley Film Archives (motoring) | 117 | 12.5 |
| 848 Architecture Archive | Huntley Film Archives (buildings and housing) | 251 | 30.3 |

**Stopped at quota:** the YouTube Data API daily quota (already largely used by passes 13–15B the same day) ran out at `src_gresham_law`. Not acquired, resume from there: 451, 462, 746, 423, 494, 495, 163, 166, 196, 253, 560, 635, 653, 384, 776, 744, 768, 611, 694, 840. Their sources are verified and listed in `scripts/add_targeted_sources.py`.

**Rejected or not found:** ICE (Institution of Civil Engineers) and REEL ROCK (no verifiable official channel); `@LSE` and `@VashiVisuals` handles were placeholders (real channels resolved by search).

**Post-filtering:** 186 Huntley/Travel Film Archive rows removed for keyword collisions (rowing/growing, making/king, care homes, Christian holiday camps, wartime, airborne, parasailing, cookery, refugees, a US presidential visit, reunions/conventions); capped splits were refilled from cached API responses without further quota.

**Routing change:** 801 and 848 are home-only channels, so broad archive rows that nominate them (NFB, Time Team, Sky History, Antiques Roadshow) do not air there; without this, 801 would have added 28 duplicate-channel pairs.

**Recorded, not fixed:** maxSync 4 for one pre-existing three-slot overlap (6, 100, 109, 460); fallback 46 h.

### PASS 16 — CONTINUATION / COMPLETION

Resumed at `src_gresham_law` with the 25 prepared sources, in their original order, using the stored channel IDs (no searches). The seven earlier Pass 16 channels (422, 429, 779, 801, 833, 836, 848) were not re-enumerated. Catalogue v35 → v36.

**Acquired and kept (22 sources, 20 channels):**

| Channel | Source | Programmes | Hours |
|---|---|---|---|
| 163 Actors | SAG-AFTRA Foundation | 300 | 396.1 |
| 166 Film Editing | American Cinema Editors | 166 | 97.9 |
| 196 Movie Culture | Patrick (H) Willems, Thomas Flight | 286 | 127.0 |
| 253 Superheroes | Comicstorian (comic stories only) | 300 | 172.6 |
| 384 Outdoor Sport | Mellow (climbing films) | 176 | 36.2 |
| 423 Political History | Gresham College (political history lectures) | 23 | 20.2 |
| 451 Legal History | Gresham College (law lectures) | 73 | 67.8 |
| 462 Criminology | Gresham College (crime lectures) | 20 | 18.3 |
| 494 Anthropology | Royal Anthropological Institute | 56 | 89.8 |
| 495 Sociology | LSE (sociology, inequality, welfare, cities) | 191 | 262.5 |
| 560 Music Documentary | Trash Theory | 131 | 58.9 |
| 611 Advertising | Cannes Lions | 20 | 7.8 |
| 635 Open Source | The Linux Foundation | 300 | 240.3 |
| 653 Civil Engineering | Brick Immortar (structural failures only) | 15 | 6.1 |
| 694 Market History | Patrick Boyle (historical episodes only) | 16 | 7.5 |
| 744 Healthy Ageing | Dr Brad Stanfield | 81 | 21.4 |
| 746 Medical History | Gresham College (history of medicine) | 4 | 3.8 |
| 768 Organisation | Clutterbug | 300 | 86.5 |
| 776 Adventure Travel | Indigo Traveller, Eva zu Beck | 486 | 157.5 |
| 840 Books | 92NY (readings and author talks) | 81 | 93.2 |

**Rejected after acquisition:** BAFTA (5 programmes, 2.8 h, games and sponsored clips), Vashi Visuals (monitor promotions, music videos, game-engine tutorials and commentary tracks of unclear rights), LSE anthropology split (1 programme). Their channels are covered by the kept second sources.

**Unresolved:** none of the 20 targets.

**Filtering (from cached API responses, no extra quota):** duplicate lecture uploads collapsed (Gresham, RAI, LSE, SAG-AFTRA, ACE, 92NY); keyword collisions and off-identity titles excluded — "trial" in "industrial", royal-court histories, astrophysics, religious and missionary titles, art/science "revolutions", awards pre-shows and ceremony segments, gameplay streams and MCU commentary, ship sinkings on Civil Engineering, current-affairs episodes on Market History, film/TV/political events on Books, channel Q&A and promotional clips. Totals: 3,374 rows acquired; 37 rejected-source rows and 342 editorial removals; 31 cached refills; 3,026 kept.

**Routing:** 163, 166 and 196 are home-only channels, so broad NFB rows that nominate them do not air there.

**Quota:** about 1,000 units (25 channel lookups, about 480 playlist pages, about 480 video batches, a few key checks); no `search.list`.

**Final Pass 16 totals:** 27 channels activated (7 before the interruption, 20 in this continuation); 29 of 32 selected sources kept. On air 623 → 650; NEEDS_CONTENT 217 → 190. Overlap pairs 543 unchanged; maxSync 3; fallback 49 h (46 h before; the difference is block gap-filling on the new long-lecture channels).

## PASS 17 — ENTERTAINMENT / TELEVISION / CULTURE

Official, rights-holder or creator-owned publishers only, identified by handle lookups (about 170 `channels.list` probes, no `search.list`). New publishers are dedicated to one home; each Pass 17 home is home-only, so the broad inherited pools that made these channels duplicates of 100 Film, 210 Drama, 220 Animation and 400 History do not air there. Catalogue v36 → v37.

**Activated (16 channels):**

| Channel | Sources | Programmes | Hours |
|---|---|---|---|
| 049 Stage | Stratford Festival, Royal Court Theatre, Lincoln Center (theatre and dance only), Royal Shakespeare Company | 161 | 121.0 |
| 076 Talk | The Dick Cavett Show, First We Feast (Hot Ones episodes only) | 500 | 179.7 |
| 096 Oddities | Atlas Obscura (Gastro Obscura food segments excluded) | 75 | 10.6 |
| 197 Behind the Scenes | Programme reuse: making-of film, television and stage (16 existing publishers) | 69 | 24.4 |
| 219 Cult TV | Gerry Anderson (Anderson Entertainment: interviews, watchalongs and making-of documentaries) | 300 | 421.8 |
| 228 Anime Action | Cardfight!! Vanguard, BEYBLADE English, Crunchyroll (action series) | 614 | 328.2 |
| 230 Anime Fantasy | Crunchyroll (fantasy series) | 21 | 8.9 |
| 231 Anime Drama | Crunchyroll (drama series) | 10 | 4.0 |
| 232 Anime Comedy | Crunchyroll (comedy series) | 23 | 9.1 |
| 234 Manga Culture | VIZ (mangaka, reading guides, Shonen Jump), plus reuse from British Museum, Comic Tropes, Strip Panel Naked | 45 | 7.4 |
| 238 Teen | Degrassi – The Official Channel | 300 | 261.7 |
| 239 Young Adult | Pemberley Digital, The Lizzie Bennet Diaries, KindaTV (series episodes only) | 305 | 31.0 |
| 242 Arcade | Programme reuse: arcade hardware, cabinets and coin-op history (8 existing publishers) | 28 | 11.6 |
| 254 Science Fiction Culture | Programme reuse: SF screen culture — makers, criticism, fandom, sound (16 existing publishers) | 67 | 31.9 |
| 275 Classic Game Shows | Wheel of Fortune (full vintage episodes) | 19 | 6.9 |
| 497 Literature | British Library (literature events), Royal Society of Literature | 124 | 144.2 |

096 and 497 are secondary targets, taken as replacements for failed primaries.

**Series-level classification:** Crunchyroll's free episodes are split per series into four sources. Each series has exactly one genre home: 8 action series, 12 fantasy, 4 drama and 12 comedy. BEYBLADE and Vanguard are homed on 228 only. TMS Anime, It's Anime and GUNDAM are unchanged.

**Programme reuse (no quota):** `scripts/programme_reuse.py` writes explicit `programmeRoutes` for 197, 234, 242 and 254, and `PROGRAMME_REUSE` in `fit.ts` approves the source for each channel. The 197 and 254 lists are disjoint. Owned sources (British Pathé, KOFA, Orbital Bacon) are not used.

**Unresolved:**
- 211 Classic Drama: Sullivan Entertainment carries soundtracks, interviews and kids' animation, not drama episodes.
- 212–215 Crime Drama, Detective, Mystery, Thriller TV: The Bill (3,372 of 4,044 blocked in GB) and Midsomer Murders (903 of 911 blocked in GB) are geo-blocked. Columbo, Kojak, Murder, She Wrote, Miami Vice, Knight Rider and Da Vinci's Inquest carry only clips and compilations. No lawful full-episode inventory is viewable in the UK, so nothing is sprayed across the four identities.
- 297 Fan Films: not attempted; creator ownership cannot be established at scale.
- 027 People (secondary): Biography kept 6 full documentaries, two of them current-affairs political profiles; under 3 h remained.

**Rejected after acquisition:**
- Merv Griffin Show (clips only).
- GSN (modern GSN originals, not classic shows).
- Baywatch ("best rescues" compilations).
- The Next Step (3 h, mostly blocked in GB).
- Saved by the Bell and Riverdance (clips).
- RetroCrush (chat shows; its episodes are blocked in GB).
- Muse Asia and Ani-One Asia (blocked in GB).
- Wolfblood (blocked in GB).
- Being Erica (official status not established).

**Filtering (from cached API responses):** trailers, teasers, promos, compilations, "best moments", recaps, clips, reactions and sales excluded throughout. Also excluded:
- Stratford political forums and symposia.
- Lincoln Center concerts, workshops and film events.
- KindaTV full-season duplicates of individual episodes, pre-shows, Periscopes and convention panels.
- Gerry Anderson yule log, polls and compilations.
- VIZ anime promotion, music videos and sales.
- RSL careers events.

Space, aviation and religious terms are excluded for every source; fictional SF stays, factual space does not.

**Audit (same audit date, before and after):**
- On air 650 → 666; NEEDS_CONTENT 190 → 174; no losses.
- Overlap pairs 543 → 543, with no new pairs.
- maxSync 4 → 4. The four-way slots are on 41/220/226/269 and 68/689/816/908, whose programme pools are unchanged; the difference is schedule reseeding from the catalogue version change.
- Fallback 49 h → 51 h.
- Owned sources stay home-only.

**Catalogue:** 104,159 → 106,646 programmes; 48,794 → 50,324 h.

**Quota:** about 2,000 units (channel lookups, about 1,000 playlist pages and about 1,000 video batches, later splits and re-filters from cache).

## PASS 18 — LAW / TECHNOLOGY / ARCHIVE / CULTURE

All 21 targets were NEEDS_CONTENT with no programmes in the v37 manifest, so no substitutions were needed. Names follow the manifest. 892 Station Archive sits in the broadcast block (887 Test Card to 897 Closedown), so it is read as broadcast-station archive material, not railway stations.

Sources are official publishers only, found by handle lookups (about 130 `channels.list` probes, no `search.list`). Each new publisher or publisher split is dedicated to one home. Every Pass 18 channel is home-only, so theme-routed publishers do not air there: Computer History Museum, Computerphile and Numberphile stay off the technology channels, Rotten Tomatoes stays off 891, and National Theatre and Globe stay off 844. Catalogue v37 → v38.

**Activated (21 channels):**

| Channel | Sources | Programmes | Hours |
|---|---|---|---|
| 454 Criminal Law | Oxford Law Faculty, Harvard Law School (criminal splits); reuse from Gresham, LegalEagle, Timeline | 84 | 80.7 |
| 455 Civil Law | Harvard and Oxford (civil splits); reuse from Gresham family and civil law lectures, LegalEagle | 39 | 38.3 |
| 456 Human Rights | UN Human Rights, Oxford, UK Supreme Court (human rights cases), Harvard; reuse from Gresham, US National Archives and 4 others | 185 | 208.8 |
| 457 International Law | International Criminal Court (English and untagged hearings), Oxford, Harvard; reuse from Gresham, DW, Timeline, FRONTLINE | 326 | 402.9 |
| 458 Constitutional Law | Harvard, UK Supreme Court (constitutional cases), Oxford; reuse from Gresham, Historia Civilis, Timeline, LegalEagle | 145 | 184.3 |
| 463 Policing History | Huntley Film Archives (police films); reuse from Gresham, Timeline, NFB and 6 archives | 40 | 10.6 |
| 636 Internet | IETF (plenaries, tutorials, IRTF, ANRW), RIPE NCC (talks) | 314 | 440.0 |
| 643 Automation | RealPars | 300 | 46.3 |
| 685 Future Tech | Royal Society, Long Now Foundation, IEEE Spectrum | 135 | 97.6 |
| 686 Inventions | The Henry Ford, Science Museum, National Inventors Hall of Fame | 68 | 7.0 |
| 690 Digital Culture | Berkman Klein Center, Oxford Internet Institute, Folding Ideas, Internet Historian | 619 | 746.7 |
| 691 Tech Interviews | Computer History Museum (oral histories not already catalogued), Dwarkesh Patel (technology episodes), Centre for Computing History (interviews) | 350 | 829.1 |
| 795 Collecting | Sotheby's, Christie's (collection features), The Strong (halls of fame, game preservation) | 158 | 29.4 |
| 798 Everyday Skills | ChrisFix, iFixit, British Red Cross (first aid) | 476 | 91.7 |
| 815 Internet History | Computer History Museum (internet history lectures not already catalogued); reuse from CHM, RIPE NCC history panels and 5 others | 42 | 47.9 |
| 818 Radio History | Huntley Film Archives (radio films), BBC Archive (radio items), ARRL, BVWS; reuse from Oceanliner Designs and BBC Archive | 27 | 4.6 |
| 843 Literature Archive | Lannan Foundation (readings and writers' conversations); reuse of archival author interviews from Thames TV, Dick Cavett, BBC Archive and others | 58 | 45.4 |
| 844 Theatre Archive | American Theatre Wing (Working in the Theatre archive); reuse from Dick Cavett stage interviews and 3 archives | 311 | 349.2 |
| 849 Design Archive | Cooper Hewitt (historic design lectures), Vitra Design Museum, V&A (design history), Eames Office films | 111 | 44.9 |
| 891 Trailers & Promos | Trailers From Hell (filmmaker commentary on trailers) | 900 | 67.9 |
| 892 Station Archive | GBH Archives | 55 | 13.8 |

**Archive distinctness:**
- 843 shares no programmes with 497 Literature. Lannan's political talks are excluded; only readings and conversations with novelists and poets remain.
- 844 shares none with 049 Stage. The American Theatre Wing's recent Master Classes are excluded.
- 891 shares none with the Rotten Tomatoes trailer channels 120, 121 and 136.
- 849 takes historical design only: museum lectures on design history, Eames films and historic collections, not current fashion or costume.
- 818 contains no podcasts.

**Programme reuse (no quota):** `scripts/programme_reuse.py` writes explicit `programmeRoutes` for 454–458, 463, 815, 818, 843 and 844 (118 programmes). `PROGRAMME_REUSE` in `fit.ts` approves each source per channel. Owned sources are not used.

**Source ID collision (fixed):** the International Criminal Court was first acquired as `src_icc`, which is the cricket ICC's source id. The run replaced the 73 cricket rows. The court is now `src_intl_criminal_court`, and the cricket rows and source entry are restored from the pre-pass backup. Cricket routing is identical to v37 (52, 300, 339, 396, 398, 940).

**Rejected after acquisition:**
- Yale Law School: 1 award ceremony.
- Internet Hall of Fame: 1 short video.
- NZ On Screen: 1 video.
- MACE: 4 short items.
- IEEE Spectrum's Radio Spectrum podcast episodes.

Handles not found: National Constitution Center, ICJ, ECHR, Innocence Project, Internet Archive, Library of Congress, Poetry Archive, St John Ambulance, NANOG, APNIC, IEEE History Center and the regional UK screen archives. CBC, RTÉ and TVNZ are general broadcasters and were not used.

**Filtering (from cached API responses):** about 5,450 acquired rows became 4,626 after editorial filtering.
- ICC: floor and non-English audio, French, Spanish, Arabic, Russian and Chinese titles, moot-court competitions, Assembly of States Parties sessions and ceremonies.
- UK Supreme Court: cases that are not constitutional (tax, defamation, extradition).
- Harvard: tributes, IP panels, access-to-justice events and duplicates.
- IETF: raw working-group sessions.
- RIPE: full-day room streams.
- RealPars: Starlink and SQL items.
- Long Now: cosmology and dark-matter talks and non-technology talks.
- Royal Society: universe and climate talks.
- Henry Ford: the female aviators, yule log and non-invention segments.
- Eames: Powers of Ten, Copernicus, Eratosthenes, solar toys, translated duplicates.
- Trailers From Hell: religious epics and space titles.
- GBH: B-roll, space animation and flying footage.
- Christie's and Sotheby's: livestream sales, wine, whisky and sneakers.
- British Red Cross: hashtag shorts.
- Dwarkesh Patel: economics and politics episodes.

**Thin but genuine:**
- 818 Radio History (4.6 h): the catalogue holds very little radio history. ARRL's centennial content is mostly convention speeches (excluded), and BVWS has 12 uploads.
- 686 Inventions (7.0 h): Innovation Nation segments are about 4 minutes each.
- 463 Policing History (10.6 h).

**Audit (audit date 2026-09-29, before and after):**
- On air 666 → 687; NEEDS_CONTENT 174 → 153; no channel lost programming.
- Overlap pairs 543 → 543, with no new pairs.
- maxSync 4 → 3.
- Fallback 51 h → 53 h.
- British Pathé, KOFA and Orbital Bacon stay home-only; 1001+ is untouched.

**Catalogue:** 106,646 → 111,272 programmes; 50,324 → 54,029 h.

**Quota:** about 2,900 units. The first acquisition run used about 2,800, including about 130 channel probes. The re-filter runs used about 100; their playlist pages and video records came from cache, and only handle lookups and the new ARRL uploads scan cost quota.


## PASS 19 — COMPLETE REMAINING CONTENT MAP + PRODUCTION WAVE

**Map:** all 153 channels that were NEEDS_CONTENT at catalogue v38 are listed once in `docs/remaining-content-map-v38.json` / `.md`, each with its identity, scope, distinction, blocker, family, method, candidates, rights risk, expected yield, research group, priority, action and deferral reason. Methods: ACQUIRE_KNOWN 1, ACQUIRE_RESEARCH 8, CURRENT_OR_ROLLING 37, FORMAT_FROM_EXISTING 32, METADATA_ROUTE 19, NO_CREDIBLE_PATH 1, ORIGINAL_REQUIRED 8, REUSE_NOW 38, RIGHTS_BLOCKED 8, SOURCE_SPLIT_NOW 1.

**Production:** 38 channels activated through curated programme-level reuse of the existing catalogue, about 1030 h. No acquisition was run and no API quota was used. Each channel's programmes are listed explicitly in `scripts/pass19_routes.py`; `scripts/programme_reuse.py` validates them against the channel's publisher pool and writes `programmeRoutes`; `fit.ts` marks the channels home-only and lists their pools in `PROGRAMME_REUSE`.

| # | Channel | Status | Programmes | Hours |
|---|---|---|---|---|
| 129 | New Trailers | PLAYABLE | 275 | 13.2 |
| 143 | Creature Features | PLAYABLE | 14 | 22.4 |
| 184 | B-Movies | PLAYABLE_STRONG | 48 | 76.5 |
| 187 | Creature Night | PLAYABLE_STRONG | 10 | 28.3 |
| 192 | Double Feature | PLAYABLE_STRONG | 23 | 65.7 |
| 233 | Anime Cinema | PLAYABLE | 5 | 10.2 |
| 290 | Internet Classics | PLAYABLE | 26 | 12.8 |
| 304 | Football Documentary | PLAYABLE | 38 | 14.6 |
| 306 | Football History | PLAYABLE | 23 | 7 |
| 390 | Sports Science | PLAYABLE | 15 | 6.4 |
| 391 | Sports Medicine | PLAYABLE | 12 | 4.9 |
| 397 | Great Athletes | PLAYABLE_STRONG | 86 | 28.1 |
| 407 | Renaissance | PLAYABLE_STRONG | 69 | 30.9 |
| 418 | African History | PLAYABLE | 39 | 19.3 |
| 424 | Economic History | PLAYABLE | 45 | 14.3 |
| 434 | Nations | PLAYABLE_STRONG | 114 | 42.9 |
| 440 | Deserts | PLAYABLE_STRONG | 41 | 24.4 |
| 449 | World Cultures | PLAYABLE | 24 | 17.5 |
| 469 | Law Extra | PLAYABLE_STRONG | 54 | 66.3 |
| 610 | Marketing | PLAYABLE | 53 | 22.4 |
| 612 | Retail | PLAYABLE | 57 | 23 |
| 624 | Energy Business | PLAYABLE | 45 | 16.8 |
| 625 | Media Business | PLAYABLE | 57 | 21.1 |
| 626 | Sports Business | PLAYABLE_STRONG | 62 | 31.5 |
| 662 | Infrastructure | PLAYABLE_STRONG | 144 | 27.6 |
| 675 | Trucks | PLAYABLE | 19 | 7.1 |
| 697 | Careers | PLAYABLE_STRONG | 81 | 31.8 |
| 717 | Seafood | PLAYABLE_STRONG | 205 | 51.7 |
| 725 | Slow Cooking | PLAYABLE_STRONG | 188 | 51 |
| 726 | Regional Food | PLAYABLE_STRONG | 159 | 33.4 |
| 749 | Health Documentary | PLAYABLE_STRONG | 43 | 30.9 |
| 764 | Landscape | PLAYABLE_STRONG | 113 | 103.5 |
| 767 | Property Life | PLAYABLE | 42 | 13 |
| 778 | Luxury Travel | PLAYABLE | 23 | 9.8 |
| 819 | Tech Archive | PLAYABLE | 26 | 13.4 |
| 837 | Buses | PLAYABLE | 24 | 5.3 |
| 838 | Trams | PLAYABLE | 25 | 6 |
| 882 | Independent TV | PLAYABLE_STRONG | 59 | 24.7 |

**Guards:**
- The horror and cult film channels (141, 142, 143, 183, 184, 187) share no films.
- Renaissance, African History and Economic History stay distinct. So do Internet Classics, Tech Archive and Software History, and the five business channels.
- The format channels 187 and 192 use only existing full-length double bills from film publishers.
- No year channel or public-domain channel is activated.
- No channel lost programming.
- British Pathé stays on 805, KOFA on 114 and Orbital Bacon on 225. ICC cricket routing is unchanged, and the International Criminal Court stays on `src_intl_criminal_court`.

**Source-ID registry:** `scripts/source_registry.py` rejects any id that would name two publishers, a repeated TARGETS entry, and a second unfiltered id for one publisher. Deliberate subject strands with their own filters are allowed. `add_targeted_sources.py` checks the registry before changing the catalogue.

**Wave 2 (families):** 18 more channels activated, about 1,030 h. This wave worked through reuse and format first, then local metadata, then the film-metadata family, then an explicit NFB subset, then targeted acquisition.

| # | Channel | Status | Programmes | Hours | Route |
|---|---|---|---|---|---|
| 628 | Food Business | PLAYABLE | 40 | 10.7 | reuse |
| 085 | Festival | PLAYABLE_STRONG | 228 | 293 | reuse |
| 118 | Family Film | PLAYABLE | 6 | 10 | reuse |
| 563 | Artists | PLAYABLE_STRONG | 85 | 83.5 | reuse |
| 037 | Fantasy | PLAYABLE | 6 | 11.4 | reuse |
| 171 | Cinema 1920s | PLAYABLE_STRONG | 20 | 28.5 | Wikidata year |
| 172 | Cinema 1930s | PLAYABLE_STRONG | 83 | 104.9 | Wikidata year |
| 173 | Cinema 1940s | PLAYABLE_STRONG | 94 | 124.6 | Wikidata year |
| 175 | Cinema 1960s | PLAYABLE_STRONG | 18 | 25.5 | Wikidata year |
| 176 | Cinema 1970s | PLAYABLE | 10 | 14.6 | Wikidata year |
| 111 | Golden Age | PLAYABLE_STRONG | 55 | 76.4 | Wikidata year (1950s) |
| 141 | Classic Horror | PLAYABLE | 18 | 22.7 | Wikidata genre + year |
| 145 | Classic Sci-Fi | PLAYABLE | 17 | 19.7 | Wikidata genre + year |
| 116 | Experimental Film | PLAYABLE | 64 | 8.9 | NFB McLaren/Lambart/Lipsett playlists |
| 188 | Saturday Matinee | PLAYABLE_STRONG | 38 | 51.6 | curated Film Detective |
| 189 | Sunday Cinema | PLAYABLE_STRONG | 57 | 82.8 | curated Film Detective |
| 190 | Late Film | PLAYABLE_STRONG | 25 | 29.4 | curated Film Detective |
| 654 | Chemical Engineering | PLAYABLE_STRONG | 34 | 34.2 | IChemE |

Other channels improved: 103 Classic Film went from 2 to 472 programmes (621 h), 109 Film Noir from 6 to 33, and 110 Silent Cinema from 1 to 20.

**Sources acquired:** `src_film_detective` (470 feature films, 619 h, home 103), `src_nfb_experimental` (53 films from three NFB playlists, home 116) and `src_icheme` (34 lectures, home 654). **Rejected:** `src_lux`, which had under 1 h of actual artworks. Handles not found: ParamountVault, ShoutFactory, MGM, LibraryOfCongress, HAT, AIChE, CinemaTheatreAssociation, EYEFilmmuseum, MoMA, EAI. Kino Lorber and Cohen are mostly trailers. About 125 API units were used, all on the primary key.

**Film metadata:** `scripts/film_years.py` matches films to Wikidata. A match needs an exact label, a film instance, and corroboration from either the title year (equal to P577) or a billed cast member (in P161). It matched 308 programmes (288 films), stored in originals with provenance `wikidata` and cached in `scripts/data/wikidata-film-years.json`. A film joins at most one era channel. P6216 copyright statements are kept only as evidence (`wikidata-film-copyright.json`), because they are US-only and do not establish UK public domain. 087 and 802 therefore stay RIGHTS_BLOCKED.

**Queue:** the 97 channels still NEEDS_CONTENT are in `docs/remaining-content-map-v39.json` / `.md`, which is the authoritative queue. Each channel appears exactly once. Methods: CURRENT_OR_ROLLING 37, FORMAT_FROM_EXISTING 26, METADATA_ROUTE 10, RIGHTS_BLOCKED 10, ORIGINAL_REQUIRED 8, ACQUIRE_RESEARCH 5, NO_CREDIBLE_PATH 1.

**Known overlaps:** 129 New Trailers is a subset of 120 Trailer TV (the current-year weekly compilations, similarity 0.55). 184 B-Movies' MST3K features also air on 119 Midnight Movies (similarity 0.45). Both are below the 0.6 duplicate threshold.

Wave 2 overlaps: the classic-film slots (109, 110, 141, 145, 188, 189, 190) are subsets of 103, and each Film Detective film sits in at most one slot. 085 overlaps 559 Festivals at 0.05, and 563 overlaps 566 at 0.29.

**Catalogue:** 111,829 programmes and 54,688 h (from 111,272 and 54,029 h). 743 channels are on air, and the version is v39.

## PASS 20 — FINISH STATIC CONTENT PRODUCTION (catalogue-v40)

Pass 20 worked through the whole in-house classification queue from the v39 map (METADATA_ROUTE 10, FORMAT_FROM_EXISTING 26, NO_CREDIBLE_PATH 1) and the five research channels (812, 198, 199, 806, 885). Nine channels were activated. Every channel still NEEDS_CONTENT now sits in exactly one final class in `docs/remaining-content-map-v40.json` / `.md`: LIVE_OR_ROLLING 39, OTHER_GENUINE_BLOCKER 26, RIGHTS_BLOCKED 10, ORIGINAL_REQUIRED 8, RESEARCH_UNRESOLVED 5.

| # | Channel | Status | Programmes | Hours | Route |
|---|---|---|---|---|---|
| 027 | People | PLAYABLE | 23 | 21.7 | curated biographies (Timeline, BBC Archive, National Gallery, NFB, BFI, Epic History) |
| 084 | Indie Screen | PLAYABLE | 50 | 21.4 | curated independent shorts, 14 each from Omeleto, ALTER and DUST plus 8 NFB animations |
| 088 | Community | PLAYABLE | 29 | 16.6 | BBC Archive "Voice of the People" collection |
| 089 | Local | PLAYABLE | 25 | 7.4 | curated British town, village and seaside films, disjoint from 088 |
| 090 | Learning | PLAYABLE_STRONG | 52 | 53.7 | curated full lectures, six per institution |
| 292 | Creators | PLAYABLE | 35 | 20.2 | curated creator-owned long-form shows, five per creator |
| 139 | Documentary Trailers | PLAYABLE | 419 | 14.9 | new source `src_dogwoof` (official UK documentary distributor) |
| 544 | 1990s | PLAYABLE | 72 | 5.7 | Wikidata recording years (existing era rule) |
| 547 | 2020s | PLAYABLE | 38 | 3.4 | Wikidata recording years (existing era rule) |

**Curated routes:** the explicit programme lists are in `scripts/pass20_routes.py`. `scripts/programme_reuse.py` validates them into `programmeRoutes`. In `fit.ts`, the channels join `HOME_ONLY_CHANNELS` and gain `PROGRAMME_REUSE` publisher lists. Dedicated publishers stay at home except through these explicit lists.

**Music metadata:** `scripts/music_years.py` matches official videos (90–900 s, no live, remaster, cover or re-recording markers) to Wikidata songs. A match needs the same performer (P175) and an exact normalised title, and takes the earliest P577. It dated 826 of 1,834 candidates. These are stored in originals as `[year, "recording", "wikidata", "VERIFIED", "<QID> <title> P577 <date>, performer <artist>"]` and cached in `scripts/data/wikidata-song-years.json`. Upload year and performer age are never used. The music era limit (two per programme) was not changed. The new years also strengthened 541, 542, 543, 545, 580, 581, 583, 584 and 595–597.

**Decisions recorded:** identity collisions for 134, 191, 323, 325, 326, 327, 394, 616, 548, 549, 564, 729, 769, 799 and 883. Shortfalls below 3 h for 185, 588, 594 and 620. No verifiable metadata for 135, 142, 183, 579, 586 and 589 (only one 1983–86 song carries a synth-pop genre in Wikidata). 582 fails the diversity rule (Radiohead 90%). 550 Chart and 551 New Music move to LIVE_OR_ROLLING. The research channels are unresolved: 812, 198 (clip-only), 199 (Cinema Museum channel about 2.1 h usable), 806 and 885 (ZKM uploads are talks, not artworks).

**Backlog (not fixed in Pass 20):** Some small programme pools can exhaust repeat eligibility across multiple broadcast days and produce later dead air because current repeat rules intentionally prohibit reuse.

**Catalogue:** catalogue-v40, 112,678 programmes and 54,732 h (from 111,829 and 54,688 h). 752 channels are on air (from 743), and NEEDS_CONTENT fell from 97 to 88.

## PASS 21 — LIVE / ROLLING PROVIDER MODEL (catalogue-v41)

Pass 21 moved all 39 LIVE_OR_ROLLING channels from the v40 map onto one provider model. The model is `src/data/dynamic/providers.json` (`dynamic-v1`), and it is written only by `scripts/dynamic_refresh.py` at development or release time. The runtime is keyless. It reads the static config and the catalogue's `published` dates and never calls the YouTube Data API.

Each channel is classified in exactly one mode:

| Mode | Count | Channels |
|---|---|---|
| LIVE_STREAM | 6 | 73, 74, 927, 929, 931, 946 |
| HYBRID_LIVE_ROLLING | 8 | 903, 904, 905, 907, 922, 926, 928, 932 |
| ROLLING_CURRENT | 20 | 551, 895, 902, 906, 911, 912, 913, 917, 919, 930, 933, 934, 936, 938, 939, 941, 942, 943, 944, 947 |
| UNRESOLVED | 5 | 550, 910, 935, 948, 949 |

| # | Channel | Mode | Live service | Window (days) | Status | Programmes | Hours |
|---|---|---|---|---|---|---|---|
| 073 | Business Today | LIVE_STREAM | Yahoo Finance 24/7 | — | PLAYABLE | 0 | 0 |
| 074 | Weather | LIVE_STREAM | WeatherNation Live | — | PLAYABLE | 0 | 0 |
| 551 | New Music | ROLLING_CURRENT | — | 60 | PLAYABLE | 52 | 3 |
| 895 | Weather Maps | ROLLING_CURRENT | — | 30 | PLAYABLE | 16 | 3.1 |
| 902 | US News | ROLLING_CURRENT | — | 7 | PLAYABLE | 186 | 12.2 |
| 903 | Europe News | HYBRID_LIVE_ROLLING | Euronews English Live | 7 | PLAYABLE | 92 | 4.9 |
| 904 | Asia News | HYBRID_LIVE_ROLLING | CNA 24/7 Live | 7 | PLAYABLE | 94 | 7.6 |
| 905 | Africa News | HYBRID_LIVE_ROLLING | Africanews English Live | 7 | PLAYABLE | 112 | 3.2 |
| 906 | Middle East News | ROLLING_CURRENT | — | 7 | PLAYABLE | 84 | 6.8 |
| 907 | Business News | HYBRID_LIVE_ROLLING | Bloomberg Business News Live | 7 | PLAYABLE_STRONG | 125 | 36.5 |
| 911 | World Weather | ROLLING_CURRENT | — | 14 | PLAYABLE | 71 | 4.6 |
| 912 | Current Affairs | ROLLING_CURRENT | — | 14 | PLAYABLE_STRONG | 73 | 54.9 |
| 913 | News Analysis | ROLLING_CURRENT | — | 21 | PLAYABLE_STRONG | 148 | 42.9 |
| 917 | Economy Today | ROLLING_CURRENT | — | 7 | PLAYABLE | 50 | 7.4 |
| 919 | Global Affairs | ROLLING_CURRENT | — | 21 | PLAYABLE_STRONG | 236 | 32.3 |
| 922 | Fox Weather | HYBRID_LIVE_ROLLING | FOX Weather Live | 7 | PLAYABLE | 88 | 6.4 |
| 926 | International News 5 | HYBRID_LIVE_ROLLING | FRANCE 24 English Live | 7 | PLAYABLE | 107 | 9.4 |
| 927 | International News 6 | LIVE_STREAM | TRT World Live | — | PLAYABLE | 0 | 0 |
| 928 | International News 7 | HYBRID_LIVE_ROLLING | WION Live | 7 | PLAYABLE | 67 | 4.7 |
| 929 | International News 8 | LIVE_STREAM | NHK WORLD-JAPAN News Live | — | PLAYABLE | 0 | 0 |
| 930 | US News Network | ROLLING_CURRENT | — | 7 | PLAYABLE | 137 | 10 |
| 931 | European News Network | LIVE_STREAM | DW News Live | — | PLAYABLE | 0 | 0 |
| 932 | Asia-Pacific News | HYBRID_LIVE_ROLLING | ABC News Australia Live | 7 | PLAYABLE | 106 | 6.5 |
| 933 | Africa Report | ROLLING_CURRENT | — | 14 | PLAYABLE | 226 | 23.6 |
| 934 | Middle East Report | ROLLING_CURRENT | — | 10 | PLAYABLE | 98 | 6.7 |
| 936 | World Business | ROLLING_CURRENT | — | 30 | PLAYABLE | 24 | 3.3 |
| 938 | World Science | ROLLING_CURRENT | — | 60 | PLAYABLE | 127 | 14.8 |
| 939 | Environment News | ROLLING_CURRENT | — | 30 | PLAYABLE | 47 | 4.4 |
| 941 | Culture News | ROLLING_CURRENT | — | 30 | PLAYABLE | 80 | 5.6 |
| 942 | Media News | ROLLING_CURRENT | — | 30 | PLAYABLE | 124 | 14.7 |
| 943 | Longform News | ROLLING_CURRENT | — | 180 | PLAYABLE | 23 | 13.6 |
| 944 | News Interviews | ROLLING_CURRENT | — | 60 | PLAYABLE | 30 | 11.7 |
| 946 | Newsroom | LIVE_STREAM | Sky News Live | — | PLAYABLE | 0 | 0 |
| 947 | Headlines | ROLLING_CURRENT | — | 4 | PLAYABLE | 112 | 4.3 |

**Runtime:**
- A verified live stream airs as one listing per broadcast day, titled with the service name.
- If the player reports that the stream failed or is no longer live, the failure is held in session memory only. It is retried after 15 minutes and is never written into a frozen day.
- While a stream is unavailable, a hybrid channel falls back to its rolling pool, and a live-only channel shows the intentional off-air presentation.
- A rolling programme airs on date D only if it was published within the channel's window before D and not after D ends.
- Rolling days carry a `dynamicVersion` and are recompiled when the provider config changes.
- Presence is recorded per date, so an empty day cannot poison later dates.
- Static channels are unchanged.

**Classification:**
- Geographic news is assigned by the regions a title names.
- Topical and format news is assigned by subject and form (analysis, diplomacy, science, environment, culture, media, interviews, full editions of 15 minutes or more, longform of 20 minutes or more, headlines of 6 minutes or less).
- Weather is a separate family with no overlap with news.
- 551 takes only official music videos and visualizers first published by labels within 60 days, excluding remasters, live, lyric and audio versions.
- Each programme joins at most one dynamic channel.
- Space, astronomy, aviation, religious, true-crime and Shorts content is blocked.

**Unresolved (LIVE_OR_ROLLING in the v41 map):**
- 550 Chart: no official chart programme at volume.
- 910 Weather: 1.2 h of Met Office forecasts inside 7 days.
- 935 Americas Report: 2.6 h.
- 948 and 949: no distinct identity.

**Maintenance:** rolling pools age out after release. Run `python3 scripts/dynamic_refresh.py fetch` and then `build` before each release, then regenerate the manifest.

**Catalogue:** catalogue-v41, 115,413 programmes and 55,091 h (from 112,678 and 54,732 h). 786 channels are on air (from 752), measured on 2026-09-28. NEEDS_CONTENT fell from 88 to 54: LIVE_OR_ROLLING 5, OTHER_GENUINE_BLOCKER 26, RIGHTS_BLOCKED 10, ORIGINAL_REQUIRED 8, RESEARCH_UNRESOLVED 5.

## Pass 22: final 000–999 completion

Every one of the 54 channels that were NEEDS_CONTENT in catalogue-v41 now has exactly one outcome. The full record, including the rights records, is in `docs/remaining-content-map-v42.md`; the decisions table is `scripts/pass22_decisions.py`.

| Outcome | Channels |
|---|---|
| Activated from verified material | 19 Archive, 61 Geography Mix, 78 Magazine, 800 Specialist (curated front doors); 564 Bands (Wikidata musical-group performers); 582 Indie 2000 (era membership with the 60% cap kept); 935 Americas Report (rolling, CBC News added) |
| RetroTV presentation | 887 Test Card: an hourly cycle of test card, colour bars, line-up and clock |
| RetroTV original | 898 Night Network: 00:00–04:00 nightly, verified 1987–1992 recordings, one act per night, seeded by date; a card holds the rest of the day |
| Intentionally unavailable (redundant slot, card names the channel that carries it) | 191→119, 325→303, 326→304, 327→313, 394→626, 499→062, 548→540, 616→424, 699→600, 729→700, 769→750, 799→700, 883→292, 948→900, 949→900 |
| Rights-blocked (UK rights not established) | 087, 211, 212, 213, 214, 215, 297, 361, 802, 841 |
| Unresolved, precise class | IDENTITY_COLLISION 134, 323; NEAR_THRESHOLD 185, 594; METADATA_UNAVAILABLE 142, 183, 549, 586, 589; INSUFFICIENT_EXISTING_INVENTORY 135, 588, 620; INSUFFICIENT_INVENTORY 199, 910; NO_OFFICIAL_SOURCE 550, 806, 812, 885; IDENTITY_UNRESOLVED 198; NO_LEGITIMATE_CONTENT_MODEL 579 |

**Mechanism:**
- `src/originals/originals.ts` reads `src/data/originals/originals.json`, which `scripts/originals_build.py` writes from the decisions table.
- The module has two formats. `test-card` is a fixed segment cycle. `night-block` is a date-seeded block drawn from catalogue recordings with a verified original year, excluding owned catalogues and user media.
- The module also holds one presentation card per unavailable, rights-blocked or unresolved channel. The card replaces the bare "Programming resumes soon" holding title with a caption.
- `broadcast()` and `guideSlots()` consult originals before the dynamic and director paths. Channel numbers 1001 and above are never consulted.
- There is no generated media, backend, account or network call.

**Other changes:**
- 61 is the one channel on the general day template. Its three hold blocks (Breakfast, News, Overnight) are now programmed blocks, so the activated channel has no daily blank hours.
- Rolling freshness windows are unchanged. The dynamic config is dynamic-v2 because CBC News was added to 935's publishers.

**Catalogue:** catalogue-v42, 115,473 programmes and 55,098 h. 793 channels are on air (from 786), measured on 2026-09-28. NEEDS_CONTENT fell from 54 to 30: RIGHTS_BLOCKED 10, METADATA_UNAVAILABLE 5, NO_OFFICIAL_SOURCE 4, INSUFFICIENT_EXISTING_INVENTORY 3, IDENTITY_COLLISION 2, NEAR_THRESHOLD 2, INSUFFICIENT_INVENTORY 2, IDENTITY_UNRESOLVED 1, NO_LEGITIMATE_CONTENT_MODEL 1.

## Pass 23: release-candidate hardening

The full record is in `docs/remaining-content-map-v43.md`; the Pass 23 decisions table is `scripts/pass23_decisions.py`.

| Outcome | Channels |
|---|---|
| Final attempt on the 20 non-rights blockers | Every one stays unresolved; the 3 h floor is not lowered. Each map row carries its Pass 23 attempt |
| Legacy placeholders given a real format | 896 Clocks (network clock), 897 Closedown and 999 Closedown (hourly closedown sequences); 099 Preview, 887 Test Card and 894 Teletext keep their formats |
| Legacy placeholders reclassified honestly | 098, 285, 291, 294, 295, 884, 886, 889, 890 are now NEEDS_CONTENT with a stated reason; none has a format of its own |
| Intentionally unavailable | 097 Test Lab, 888 Continuity and 899 Specialist Extra join the 15 Pass 22 redirects |
| Closed by the mandatory exclusion | 829 Flight Deck (aviation), now EXCLUDED |
| Rights-blocked, unchanged | 087, 211, 212, 213, 214, 215, 297, 361, 802, 841 |

**Exclusion:**
- `src/library/exclusions.ts` now covers aviation beside space and religion: a wider title pattern, a reviewed ID list and `excludedChannelName`, which closes 829.
- 217 programmes are removed from 117 channels, 488 placements in all. `docs/exclusion-removals-v43.json` records them, and a test recomputes the list and checks that every removal really is excluded.
- `scripts/catalogue-audit.gen.ts` finds 219 rejected programmes (217 by ID, 2 by title) and 0 still airable. Of the 1,132 broad-pattern matches, 989 are listed for review; each uses the word in another sense.

**Scheduler:**
- A new `rerun` weight costs more than the widest cross-channel affinity spread. Before it, 23 channels with at least a week of material aired well under half their pool across seven days.
- A same-day loop now rotates through the items that fit instead of replaying one clip.
- The fill order tries a cross-day repeat before letting the programme that has just finished run again. The old loop is kept as the last resort, so no channel holds where it did not before.
- The schedule audit's "SCHEDULER" repeat cause fell from 23 channels to 0, and hard once-a-week breaches stay at 0.

**Catalogue:** catalogue-v43, 115,474 programmes and 55,098 h in the manifest; 117,447 rows once the dynamic refresh is included. 792 channels are on air (from 793; 829 closed), counted as in Pass 22 over PLAYABLE_STRONG 478, PLAYABLE 252 and PLAYABLE_THIN 62. RetroTV presentation and original channels are 7 (GENERATED 6, RETROTV_ORIGINAL 1; from 19). NEEDS_CONTENT is 39: the 29 unresolved plus the rights ten.
