"""Pass 23 outcomes: the placeholder channels that carried an original or generated label without a format.

Same record shape as scripts/pass22_decisions.py. Formats for the channels that gained one live in
FORMATS; scripts/originals_build.py merges both tables into src/data/originals/originals.json.
"""

# Status each channel carried in catalogue-v42.
V42_STATUS = {
    **{n: "RETROTV_ORIGINAL" for n in (98, 99, 285, 291, 294, 295, 899)},
    **{n: "GENERATED" for n in (97, 884, 886, 888, 889, 890, 894, 896, 897, 999)},
}

# The channels RetroTV's listings services page through: the category homes that are on air.
LISTED = [1, 100, 200, 300, 400, 500, 600, 700, 900]

FORMATS = {
    "896": {
        "kind": "test-card",
        "clock": True,
        "segments": [["RetroTV Network Clock", "NETWORK TIME · RETROTV", 60]],
        "summary": "RetroTV network clock: the time, all day; no external media.",
    },
    "897": {
        "kind": "test-card",
        "programmeType": "closedown",
        "segments": [
            ["Closedown", "THAT'S ALL FROM RETROTV · GOODNIGHT", 10],
            ["Test Card", "PLEASE SWITCH OFF YOUR SET", 40],
            ["Tuning Signal", "NORMAL SERVICE RESUMES ON THE REST OF THE DIAL", 10],
        ],
        "summary": "RetroTV closedown: an hourly closedown sequence of cards; no external media.",
    },
    "999": {
        "kind": "test-card",
        "programmeType": "closedown",
        "segments": [
            ["Closedown", "THAT'S ALL FROM RETROTV RADIO · GOODNIGHT", 10],
            ["Interval", "THE END OF THE DIAL", 50],
        ],
        "summary": "RetroTV radio closedown at the end of the dial; no external media.",
    },
    "894": {
        "kind": "listings",
        "mode": "now",
        "title": "Teletext: Now on RetroTV",
        "channels": LISTED,
        "seconds": 20,
        "summary": "RetroTV teletext: pages of what each category home is airing now, read from the live schedules.",
    },
    "99": {
        "kind": "listings",
        "mode": "next",
        "title": "Preview: Coming up on RetroTV",
        "channels": LISTED,
        "seconds": 20,
        "summary": "RetroTV preview: pages of what comes next on each category home, read from the live schedules.",
    },
}


def fmt(outcome, subtype, reason, **extra):
    return {"outcome": outcome, "subtype": subtype, "reason": reason, **extra}


