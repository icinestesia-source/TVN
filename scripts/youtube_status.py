#!/usr/bin/env python3
"""
Records YouTube's madeForKids and embeddable status for the videos TVN already ships: the catalogue, the
live streams and webcams, and the demonstration films. Metadata only; nothing new is acquired.

Uses the YouTube Data API v3 videos.list endpoint (part=status, 50 ids per request). The key is read from
the environment and never written anywhere. Results are cached outside the project, so a rerun resumes.

  YOUTUBE_API_KEY=... python3 scripts/youtube_status.py
"""
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / "public/independent/playable.json"
PROVIDERS = ROOT / "src/data/dynamic/providers.json"
DEMO = ROOT / "src/data/media.ts"
OUT = ROOT / "public/independent/youtube-status.json"
CACHE = Path("/tmp/tvn-youtube-status-cache.json")
API = "https://www.googleapis.com/youtube/v3/videos"
VIDEO_ID = re.compile(r"^[\w-]{11}$")


class QuotaExhausted(Exception):
    pass


def shipped_ids():
    ids = []
    for row in json.loads(CATALOGUE.read_text())["items"]:
        ids.append(row[0])
    for channel in json.loads(PROVIDERS.read_text())["channels"].values():
        if channel.get("live"):
            ids.append(channel["live"]["videoId"])
        for cam in channel.get("cams", []) or []:
            ids.append(cam["videoId"])
    ids += re.findall(r"videoId:\s*'([\w-]{11})'", DEMO.read_text())
    seen, out = set(), []
    for vid in ids:
        if VIDEO_ID.match(vid or "") and vid not in seen:
            seen.add(vid)
            out.append(vid)
    return out


def fetch(key, batch):
    url = API + "?" + urllib.parse.urlencode({"part": "status", "id": ",".join(batch), "maxResults": 50, "key": key})
    last = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 403:
                raise QuotaExhausted(f"HTTP 403 ({error.reason})")
            last = f"HTTP {error.code}"
        except Exception as error:
            last = type(error).__name__
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"request failed: {last}")


def main():
    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        sys.exit("YOUTUBE_API_KEY is required.")
    ids = shipped_ids()
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    pending = [vid for vid in ids if vid not in cache]
    batches = [pending[i:i + 50] for i in range(0, len(pending), 50)]
    print(f"eligible={len(ids)} cached={len(ids) - len(pending)} requests={len(batches)}", flush=True)
    stopped = None

    def run(batch):
        found = {item["id"]: item.get("status", {}) for item in fetch(key, batch).get("items", [])}
        return {vid: ({"madeForKids": bool(found[vid].get("madeForKids")), "embeddable": bool(found[vid].get("embeddable"))} if vid in found else None) for vid in batch}

    done = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for start in range(0, len(batches), 64):
            try:
                for result in pool.map(run, batches[start:start + 64]):
                    cache.update(result)
                    done += 1
            except (QuotaExhausted, RuntimeError) as error:
                stopped = str(error)
            CACHE.write_text(json.dumps(cache))
            print(f"requests {done}/{len(batches)}", flush=True)
            if stopped:
                break

    resolved = {vid: cache[vid] for vid in ids if vid in cache and cache[vid] is not None}
    missing = [vid for vid in ids if vid in cache and cache[vid] is None]
    unprocessed = [vid for vid in ids if vid not in cache]
    doc = {
        "format": "tvn-youtube-status-v1",
        "checkedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "eligible": len(ids),
        "resolved": len(resolved),
        "madeForKids": sorted(vid for vid, status in resolved.items() if status["madeForKids"]),
        "notEmbeddable": sorted(vid for vid, status in resolved.items() if not status["embeddable"]),
        "notReturned": sorted(missing),
        "unprocessed": len(unprocessed),
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")))
    print(
        f"eligible={len(ids)} resolved={len(resolved)} madeForKids={len(doc['madeForKids'])} "
        f"notEmbeddable={len(doc['notEmbeddable'])} notReturned={len(missing)} unprocessed={len(unprocessed)}"
        + (f" stopped: {stopped}" if stopped else ""),
        flush=True,
    )


if __name__ == "__main__":
    main()
