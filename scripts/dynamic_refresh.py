"""Release-time refresh for the live and rolling channels (Pass 21).

The shipped application never calls the YouTube Data API. This tool runs at development or
release time with the developer key and writes two shipped files:

  public/independent/playable.json   rolling programmes (rows with no home channel), their
                                      programmeRoutes and a `published` map (videoId -> ISO date)
  src/data/dynamic/providers.json     per-channel mode, verified live endpoint, freshness window

Usage:
  python3 scripts/dynamic_refresh.py fetch   # recent uploads + live re-verification (quota)
  python3 scripts/dynamic_refresh.py build   # classify offline and write both files

Upload age (snippet.publishedAt) is the currentness evidence for every rolling programme. For
New Music it stands in for release date only for official videos from the label or artist, with
remasters, anniversaries, live versions and songs the catalogue already holds excluded.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import add_targeted_sources as A  # noqa: E402
from source_registry import problems  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / "public" / "independent" / "playable.json"
PROVIDERS = ROOT / "src" / "data" / "dynamic" / "providers.json"
RAW = Path("/tmp/retrotv-dyn-raw.json")
DYNAMIC_VERSION = "dynamic-v2"

# sourceId -> (YouTube channel id, publisher name, upload pages to scan)
PUBLISHERS: dict[str, tuple[str, str, int]] = {
    "src_sky_news": ("UCoMdktPbSTixAyNGwb-UYkQ", "Sky News", 4),
    "src_dw_news": ("UCknLrEdhRCp1aegoMqRaCZg", "DW News", 14),
    "src_aljazeera_english": ("UCNye-wNBqNL5ZzHSJj3l8Bg", "Al Jazeera English", 18),
    "src_france24_english": ("UCQfwfsi5VrQ8yKZ-UWmAEFg", "FRANCE 24 English", 12),
    "src_euronews": ("UCSrZ3UV4jOidv8ppoVuvW9Q", "euronews", 4),
    "src_cna": ("UC83jt4dlz1Gjl58fzQrrKZg", "CNA", 8),
    "src_abc_news_au": ("UCVgO39Bk5sMo66-6o6Spn6Q", "ABC News (Australia)", 8),
    "src_nhk_world": ("UCSPEjw8F2nQDtmUKPFNF7_A", "NHK WORLD-JAPAN", 4),
    "src_wion": ("UC_gUM8rL-Lrg6O3adPW9K1g", "WION", 3),
    "src_africanews": ("UC1_E8NeF5QHY2dtdLRBCCLA", "africanews", 4),
    "src_sabc_news": ("UC8yH-uI81UUtEMDsowQyx1g", "SABC News", 4),
    "src_trt_world": ("UC7fWeaHhqgM4Ry-RMpM2YYw", "TRT World", 8),
    "src_cbs_news": ("UC8p1vwvWtl6T73JiExfWs1g", "CBS News", 4),
    "src_nbc_news": ("UCeY0bbntWzzVIaj2z3QigXg", "NBC News", 3),
    "src_abc_news": ("UCBi2mrWuNuyYy4gbM6fU18Q", "ABC News", 3),
    "src_scripps_news": ("UCTln5ss6h6L_xNfMeujfPbg", "Scripps News", 3),
    "src_newsnation": ("UCCjG8NtOig0USdrT5D1FpxQ", "NewsNation", 3),
    "src_pbs_newshour": ("UC6ZFN9Tx6xh-skXCuRHCDpQ", "PBS NewsHour", 8),
    "src_channel4_news": ("UCTrQ7HXWRRxr7OsOtodr2_w", "Channel 4 News", 5),
    "src_guardian_news": ("UCIRYBXDze5krPDzAEOxFGVA", "Guardian News", 5),
    "src_bbc_news": ("UC16niRr50-MSBwiO3YDb3RA", "BBC News", 8),
    "src_itv_news": ("UCFQgi22Ht00CpaOQLtvZx2A", "ITV News", 3),
    "src_reuters": ("UChqUTb7kYRX8-EiaN3XFrSQ", "Reuters", 3),
    "src_cbc_news": ("UCuFFtHWoLl5fauMMD5Ww2jA", "CBC News", 4),
    "src_nyt": ("UCqnbDFdCpuN8CMEg0VuEBqA", "The New York Times", 2),
    "src_npr": ("UCJnS2EsPfv46u1JR8cnD0NA", "NPR", 2),
    "src_bloomberg_tv": ("UCIALMKvObZNtJ6AmdCLP7Lg", "Bloomberg Television", 4),
    "src_yahoo_finance": ("UCEAZeUIeJs0IjQiqTCdVSIg", "Yahoo Finance", 4),
    "src_cnbc": ("UCvJJ_dzjViJCoLf5uKUTwoA", "CNBC", 4),
    "src_cnbc_international": ("UCo7a6riBFJ3tkeHjvkXPn1g", "CNBC International", 4),
    "src_new_scientist": ("UCt5OA3LingpZBeEyPYmputQ", "New Scientist", 2),
    "src_variety": ("UCgRQHK8Ttr1j9xCEpCAlgbQ", "Variety", 3),
    "src_hollywood_reporter": ("UCZ8Sxmkweh65HetaZfR8YuA", "The Hollywood Reporter", 3),
    "src_fox_weather": ("UC1FbPiXx59_ltnFVx7IxWow", "FOX Weather", 4),
    "src_met_office": ("UC40Tw2tFuMzK305mi7nj8rg", "Met Office", 3),
    "src_weather_channel": ("UCGTUbwceCMibvpbd2NaIP7A", "The Weather Channel", 3),
    "src_weathernation": ("UCiOmTCan1HRYtZ_wWu15KJQ", "WeatherNation", 3),
    "src_accuweather": ("UCuYqi3hOfz6-3Hdp6tEJjAg", "AccuWeather", 3),
    "src_official_charts": ("UCp1Cpp4WraWrcOMrmM1GHKw", "Official Charts", 3),
    "src_billboard": ("UCsVcseUYbYjldc-XgcsiEbg", "Billboard", 4),
    # Existing label ids: New Music rows join these publishers without a home channel.
    "src_epitaph": ("UCDE5Ezmxq1bNVak4lmkpCMw", "Epitaph Records", 2),
    "src_sub_pop": ("UCsgEkEWaXKQwrhlLHFbcQFw", "Sub Pop", 2),
    "src_nuclear_blast": ("UCoxg3Kml41wE3IPq-PC-LQw", "Nuclear Blast", 2),
    "src_insideout": ("UC7Rl9oJzj7udPdl2oPT1SkQ", "InsideOut Music", 2),
    "src_vp_records": ("UCZng8TYQxSMYuRS7CZd-nvg", "VP Records", 2),
    "src_spinnin": ("UCpDJl2EmP7Oh90Vylx0dZtA", "Spinnin' Records", 3),
    "src_ultra": ("UC4rasfm9J-X4jNl9SvXp8xA", "Ultra Records", 2),
    "src_armada": ("UCGZXYc32ri4D0gSLPf2pZXQ", "Armada Music", 3),
    "src_toolroom": ("UCpiZh3AGeTygzfmUgioOFFg", "Toolroom Records", 2),
    "src_ukf_dnb": ("UCr8oc-LOaApCXWLjL7vdsgw", "UKF Drum & Bass", 2),
}

# channel -> (sourceId, videoId, service name): official 24/7 streams verified public, embeddable,
# GB-viewable and not age-restricted by `fetch`.
LIVE: dict[int, tuple[str, str, str]] = {
    946: ("src_sky_news", "xDWQ3LkccY8", "Sky News Live"),
    931: ("src_dw_news", "LuKwFajn37U", "DW News Live"),
    903: ("src_euronews", "pykpO5kQJ98", "Euronews English Live"),
    904: ("src_cna", "XWq5kBlakcQ", "CNA 24/7 Live"),
    932: ("src_abc_news_au", "vOTiJkg1voo", "ABC News Australia Live"),
    905: ("src_africanews", "NQjabLGdP5g", "Africanews English Live"),
    926: ("src_france24_english", "HvZt-nh9sGg", "FRANCE 24 English Live"),
    927: ("src_trt_world", "qBe59l6p_EU", "TRT World Live"),
    928: ("src_wion", "vfszY1JYbMc", "WION Live"),
    929: ("src_nhk_world", "IimtbuqYIE8", "NHK WORLD-JAPAN News Live"),
    907: ("src_bloomberg_tv", "QB5BNdBFujE", "Bloomberg Business News Live"),
    73: ("src_yahoo_finance", "KQp-e_XQnDE", "Yahoo Finance 24/7"),
    922: ("src_fox_weather", "wt6SIE7BXS8", "FOX Weather Live"),
    74: ("src_weathernation", "3dDyjHc8DkA", "WeatherNation Live"),
}


def upload_ids(channel_id: str, pages: int) -> list[str]:
    ids, token = [], None
    for _ in range(pages):
        params = {"pageToken": token} if token else {}
        page = A.fetch("playlistItems", part="contentDetails", playlistId="UU" + channel_id[2:], maxResults=50, **params)
        ids += [item["contentDetails"]["videoId"] for item in page.get("items", [])]
        token = page.get("nextPageToken")
        if not token:
            break
    return ids


def video_records(ids: list[str]) -> list[dict]:
    out = []
    for start in range(0, len(ids), 50):
        batch = A.fetch("videos", part="snippet,contentDetails,status,liveStreamingDetails", id=",".join(ids[start:start + 50]))
        out += batch.get("items", [])
    return out


def compact(video: dict) -> dict:
    snippet, details, status = video["snippet"], video["contentDetails"], video["status"]
    region = details.get("regionRestriction", {})
    return {
        "id": video["id"],
        "title": re.sub(r"\s+", " ", snippet.get("title", "")).strip(),
        "description": snippet.get("description", "")[:400],
        "channelId": snippet.get("channelId"),
        "publishedAt": snippet.get("publishedAt"),
        "seconds": A.seconds(details.get("duration", "")),
        "public": status.get("privacyStatus") == "public",
        "embeddable": bool(status.get("embeddable")),
        "gbBlocked": "GB" in region.get("blocked", []) or ("allowed" in region and "GB" not in region["allowed"]),
        "age": details.get("contentRating", {}).get("ytRating") == "ytAgeRestricted",
        "broadcast": snippet.get("liveBroadcastContent", "none"),
        "wasLive": "liveStreamingDetails" in video,
    }


def fetch() -> None:
    """A failed, empty or quota-stopped fetch keeps the last valid record for that publisher or stream."""
    raw = json.loads(RAW.read_text()) if RAW.exists() else {"publishers": {}, "live": {}}
    only = set(sys.argv[2:])
    stopped = False
    for sid, (channel_id, name, pages) in PUBLISHERS.items():
        if only and sid not in only:
            continue
        previous = raw["publishers"].get(sid)
        try:
            videos = [compact(v) for v in video_records(upload_ids(channel_id, pages))]
        except urllib.error.HTTPError as error:
            print(f"{sid}: fetch failed (HTTP {error.code}); keeping previous record")
            if error.code == 403:
                stopped = True
                break
            continue
        videos = [v for v in videos if v["channelId"] == channel_id]
        if not videos and previous and previous.get("videos"):
            print(f"{sid}: empty response; keeping previous record from {previous.get('fetchedAt')}")
            continue
        raw["publishers"][sid] = {"name": name, "channelId": channel_id, "fetchedAt": now_iso(), "videos": videos}
        print(f"{sid}: {len(videos)} uploads, newest {max((v['publishedAt'] for v in videos), default='-')}")
    if stopped:
        print("quota or permission error: live checks skipped; previous live records kept")
    else:
        by_id = {v["id"]: compact(v) for v in video_records([video for _, video, _ in LIVE.values()])}
        for number, (sid, video, service) in LIVE.items():
            record = by_id.get(video)
            previous = raw["live"].get(str(number))
            if record is None and previous and previous.get("videoId") == video:
                print(f"live {number} {service}: no record returned; keeping previous check from {previous.get('checkedAt')}")
                continue
            ok = bool(record and record["broadcast"] == "live" and record["public"] and record["embeddable"] and not record["gbBlocked"] and not record["age"]
                      and record["channelId"] == PUBLISHERS[sid][0])
            raw["live"][str(number)] = {"sourceId": sid, "videoId": video, "service": service, "verified": ok, "checkedAt": now_iso(),
                                        "title": record["title"] if record else None}
            print(f"live {number} {service}: {'verified' if ok else 'NOT LIVE'}")
    RAW.write_text(json.dumps(raw))


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- classification

# Mirrors src/director/fit.ts BLOCKED_TITLE so nothing is routed that the runtime would refuse.
FIT_BLOCKED = re.compile(
    r"\b(space[\s-]race|spaceflight|space[\s-]flight|space[\s-]station|spacex|astronom(y|ers?)|cosmology|nasa|"
    r"astronauts?|cosmonauts?|satellites?|solar[\s-]system|outer[\s-]space|milky[\s-]way|from space|galax(y|ies)|"
    r"telescopes?|rockets?|moon[\s-]landing|apollo \d+|mars rover|"
    r"sermons?|worship|bible|quran|koran|church service|gospel|hymns?|prayers?|jesus|scripture|psalms?|"
    r"religio(n|us)|ramadan|mosque|synagogue|buddhis[mt]|hindu(ism)?|christianity|islam(ic)?|"
    r"aircraft|airplanes?|aeroplanes?|airliners?|aviation|aviators?|aerospace|aeronautic(s|al)|jetliners?|helicopters?|"
    r"boeing|airbus|concorde|spitfires?|biplanes?|flying boats?|warplanes?|fighter jets?|jet engines?|air ?shows?|"
    r"airports?|aerodromes?|airfields?|airships?|zeppelins?|gliders?|gliding|air ?force|raf|luftwaffe|bombers?|"
    r"fighter (wing|pilots?)|jet pilots?|flying aces?|air ?races?|parachut\w*|cockpit|planes?|plane crash\w*|"
    r"flight simulator|transpacific flight|jets? revolution)\b",
    re.I,
)
# Content rules beyond the runtime list: faith events, flight and space in any form, and formats that are not programmes.
CONTENT_BLOCK = re.compile(
    r"\b(pope|papal|vatican|church(es)?|cathedral|bishops?|archbishop|imam|pilgrim\w*|holy|faith|pray\w*|temples?|sacred|"
    r"flights?|airlines?|pilots?|drones?|space|spacecraft|starlink|orbit\w*|lunar|moon|mars|eclipse|meteor\w*|asteroid|comet|ufos?|uap|"
    r"jetstream|pastors?|leo xiv|f-\d+|air ?bases?|fighter|air travel|air traffic|airspace|"
    r"ultra-orthodox|spiritual\w*|gurus?|astronom\w*|the stars are|hypersonic|air,? (and )?land travel|shorts|"
    r"judaism|rabbis?|catholic\w*|evangelical\w*|clergy|priests?|nuns?|monks?|hajj|shrines?|muslims?|christians?|jewish holiday|"
    r"planets?|exoplanets?|black holes?|dark (matter|energy)|universe|cosmic|multiverse|many worlds|big bang|gravity|relativity|"
    r"sun|solar (flare|wind|storm|eclipse)|supernova|nebula|light.?years?|stellar)\b|#\w+|\blive\b|livestream|watch live|full stream|true crime|48 hours|20/20|the case of|strangler",
    re.I,
)

REGIONS: dict[str, re.Pattern] = {
    "us": re.compile(
        r"\b(u\.s\.?|usa|united states|america(ns?)?(?! ?(latin|south|central))|trump|vance|biden|white house|congress\w*|senat(e|or)s?|"
        r"democrats?|republicans?|gop|washington|pentagon|fbi|cia|ice|supreme court|capitol|midterms?|new york|california|texas|"
        r"florida|chicago|los angeles|ohio|pennsylvania|michigan|arizona|illinois|minnesota|louisiana|virginia|carolina|oregon|"
        r"colorado|nevada|hawaii|alaska|mississippi|tennessee|kentucky|missouri|wisconsin|maryland|massachusetts|epstein)\b", re.I),
    "europe": re.compile(
        r"\b(europe(an)?|eu|brussels|france|french|paris|macron|germany|german|berlin|merz|italy|italian|rome|meloni|spain|spanish|"
        r"madrid|poland|polish|warsaw|ukraine|ukrainian|kyiv|zelensk(y|yy)|russia|russian|moscow|kremlin|putin|netherlands|dutch|"
        r"belgium|sweden|swedish|norway|denmark|danish|finland|greece|greek|athens|portugal|austria|switzerland|swiss|hungary|orban|"
        r"romania|czech|slovakia|serbia|kosovo|bosnia|croatia|moldova|baltic|estonia|latvia|lithuania|ireland|irish|greenland|"
        r"georgia(?!,? us)|armenia|azerbaijan|belarus|balkans?)\b", re.I),
    "asia": re.compile(
        r"\b(china|chinese|beijing|xi jinping|xi|japan|japanese|tokyo|india|indian|delhi|modi|korea|korean|seoul|pyongyang|"
        r"kim jong|taiwan|taipei|singapore|malaysia|indonesia|jakarta|philippines|manila|vietnam|thailand|thai|bangkok|cambodia|"
        r"myanmar|bangladesh|pakistan|afghanistan|taliban|nepal|sri lanka|hong kong|mongolia|kazakhstan|asia(n)?|asean|laos)\b", re.I),
    "pacific": re.compile(
        r"\b(australia(n)?|albanese|canberra|sydney|melbourne|brisbane|perth|adelaide|queensland|victoria|tasmania|new zealand|"
        r"pacific|papua|fiji|solomon|tonga|samoa|vanuatu|chalmers)\b", re.I),
    "africa": re.compile(
        r"\b(africa(n)?|nigeria|kenya|ethiopia|sudan|congo|drc|ghana|senegal|mali|niger|burkina|sahel|somalia|uganda|tanzania|"
        r"rwanda|cameroon|zimbabwe|zambia|mozambique|angola|malawi|namibia|botswana|libya|tunisia|algeria|morocco|chad|"
        r"ivory coast|madagascar|eritrea|gabon|guinea|sierra leone|liberia|togo|benin|ramaphosa|anc|tinubu|ruto|kinshasa|"
        r"nairobi|lagos|johannesburg|khartoum|gauteng|cape town|durban|soweto|eswatini|lesotho)\b", re.I),
    "mideast": re.compile(
        r"\b(middle east|israel(i|is)?|gaza|palestin\w*|west bank|hamas|hezbollah|lebanon|lebanese|beirut|syria(n)?|damascus|"
        r"iran(ian)?|tehran|iraq(i)?|baghdad|yemen(i)?|houthis?|saudi|riyadh|uae|emirates|dubai|qatar|doha|kuwait|bahrain|oman|"
        r"jordan|egypt(ian)?|cairo|netanyahu|turkey|türkiye|erdogan|kurd\w*|abbas|barghouti)\b", re.I),
    "americas": re.compile(
        r"\b(latin america(n)?|south america(n)?|central america(n)?|canada|canadian|ottawa|carney|mexico|mexican|brazil(ian)?|"
        r"lula|argentina|milei|venezuela(n)?|maduro|colombia(n)?|chile(an)?|peru(vian)?|bolivia|ecuador|cuba(n)?|haiti(an)?|"
        r"guatemala|honduras|el salvador|bukele|nicaragua|panama|costa rica|paraguay|uruguay|caribbean|jamaica|puerto rico|"
        r"dominican|toronto|montreal|quebec)\b", re.I),
}


def regions(title: str) -> set[str]:
    found = {name for name, pattern in REGIONS.items() if pattern.search(title)}
    if "americas" in found and not REGIONS["us"].search(re.sub(r"(latin|south|central) america", "", title, flags=re.I)):
        found.discard("us")
    return found


def region_is(*wanted: str, allow_none: bool = False):
    def test(video: dict) -> bool:
        found = regions(video["title"])
        if not found:
            return allow_none
        return found <= set(wanted)
    return test


def words(pattern: str) -> re.Pattern:
    return re.compile(rf"(?<![a-z0-9])(?:{pattern})(?![a-z0-9])", re.I)


def has(pattern: str, title: str) -> bool:
    return bool(words(pattern).search(title))


def matches(pattern: str):
    compiled = words(pattern)
    return lambda video: bool(compiled.search(video["title"]))


def both(*tests):
    return lambda video: all(test(video) for test in tests)


def negate(test):
    return lambda video: not test(video)


WEATHER = r"forecast|weather|storm|hurricane|tropical|typhoon|cyclone|tornado|flood\w*|rain\w*|snow\w*|heat\w*|drought|wildfire|" \
          r"nor'?easter|el ni(n|ñ)o|la ni(n|ñ)a|derecho|lightning|blizzard|monsoon|\bwinds?\b|temperatures?|kelvin wave|frost|fog|" \
          r"thunder\w*|hail|landslide|mudslide|meteorolog\w*"
DOCUMENTARY = r"documentary|full film|storyteller|series \| full episode|witness|101 east|fault lines|people (&|and) power|" \
              r"al jazeera world|correspondent|four corners|dispatches|unreported world|insight|the big picture|reporters|" \
              r"call sign \w+|investigat\w*|special report|in depth|this is why|the wargame"
EPISODE = r"full (episode|broadcast|show)|full epis|east asia tonight|the takeout|^today:|meet the press|this week with|" \
          r"nbc news now|world news tonight|good morning america|news hour full|newsnight|abc news live prime|batya!|on balance|cuomo"
INTERVIEW = r"interview|in conversation|speaks (to|with)|talk to al jazeera|conflict zone|hardtalk|one[- ]on[- ]one|" \
            r"sits down|newsmakers|the bottom line|\| .*\bceo\b|frankly speaking|upfront|head to head|full interview"
ANALYSIS = r"analysis|explained|explainer|this is why|inside story|to the point|sources (&|and) methods|global story|newscast|" \
           r"the dip|al jazeera explains|breakdown|fact.?check|what we know|what it means|decoded|in context|^(why|how|what|is|are|can|could|does|did|will|who|should) .*\?"
MACRO = r"econom\w*|inflation|interest rates?|rate (cut|hike)s?|federal reserve|\bfed\b|central bank|ecb|bank of england|boe|gdp|" \
        r"recession|jobs report|payrolls|unemployment|tariffs?|trade (war|deal)|bond (yields?|market)|treasur(y|ies)|currency|" \
        r"dollar|yuan|yen|budget|deficit|debt ceiling|cpi|mortgage rates?|imf|world bank|oil prices?|opec"
SCIENCE = r"scien\w*|researchers|study (finds|shows|suggests)|discover\w*|species|fossils?|dinosaurs?|\bdna\b|genes?|genetic\w*|" \
          r"vaccines?|medic(al|ine)|brain|cancer|disease|virus|physics|chemistry|archaeolog\w*|quantum|evolution|biolog\w*|" \
          r"neuro\w*|health breakthrough|mathematic\w*|robots?|artificial intelligence"
ENVIRONMENT = r"climate|environment\w*|emissions?|carbon|pollution|plastics?|biodiversity|deforestation|glaciers?|coral|" \
              r"conservation|wildlife|endangered|cop\d\d|renewables?|solar (power|farm|panels?)|wind (farm|power)|fossil fuels?|" \
              r"net zero|ocean(s)? (warming|heat)|sea level|rainforest|amazon (forest|fires?)|extinction|greenpeace|epa"
CULTURE = r"cultur\w*|\barts?\b|artists?|museums?|exhibition|galler(y|ies)|painting|sculpture|theat(re|er)|opera|ballet|" \
          r"festival|novel(ist)?|authors?|new book|book (prize|award|fair|festival)|literature|poet\w*|heritage|unesco|fashion|design(er)?|architect\w*|" \
          r"orchestra|composer|film ?maker|cinema|comedian|comedy|musician|singer|album"
MEDIA = r"\bmedia\b|journalis\w*|press (freedom|ban|pool|corps)|reporters?|newspapers?|broadcast(er|ing)|state-run tv|" \
        r"listening post|propaganda|disinformation|misinformation|social media|tiktok|youtube|netflix|streaming|box office|" \
        r"hollywood|studio|ratings|network tv|advertis\w*|publishing|free speech|first amendment|censorship"
AFFAIRS = r"\bu\.?n\.?\b|united nations|general assembly|unga|security council|nato|g7|g20|summit|diplomac\w*|diplomat\w*|" \
          r"foreign (minister|policy|secretary)|sanctions?|treat(y|ies)|peace (talks|deal|proposal|plan|process)|ceasefire|" \
          r"envoy|ambassador|geopolit\w*|brics|world leaders|state (visit|dinner)|bilateral|alliance|multilateral|global order"
MEDIA_INDUSTRY = r"box office|thr news|variety|industry|studio|streaming|netflix|disney|warner|paramount|universal|sony|amazon|apple tv|" \
                 r"hbo|max\b|peacock|ratings|emmys?|oscars?|golden globes?|awards?|strike|merger|deal|executive|ceo|chief|roundtable|" \
                 r"business|budget|release date|renewed|cancell?ed|showrunner|festival|tiff|venice|cannes|sundance"
NOT_PROMO = r"trailer|teaser|clip\b|sneak peek|red carpet|first look|behind the scenes|bts|reacts?|reaction|#shorts|official video"

NEWS = ["src_sky_news", "src_dw_news", "src_aljazeera_english", "src_france24_english", "src_euronews", "src_cna", "src_abc_news_au",
        "src_wion", "src_africanews", "src_sabc_news", "src_trt_world", "src_cbs_news", "src_nbc_news", "src_abc_news",
        "src_scripps_news", "src_newsnation", "src_pbs_newshour", "src_channel4_news", "src_guardian_news", "src_bbc_news",
        "src_itv_news", "src_reuters", "src_nyt", "src_npr"]
INTL = ["src_aljazeera_english", "src_france24_english", "src_dw_news", "src_trt_world", "src_cna", "src_abc_news_au", "src_wion",
        "src_euronews", "src_sabc_news", "src_africanews", "src_reuters", "src_guardian_news", "src_bbc_news", "src_sky_news",
        "src_channel4_news", "src_itv_news"]
LABELS = ["src_epitaph", "src_sub_pop", "src_nuclear_blast", "src_insideout", "src_vp_records", "src_spinnin", "src_ultra",
          "src_armada", "src_toolroom", "src_ukf_dnb"]
BUSINESS = ["src_bloomberg_tv", "src_yahoo_finance", "src_cnbc", "src_cnbc_international"]
NEW_RELEASE = r"official (music )?video|official visuali[sz]er|\(official\)|\[official"
NOT_NEW = r"remaster\w*|anniversary|\blive\b|live (at|from|in|session)|acoustic|lyric|audio|reaction|behind the scenes|making of|" \
          r"teaser|trailer|mix 20|\bset\b|\bdj mix|yule log|full album|album stream|\d+ years|documentary|interview"

# channel -> dict(identity, freshness days, rules). A rule: sources, min/max seconds, test(video).
# Rules are evaluated in PRIORITY order and each programme joins at most one channel.
CHANNELS: dict[int, dict] = {
    922: dict(identity="FOX Weather: live US weather coverage and its own recent forecasts", freshness=7, family="weather",
              rule="FOX Weather uploads that are weather reporting",
              sources=["src_fox_weather"], min=60, max=3600, test=matches(WEATHER)),
    895: dict(identity="Weather Maps: chart-led long-range and synoptic forecasts", freshness=30, family="weather",
              rule="Met Office 10 Day Trend, Deep Dive, Week Ahead, long-range and Met Office Explains chart briefings",
              sources=["src_met_office"], min=150, max=3600,
              test=matches(r"10 day trend|deep(er)? dive|week ahead|long range|next week|explains|weekend weather|how warm|how cold|how wet|jet stream|pressure")),
    910: dict(identity="Weather (news slot): the latest UK national forecast", freshness=7, family="weather",
              rule="Met Office morning, afternoon and evening UK forecasts",
              sources=["src_met_office"], min=90, max=900, test=matches(r"weather forecast uk|met office weather")),
    911: dict(identity="World Weather: weather and climate events around the world", freshness=14, family="weather",
              rule="Weather-event reports outside the US from international broadcasters and weather publishers",
              sources=INTL + ["src_accuweather", "src_weather_channel", "src_weathernation"], min=60, max=1800,
              test=both(matches(r"hurricane|typhoon|cyclone|tropical storm|winter storm|severe storms?|thunderstorms?|storm surge|"
                                r"monsoon|heatwave|heat wave|floods?|flooding|flash flood|tornado|blizzard|snowstorm|sandstorm|drought|"
                                r"landslide|extreme weather|el ni(n|ñ)o|la ni(n|ñ)a|weather|deluge|downpours?"),
                        negate(region_is("us", allow_none=False)),
                        lambda v: bool(regions(v["title"])) or v["_source"] not in ("src_accuweather", "src_weather_channel", "src_weathernation"))),
    74: dict(identity="Weather: live national weather with recent national forecasts", freshness=14, family="weather",
             rule="WeatherNation, AccuWeather and The Weather Channel national forecast and storm reports",
             sources=["src_weathernation", "src_accuweather", "src_weather_channel"], min=60, max=1800, test=matches(WEATHER)),
    551: dict(identity="New Music: official new releases", freshness=60, family="music",
              rule="Official music videos first published by the label in the window; remasters, anniversaries, live, lyric and audio versions excluded",
              sources=LABELS, min=100, max=600, test=both(matches(NEW_RELEASE), negate(matches(NOT_NEW)))),
    942: dict(identity="Media News: the news, film, television and press industries", freshness=30, family="news-topic",
              rule="Variety and Hollywood Reporter industry news (no trailers, clips or red-carpet junkets) and media-industry reports from news publishers",
              sources=["src_variety", "src_hollywood_reporter"] + NEWS, min=60, max=3600,
              test=lambda v: (has(MEDIA_INDUSTRY, v["title"]) and not has(NOT_PROMO, v["title"])
                              and not re.search(r"emmys 2026|tiff 2026|\| emmys|\| tiff|star .* (says|on|reveals|teases)", v["title"], re.I))
              if v["_source"] in ("src_variety", "src_hollywood_reporter") else has(MEDIA, v["title"])),
    938: dict(identity="World Science: science news", freshness=60, family="news-topic",
              rule="New Scientist uploads and science reports from news publishers (no space, astronomy or flight)",
              sources=["src_new_scientist"] + NEWS, min=60, max=3600,
              test=lambda v: v["_source"] == "src_new_scientist" or has(SCIENCE, v["title"])),
    912: dict(identity="Current Affairs: full editions of current-affairs programmes", freshness=14, family="news-format",
              rule="Full episodes and broadcasts of news and current-affairs programmes",
              sources=NEWS, min=900, max=7200, test=matches(EPISODE)),
    943: dict(identity="Longform News: documentary-length reporting", freshness=180, family="news-format",
              rule="Documentary strands and reported films of 20 minutes or more; bulletins, interviews, speeches and trial coverage excluded",
              sources=NEWS + ["src_cnbc_international", "src_cnbc"], min=1200, max=7200,
              test=both(lambda v: v["_source"] in ("src_cnbc_international", "src_cnbc") or has(DOCUMENTARY, v["title"]),
                        negate(matches(EPISODE + "|" + INTERVIEW + r"|podcast|replay|in full|speech|address|remarks|news conference|"
                                                                  r"press conference|trial|case|court|verdict|murder")))),
    944: dict(identity="News Interviews: long-form news interviews", freshness=60, family="news-format",
              rule="Interview programmes and sit-down interviews from news and business publishers",
              sources=NEWS + ["src_cnbc_international", "src_bloomberg_tv"], min=300, max=5400,
              test=both(matches(INTERVIEW), negate(matches(r"trial|case|court|verdict|murder|backscroll")))),
    917: dict(identity="Economy Today: same-week economy news", freshness=7, family="business",
              rule="Macroeconomic reports: rates, inflation, jobs, trade, currencies and budgets",
              sources=BUSINESS + ["src_reuters", "src_dw_news", "src_france24_english", "src_cna", "src_abc_news_au"], min=90, max=3600,
              test=matches(MACRO)),
    73: dict(identity="Business Today: same-day business bulletins", freshness=3, family="business",
             rule="Yahoo Finance market and company coverage", sources=["src_yahoo_finance"], min=90, max=3600, test=lambda v: True),
    907: dict(identity="Business News: rolling business news", freshness=7, family="business",
              rule="Bloomberg Television markets and company coverage", sources=["src_bloomberg_tv"], min=90, max=3600, test=lambda v: True),
    936: dict(identity="World Business: international business stories", freshness=30, family="business",
              rule="CNBC and CNBC International business reports and company stories", sources=["src_cnbc_international", "src_cnbc"],
              min=120, max=3600, test=lambda v: True),
    939: dict(identity="Environment News: environment and climate news", freshness=30, family="news-topic",
              rule="Climate, environment, wildlife and pollution reports from news publishers", sources=NEWS, min=60, max=3600,
              test=matches(ENVIRONMENT)),
    941: dict(identity="Culture News: arts and culture news", freshness=30, family="news-topic",
              rule="Arts, books, film, music and heritage reports from news publishers", sources=NEWS, min=60, max=3600,
              test=matches(CULTURE)),
    919: dict(identity="Global Affairs: diplomacy and international relations", freshness=21, family="news-topic",
              rule="Diplomacy, summits, the UN, NATO, sanctions and peace processes from international publishers",
              sources=INTL + ["src_pbs_newshour", "src_npr", "src_nyt"], min=90, max=3600, test=matches(AFFAIRS)),
    913: dict(identity="News Analysis: explainers and analysis", freshness=21, family="news-format",
              rule="Explainers, analysis programmes and question-led reports", sources=NEWS, min=180, max=3600, test=matches(ANALYSIS)),
    947: dict(identity="Headlines: short news reports", freshness=4, family="news-format",
              rule="Reports of six minutes or less from BBC News, ITV News, Sky News, Reuters, Guardian News and Channel 4 News",
              sources=["src_bbc_news", "src_itv_news", "src_sky_news", "src_reuters", "src_guardian_news", "src_channel4_news"], min=45, max=360,
              test=negate(matches(ANALYSIS))),
    902: dict(identity="US News: rolling US news", freshness=7, family="news-geo", rule="US reports from CBS News, NBC News and ABC News",
              sources=["src_cbs_news", "src_nbc_news", "src_abc_news"], min=60, max=1800, test=region_is("us", allow_none=True)),
    930: dict(identity="US News Network: rolling US news", freshness=7, family="news-geo",
              rule="US reports from NewsNation, Scripps News and PBS NewsHour",
              sources=["src_newsnation", "src_scripps_news", "src_pbs_newshour"], min=60, max=1800, test=region_is("us", allow_none=True)),
    903: dict(identity="Europe News: rolling Europe news", freshness=7, family="news-geo", rule="euronews reports on Europe",
              sources=["src_euronews"], min=60, max=1800, test=region_is("europe", allow_none=True)),
    931: dict(identity="European News Network: rolling Europe news", freshness=7, family="news-geo", rule="DW News reports on Europe",
              sources=["src_dw_news"], min=60, max=1800, test=region_is("europe")),
    904: dict(identity="Asia News: rolling Asia news", freshness=7, family="news-geo", rule="CNA reports on Asia",
              sources=["src_cna"], min=60, max=1800, test=region_is("asia", allow_none=True)),
    932: dict(identity="Asia-Pacific News: rolling Asia-Pacific news", freshness=7, family="news-geo",
              rule="ABC News (Australia) reports on Australia, the Pacific and Asia", sources=["src_abc_news_au"], min=60, max=1800,
              test=region_is("pacific", "asia", allow_none=True)),
    905: dict(identity="Africa News: rolling Africa news", freshness=7, family="news-geo", rule="africanews reports on Africa",
              sources=["src_africanews"], min=60, max=1800, test=region_is("africa", allow_none=True)),
    933: dict(identity="Africa Report: rolling Africa news", freshness=14, family="news-geo",
              rule="SABC News and international broadcasters' Africa reports",
              sources=["src_sabc_news", "src_aljazeera_english", "src_france24_english", "src_dw_news", "src_trt_world", "src_bbc_news",
                       "src_channel4_news"], min=60, max=1800,
              test=lambda v: region_is("africa", allow_none=v["_source"] == "src_sabc_news")(v)),
    906: dict(identity="Middle East News: rolling Middle East news", freshness=7, family="news-geo",
              rule="Al Jazeera English reports on the Middle East", sources=["src_aljazeera_english"], min=60, max=1800,
              test=region_is("mideast")),
    934: dict(identity="Middle East Report: rolling Middle East news", freshness=10, family="news-geo",
              rule="TRT World, FRANCE 24, DW News, Sky News and BBC News reports on the Middle East",
              sources=["src_trt_world", "src_france24_english", "src_dw_news", "src_sky_news", "src_bbc_news"], min=60, max=1800,
              test=region_is("mideast")),
    935: dict(identity="Americas Report: rolling Americas news", freshness=14, family="news-geo",
              rule="Reports on Canada, Latin America and the Caribbean from international broadcasters",
              sources=INTL + ["src_cbc_news", "src_cbs_news", "src_nbc_news", "src_abc_news", "src_pbs_newshour"], min=60, max=1800,
              test=region_is("americas")),
    926: dict(identity="International News 5: FRANCE 24 English", freshness=7, family="news-publisher",
              rule="FRANCE 24 English reports", sources=["src_france24_english"], min=60, max=1800, test=lambda v: True),
    927: dict(identity="International News 6: TRT World", freshness=7, family="news-publisher",
              rule="TRT World reports", sources=["src_trt_world"], min=60, max=1800, test=lambda v: True),
    928: dict(identity="International News 7: WION", freshness=7, family="news-publisher",
              rule="WION reports", sources=["src_wion"], min=60, max=1800, test=lambda v: True),
    946: dict(identity="Newsroom: rolling UK and world news", freshness=3, family="news-publisher",
              rule="Sky News reports", sources=["src_sky_news"], min=60, max=1800, test=lambda v: True),
}
PRIORITY = [922, 895, 910, 911, 74, 551, 912, 942, 938, 943, 944, 917, 73, 907, 936, 939, 941,
            947, 902, 930, 903, 931, 904, 932, 905, 933, 906, 934, 935, 919, 913, 926, 927, 928, 946]

LIVE_ONLY_IDENTITY = {929: "International News 8: NHK WORLD-JAPAN (on-demand uploads are not embeddable)"}
UNRESOLVED = {
    550: "No official chart programme exists at broadcast volume: Official Charts publishes one 60-second Top 10 clip a week and "
         "Billboard's chart videos are Shorts; pop videos without a verified current chart position would falsify 'Chart'.",
    948: "News Extra has no identity distinct from News (900) and Newsroom (946); any pool would repeat their publishers as filler.",
    949: "Information has no defined news identity; routing general news to it would be spraying, not programming.",
}
# Below this a rolling pool would loop the same few reports all day (src/network/airing.ts MIN_AIRING_SECONDS).
MIN_ROLLING_SECONDS = 3 * 3600


def eligible(video: dict, source: str) -> bool:
    if not (video["public"] and video["embeddable"]) or video["gbBlocked"] or video["age"]:
        return False
    if video["broadcast"] != "none" or video["wasLive"]:
        return False
    title = video["title"]
    if source != "src_met_office" and re.search(r"\bjets?\b", title, re.I):
        return False
    return not (A.BLOCKED.search(title) or FIT_BLOCKED.search(title) or CONTENT_BLOCK.search(title))


def published(video: dict) -> datetime:
    return datetime.fromisoformat(video["publishedAt"].replace("Z", "+00:00"))


def song_key(title: str) -> str:
    return re.sub(r"[^a-z0-9]", "", re.split(r"\(|\[| - official| \| ", title.lower())[0])


def build() -> None:
    raw = json.loads(RAW.read_text())
    doc = json.loads(CATALOGUE.read_text())
    refreshed = max(p["fetchedAt"] for p in raw["publishers"].values())
    anchor = datetime.fromisoformat(refreshed.replace("Z", "+00:00"))
    previous = set(doc.get("published", {}))
    doc["items"] = [row for row in doc["items"] if not (row[0] in previous and not row[4])]
    for number in CHANNELS:
        doc["programmeRoutes"].pop(str(number), None)
    held = {row[0] for row in doc["items"]}
    known_songs = {song_key(row[1]) for row in doc["items"] if row[1] and (row[3] in LABELS or row[3].startswith("src_vevo"))}

    videos: list[dict] = []
    for sid, publisher in raw["publishers"].items():
        for video in publisher["videos"]:
            if video["channelId"] != publisher["channelId"] or not eligible(video, sid):
                continue
            videos.append({**video, "_source": sid})
    assigned: dict[str, int] = {}
    pools: dict[int, list[dict]] = {number: [] for number in CHANNELS}
    for number in PRIORITY:
        spec = CHANNELS[number]
        horizon = anchor - timedelta(days=spec["freshness"])
        for video in videos:
            if video["id"] in assigned or video["id"] in held or video["_source"] not in spec["sources"]:
                continue
            if not (spec["min"] <= video["seconds"] <= spec["max"]) or published(video) < horizon:
                continue
            if number == 551 and song_key(video["title"]) in known_songs:
                continue
            if not spec["test"](video):
                continue
            assigned[video["id"]] = number
            pools[number].append(video)

    if "--dump" in sys.argv:
        Path("/tmp/retrotv-dyn-pools.json").write_text(json.dumps({n: [[v["_source"], v["seconds"], v["title"]] for v in p] for n, p in pools.items()}))
    providers = {"format": "retrotv-dynamic-v1", "version": DYNAMIC_VERSION, "refreshedAt": refreshed, "channels": {}}
    report = []
    active: dict[int, list[dict]] = {}
    for number in sorted(set(CHANNELS) | set(LIVE) | set(LIVE_ONLY_IDENTITY) | set(UNRESOLVED)):
        live = raw["live"].get(str(number))
        live_ok = bool(live and live["verified"])
        spec = CHANNELS.get(number)
        pool = pools.get(number, [])
        seconds = sum(v["seconds"] for v in pool)
        rolling_ok = seconds >= MIN_ROLLING_SECONDS
        if rolling_ok and number not in UNRESOLVED:
            active[number] = pool
        entry: dict = {}
        if number in UNRESOLVED:
            entry = {"mode": "UNRESOLVED", "reason": UNRESOLVED[number]}
        elif live_ok and rolling_ok:
            entry = {"mode": "HYBRID_LIVE_ROLLING"}
        elif live_ok:
            entry = {"mode": "LIVE_STREAM"}
        elif rolling_ok:
            entry = {"mode": "ROLLING_CURRENT"}
        else:
            entry = {"mode": "UNRESOLVED",
                     "reason": f"No verified live stream and only {seconds / 3600:.1f} h of in-window rolling programming "
                               f"(below the 3 h on-air floor)."}
        entry["identity"] = spec["identity"] if spec else LIVE_ONLY_IDENTITY.get(number, "")
        if spec:
            entry["family"] = spec["family"]
        if live_ok and entry["mode"] != "UNRESOLVED":
            entry["live"] = {"sourceId": live["sourceId"], "videoId": live["videoId"], "service": live["service"], "verifiedAt": live["checkedAt"]}
        if spec and entry["mode"] in ("ROLLING_CURRENT", "HYBRID_LIVE_ROLLING"):
            entry["rolling"] = {"freshnessDays": spec["freshness"], "rule": spec["rule"], "sources": sorted({v["_source"] for v in pool}),
                                "programmes": len(pool), "hours": round(seconds / 3600, 2)}
        elif spec and pool:
            entry["rollingCandidate"] = {"freshnessDays": spec["freshness"], "programmes": len(pool), "hours": round(seconds / 3600, 2)}
        providers["channels"][str(number)] = entry
        report.append((number, entry["mode"], len(pool), round(seconds / 3600, 1), live_ok))

    sources = doc["sources"]
    used = {v["_source"] for pool in active.values() for v in pool}
    new_sources = {sid: PUBLISHERS[sid][1] for sid in used if sid not in sources}
    registry = problems([{"id": sid, "handle": PUBLISHERS[sid][0], "name": name, "filter": "dynamic"} for sid, name in new_sources.items()],
                        {**sources, **new_sources})
    if registry:
        raise SystemExit("source-id registry collision:\n  " + "\n  ".join(registry))
    sources.update(new_sources)
    published_map = {}
    rows = []
    for number, pool in sorted(active.items()):
        pool.sort(key=lambda v: v["publishedAt"], reverse=True)
        for video in pool:
            rows.append([video["id"], video["title"], video["seconds"], video["_source"], [], "api"])
            published_map[video["id"]] = video["publishedAt"]
        doc["programmeRoutes"][str(number)] = [video["id"] for video in pool]
    doc["items"] += rows
    doc["published"] = published_map

    for line in report:
        print(*line)
    print("rows", len(rows), "new sources", len(new_sources))
    # Webcam channels are written by scripts/live_cams.py; a rolling rebuild keeps them as they are.
    if PROVIDERS.exists():
        for number, entry in json.loads(PROVIDERS.read_text())["channels"].items():
            if entry.get("mode") == "LIVE_CAMS" and number not in providers["channels"]:
                providers["channels"][number] = entry
    if "--dry" in sys.argv:
        return
    CATALOGUE.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    PROVIDERS.parent.mkdir(parents=True, exist_ok=True)
    PROVIDERS.write_text(json.dumps(providers, indent=2, ensure_ascii=False) + "\n")
    from source_register import write_register  # noqa: E402
    write_register()


if __name__ == "__main__":
    if (sys.argv[1] if len(sys.argv) > 1 else "build") == "fetch":
        fetch()
    else:
        build()
