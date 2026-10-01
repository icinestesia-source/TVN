#!/usr/bin/env python3
"""
Turns enumerated YouTube discovery records into the shipped RetroTV catalogue.

Uses only the YouTube Data API v3 videos.list endpoint. Nothing is scraped,
downloaded or rehosted. Results are cached, so a rerun resumes where it stopped.

  YOUTUBE_API_KEY=... python3 scripts/validate_youtube_catalogue.py \
    --discovery ~/Desktop/TODO/retrotv-youtube-discovery-bulk.json.jsonl \
    --sources ~/Desktop/TODO/retrotv-youtube-acquisition-sources.json \
    --cache ~/Desktop/TODO/retrotv-youtube-validation-cache.json \
    --pathe ~/Desktop/TODO/retrotv-playable-pathe-v1.json \
    --out public/independent/playable.json
"""
import argparse, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

API = "https://www.googleapis.com/youtube/v3/videos"
EXCLUDED_CHANNELS = {64, 146, 480, 481, 482, 492, 667, 682, 683, 873, 874}
PATHE = "src_british_pathe"
# Aerospace Engineering: aircraft/aerospace programming is not wanted.
UNWANTED_CHANNELS = {655}

BLOCKED = re.compile(
    r"\b(space[\s-]race|spaceflight|space[\s-]flight|space[\s-]station|spacex|astronomy|astronomers?|cosmology|nasa|"
    r"astronauts?|cosmonauts?|satellites?|solar[\s-]system|outer[\s-]space|milky[\s-]way|from space|galax(y|ies)|"
    r"telescopes?|rocket[\s-]launch|moon[\s-]landing|apollo \d+|mars rover|"
    r"sermons?|worship|bible|quran|koran|church service|gospel|hymns?|prayers?|jesus|scripture|psalms?|"
    r"religio(n|us)|ramadan|mosque|synagogue|buddhis[mt]|hindu(ism)?|christianity|islam(ic)?|"
    r"aircraft|airplanes?|aeroplanes?|airliners?|aviation|aerospace|aeronautic(s|al)|jetliners?|helicopters?|"
    r"boeing|airbus|concorde|spitfire|biplanes?|flying boats?|warplanes?|fighter jets?|jet engines?|air shows?)\b",
    re.I,
)

