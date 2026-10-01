"""Film genres for single-film trailers, from Wikidata structured metadata (build time only).

Each dated Rotten Tomatoes Classic Trailers programme (original year from scripts/original_years.py) is
matched to exactly one Wikidata film by its exact English label or alias AND a publication date (P577) in
the trailer's year. No match, or more than one film, means no genre. Genres come only from the film's
genre statements (P136) and, for animation, its instance-of class (P31), counted when that value is the
target genre or an explicit subclass (P279) of it. Trailer titles are never read for genre.

Writes:
  scripts/data/wikidata-trailer-films.json  provenance cache: match, QID, genre QIDs, rejects
  public/independent/playable.json          "trailerGenres": videoId -> [QID, [genre, ...]]

usage: python3 scripts/trailer_genres.py [--refresh]   (network only when the cache is missing or --refresh)
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / "public/independent/playable.json"
CACHE = ROOT / "scripts/data/wikidata-trailer-films.json"
ENDPOINT = "https://query.wikidata.org/sparql"
AGENT = "RetroTV-catalogue-build/1.0 (film genre metadata; build time only)"
SOURCE = "src_rt_classic_trailers"

FILM_CUT = re.compile(
    r"\s+(?:\((?:19|20)\d\d\)|official\b|theatrical\b|teaser\b|trailer\b|international\b|original\b|tv spot\b|"
    r"clip\b|re-?release\b|restored\b|remastered\b|us\b|uk\b|hd\b)|\s+[-–|:]\s",
    re.I,
)

ROOTS = {
    "Horror": ["Q200092"],
    "Science Fiction": ["Q471839", "Q24925"],
    "Action": ["Q188473"],
    "Animation": ["Q202866"],
    "Drama": ["Q130232"],
    "Thriller": ["Q2484376", "Q182015"],
    "Fantasy": ["Q157394", "Q132311"],
}
INSTANCE_GENRES = {"Animation"}
# Wikidata subclass links that reach a target from a neighbouring genre rather than a subgenre of it.
NOT_A_SUBGENRE = {
    "Science Fiction": {"Q109626272", "Q580850"},  # natural horror film, techno-thriller
    "Action": {"Q2297927", "Q133857225", "Q883179", "Q4925568"},  # spy film, spy comedy, blaxploitation (+ horror)
    "Drama": {"Q846544", "Q222639", "Q102429885", "Q132803402"},  # disaster, swashbuckler, coming-of-age, white savior
    "Thriller": {"Q2297927", "Q133857225", "Q846544", "Q496523", "Q2254193"},  # spy, spy comedy, disaster, heist, rape and revenge
}


def film_name(title: str) -> str:
    cut = FILM_CUT.search(title)
    name = title[: cut.start()] if cut else ""
    return name.strip().strip("\"'“”‘’").strip()


def sparql(query: str) -> list[dict]:
    body = urllib.parse.urlencode({"query": query, "format": "json"}).encode()
    request = urllib.request.Request(ENDPOINT, data=body, headers={"User-Agent": AGENT, "Accept": "application/sparql-results+json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.load(response)["results"]["bindings"]
        except Exception as error:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f"  retry after {error}", flush=True)
            time.sleep(10 * (attempt + 1))
    return []


def literal(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"@en'


def qid(uri: str) -> str:
    return uri.rsplit("/", 1)[-1]


def fetch_films(names: list[str]) -> dict[str, dict]:
    """Items whose English label or alias is one of the names and that carry a publication date."""
    items: dict[str, dict] = {}
    for start in range(0, len(names), 40):
        batch = names[start : start + 40]
        values = " ".join(literal(name) for name in batch)
        rows = sparql(f"""
SELECT ?item ?name ?date WHERE {{
  VALUES ?name {{ {values} }}
  ?item rdfs:label|skos:altLabel ?name .
  ?item wdt:P577 ?date .
}}""")
        for row in rows:
            item = items.setdefault(qid(row["item"]["value"]), {"names": set(), "years": set(), "genres": set(), "instances": set()})
            item["names"].add(row["name"]["value"])
            if re.match(r"^\d{4}", row["date"]["value"]):
                item["years"].add(int(row["date"]["value"][:4]))
        if start % 400 == 0:
            print(f"  names {start + len(batch)}/{len(names)} -> {len(items)} dated items", flush=True)
        time.sleep(0.5)
    keys = sorted(items)
    for start in range(0, len(keys), 150):
        batch = " ".join(f"wd:{key}" for key in keys[start : start + 150])
        for row in sparql(f"SELECT ?item ?inst ?genre WHERE {{ VALUES ?item {{ {batch} }} ?item wdt:P31 ?inst . OPTIONAL {{ ?item wdt:P136 ?genre }} }}"):
            item = items[qid(row["item"]["value"])]
            item["instances"].add(qid(row["inst"]["value"]))
            if "genre" in row:
                item["genres"].add(qid(row["genre"]["value"]))
        time.sleep(0.5)
    classes = sorted({inst for item in items.values() for inst in item["instances"]})
    films_classes: set[str] = set()
    for start in range(0, len(classes), 200):
        batch = " ".join(f"wd:{key}" for key in classes[start : start + 200])
        for row in sparql(f"SELECT DISTINCT ?c WHERE {{ VALUES ?c {{ {batch} }} ?c wdt:P279* wd:Q11424 . }}"):
            films_classes.add(qid(row["c"]["value"]))
        time.sleep(0.5)
    films = {key: item for key, item in items.items() if item["instances"] & films_classes}
    print(f"  dated items {len(items)}, films {len(films)}", flush=True)
    return films


def fetch_closure(classes: set[str]) -> dict[str, list[str]]:
    roots = sorted({root for ids in ROOTS.values() for root in ids})
    listed = sorted(classes)
    closure: dict[str, set[str]] = {}
    for start in range(0, len(listed), 200):
        batch = " ".join(f"wd:{item}" for item in listed[start : start + 200])
        rows = sparql(f"""
