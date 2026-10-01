"""Film genres from the publisher's own structured genre field. Popcornflix titles carry it after the
"FULL MOVIE" marker: 'Name | FULL MOVIE | 2009 | Action, Thriller | Cast'. Only tokens that are exactly a
genre (optionally with a period/style qualifier) count; cast names, plot tags and themes do not.

Writes playable.json "filmGenres": videoId -> [genre, ...]. Full films only (60 min+, not miniseries parts).

usage: python3 scripts/film_genres.py
"""
import json
import re
from pathlib import Path

CATALOGUE = Path(__file__).resolve().parent.parent / "public/independent/playable.json"
SOURCES = {"src_popcornflix"}

MARKER = re.compile(r"\|\s*full movie\s*[|I]|\((?:free )?full movie\)|\|\s*full movie\s*$", re.I)
PART = re.compile(r"\bpart \d+ of \d+\b|miniseries", re.I)
QUALIFIER = r"(?:classic|\d0s|psychological|historical|dark|epic|indie|sci-?fi)"
GENRES = {
    "Action": rf"(?:{QUALIFIER} )?action",
    "Adventure": rf"(?:{QUALIFIER} )?adventure",
    "Thriller": rf"(?:{QUALIFIER} |crime )?thriller",
    "Crime": r"crime(?: thriller| drama)?",
    "Mystery": r"mystery",
    "Comedy": rf"(?:{QUALIFIER} |romantic )?comedy",
    "Romantic Comedy": r"romantic comedy",
    "Drama": rf"(?:{QUALIFIER} |crime )?drama",
    "Western": r"western",
    "Horror": r"horror",
}
COMPILED = {genre: re.compile(rf"{pattern}", re.I) for genre, pattern in GENRES.items()}


def genres_of(title: str) -> list[str]:
    marker = MARKER.search(title)
    if not marker or PART.search(title):
        return []
    found = []
    for segment in re.split(r"\||\s+I\s+", title[marker.end():]):
        for token in re.split(r",|\s+l\s+", segment):
            token = token.strip().strip(".")
            for genre, pattern in COMPILED.items():
                if pattern.fullmatch(token) and genre not in found:
                    found.append(genre)
    return found


def main() -> None:
    doc = json.loads(CATALOGUE.read_text())
    genres = {}
    for video, title, seconds, source, *_ in doc["items"]:
        if source in SOURCES and seconds >= 3600:
            found = genres_of(title)
            if found:
                genres[video] = found
    doc["filmGenres"] = genres
    CATALOGUE.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    counts: dict[str, int] = {}
    for found in genres.values():
        for genre in found:
            counts[genre] = counts.get(genre, 0) + 1
    print(f"films with structured genres: {len(genres)} {dict(sorted(counts.items(), key=lambda kv: -kv[1]))}")


if __name__ == "__main__":
    main()
