"""Original-year metadata from explicit, unambiguous statements. Upload dates are never used.

Writes playable.json "originals": videoId -> [year, basis, provenance, confidence, evidence].
  basis:       film | recording | performance | episode | event
  provenance:  title (the publisher's own title states it) | description (the publisher's own
               description states it, fetched with --descriptions)
  confidence:  VERIFIED (a full date, or a copyright line naming the year) | HIGH (a year in a
               pattern that can only mean the work's own date)
A title with two different years, or any remaster/reissue wording, is left unresolved.
Re-running is safe: title rules are recomputed; description results are kept.

usage: python3 scripts/original_years.py [--descriptions]   (descriptions need /tmp/.retrotv_key)
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
PROGRESS = Path("/tmp/retrotv-descriptions.json")

YEAR = re.compile(r"(?<!\d)(19[2-9]\d|20[0-2]\d)(?![\d])")
REJECT = re.compile(
    r"remaster|re-master|reissue|re-issue|anniversary|deluxe|expanded|restor|\bversion\b|interview|documentary|podcast|"
    r"q ?& ?a|behind|trailer|teaser|pre-show|livestream|\bstream\b|periscope|announce|reaction|unboxing|tutorial|lesson|"
    r"lyric|\baudio\b|visuali[sz]er|reunion|tribute|\bcover\b|rehearsal|preview|recap|compilation|best of|top \d+",
    re.I,
)
MONTHS = r"jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?"
FULL_DATE = re.compile(rf"\b\d{{1,2}}[./]\d{{1,2}}[./](19|20)\d\d\b|\b({MONTHS})\.? \d{{1,2}},? (19|20)\d\d\b|\b\d{{1,2}}(st|nd|rd|th)? ({MONTHS}) (19|20)\d\d\b", re.I)

# Performance-led music publishers (instructional, essay, karaoke and awards channels excluded).
MUSIC = {
    "src_50_cent", "src_acdc", "src_aerosmith", "src_afro_nation", "src_alice_in_chains", "src_alicia_keys", "src_arctic_monkeys",
    "src_audiotree", "src_bee_gees", "src_blogotheque", "src_blur", "src_boiler_room", "src_bon_jovi", "src_brandy", "src_cercle",
    "src_coachella", "src_colors", "src_dashboard_confessional", "src_def_leppard", "src_eminem", "src_epitaph", "src_fall_out_boy",
    "src_foo_fighters", "src_gloria_gaynor", "src_guns_n_roses", "src_hammock", "src_home_free", "src_imagine_dragons", "src_insideout",
    "src_jalc", "src_jimmy_eat_world", "src_kendrick_lamar", "src_kexp", "src_khruangbin", "src_kings_singers", "src_kiss",
    "src_massive_attack", "src_motley_crue", "src_my_bloody_valentine", "src_my_chemical_romance", "src_ne_yo", "src_newport_folk",
    "src_nile_rodgers", "src_nine_inch_nails", "src_nirvana", "src_npr_music", "src_nuclear_blast", "src_oasis", "src_opry",
    "src_paramore", "src_paste", "src_pearl_jam", "src_polyphia", "src_radiohead", "src_rem", "src_rhcp", "src_rockpalast",
    "src_sigur_ros", "src_slowdive", "src_smashing_pumpkins", "src_sofar", "src_soul_train", "src_soundgarden", "src_sub_pop",
    "src_the_cure", "src_the_specials", "src_toolroom", "src_ukf_dnb", "src_usher", "src_vevo", "src_vp_records", "src_zero_7",
    "src_animals_as_leaders", "src_mahogany", "src_postmodern_jukebox",
    "src_nirvana_vevo", "src_stone_temple_pilots", "src_mudhoney", "src_screaming_trees_vevo", "src_mad_season_vevo", "src_melvins",
    "src_mark_lanegan", "src_temple_of_the_dog", "src_l7", "src_hole_vevo", "src_chris_cornell", "src_sub_pop_grunge",
    "src_the_who_vevo", "src_tears_for_fears_vevo", "src_siouxsie_vevo", "src_manics_vevo", "src_the_verve_vevo", "src_vevo_the_killers", "src_vevo_kings_of_leon",
    "src_pulp", "src_suede", "src_supergrass", "src_manics", "src_duran_duran", "src_depeche_mode", "src_talking_heads", "src_new_order",
    "src_human_league", "src_bauhaus", "src_ride", "src_cocteau_twins", "src_diiv", "src_led_zeppelin", "src_pink_floyd", "src_the_doors", "src_jimi_hendrix",
    "src_tom_petty", "src_bruce_springsteen", "src_eric_clapton", "src_joe_bonamassa", "src_bb_king", "src_gary_clark_jr", "src_vulf", "src_lettuce",
    "src_snarky_puppy", "src_run_the_jewels", "src_wu_tang_clan", "src_public_enemy", "src_madness", "src_the_selecter", "src_the_beat", "src_toots",
    "src_playing_for_change", "src_tinariwen", "src_lollapalooza", "src_roskilde", "src_keb_mo", "src_beth_hart", "src_the_cult",
    "src_songhoy_blues", "src_angelique_kidjo", "src_primavera_sound", "src_sziget", "src_bonnaroo", "src_she_wants_revenge_vevo",
    "src_ed_sullivan", "src_the_beatles", "src_rolling_stones", "src_roy_orbison", "src_beach_boys",
    "src_vevo_classics", "src_vevo_80s", "src_vevo_90s", "src_vevo_2000s",
    *(f"src_vevo_{slug}" for slug in ("abba", "queen", "elton_john", "bob_marley", "fleetwood_mac", "stevie_wonder", "diana_ross", "ewf", "blondie", "carpenters",
                                      "donna_summer", "barry_white", "marvin_gaye", "temptations", "smokey_robinson", "dolly_parton", "simon_garfunkel")),
}
PERFORMANCE = re.compile(r"\blive\b|concert|session|festival|unplugged|\btour\b|rockpalast|starparade|\btv\b|top of the pops|\bshow\b|\bdemo\b|in concert|\bsopot\b|montreux|glastonbury|reading|wembley|donington", re.I)

FILM_PUBLISHERS = {"src_popcornflix", "src_movie_central"}
FULL_FILM = re.compile(r"full (movie|film|feature)", re.I)
MARKETING_YEAR = re.compile(r"(19|20)\d\d (\w+ )?(movies?|films?)\b", re.I)

EPISODE_SOURCES = {"src_buzzr", "src_red_green", "src_royal_institution"}
EPISODE = re.compile(r"\((19|20)\d\d\)|\((19|20)\d\d season\)|\b(19|20)\d\d season\b|\b(19|20)\d\d christmas lectures\b|\bwinners of (19|20)\d\d\b", re.I)

TRAILER_SOURCES = {"src_rt_classic_trailers"}
TRAILER = re.compile(r"\btrailer\b|\bteaser\b", re.I)
TRAILER_YEAR = re.compile(r"\(((?:19|20)\d\d)\)")
NOT_ORIGINAL_RELEASE = re.compile(r"re-?release|anniversary|restor|remaster|re-?issue|\b4k\b|\b3-?d\b|imax|special edition|director'?s cut|extended|redux|reboot|remake", re.I)

EVENT_SOURCES = {"src_fifa", "src_wimbledon", "src_world_rugby", "src_fivb_archive", "src_iihf", "src_pdc", "src_fih", "src_wsl", "src_nfl_films"}
EVENT = re.compile(r"\b(19|20)\d\d (fifa )?(world cup|olympics|euro|final|championships?)\b|\b(world cup|wimbledon|championships?|olympics) (19|20)\d\d\b", re.I)
FULL_MATCH_SOURCES = {"src_uefa", "src_premier_league", "src_england_football"}
EVENT_TYPE = re.compile(r"full match|full game|highlights|final", re.I)


def one_year(title: str) -> int | None:
    years = {int(match) for match in YEAR.findall(title)}
    return years.pop() if len(years) == 1 else None


def from_title(title: str, source: str, seconds: int):
    year = one_year(title)
    if source in TRAILER_SOURCES:
        bracketed = TRAILER_YEAR.search(title)
        if year is None or not bracketed or int(bracketed.group(1)) != year or not TRAILER.search(title) or NOT_ORIGINAL_RELEASE.search(title):
            return None
        return [year, "trailer", "title", "HIGH", title]
    if year is None or REJECT.search(title):
        return None
    if source == "src_ed_sullivan" and (NOT_SONG.search(title) or not re.search(r"[\"“]", title)):
        return None
    confidence = "VERIFIED" if FULL_DATE.search(title) else "HIGH"
    if source in FILM_PUBLISHERS:
        bracketed = re.search(rf"^[^|(]+\({year}\)", title)
        fielded = source == "src_popcornflix" and re.search(rf"\|\s*{year}\s*(\||$)", title)
        if seconds >= 3600 and FULL_FILM.search(title) and not MARKETING_YEAR.search(title) and (bracketed or fielded):
            return [year, "film", "title", "HIGH", title]
        return None
    if source in MUSIC and PERFORMANCE.search(title):
        return [year, "recording" if re.search(r"\bdemo\b", title, re.I) else "performance", "title", confidence, title]
    if source in EPISODE_SOURCES and EPISODE.search(title):
        return [year, "episode", "title", confidence, title]
    if source in EVENT_SOURCES and EVENT.search(title) and EVENT_TYPE.search(title):
        return [year, "event", "title", confidence, title]
    if source in FULL_MATCH_SOURCES and re.search(r"\bfull match\b", title, re.I):
        return [year, "event", "title", confidence, title]
    return None


COPYRIGHT = re.compile(r"(?:\(c\)|©|\(p\)|℗)\s*((?:19|20)\d\d)\b", re.I)
MUSIC_VIDEO = re.compile(r"music video by .{1,80}? performing[^\n]{0,160}", re.I)
DATE = rf"(?:\d{{1,2}}(?:st|nd|rd|th)? (?:{MONTHS}),? |(?:{MONTHS})\.? \d{{1,2}}(?:st|nd|rd|th)?,? )?((?:19|20)\d\d)\b"
PERFORMED = re.compile(rf"\b(?:recorded|filmed|captured|shot)(?: live)?(?: (?:at|in|on)\b)[^.\n/]{{0,80}}?\b(?:on |in )?{DATE}", re.I)
RELEASED = re.compile(rf"\boriginally released (?:in |on )?{DATE}|\btaken from [^.\n]{{0,60}}?released in ((?:19|20)\d\d)\b|\bfrom (?:the|their|his|her) ((?:19|20)\d\d) (?:album|ep|single)\b", re.I)
NOT_ORIGINAL = re.compile(r"remix|recycled|re-?work|re-?edit|\bcover\b|mash-?up|karaoke|instrumental|slowed|sped up", re.I)
VIDEO_REMASTER = re.compile(r"#remastered\b|remastered in hd|hd remaster(ed)?|remastered video|video remaster(ed)?", re.I)
REISSUE = re.compile(r"remaster|re-?issue|re-?release|anniversary|deluxe|expanded edition", re.I)
COMPILATION = re.compile(r"greatest hits|\bbest of\b|compilation|\bthe (very best|essential|collection)\b|anthology", re.I)
DIGITAL = re.compile(r"released on: ?(19|20)\d\d-|digital(ly)? (release|remaster)|auto-generated by youtube|provided to youtube by", re.I)
URL = re.compile(r"https?://\S+|#\w+")
BROADCAST = re.compile(rf"on the ed sullivan show(?:,| on) ({MONTHS})\.? (\d{{1,2}}),? ((?:19|20)\d\d)", re.I)
NOT_SONG = re.compile(r"portray|monologue|routine|impression|sketch|scene\b|recit|\breads?\b|poem|speech|interview|comed|comic|joke|skit|magic|trick|ventriloqu|puppet|topo gigio|"
                      r"\bdogs?\b|\bbears?\b|\bseals?\b|chimp|juggl|acrobat|trampoline|tumbl|circus|gospel|hymn|\bgod\b|jesus|\blord\b|prayer|spirit|psalm|ave maria|hallelujah|christmas|easter", re.I)
PART = re.compile(r"\bpart \d+ of \d+\b", re.I)

REJECTIONS: dict[str, int] = {}


def reject(reason: str):
    REJECTIONS[reason] = REJECTIONS.get(reason, 0) + 1
    return None


def years_of(pattern: re.Pattern, text: str) -> tuple[set[int], str]:
    years, evidence = set(), ""
    for match in pattern.finditer(text):
        year = next(group for group in match.groups() if group and re.fullmatch(r"(19|20)\d\d", group))
        years.add(int(year))
        evidence = evidence or match.group(0)
    return years, evidence


def from_description(entry, title: str, source: str, seconds: int):
    """Only the publisher's own explicit statements; the upload date is used solely to reject copyright years it could be."""
    description, published = (entry, "") if isinstance(entry, str) else (entry.get("d", ""), entry.get("p", ""))
    if not description:
        return None
    if source in FILM_PUBLISHERS:
        if seconds < 3600 or not FULL_FILM.search(title) or PART.search(title) or "directed by" not in description.lower():
            return None
        standalone = {int(line.strip()) for line in description.splitlines() if YEAR.fullmatch(line.strip())}
        if len(standalone) != 1:
            return reject("film: no single credit-block year") if len(standalone) > 1 else None
        year = standalone.pop()
        return [year, "film", "description", "HIGH", f"credit block year {year}"]
    if source == "src_ed_sullivan":
        if NOT_SONG.search(title) or not re.search(r"[\"“]", title):
            return None
        match = BROADCAST.search(description)
        if not match:
            return None
        return [int(match.groups()[-1]), "performance", "description", "VERIFIED", match.group(0)[:120]]
    if source not in MUSIC or REJECT.search(title):
        return None
    if NOT_ORIGINAL.search(title):
        return reject("remix/cover/rework title")
    text = URL.sub(" ", description)
    performed, performed_evidence = years_of(PERFORMED, text)
    if performed:
        if len(performed) > 1:
            return reject("several performance years")
        year = performed.pop()
        confidence = "VERIFIED" if FULL_DATE.search(performed_evidence) else "HIGH"
        return [year, "performance", "description", confidence, performed_evidence.strip()[:120]]
    if PERFORMANCE.search(title):
        return None
    released, released_evidence = years_of(RELEASED, text)
    if released:
        if len(released) > 1:
            return reject("several release years")
        return [released.pop(), "recording", "description", "HIGH", released_evidence.strip()[:120]]
    line = MUSIC_VIDEO.search(description)
    if not line:
        return None
    years = {int(year) for year in COPYRIGHT.findall(description)}
    if not years:
        return None
    if len(years) > 1:
        return reject("several copyright years")
    year = years.pop()
    if DIGITAL.search(description):
        return reject("digital release year")
    if COMPILATION.search(text):
        return reject("compilation year")
    if REISSUE.search(VIDEO_REMASTER.sub(" ", description)):
        return reject("reissue/remaster year")
    upload = int(published[:4]) if published[:4].isdigit() else None
    if upload is None or year >= upload:
        return reject("copyright year is the upload year")
    return [year, "recording", "description", "VERIFIED", line.group(0).strip()[:120]]