SELECT ?g ?root WHERE {{
  VALUES ?g {{ {batch} }} VALUES ?root {{ {' '.join('wd:' + r for r in roots)} }}
  ?g wdt:P279* ?root .
}}""")
        for row in rows:
            closure.setdefault(qid(row["g"]["value"]), set()).add(qid(row["root"]["value"]))
        time.sleep(1)
    return {key: sorted(value) for key, value in closure.items()}


def fetch_labels(ids: set[str]) -> dict[str, str]:
    labels: dict[str, str] = {}
    listed = sorted(ids)
    for start in range(0, len(listed), 300):
        batch = " ".join(f"wd:{item}" for item in listed[start : start + 300])
        for row in sparql(f'SELECT ?g ?l WHERE {{ VALUES ?g {{ {batch} }} ?g rdfs:label ?l FILTER(LANG(?l) = "en") }}'):
            labels[qid(row["g"]["value"])] = row["l"]["value"]
        time.sleep(1)
    return labels


def trailers(doc: dict) -> list[tuple[str, str, int, str]]:
    out = []
    for video, title, _seconds, source, *_ in doc["items"]:
        original = doc.get("originals", {}).get(video)
        if source != SOURCE or not original or original[1] != "trailer":
            continue
        name = film_name(title)
        if name:
            out.append((video, title, original[0], name))
    return out


def build_cache(doc: dict) -> dict:
    rows = trailers(doc)
    names = sorted({name for *_, name in rows} | {name.replace("’", "'") for *_, name in rows} | {name.replace("'", "’") for *_, name in rows})
    print(f"trailers with a verified year and a film name: {len(rows)}; distinct names queried: {len(names)}", flush=True)
    films = fetch_films(names)
    classes = {g for film in films.values() for g in film["genres"] | film["instances"]}
    closure = fetch_closure(classes)
    labels = fetch_labels(set(closure) | {r for ids in ROOTS.values() for r in ids})
    return {
        "source": "Wikidata (https://www.wikidata.org), CC0; SPARQL endpoint " + ENDPOINT,
        "retrievedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "method": "exact English label/alias AND P577 year == trailer year; exactly one film required",
        "films": {key: {k: sorted(v) for k, v in film.items()} for key, film in films.items()},
        "closure": closure,
        "labels": labels,
    }


def genres_for(film: dict, closure: dict[str, list[str]]) -> list[str]:
    found = []
    for genre, roots in ROOTS.items():
        values = film["genres"] + (film["instances"] if genre in INSTANCE_GENRES else [])
        values = [value for value in values if value not in NOT_A_SUBGENRE.get(genre, set())]
        if any(set(closure.get(value, [])) & set(roots) for value in values):
            found.append(genre)
    return found


def resolve(doc: dict, cache: dict) -> tuple[dict, dict]:
    by_name: dict[str, list[str]] = {}
    for key, film in cache["films"].items():
        for name in film["names"]:
            by_name.setdefault(name.replace("’", "'").casefold(), []).append(key)
    matched, report = {}, {"matched": 0, "ambiguous": [], "unmatched": [], "noGenre": 0}
    for video, title, year, name in trailers(doc):
        candidates = {key for key in by_name.get(name.replace("’", "'").casefold(), []) if year in cache["films"][key]["years"]}
        if len(candidates) > 1:
            report["ambiguous"].append([video, name, year, sorted(candidates)])
            continue
        if not candidates:
            report["unmatched"].append([video, name, year])
            continue
        key = candidates.pop()
        report["matched"] += 1
        genres = genres_for(cache["films"][key], cache["closure"])
        if genres:
            matched[video] = [key, genres]
        else:
            report["noGenre"] += 1
    return matched, report


def main() -> None:
    doc = json.loads(CATALOGUE.read_text())
    if "--refresh" in sys.argv or not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        cache = build_cache(doc)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
    cache = json.loads(CACHE.read_text())
    matched, report = resolve(doc, cache)
    cache["resolution"] = {"matched": report["matched"], "withGenre": len(matched), "noGenre": report["noGenre"],
                           "ambiguous": report["ambiguous"], "unmatched": report["unmatched"]}
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
    if "--dry" not in sys.argv:
        doc["trailerGenres"] = matched
        CATALOGUE.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    counts: dict[str, int] = {}
    for _key, genres in matched.values():
        for genre in genres:
            counts[genre] = counts.get(genre, 0) + 1
    print(f"matched {report['matched']}, with target genres {len(matched)}, ambiguous {len(report['ambiguous'])}, unmatched {len(report['unmatched'])}")
    print(dict(sorted(counts.items(), key=lambda kv: -kv[1])))


if __name__ == "__main__":
    main()
