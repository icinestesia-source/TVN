#!/usr/bin/env python3
"""Write src/data/originals/originals.json from scripts/pass22_decisions.py and scripts/pass23_decisions.py.

`channels` holds the deterministic RetroTV originals (no external media for the test card; the
night block reuses verified catalogue recordings). `cards` holds the presentation shown on a channel
that is intentionally unavailable, rights-blocked or unresolved, in place of a blank "Off air".
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pass22_decisions import DECISIONS as P22  # noqa: E402
from pass23_decisions import DECISIONS as P23, FORMATS as P23_FORMATS  # noqa: E402
from decision_identities import DECIDED_FOR  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get("ORIGINALS_OUT") or os.path.join(ROOT, "src/data/originals/originals.json")
VERSION = "originals-v2"

CHANNELS = {
    "887": {
        "kind": "test-card",
        "segments": [
            ["Test Card", "TEST CARD · 1 kHz LINE-UP TONE", 40],
            ["Colour Bars", "COLOUR BARS · 100/0/75/0", 10],
            ["Line-Up", "LINE-UP · GREY SCALE AND CONVERGENCE", 5],
            ["Clock", "RETROTV NETWORK CLOCK", 5],
        ],
        "summary": "RetroTV test card: an hourly cycle of test card, colour bars, line-up and clock; no external media.",
    },
    "898": {
        "kind": "night-block",
        "start": "00:00",
        "hours": 4,
        "from": 1987,
        "to": 1992,
        "basis": "recording",
        "card": ["Night Network", "NIGHT NETWORK · TONIGHT FROM MIDNIGHT"],
        "summary": "RetroTV Night Network: 00:00-04:00 nightly block of verified 1987-1992 recordings.",
    },
}

CAPTION = {
    "RIGHTS_BLOCKED": "OFF AIR · BROADCAST RIGHTS NOT CLEARED",
    "NO_OFFICIAL_SOURCE": "OFF AIR · AWAITING AN OFFICIAL SOURCE",
    "INSUFFICIENT_INVENTORY": "OFF AIR · NOT ENOUGH PROGRAMMES YET",
    "INSUFFICIENT_EXISTING_INVENTORY": "OFF AIR · NOT ENOUGH PROGRAMMES YET",
    "NEAR_THRESHOLD": "OFF AIR · NOT ENOUGH PROGRAMMES YET",
    "METADATA_UNAVAILABLE": "OFF AIR · PROGRAMME DETAILS NOT YET VERIFIED",
    "IDENTITY_COLLISION": "OFF AIR · THESE PROGRAMMES AIR ON OTHER CHANNELS",
    "IDENTITY_UNRESOLVED": "OFF AIR · SERVICE NOT YET DEFINED",
    "NO_LEGITIMATE_CONTENT_MODEL": "OFF AIR · NO SERVICE PLANNED",
    "ORIGINAL_MEDIA_REQUIRED": "OFF AIR · AWAITING RETROTV PRODUCTION",
}

NAMES = {c["number"]: c["name"] for c in json.load(open(os.path.join(ROOT, "src/data/canonical-network.json")))["channels"]}

# A decision made for a channel whose slot now carries another channel is set aside, never applied to the newcomer.
SET_ASIDE = {n for n in {**P22, **P23} if NAMES.get(n) != DECIDED_FOR[n]}
DECISIONS = {n: d for n, d in {**P22, **P23}.items() if n not in SET_ASIDE}
FORMATS = {k: v for k, v in P23_FORMATS.items() if int(k) not in SET_ASIDE}


# Presentation only: what a channel shows while it has nothing to air. These never change a channel's
# manifest status; they replace the generic holding title with an explanation.
PRESENTATION = {
    "EXCLUDED": ("Not carried", "OFF AIR · NOT CARRIED ON RETROTV"),
    "DELIBERATELY_UNAVAILABLE": ("Not broadcasting", "OFF AIR · SUBSCRIPTION OR RIGHTS-HOLDER SERVICE"),
    "NEEDS_LIVE_PROVIDER": ("Not broadcasting", "OFF AIR · AWAITING A LIVE SOURCE"),
    "NEEDS_AUDIO_PROVIDER": ("Not broadcasting", "OFF AIR · AWAITING AN AUDIO SOURCE"),
}
DYNAMIC = {
    "LIVE_STREAM": ("LIVE_INTERRUPTED", "Live service interrupted", "LIVE STREAM UNAVAILABLE · RETRYING SHORTLY"),
    "HYBRID_LIVE_ROLLING": ("LIVE_INTERRUPTED", "Live service interrupted", "LIVE STREAM UNAVAILABLE · RETRYING SHORTLY"),
    "ROLLING_CURRENT": ("DYNAMIC_EMPTY", "No current programmes", "OFF AIR · NO CURRENT PROGRAMMES IN THIS WINDOW"),
}


def presentation(cards):
    manifest = json.load(open(os.path.join(ROOT, "docs/channel-manifest.json")))["records"]
    providers = json.load(open(os.path.join(ROOT, "src/data/dynamic/providers.json")))["channels"]
    for record in manifest:
        key = str(record["number"])
        if key in cards or key in CHANNELS or record["number"] == 0:
            continue
        mode = providers.get(key, {}).get("mode")
        if mode in DYNAMIC:
            cls, title, caption = DYNAMIC[mode]
            cards[key] = {"class": cls, "subtype": mode, "title": title, "caption": caption, "reason": "Shown only while the channel's live stream or rolling window has nothing to air."}
        elif record["status"] in PRESENTATION:
            title, caption = PRESENTATION[record["status"]]
            cards[key] = {"class": "OFF_AIR", "subtype": record["status"], "title": title, "caption": caption, "reason": record["reason"]}


def main():
    cards = {}
    for number, decision in sorted(DECISIONS.items()):
        outcome = decision["outcome"]
        if outcome == "INTENTIONALLY_UNAVAILABLE":
            target = decision["redirect"]
            cards[str(number)] = {
                "class": "INTENTIONALLY_UNAVAILABLE",
                "subtype": decision["subtype"],
                "title": f"See {target:03d} {NAMES[target]}",
                "caption": f"THIS SERVICE IS NOW ON {target:03d}",
                "redirect": target,
                "reason": decision["reason"],
            }
        elif outcome in ("UNRESOLVED", "RIGHTS_BLOCKED"):
            cards[str(number)] = {
                "class": outcome,
                "subtype": decision["subtype"],
                "title": "Not broadcasting",
                "caption": CAPTION[decision["subtype"]],
                "reason": decision["reason"],
            }
    presentation(cards)
    out = {"format": "retrotv-originals-v1", "version": VERSION, "channels": {**CHANNELS, **FORMATS}, "cards": cards}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as handle:
        json.dump(out, handle, indent=1, ensure_ascii=False)
        handle.write("\n")
    for number in sorted(SET_ASIDE):
        print(f"set aside: {number:03d} was decided for {DECIDED_FOR[number]}, now {NAMES.get(number, 'unassigned')}")
    print(f"originals: {len(out['channels'])} channels, {len(cards)} cards -> {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