def fetch_descriptions(doc) -> None:
    key = Path("/tmp/.retrotv_key").read_text().strip()
    done = json.loads(PROGRESS.read_text()) if PROGRESS.exists() else {}
    wanted = [row[0] for row in doc["items"] if (row[3] in MUSIC or row[3] in FILM_PUBLISHERS) and row[0] not in done]
    calls = 0
    for start in range(0, len(wanted), 50):
        batch = wanted[start:start + 50]
        query = urllib.parse.urlencode({"part": "snippet", "id": ",".join(batch), "key": key, "maxResults": 50})
        try:
            calls += 1
            with urllib.request.urlopen(f"https://www.googleapis.com/youtube/v3/videos?{query}", timeout=30) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            reasons = [item.get("reason") for item in json.loads(error.read() or b"{}").get("error", {}).get("errors", [])]
            print(f"descriptions stopped at {start}/{len(wanted)}: HTTP {error.code} {reasons}")
            break
        found = {item["id"]: {"d": item["snippet"].get("description", ""), "p": item["snippet"].get("publishedAt", "")} for item in payload.get("items", [])}
        for video in batch:
            done[video] = found.get(video, {"d": "", "p": ""})
        PROGRESS.write_text(json.dumps(done))
        time.sleep(0.05)
    print(f"descriptions cached: {len(done)}; videos.list calls this run: {calls} ({calls} quota units)")


