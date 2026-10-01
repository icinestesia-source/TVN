#!/usr/bin/env python3
"""TVN source register: where each catalogue source comes from, generated, never hand-written.

Writes public/independent/sources.json from records TVN already keeps:

  public/independent/playable.json     catalogue source ids and publisher names
  add_targeted_sources.TARGETS         the YouTube @handle or channel id each source was acquired from
  dynamic_refresh.PUBLISHERS           the YouTube channel id of each news and rolling publisher
  src/data/independent/manifest.json   the official address recorded for each researched source

A link is only written when one of those records names it; nothing is inferred from a name. Licence terms
are not recorded anywhere in TVN, so the register carries none. The catalogue scripts call write_register()
after every catalogue write, and a test fails if a catalogue source is missing here.

  python3 scripts/source_register.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / "public" / "independent" / "playable.json"
MANIFEST = ROOT / "src" / "data" / "independent" / "manifest.json"
REGISTER = ROOT / "public" / "independent" / "sources.json"
YOUTUBE_HOST = re.compile(r"^https://(www\.)?youtube\.com/", re.I)


def youtube_url(handle: str) -> str | None:
    if re.fullmatch(r"UC[0-9A-Za-z_-]{22}", handle):
        return f"https://www.youtube.com/channel/{handle}"
    if re.fullmatch(r"@[\w.-]{3,}", handle):
        return f"https://www.youtube.com/{handle}"
    return None


def build() -> dict:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from add_targeted_sources import TARGETS  # noqa: E402
    from dynamic_refresh import PUBLISHERS  # noqa: E402

    catalogue = json.loads(CATALOGUE.read_text())
    targets = {target["id"]: target["handle"] for target in TARGETS}
    manifest = {source["id"]: source for source in json.loads(MANIFEST.read_text())["sources"]}
    sources: dict[str, dict] = {}
    for source_id, name in sorted(catalogue["sources"].items()):
        entry: dict[str, str] = {"name": name, "provider": "YouTube"}
        channel = youtube_url(targets.get(source_id, "")) or youtube_url(PUBLISHERS.get(source_id, ("",))[0])
        recorded = manifest.get(source_id, {}).get("url", "")
        if not channel and YOUTUBE_HOST.match(recorded):
            channel = recorded
        if channel:
            entry["channelUrl"] = channel
        if recorded and not YOUTUBE_HOST.match(recorded):
            entry["website"] = recorded
        sources[source_id] = entry
    return {
        "format": "tvn-source-register-v1",
        "catalogueGeneratedAt": catalogue.get("generatedAt"),
        "sources": sources,
    }


def write_register() -> int:
    register = build()
    REGISTER.write_text(json.dumps(register, ensure_ascii=False, indent=1) + "\n")
    return len(register["sources"])


if __name__ == "__main__":
    count = write_register()
    print(f"source register: {count} sources -> {REGISTER.relative_to(ROOT)}")
