"""Release years for official music videos from Wikidata (build time only).

A video is dated only when a Wikidata song or single whose performer (P175) carries the video's artist
name as its English label has the video's song title as its English label and a publication date
(P577). The earliest matching date is the song's first release. Live, session, cover, remix and
re-recorded videos are never dated: their recording is not the original release. Upload dates are
never used. Results are cached in scripts/data/wikidata-song-years.json and written to originals as
[year, "recording", "wikidata", "VERIFIED", "<QID> <title> P577 <date>, performer <artist>"].
"""
import json, re, sys, unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from trailer_genres import literal, qid, sparql  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / "public/independent/playable.json"
CACHE = ROOT / "scripts/data/wikidata-song-years.json"

OFFICIAL = re.compile(r"official (music )?video|official audio|official lyric|\(lyrics?\)|official visuali[sz]er|official hd video|music video|\(audio\)|\bvideo\b", re.I)
NOT_ORIGINAL = re.compile(r"\blive\b|session|perform|acoustic|cover|remix|reaction|interview|behind the scenes|teaser|trailer|making of|documentary|full album|full concert|medley|karaoke|tutorial|lesson|rehears|unplugged|tour|festival|podcast|mix\b|#shorts|\bep\b|version|re-?record|redux|anniversary|demo", re.I)
LABELS = {"src_insideout", "src_nuclear_blast", "src_sub_pop", "src_sub_pop_grunge", "src_epitaph", "src_vevo", "src_vevo_classics", "src_vevo_80s", "src_vevo_90s",
          "src_vevo_2000s", "src_ed_sullivan", "src_afro_nation", "src_vp_records", "src_toolroom", "src_ukf_dnb", "src_mahogany", "src_postmodern_jukebox"}
DECOR = re.compile(r"\s*[\(\[][^\)\]]*(official|video|audio|lyric|visuali|hd|4k|remaster|explicit|clean|uncensored|m/v|mv)[^\)\]]*[\)\]]", re.I)


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower().replace("&", "and")
    text = re.sub(r"^the\s+", "", text)
    return re.sub(r"[^a-z0-9]+", "", text)


def parse(row: list, source_name: str) -> tuple[str, str] | None:
    title = DECOR.sub("", row[1]).strip()
    title = re.sub(r"\s*[|｜].*$", "", title).strip()
    if row[3] in LABELS or re.search(r"\s[-–—]\s", title):
        parts = re.split(r"\s[-–—]\s", title, maxsplit=1)
        if len(parts) != 2:
            return None
        artist, song = parts
    else:
        artist, song = source_name, title
    artist = re.split(r",|/", artist)[0].strip()
    while re.match(re.escape(artist) + r"\s[-–—]\s", song, re.I):
        song = re.split(r"\s[-–—]\s", song, maxsplit=1)[1]
    song = re.sub(r'^["“”\']+|["“”\']+$', "", song).strip()
    song = re.sub(r"\s*\b(ft|feat|featuring)\.?\s.*$", "", song, flags=re.I).strip()
    artist = re.sub(r"\s*\b(ft|feat|featuring|x|&|and|with)\.?\s.*$", "", artist, flags=re.I).strip()
    if not artist or not song or len(song) > 80:
        return None
    return artist, song


def songs_by(artist: str) -> list[dict]:
    names = sorted({artist, artist.title(), artist.upper(), artist.lower(), " ".join(w.capitalize() for w in artist.split())})
    values = " ".join(literal(name) for name in names)
    rows = sparql(f"""
SELECT ?song ?title ?date WHERE {{
  VALUES ?name {{ {values} }}
  ?artist rdfs:label ?name .
  ?song wdt:P175 ?artist ; wdt:P577 ?date ; rdfs:label ?title .
  FILTER(LANG(?title) = "en")
}}""")
    return [{"qid": qid(r["song"]["value"]), "title": r["title"]["value"], "date": r["date"]["value"][:10]} for r in rows]


def main() -> None:
    doc = json.loads(CATALOGUE.read_text())
    sources = set(json.loads(Path(sys.argv[1]).read_text())) if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else None
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {"artists": {}, "programmes": {}}
    originals = doc.setdefault("originals", {})
    todo = [r for r in doc["items"] if (sources is None or r[3] in sources) and 90 <= r[2] <= 900
            and OFFICIAL.search(r[1]) and not NOT_ORIGINAL.search(r[1])
            and (r[0] not in originals or originals[r[0]][2] == "wikidata")]
    parsed = {r[0]: parse(r, doc["sources"].get(r[3], "")) for r in todo}
    artists = sorted({p[0] for p in parsed.values() if p})
    print(len(todo), "candidates,", len(artists), "artists", flush=True)
    for index, artist in enumerate(artists):
        if artist in cache["artists"]:
            continue
        try:
            cache["artists"][artist] = songs_by(artist)
        except Exception as error:  # noqa: BLE001
            print("  skip", artist, error, flush=True)
            continue
        if index % 25 == 0:
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0, sort_keys=True))
            print(index, "artists", flush=True)
    programmes = {}
    for video, hit in parsed.items():
        if not hit:
            continue
        artist, song = hit
        matches = [s for s in cache["artists"].get(artist, []) if norm(s["title"]) == norm(song) and re.match(r"^(1[89]|20)\d\d", s["date"])]
        if matches:
            first = min(matches, key=lambda s: s["date"])
            programmes[video] = {"artist": artist, "song": song, **first}
    cache["programmes"] = programmes
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0, sort_keys=True))
    if "--write" in sys.argv:
        for video, hit in programmes.items():
            if video in originals and originals[video][2] != "wikidata":
                continue
            originals[video] = [int(hit["date"][:4]), "recording", "wikidata", "VERIFIED",
                                f"{hit['qid']} {hit['title']} P577 {hit['date']}, performer {hit['artist']}"]
        CATALOGUE.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    print("dated", len(programmes), "of", len(todo))


if __name__ == "__main__":
    main()
