"""Resolve each built-in User Network collection to its YouTube uploader and record that uploader's archive.

Acquisition-time only: reads the YouTube Data API key from /tmp (never from the repository) and writes
public/user-network/uploaders.json with ids, titles, durations and upload dates alone. The application
reads that file without a key. Only videos that play embedded in the UK are kept.
"""
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = [ROOT / "public/user-network/channels.txt", ROOT / "public/user-network/more-channels.txt"]
OUT = ROOT / "public/user-network/uploaders.json"
KEY_FILES = [pathlib.Path("/tmp/.retrotv_key"), pathlib.Path("/tmp/.retrotv_key_fallback")]
ARCHIVE_SCAN = 200
ARCHIVE_KEEP = 120
MIN_SECONDS = 61


def key() -> str:
    for path in KEY_FILES:
        if path.exists():
            return path.read_text().strip()
    raise SystemExit("no acquisition key in /tmp")


def call(endpoint: str, params: dict, secret: str) -> dict:
    query = urllib.parse.urlencode({**params, "key": secret})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(f"https://www.googleapis.com/youtube/v3/{endpoint}?{query}", timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code in (403, 404) and attempt == 0:
                body = error.read().decode("utf8", "replace")
                if "playlistNotFound" in body:
                    return {"items": []}
                raise SystemExit(f"{endpoint}: HTTP {error.code} {re.sub(r'AIza[0-9A-Za-z_-]{20,}', '[REDACTED]', body[:300])}")
            time.sleep(2 * (attempt + 1))
        except urllib.error.URLError:
            time.sleep(2 * (attempt + 1))
    raise SystemExit(f"{endpoint}: gave up")


def seconds(iso: str) -> int:
    match = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    if not match:
        return 0
    d, h, m, s = (int(part or 0) for part in match.groups())
    return ((d * 24 + h) * 60 + m) * 60 + s


def plays_embedded(item: dict) -> bool:
    status, details = item.get("status", {}), item.get("contentDetails", {})
    region = details.get("regionRestriction", {})
    gb_blocked = "GB" in region.get("blocked", []) or ("allowed" in region and "GB" not in region["allowed"])
    live = item.get("snippet", {}).get("liveBroadcastContent", "none") != "none"
    return status.get("privacyStatus") == "public" and bool(status.get("embeddable")) and not gb_blocked and not live


def videos(ids: list[str], secret: str) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for start in range(0, len(ids), 50):
        batch = ids[start:start + 50]
        for item in call("videos", {"part": "snippet,contentDetails,status", "id": ",".join(batch), "maxResults": 50}, secret).get("items", []):
            found[item["id"]] = item
    return found


def main() -> None:
    secret = key()
    collections: list[tuple[str, list[str]]] = []
    for path in FILES:
        for channel in json.loads(path.read_text())["channels"]:
            collections.append((channel["name"], [video["id"] for video in channel.get("videos", []) if isinstance(video.get("id"), str)]))

    export_ids = sorted({video_id for _, ids in collections for video_id in ids})
    export = videos(export_ids, secret)

    owners: dict[str, str] = {}
    titles: dict[str, str] = {}
    report = []
    for name, ids in collections:
        counts: dict[str, int] = {}
        for video_id in ids:
            snippet = export.get(video_id, {}).get("snippet")
            if not snippet:
                continue
            counts[snippet["channelId"]] = counts.get(snippet["channelId"], 0) + 1
            titles[snippet["channelId"]] = snippet["channelTitle"]
        if not counts:
            report.append(f"  {name}: no resolvable videos")
            continue
        owner = max(counts, key=lambda channel_id: counts[channel_id])
        owners[name] = owner
        if len(counts) > 1 or titles[owner].casefold() != name.casefold():
            detail = ", ".join(f"{titles[c]} x{n}" for c, n in sorted(counts.items(), key=lambda kv: -kv[1]))
            report.append(f"  {name}: {detail}")

    uploaders: dict[str, dict] = {}
    for channel_id in sorted(set(owners.values())):
        uploads = "UU" + channel_id[2:]
        ids: list[str] = []
        token = None
        while len(ids) < ARCHIVE_SCAN:
            params = {"part": "contentDetails", "playlistId": uploads, "maxResults": 50}
            if token:
                params["pageToken"] = token
            page = call("playlistItems", params, secret)
            ids += [item["contentDetails"]["videoId"] for item in page.get("items", [])]
            token = page.get("nextPageToken")
            if not token:
                break
        details = videos(ids, secret)
        kept = []
        for video_id in ids:
            item = details.get(video_id)
            if not item or item["snippet"]["channelId"] != channel_id or not plays_embedded(item):
                continue
            duration = seconds(item["contentDetails"].get("duration", ""))
            if duration < MIN_SECONDS:
                continue
            kept.append([video_id, item["snippet"]["title"], duration, item["snippet"]["publishedAt"][:10]])
        kept.sort(key=lambda row: row[3], reverse=True)
        uploaders[channel_id] = {"title": titles[channel_id], "videos": kept[:ARCHIVE_KEEP]}
        print(f"  {titles[channel_id]}: {len(ids)} scanned, {len(kept[:ARCHIVE_KEEP])} kept", file=sys.stderr)

    OUT.write_text(
        json.dumps(
            {"checked": time.strftime("%Y-%m-%d"), "collections": owners, "uploaders": uploaders},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        + "\n"
    )
    print(f"{len(collections)} collections, {len(uploaders)} uploaders, {sum(len(u['videos']) for u in uploaders.values())} archive videos")
    print("Collections whose name or videos differ from a single matching uploader:")
    print("\n".join(report) or "  none")


if __name__ == "__main__":
    main()