DECISIONS = {
    896: fmt("GENERATED_PRESENTATION", "FORMAT_DEFINED", "Clocks: a network clock is a defined RetroTV presentation; the card shows the network time."),
    897: fmt("GENERATED_PRESENTATION", "FORMAT_DEFINED", "Closedown: a closedown sequence of RetroTV cards."),
    999: fmt("GENERATED_PRESENTATION", "FORMAT_DEFINED", "Radio closedown at the end of the dial (catalogue seed: 'The end of the dial. A closedown sequence on the clock.')."),
    894: fmt("GENERATED_PRESENTATION", "FORMAT_DEFINED", "Teletext carried television listings; the pages read what each category home airs now from the same schedules the player uses."),
    99: fmt("GENERATED_PRESENTATION", "FORMAT_DEFINED", "Preview: what comes next on each category home, from the same schedules the player uses."),
    97: fmt("INTENTIONALLY_UNAVAILABLE", "DUPLICATE_FRONT_DOOR", "Test Lab's only supportable form is a test card, which 887 Test Card already is.", redirect=887),
    888: fmt("INTENTIONALLY_UNAVAILABLE", "DUPLICATE_FRONT_DOOR", "Continuity (what is on, what is next) is the listings service on 894; no separate continuity media exists.", redirect=894),
    899: fmt("INTENTIONALLY_UNAVAILABLE", "DUPLICATE_FRONT_DOOR", "Specialist Extra would repeat 800 Specialist; no distinct format.", redirect=800),
    889: fmt("UNRESOLVED", "ORIGINAL_MEDIA_REQUIRED", "Idents need RetroTV-produced ident films; none exist, and archive idents are broadcasters' property."),
    890: fmt("UNRESOLVED", "NO_OFFICIAL_SOURCE", "Retro adverts need an official advertising archive (see 806); RetroTV has no advertising system."),
    884: fmt("UNRESOLVED", "IDENTITY_UNRESOLVED", "No repository evidence defines what Experimental would air."),
    886: fmt("UNRESOLVED", "IDENTITY_UNRESOLVED", "No repository evidence defines Generative; generative-AI programming is excluded."),
    98: fmt("UNRESOLVED", "IDENTITY_UNRESOLVED", "No repository evidence defines what Showcase would feature distinct from the main-network mixes."),
    285: fmt("UNRESOLVED", "INSUFFICIENT_EXISTING_INVENTORY", "Titles naming magic are mostly unrelated (sketch shows, music, antiques); verified magic performance is under 3 h."),
    291: fmt("UNRESOLVED", "NO_OFFICIAL_SOURCE", "Viral clips circulate as third-party re-uploads; catalogue hits are news items about virality, not the clips."),
    295: fmt("UNRESOLVED", "NO_LEGITIMATE_CONTENT_MODEL", "Reaction videos are built on third-party footage; no reaction format rests on official material."),
    294: fmt("UNRESOLVED", "IDENTITY_COLLISION", "Review programmes exist (tech, motoring, coffee) but each is already the identity of its subject channel; a Reviews mix would be a front door with no editorial definition."),
}

assert set(DECISIONS) == set(V42_STATUS), set(DECISIONS) ^ set(V42_STATUS)
assert {str(n) for n, d in DECISIONS.items() if d["outcome"] == "GENERATED_PRESENTATION"} == set(FORMATS)

# Pass 23 final attempt on the 20 non-rights blockers, against the existing approved source universe only.
# None changed outcome; each note records what was re-measured or why the class is structural.
ATTEMPTS = {
    134: "Structural: every free trailer publisher already feeds 891 and the genre trailer channels; no field marks a trailer as cult.",
    323: "Structural: src_fifa is the whole of 301 Football; no second official World Cup archive exists in the registry.",
    185: "No film publisher has entered the registry since the Pass 22 targeted search; 2.4 h stands and the 3 h floor is kept.",
    594: "Re-measured: VEVO recordings with VERIFIED 1950-1979 years total 2.8 h before exclusions; 3.2 h more rests only on inferred title years, which are not accepted.",
    142: "Film genre table offers Horror but no Gothic sub-genre; titles are not used to infer it.",
    183: "No structured cult-status field in Wikidata genres or publisher metadata.",
    549: "No chart-position property for the catalogue's recordings.",
    586: "Pass 22 measurement stands: 0 Epitaph recordings with verified 1990-1999 years; no punk publisher added since.",
    589: "Song-level genre coverage remains below one programme block; publisher genre is not song genre.",
    135: "Re-measured: trailers with a Wikidata Animation genre: 55 items, 1.91 h.",
    588: "Pass 22 measurement stands: one qualifying recording; song genre cannot be taken from the publisher.",
    620: "Distinct remainder after 767 Property Life's identity stays under 3 h.",
    199: "Cinema Museum about 2.1 h plus two Projected Picture Trust videos; Pathé stays 805-only.",
    910: "Weather-only official reporting inside the unchanged freshness window stays under 3 h.",
    550: "Official Charts posts about a minute a week; Billboard's chart videos are Shorts, which are not used for inventory.",
    806: "No official advertising-archive publisher in the source registry.",
    812: "No arcade museum publisher; 242 Arcade holds the available arcade material.",
    885: "No official video-art publisher in the source registry.",
    198: "Only short clips exist; no programme-length official source.",
    579: "No official field marks a recording as rare.",
}