# Demand side: each channel needs roughly this many programmes, shared across the sources the manifest routes to it.
CHANNEL_NEED = 150
MIN_PER_SOURCE = 40
MAX_PER_SOURCE = 900
# Easy-to-enumerate, repetitive material: kept for its channels but weighted down.
MARGINAL = {
    "src_bh_photo", "src_missouri_star", "src_hagerty", "src_motorweek", "src_b1m", "src_practical_engineering",
    "src_computerphile", "src_numberphile", "src_chm", "src_harvard_chan", "src_stanford_health", "src_hasfit",
    "src_yoga_adriene", "src_livenow_fox", "src_nbc_news_now",
}
# Minimum length for sources whose value is full programmes rather than clips.
LONG_FORM = {
    "src_nfb": 480, "src_kofa": 900, "src_mst3k": 900, "src_buzzr": 600, "src_red_green": 600,
    "src_time_team": 600, "src_sky_history_uk": 600, "src_rick_steves": 600, "src_antiques_roadshow_pbs": 300,
    "src_atk": 300, "src_hollyoaks": 600, "src_lol_network": 300, "src_tms_anime": 600, "src_its_anime": 600,
    "src_glitch": 180, "src_royal_institution": 900, "src_noclip": 900, "src_one": 300, "src_wwe": 300,
    "src_top_rank": 300, "src_fifa": 240, "src_world_rugby": 240, "src_icc": 240, "src_fih": 240,
    "src_fivb_archive": 600, "src_kexp": 120, "src_vevo": 120,
}
ISO = re.compile(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def seconds(iso):
    m = ISO.fullmatch(iso or "")
    if not m:
        return 0
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + s


def fetch(key, ids):
    url = API + "?" + urllib.parse.urlencode({
        "part": "contentDetails,status,snippet",
        "id": ",".join(ids),
        "maxResults": 50,
        "key": key,
    })
    last = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as error:
            if error.code == 403:
                raise
            last = error
        except Exception as error:
            last = error
        time.sleep(1.5 * (attempt + 1))
    raise last


def verdict(item):
    """A reason string when the item cannot air, else None."""
    status = item.get("status", {})
    details = item.get("contentDetails", {})
    snippet = item.get("snippet", {})
    if status.get("privacyStatus") != "public":
        return "not public"
    if not status.get("embeddable"):
        return "embedding disabled"
    if snippet.get("liveBroadcastContent", "none") != "none":
        return "live or upcoming"
    if details.get("contentRating", {}).get("ytRating") == "ytAgeRestricted":
        return "age restricted"
    region = details.get("regionRestriction", {})
    if "GB" in region.get("blocked", []) or ("allowed" in region and "GB" not in region["allowed"]):
        return "not available in GB"
    duration = seconds(details.get("duration"))
    if duration < 60:
        return "shorter than a minute"
    if duration > 4 * 3600:
        return "longer than four hours"
    return None


def spread(items, count):
    if len(items) <= count:
        return list(items)
    step = len(items) / count
    return [items[int(i * step)] for i in range(count)]


def channels_for(record, title, routed):
    out = []
    for number in list(record.get("eligibleChannels", [])) + routed.get(record["sourceId"], []):
        n = int(number)
        if n < 0 or n > 999 or n in EXCLUDED_CHANNELS or n in UNWANTED_CHANNELS or n in out:
            continue
        out.append(n)
    return out


def source_quota(source_id, routed, feeders):
    """How many programmes the channels fed by this source need from it."""
    shares = [CHANNEL_NEED / max(1, feeders.get(n, 1)) for n in routed.get(source_id, []) if n not in UNWANTED_CHANNELS]
    need = max(shares, default=0) + 2 * len(shares)
    if source_id in MARGINAL:
        need *= 0.4
    return int(min(MAX_PER_SOURCE, max(MIN_PER_SOURCE, need)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--discovery", required=True)
    ap.add_argument("--sources", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--pathe", required=True, help="previously resolved Pathé records (legacy array)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--manifest", default="src/data/independent/manifest.json")
    args = ap.parse_args()
    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        sys.exit("YOUTUBE_API_KEY is required.")

    names = {s["sourceId"]: s["name"] for s in json.loads(Path(args.sources).read_text())["sources"]}
    routed = {}
    for route in json.loads(Path(args.manifest).read_text())["routes"]:
        if route["strategy"] != "SOURCE_ROUTED":
            continue
        for source_id in route["sourceIds"]:
            routed.setdefault(source_id, []).append(route["number"])
    by_source_count = {}
    for line in Path(args.discovery).read_text().splitlines():
        if line.strip():
            by_source_count[json.loads(line)["sourceId"]] = 1
    feeders = {}
    for source_id, numbers in routed.items():
        if source_id not in by_source_count:
            continue
        for n in numbers:
            feeders[n] = feeders.get(n, 0) + 1
    by_source = {}
    seen = set()
    for line in Path(args.discovery).read_text().splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec["sourceId"] == PATHE or rec["providerItemId"] in seen:
            continue
        seen.add(rec["providerItemId"])
        by_source.setdefault(rec["sourceId"], []).append(rec)

    cache_path = Path(args.cache)
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    report = {}
    rows = []
    for source_id, records in sorted(by_source.items()):
        quota = source_quota(source_id, routed, feeders)
        minimum = LONG_FORM.get(source_id, 60)
        candidates = spread(records, int(quota * (3 if minimum >= 300 else 1.6)))
        pending = [r["providerItemId"] for r in candidates if r["providerItemId"] not in cache]
        for i in range(0, len(pending), 50):
            batch = pending[i:i + 50]
            data = fetch(key, batch)
            found = {item["id"]: item for item in data.get("items", [])}
            for vid in batch:
                item = found.get(vid)
                reason = verdict(item) if item else "unavailable"
                cache[vid] = {"reason": reason, "duration": seconds(item.get("contentDetails", {}).get("duration")) if item else 0}
            cache_path.write_text(json.dumps(cache))
        kept = []
        rejected = {}
        for rec in candidates:
            entry = cache[rec["providerItemId"]]
            title = rec["title"]
            reason = entry["reason"] or ("blocked subject" if BLOCKED.search(title) else None)
            channels = channels_for(rec, title, routed) if not reason else []
            if not reason and not channels:
                reason = "no permitted channel"
            if reason:
                rejected[reason] = rejected.get(reason, 0) + 1
                continue
            kept.append([rec["providerItemId"], title, entry["duration"], channels])
        long_form = [row for row in kept if row[2] >= minimum]
        if len(long_form) >= min(quota, len(kept)) // 2:
            rejected["shorter than programme length"] = len(kept) - len(long_form)
            kept = long_form
        kept = spread(kept, quota)
        report[source_id] = {"enumerated": len(records), "checked": len(candidates), "quota": quota, "kept": len(kept), "rejected": rejected}
        for vid, title, duration, channels in kept:
            rows.append([vid, title, duration, source_id, channels, "api"])
        print(f"{source_id}: quota={quota} checked={len(candidates)} kept={len(kept)}", flush=True)

    pathe = json.loads(Path(args.pathe).read_text())
    pathe_blocked = 0
    for item in pathe:
        if BLOCKED.search(item["title"]):
            pathe_blocked += 1
            continue
        rec = {"sourceId": item["sourceId"], "eligibleChannels": item["explicitChannelIncludes"]}
        channels = channels_for(rec, item["title"], routed)
        rows.append([item["externalId"], item["title"], item["durationSeconds"], item["sourceId"], channels, "player"])
    names[PATHE] = names.get(PATHE, "British Pathé")
    report[PATHE] = {"kept": len(pathe) - pathe_blocked, "blockedSubject": pathe_blocked, "note": "resolved earlier by the IFrame player; not re-resolved"}
    print(f"{PATHE}: kept={len(pathe) - pathe_blocked} blocked subject={pathe_blocked}")

    used = sorted({row[3] for row in rows})
    out = {
        "format": "retrotv-playable-v2",
        "generatedAt": int(time.time() * 1000),
        "sources": {source_id: names.get(source_id, source_id) for source_id in used},
        "items": rows,
    }
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    Path(str(cache_path) + ".report.json").write_text(json.dumps(report, indent=2))
    print(f"items={len(rows)} sources={len(used)} -> {args.out}")


if __name__ == "__main__":
    main()
