"""Original release years for full films, from Wikidata structured metadata (build time only).

A film programme is matched to a Wikidata film (instance of a subclass of film, Q11424) by its exact
English label or alias, then accepted only when one candidate is corroborated by the publisher's own title:
  - the title states a year and it equals one of the film's publication dates (P577), or
  - the title names a cast member who is in the film's cast (P161).
Several corroborated candidates, a title year contradicting every candidate date, or no corroboration
means no year. The year written is the film's earliest publication date. Upload dates are never used.
Duplicate uploads of one film keep only the longest copy's year, so a film joins one decade once.

Writes:
  scripts/data/wikidata-film-years.json   provenance cache: per programme the match, QID, dates, evidence
  public/independent/playable.json        "originals": videoId -> [year, "film", "wikidata", "VERIFIED", evidence]
Also records Wikidata genre labels per matched film in the cache for later genre channels.

usage: python3 scripts/film_years.py [--refresh]   (network only when the cache is missing or --refresh)
"""
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from trailer_genres import literal, qid, sparql  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / "public/independent/playable.json"
CACHE = ROOT / "scripts/data/wikidata-film-years.json"
SOURCES = {"src_film_detective"}
MIN_SECONDS = 3600

YEAR = re.compile(r"\((1[89]\d\d|20[0-2]\d)\)")
PREFIX = re.compile(r"^(classic films for kids|film detective presents|the film detective presents)\s*:?\s*", re.I)
CUT = re.compile(r"\s*\((1[89]\d\d|20[0-2]\d)\)|\s+[-–|]\s|\s*\|", re.I)
NOT_CAST = re.compile(r"full (movie|film)|black and white|colou?r|restored|introduction|classic|movie|film|drama|comedy|western|horror|thriller|noir|sci-fi|fantasy|musical|mystery|war|romance|adventure|crime", re.I)


def fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", text.lower())


def film_name(title: str) -> str:
    title = PREFIX.sub("", title.strip())
    cut = CUT.search(title)
    name = title[: cut.start()] if cut else title
    return re.sub(r"\s+-?\s*full (movie|film).*$", "", name, flags=re.I).strip().strip("\"'“”‘’").strip()


def cast_of(title: str) -> set[str]:
    names = set()
    for part in re.split(r"\s*[|,]\s*", title)[1:]:
        part = re.sub(r"\(.*?\)", "", part).strip()
        if part and not NOT_CAST.search(part) and 1 < len(part.split()) <= 4:
            names.add(fold(part))
    return names


def fetch(names: list[str]) -> dict[str, dict]:
    films: dict[str, dict] = {}
    for start in range(0, len(names), 40):
        values = " ".join(literal(name) for name in names[start : start + 40])
        rows = sparql(f"""
SELECT ?item ?name ?date WHERE {{
  VALUES ?name {{ {values} }}
  ?item rdfs:label|skos:altLabel ?name ; wdt:P577 ?date ; wdt:P31/wdt:P279* wd:Q11424 .
}}""")
        for row in rows:
            item = films.setdefault(qid(row["item"]["value"]), {"names": set(), "years": set(), "cast": set(), "genres": set()})
            item["names"].add(row["name"]["value"])
            if re.match(r"^\d{4}", row["date"]["value"]):
                item["years"].add(int(row["date"]["value"][:4]))
        print(f"  names {start + 40}/{len(names)} -> {len(films)} films", flush=True)
        time.sleep(0.5)
    keys = sorted(films)
    for start in range(0, len(keys), 100):
        batch = " ".join(f"wd:{key}" for key in keys[start : start + 100])
        for row in sparql(f"""
SELECT ?item ?castLabel ?genreLabel WHERE {{
  VALUES ?item {{ {batch} }}
  OPTIONAL {{ ?item wdt:P161 ?cast . ?cast rdfs:label ?castLabel . FILTER(LANG(?castLabel) = "en") }}
  OPTIONAL {{ ?item wdt:P136 ?genre . ?genre rdfs:label ?genreLabel . FILTER(LANG(?genreLabel) = "en") }}
}}"""):
            item = films[qid(row["item"]["value"])]
            if "castLabel" in row:
                item["cast"].add(row["castLabel"]["value"])
            if "genreLabel" in row:
                item["genres"].add(row["genreLabel"]["value"])
        time.sleep(0.5)
    return films


def match(title: str, candidates: list[tuple[str, dict]]) -> tuple[str, dict, str] | None:
    stated = YEAR.search(title)
    year = int(stated.group(1)) if stated else None
    cast = cast_of(title)
    good = []
    for key, film in candidates:
        billed = sorted(name for name in film["cast"] if fold(name) in cast)
        if year and year in film["years"]:
            good.append((key, film, f"title year {year} = P577"))
        elif billed and (not year or abs(min(film["years"]) - year) <= 1):
            good.append((key, film, f"cast {billed[0]} in P161"))
    return good[0] if len(good) == 1 else None


def main() -> None:
    doc = json.loads(CATALOGUE.read_text())
    rows = [row for row in doc["items"] if row[3] in SOURCES and row[2] >= MIN_SECONDS]
    names = sorted({film_name(row[1]) for row in rows} - {""})
    if CACHE.exists() and "--refresh" not in sys.argv:
        films = {key: {k: set(v) for k, v in item.items()} for key, item in json.loads(CACHE.read_text())["films"].items()}
        missing = [name for name in names if not any(name in item["names"] for item in films.values())]
        cached = set(json.loads(CACHE.read_text()).get("queried", []))
        missing = [name for name in missing if name not in cached]
        if missing:
            films.update(fetch(missing))
    else:
        films = fetch(names)
    by_name: dict[str, list[tuple[str, dict]]] = {}
    for key, film in films.items():
        for name in film["names"]:
            by_name.setdefault(name, []).append((key, film))
    results, best = {}, {}
    for video, title, seconds, *_ in rows:
        name = film_name(title)
        found = match(title, by_name.get(name, []))
        if not found:
            results[video] = {"title": title, "name": name, "candidates": len(by_name.get(name, [])), "year": None}
            continue
        key, film, evidence = found
        year = min(film["years"])
        results[video] = {"title": title, "name": name, "qid": key, "year": year, "evidence": evidence, "genres": sorted(film["genres"])}
        if key not in best or seconds > best[key][1]:
            best[key] = (video, seconds)
    keep = {video for video, _ in best.values()}
    originals = {video: entry for video, entry in doc.get("originals", {}).items() if not (entry[2] == "wikidata" and video in results)}
    for video, result in results.items():
        if result["year"] and video in keep:
            originals[video] = [result["year"], "film", "wikidata", "VERIFIED", f"{result['qid']} {result['evidence']}"]
    doc["originals"] = originals
    CATALOGUE.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({
        "about": "Wikidata film matches for scripts/film_years.py; years are earliest P577 of a corroborated exact-label match.",
        "queried": sorted(set(names) | set(json.loads(CACHE.read_text()).get("queried", []) if CACHE.exists() else set())),
        "films": {key: {k: sorted(v) for k, v in item.items()} for key, item in sorted(films.items())},
        "programmes": results,
    }, ensure_ascii=False, indent=1))
    decades: dict[str, int] = {}
    for video in keep:
        decade = f"{results[video]['year'] // 10 * 10}s"
        decades[decade] = decades.get(decade, 0) + 1
    print(f"films {len(rows)}; matched {sum(1 for r in results.values() if r['year'])}; distinct films kept {len(keep)}; decades {dict(sorted(decades.items()))}")


if __name__ == "__main__":
    main()
