"""Record which built-in User Network videos refuse embedded playback.

Acquisition-time only: reads the YouTube Data API key from /tmp (never from the repository) and writes
public/user-network/playback.json with video ids alone. The application reads that file without a key.
"""
import json
import pathlib
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = [ROOT / "public/user-network/channels.txt", ROOT / "public/user-network/more-channels.txt"]
OUT = ROOT / "public/user-network/playback.json"
KEY_FILES = [pathlib.Path("/tmp/.retrotv_key"), pathlib.Path("/tmp/.retrotv_key_fallback")]


def key() -> str:
    for path in KEY_FILES:
        if path.exists():
            return path.read_text().strip()
    raise SystemExit("no acquisition key in /tmp")


def main() -> None:
    ids: list[str] = []
    for path in FILES:
        for channel in json.loads(path.read_text())["channels"]:
            for video in channel.get("videos", []):
                if isinstance(video.get("id"), str) and video["id"] not in ids:
                    ids.append(video["id"])
    secret = key()
    found: dict[str, dict] = {}
    for start in range(0, len(ids), 50):
        query = urllib.parse.urlencode({"part": "status,contentDetails", "id": ",".join(ids[start:start + 50]), "key": secret})
        with urllib.request.urlopen(f"https://www.googleapis.com/youtube/v3/videos?{query}") as response:
            for item in json.load(response).get("items", []):
                found[item["id"]] = item
    refused = []
    for video_id in ids:
        item = found.get(video_id)
        if not item:
            refused.append(video_id)
            continue
        status, region = item["status"], item["contentDetails"].get("regionRestriction", {})
        gb_blocked = "GB" in region.get("blocked", []) or ("allowed" in region and "GB" not in region["allowed"])
        if status.get("privacyStatus") not in ("public", "unlisted") or not status.get("embeddable") or gb_blocked:
            refused.append(video_id)
    OUT.write_text(json.dumps({"checked": time.strftime("%Y-%m-%d"), "videos": len(ids), "embedRefused": refused}, indent=2) + "\n")
    print(f"{len(ids)} videos checked, {len(refused)} refuse embedded playback in the UK")


if __name__ == "__main__":
    main()
