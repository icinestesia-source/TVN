"""Pass 22 outcome for every channel that was NEEDS_CONTENT in catalogue-v41.

One record per channel. `outcome` is the final disposition; `subtype` is the precise blocker class.
scripts/originals_build.py turns this table into src/data/originals/originals.json (runtime
presentation) and the remaining-content map reads it for the unresolved records.

Outcomes:
  ACTIVATED                 programmed from verified catalogue material (curated, era or rolling)
  GENERATED_PRESENTATION    RetroTV presentation channel, deterministic, no external media
  RETROTV_ORIGINAL          deterministic RetroTV-compiled programme block
  INTENTIONALLY_UNAVAILABLE redundant slot; its identity is already another channel's
  UNRESOLVED                stays NEEDS_CONTENT with a precise blocker class
  RIGHTS_BLOCKED            stays off air until UK rights are established
"""

# v41 group each channel came from.
V41_GROUP = {
    **{n: "OTHER_GENUINE_BLOCKER" for n in (134, 135, 142, 183, 185, 191, 323, 325, 326, 327, 394, 548, 549, 564, 579, 582, 586, 588, 589, 594, 616, 620, 769, 883)},
    **{n: "RIGHTS_BLOCKED" for n in (87, 211, 212, 213, 214, 215, 297, 361, 802, 841)},
    **{n: "ORIGINAL_REQUIRED" for n in (19, 61, 78, 499, 699, 800, 887, 898)},
    **{n: "RESEARCH_UNRESOLVED" for n in (198, 199, 806, 812, 885)},
    **{n: "LIVE_OR_ROLLING" for n in (550, 910, 935, 948, 949)},
}


def act(subtype, reason, how):
    return {"outcome": "ACTIVATED", "subtype": subtype, "reason": reason, "mechanism": how}


def redundant(subtype, target, reason):
    return {"outcome": "INTENTIONALLY_UNAVAILABLE", "subtype": subtype, "redirect": target, "reason": reason}


def open_(subtype, reason, evidence):
    return {"outcome": "UNRESOLVED", "subtype": subtype, "reason": reason, "evidence": evidence}


def rights(desired, provenance, problem, jurisdiction, alternative):
    return {
        "outcome": "RIGHTS_BLOCKED",
        "subtype": "RIGHTS_BLOCKED",
        "reason": problem,
        "rights": {
            "desired": desired,
            "provenance": provenance,
            "problem": problem,
            "jurisdiction": jurisdiction,
            "ukUseEstablished": False,
            "alternative": alternative,
        },
    }


