"""Source-ID registry: one id per publisher, one publisher per id.

add_targeted_sources.py calls assert_registry() before touching the catalogue, so a new
TARGETS entry can never reuse an id that already names a different publisher (the Pass 18
src_icc cricket / International Criminal Court collision). Run directly to audit.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

CATALOGUE = Path(__file__).resolve().parents[1] / "public" / "independent" / "playable.json"


def norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def problems(targets: list[dict], sources: dict[str, str]) -> list[str]:
    found = []
    by_id: dict[str, dict] = {}
    residual: dict[str, str] = {}
    for target in targets:
        sid, handle = target["id"], target["handle"].lower()
        if sid in by_id and by_id[sid]["handle"].lower() != handle:
            found.append(f"{sid}: id names two publishers ({by_id[sid]['handle']} and {target['handle']})")
        elif sid in by_id:
            found.append(f"{sid}: listed twice in TARGETS")
        by_id[sid] = target
        # A publisher may be split into subject strands, but only one strand may be unfiltered.
        if not (target.get("filter") or target.get("playlist") or target.get("playlists")):
            if handle in residual:
                found.append(f"{target['handle']}: two unfiltered ids ({residual[handle]} and {sid})")
            residual.setdefault(handle, sid)
        name = target.get("name")
        if name and sid in sources and norm(sources[sid]) != norm(name):
            found.append(f"{sid}: catalogue publisher {sources[sid]!r} differs from TARGETS publisher {name!r}")
    names: dict[str, str] = {}
    for sid, name in sources.items():
        key = norm(name)
        if key in names and names[key] != sid:
            found.append(f"{name!r}: catalogue publisher under two ids ({names[key]} and {sid})")
        names.setdefault(key, sid)
    return found


def assert_registry(targets: list[dict], sources: dict[str, str]) -> None:
    found = problems(targets, sources)
    if found:
        raise SystemExit("source-id registry collision:\n  " + "\n  ".join(found))


if __name__ == "__main__":
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from add_targeted_sources import TARGETS  # noqa: E402

    doc = json.loads(CATALOGUE.read_text())
    found = problems(TARGETS, doc["sources"])
    print("\n".join(found) if found else f"registry clean: {len(TARGETS)} targets, {len(doc['sources'])} catalogue sources")
    sys.exit(1 if found else 0)
