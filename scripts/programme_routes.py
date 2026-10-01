"""Programme-level routing: pick individual catalogue programmes for channels no single publisher fits.

Each route names one channel and the video ids chosen for it. Only BROAD sources (neither
DEDICATED nor OWNED in fit.ts) may be routed. A programme is reused only while it airs on at
most MAX_ON channels in the baseline audit, and never on two new routes, so reuse cannot
deepen network-wide duplication. Routes are written to playable.json after each channel.

usage: python3 scripts/programme_routes.py BASELINE_AUDIT.json [channel ...]
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / "public/independent/playable.json"
FIT = ROOT / "src/director/fit.ts"
MAX_ON = 3

EXCLUDED = re.compile(
    r"\b(space|astronauts?|nasa|rockets?|satellites?|planets?|mars|moon|lunar|galax\w*|cosmo\w*|universe|"
    r"black holes?|stars?|telescopes?|astronom\w*|spacex|orbit\w*|aircraft|airplanes?|aeroplanes?|planes?|"
    r"aviation|jets?|pilots?|airports?|helicopters?|flights?|flying|fighters?|bombers?|luftwaffe|raf|spitfires?|"
    r"zeppelins?|airships?|paratroop\w*|parachut\w*|air force|air raids?|church|god|jesus|bible|prayers?|"
    r"sermons?|worship|christian|islam|muslim|mosque)\b",
    re.I,
)

MILITARY = r"\b(war|wars|battle|nazis?|hitler|soldiers?|army|navy|naval|u-boats?|military|weapons?|bombs?|warheads?|stalin|reich|ww[12i]+|wartime|troops|invasion|siege|atomic|overlord|d-day|holocaust|schindler|gestapo|auschwitz|blitz|resistance|spies|spy|churchill|commandos?|victory)\b"
ARCHAEOLOGY = r"archaeolog|archeolog|excavat|mumm(y|ies)|tombs?\b|henge|pyramid|lost city|lost civili|ancient|\bdig\b|buried|burials?"

# Order matters: a programme goes to the first route that accepts it.
ROUTES = [
    {"channel": 63, "name": "Discovery", "sources": ["src_timeline"], "min": 1200, "include": ARCHAEOLOGY,
     "why": "archaeological discovery documentaries"},
    {"channel": 262, "name": "Longform", "sources": ["src_timeline", "src_noclip"], "min": 5400,
     "exclude": r"fall asleep|\bfacts\b|\d\+ hours",
     "why": "feature-length documentaries (90 min and over)"},
    {"channel": 62, "name": "Knowledge", "sources": ["src_timeline"], "min": 2700, "max": 5399, "max_on": 1,
     "exclude": MILITARY, "why": "single-film social, cultural and biographical history documentaries"},
    {"channel": 54, "name": "Motor Mix", "sources": ["src_hagerty", "src_motorweek"], "min": 480,
     "why": "motoring magazine segments, reviews and restoration films"},
    {"channel": 399, "name": "Sport Extra", "sources": ["src_wtt", "src_fivb_archive", "src_fih", "src_iihf", "src_world_rugby", "src_pdc", "src_nfl_films"],
     "min": 2400, "max_on": 2, "include": r"full match|full game|classic", "exclude": r"^live\b|live!", "source_hours": 18,
     "why": "extended full-match and final replays that air only on their own sport's channel"},
]


def protected_sources() -> set[str]:
    text = FIT.read_text()
    dedicated = set(re.findall(r"^\s+(src_\w+): \[[\d, ]+\],", text, re.M))
    owned = set(re.findall(r"\['(src_\w+)', \d+\]", text))
    return dedicated | owned


def airing_counts(audit_path: str) -> dict[str, int]:
    audit = json.loads(Path(audit_path).read_text())
    counts: dict[str, int] = {}
    for row in audit["rows"]:
        if row.get("st") in ("active", "thin"):
            for item_id in row["ids"]:
                counts[item_id] = counts.get(item_id, 0) + 1
    return counts


def main() -> None:
    audit_path, *only = sys.argv[1:]
    wanted = {int(number) for number in only}
    doc = json.loads(CATALOGUE.read_text())
    protected = protected_sources()
    on = airing_counts(audit_path)
    routes: dict[str, list[str]] = doc.get("programmeRoutes", {})
    classes: dict[str, str] = doc.get("sourceClasses", {})
    rebuilt = wanted or {route["channel"] for route in ROUTES}
    taken = {video for channel, ids in routes.items() for video in ids if int(channel) not in rebuilt}
    for route in ROUTES:
        if wanted and route["channel"] not in wanted:
            continue
        bad = [source for source in route["sources"] if source in protected]
        if bad:
            print(f"{route['channel']:03d} {route['name']}: refused, dedicated/owned sources {bad}")
            continue
        chosen = []
        source_seconds: dict[str, int] = {}
        for video, title, seconds, source, *_ in doc["items"]:
            if source not in route["sources"] or video in taken:
                continue
            if not (route.get("min", 0) <= seconds <= route.get("max", 10**9)):
                continue
            if EXCLUDED.search(title) or on.get(f"yt:{video}", 0) > route.get("max_on", MAX_ON):
                continue
            if "include" in route and not re.search(route["include"], title, re.I):
                continue
            if "exclude" in route and re.search(route["exclude"], title, re.I):
                continue
            if "source_hours" in route and source_seconds.get(source, 0) + seconds > route["source_hours"] * 3600:
                continue
            source_seconds[source] = source_seconds.get(source, 0) + seconds
            chosen.append((video, seconds, source))
        hours = sum(seconds for _, seconds, _ in chosen) / 3600
        if hours < 3:
            print(f"{route['channel']:03d} {route['name']}: {len(chosen)} programmes, {hours:.1f} h; below 3 h, not routed")
            routes.pop(str(route["channel"]), None)
            continue
        routes[str(route["channel"])] = [video for video, _, _ in chosen]
        taken.update(routes[str(route["channel"])])
        for source in {source for _, _, source in chosen}:
            classes[source] = "BROAD_PROGRAMME_ROUTED"
        doc["programmeRoutes"] = routes
        doc["sourceClasses"] = classes
        CATALOGUE.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
        per_source = {}
        for _, seconds, source in chosen:
            count, total = per_source.get(source, (0, 0))
            per_source[source] = (count + 1, total + seconds)
        detail = ", ".join(f"{source} {count}/{total / 3600:.1f} h" for source, (count, total) in sorted(per_source.items()))
        print(f"{route['channel']:03d} {route['name']}: routed {len(chosen)} programmes, {hours:.1f} h ({detail}) - {route['why']}")


if __name__ == "__main__":
    main()