def main() -> None:
    doc = json.loads(CATALOGUE.read_text())
    if "--descriptions" in sys.argv:
        fetch_descriptions(doc)
    descriptions = json.loads(PROGRESS.read_text()) if PROGRESS.exists() else {}
    previous = doc.get("originals", {})
    originals = {video: entry for video, entry in previous.items() if entry[2] == "description"}
    counts: dict[str, int] = {}
    # New Music owns its routed releases outright; an archive year would also claim them for an era channel.
    new_music = set(doc.get("programmeRoutes", {}).get("551", []))
    for video, title, seconds, source, *_ in doc["items"]:
        if video in new_music:
            originals.pop(video, None)
            continue
        titled = from_title(title, source, seconds)
        if titled and source in TRAILER_SOURCES:
            entry = descriptions.get(video, {})
            text = entry.get("d", "") if isinstance(entry, dict) else entry
            published = entry.get("p", "") if isinstance(entry, dict) else ""
            if NOT_ORIGINAL_RELEASE.search(URL.sub(" ", text)) or (published[:4].isdigit() and titled[0] > int(published[:4])):
                titled = reject("trailer: re-release or later-dated upload")
        described = from_description(descriptions[video], title, source, seconds) if video in descriptions else originals.get(video)
        if described and titled and described[0] != titled[0]:
            reject("description year contradicts title year")
            described = None
        entry = described if described and (not titled or described[3] == "VERIFIED") else titled
        originals.pop(video, None)
        if entry:
            originals[video] = entry
            counts[f"{entry[1]}/{entry[2]}"] = counts.get(f"{entry[1]}/{entry[2]}", 0) + 1
    # Wikidata film years (scripts/film_years.py) are structured metadata and are kept as written.
    originals.update({video: entry for video, entry in previous.items() if entry[2] == "wikidata"})
    doc["originals"] = originals
    CATALOGUE.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    print(f"originals: {len(originals)} {counts}")
    print(f"rejected description years: {REJECTIONS}")


if __name__ == "__main__":
    main()