DECISIONS = {
    # ---- 26 OTHER_GENUINE_BLOCKER -------------------------------------------------------------
    564: act("METADATA_UNAVAILABLE", "Bands: one official video per act whose Wikidata performer is a musical group (P31/P279* Q215380).", "curated route from Wikidata performer class (scripts/data/wikidata-song-performers.json)"),
    582: act("DIVERSITY_FAILURE", "Indie 2000 met the 3 h floor only with Radiohead above the 60% cap; the dominant act's longest programmes are dropped until it is at or under 60%, keeping the cap.", "era membership with share enforcement (eraMembership)"),
    134: open_("IDENTITY_COLLISION", "Cult Trailers: every free trailer publisher already feeds 891 Trailers & Promos and the trailer-genre channels, and no structured field marks a trailer as cult; a subset would clone 891.", "No dated classic-trailer publisher distinct from the 891 sources."),
    135: open_("INSUFFICIENT_EXISTING_INVENTORY", "Only 55 trailers carry a Wikidata Animation genre, 1.9 h; the 3 h floor is not lowered.", "trailerGenres Animation: 55 items, 1.91 h."),
    142: open_("METADATA_UNAVAILABLE", "No structured genre or date metadata identifies this identity's films; titles are never used to infer it.", "No Wikidata genre match within the free film publishers."),
    183: open_("METADATA_UNAVAILABLE", "No structured metadata identifies qualifying programmes; nothing is inferred from titles or upload dates.", "No Wikidata or publisher field for the identity."),
    185: open_("NEAR_THRESHOLD", "2.4 h of qualifying programming; one targeted attempt found no further official material, and the 3 h floor stays.", "Targeted search of existing publishers: no additions."),
    191: redundant("DUPLICATE_FRONT_DOOR", 119, "Same identity as 119 Midnight Movies; its 586 eligible programmes are the film inventory 100 Film and 119 already air."),
    323: open_("IDENTITY_COLLISION", "The only World Cup publisher (FIFA) is the whole of 301 Football; a distinct pool would mean restructuring 301.", "src_fifa feeds 301; no second official World Cup archive."),
    325: redundant("DUPLICATE_FRONT_DOOR", 303, "Same name and identity as 303 Football Classics; its eligible programmes are the sport inventory 300 and 303 already air."),
    326: redundant("DUPLICATE_FRONT_DOOR", 304, "Same name and identity as 304 Football Documentary; its eligible programmes are the sport inventory 300 and 304 already air."),
    327: redundant("DUPLICATE_FRONT_DOOR", 313, "Same name and identity as 313 Football Analysis; its eligible programmes are the sport inventory 300 and 313 already air."),
    394: redundant("DUPLICATE_FRONT_DOOR", 626, "Same name and identity as 626 Sports Business; its eligible programmes are the inventory 300 and 626 already air."),
    548: redundant("IDENTITY_COLLISION", 540, "Oldies before 1970 is exactly the union of 540 1950s and 541 1960s."),
    549: open_("METADATA_UNAVAILABLE", "No chart-position metadata for the recordings; chart status is never inferred from titles.", "Wikidata carries no reliable chart property for the catalogue's songs."),
    579: open_("NO_LEGITIMATE_CONTENT_MODEL", "Rarity cannot be verified from any official field; an unverifiable label is not programmed.", "No publisher or Wikidata field marks a recording as rare."),
    586: open_("METADATA_UNAVAILABLE", "Epitaph's official videos with verified release years are dated 2014-2021; none are 1990s.", "originals: 0 Epitaph recordings dated 1990-1999."),
    588: open_("INSUFFICIENT_EXISTING_INVENTORY", "0.1 h of verified qualifying material.", "One qualifying recording."),
    589: open_("METADATA_UNAVAILABLE", "No song-level genre metadata for the recordings; publisher genre is not song genre.", "Wikidata genre coverage below one programme block."),
    594: open_("NEAR_THRESHOLD", "2.49 h of VEVO recordings with verified 1950-79 years; non-VEVO sources cannot count, and the floor stays at 3 h.", "originals: VEVO 1950-1979 = 2.49 h."),
    616: redundant("DUPLICATE_FRONT_DOOR", 424, "Same name and identity as 424 Economic History; its eligible programmes are the history inventory 400 and 424 already air."),
    620: open_("INSUFFICIENT_EXISTING_INVENTORY", "2.9 h of eligible programmes, most of it already the identity of 767 Property Life.", "Distinct remainder below 3 h."),
    883: redundant("DUPLICATE_FRONT_DOOR", 292, "Creator TV is the identity of 292 Creators; its eligible programmes are already aired by 277 and 292."),
    769: redundant("DUPLICATE_FRONT_DOOR", 750, "Overflow slot of the home family; 750 Home carries the identity."),
    # ---- 8 ORIGINAL_REQUIRED -----------------------------------------------------------------
    19: act("ORIGINAL_REQUIRED", "Archive: a curated front-door compilation, 26 curated archive programmes (BBC Archive, Thames, Carson, Cavett) disjoint from every other curated list.", "curated route (scripts/pass22_routes.py)"),
    61: act("ORIGINAL_REQUIRED", "Geography Mix: a curated front-door compilation, 23 curated programmes from seven geography publishers.", "curated route (scripts/pass22_routes.py)"),
    78: act("ORIGINAL_REQUIRED", "Magazine: a curated front-door compilation of This Morning and the BBC magazine strands (Tonight, Nationwide, Tomorrow's World, Wogan, Film 93).", "curated route (scripts/pass22_routes.py)"),
    499: redundant("DUPLICATE_FRONT_DOOR", 62, "Knowledge Extra would repeat 062 Knowledge's aggregate; no distinct format."),
    699: redundant("DUPLICATE_FRONT_DOOR", 600, "Business Extra would repeat 600 Business; no distinct format."),
    800: act("ORIGINAL_REQUIRED", "Specialist: a curated front-door compilation, 34 curated programmes from 17 specialist home publishers.", "curated route (scripts/pass22_routes.py)"),
    887: {"outcome": "GENERATED_PRESENTATION", "subtype": "ORIGINAL_REQUIRED", "reason": "Test Card: an hourly cycle of test card, colour bars, line-up and clock, generated by RetroTV.", "mechanism": "originals: test-card"},
    898: {"outcome": "RETROTV_ORIGINAL", "subtype": "ORIGINAL_REQUIRED", "reason": "Night Network: a nightly 00:00-04:00 block of verified 1987-1992 recordings, one per act per night, seeded by date.", "mechanism": "originals: night-block"},
    # ---- 5 RESEARCH_UNRESOLVED ---------------------------------------------------------------
    198: open_("IDENTITY_UNRESOLVED", "Only short clips exist for the identity; no programme-length official source.", "Final bounded search: clips only."),
    199: open_("INSUFFICIENT_INVENTORY", "The Cinema Museum has about 2.1 h usable and the Projected Picture Trust two videos; no CTA channel; Pathé stays 805-only.", "Final bounded search: under 3 h."),
    806: open_("NO_OFFICIAL_SOURCE", "No official or authorised publisher for the identity.", "Final bounded search: none."),
    812: open_("NO_OFFICIAL_SOURCE", "No arcade museum publisher; 242 Arcade already holds the available arcade material.", "Final bounded search: none."),
    885: open_("NO_OFFICIAL_SOURCE", "No official or authorised publisher for the identity.", "Final bounded search: none."),
    # ---- 5 LIVE_OR_ROLLING -------------------------------------------------------------------
    550: open_("NO_OFFICIAL_SOURCE", "No official chart programme at volume: Official Charts posts about a minute a week and Billboard's are Shorts, which are not used for volume.", "Final chart attempt: no qualifying rolling pool."),
    910: open_("INSUFFICIENT_INVENTORY", "Weather-only reporting from official publishers is 1.2 h inside the window; the window is not extended.", "dynamic-v2 build: 1.2 h."),
    935: act("NEAR_THRESHOLD", "Americas Report: CBC News added to the international publishers; 6.4 h of Americas reporting inside the window.", "rolling (dynamic-v2)"),
    948: redundant("DUPLICATE_FRONT_DOOR", 900, "News Extra has no editorial definition distinct from 900 News."),
    949: redundant("DUPLICATE_FRONT_DOOR", 900, "Information has no editorial definition distinct from 900 News and 894 Teletext."),
    # ---- 10 RIGHTS_BLOCKED -------------------------------------------------------------------
    87: rights(
        "Feature films and television in the public domain.",
        "Wikidata copyright status (P6216) on classic films in the catalogue; every determination found is for the United States.",
        "Public-domain status is recorded only for the US (non-renewal or pre-1929 publication). UK term is 70 years from the death of the last of director, screenwriter, dialogue author and composer, and is not established for any title.",
        "US determination only; UK not established.",
        "None defensible. Classic films already air on film channels from their own free distributors without any public-domain claim.",
    ),
    802: rights(
        "Public-domain archive film.",
        "As 087: US-only copyright determinations.",
        "US public-domain status does not establish UK public-domain status; no title has a UK determination.",
        "US determination only; UK not established.",
        "None; archive film airs on 805 (British Pathé, owned) and the archive channels.",
    ),
    211: rights(
        "Complete classic television drama serials.",
        "No rightsholder publishes complete classic drama serials free and embeddable in the UK.",
        "Rights sit with broadcasters and distributors; the only full uploads are unofficial and are not used.",
        "UK broadcaster/distributor rights; no free authorised release.",
        "210 Drama carries the available official material; a subset would clone it.",
    ),
    212: rights(
        "Complete crime drama serials.",
        "No official free UK-embeddable publisher of complete crime drama.",
        "Rights held by broadcasters and distributors; unofficial uploads are not used.",
        "UK broadcaster/distributor rights; no free authorised release.",
        "210 Drama carries the available official material.",
    ),
    213: rights(
        "Complete detective drama serials.",
        "No official free UK-embeddable publisher of complete detective drama.",
        "Rights held by broadcasters and distributors; unofficial uploads are not used.",
        "UK broadcaster/distributor rights; no free authorised release.",
        "210 Drama carries the available official material.",
    ),
    214: rights(
        "Complete mystery drama serials.",
        "No official free UK-embeddable publisher of complete mystery drama.",
        "Rights held by broadcasters and distributors; unofficial uploads are not used.",
        "UK broadcaster/distributor rights; no free authorised release.",
        "210 Drama carries the available official material.",
    ),
    215: rights(
        "Complete thriller drama serials.",
        "No official free UK-embeddable publisher of complete thriller drama.",
        "Rights held by broadcasters and distributors; unofficial uploads are not used.",
        "UK broadcaster/distributor rights; no free authorised release.",
        "210 Drama carries the available official material.",
    ),
    297: rights(
        "Fan films set in established franchises.",
        "Creator uploads of fan productions.",
        "The underlying characters and worlds belong to third parties; no publisher shows a licence from the franchise owner.",
        "Franchise IP owners (worldwide, including UK); no licence established.",
        "None.",
    ),
    361: rights(
        "Complete classic cricket matches.",
        "The ICC channel publishes highlights (already routed, unchanged); boards and broadcasters hold full-match rights.",
        "No rightsholder publishes full classic matches free and embeddable in the UK; unofficial uploads are not used.",
        "ICC, ECB and broadcaster rights; no free authorised full-match release.",
        "ICC highlights on the existing cricket channels.",
    ),
    841: rights(
        "Complete audiobooks.",
        "LibriVox volunteer readings.",
        "LibriVox checks US public-domain status only; UK status of each text and translation is not established, and audio needs a separate provider.",
        "US determination only; UK not established.",
        "None.",
    ),
}

assert set(DECISIONS) == set(V41_GROUP), set(DECISIONS) ^ set(V41_GROUP)
assert len(DECISIONS) == 54
