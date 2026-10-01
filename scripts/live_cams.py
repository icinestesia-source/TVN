"""Release-time webcam channels (850-879).

The shipped application never searches YouTube. This tool runs at development or release time,
entirely keyless, and writes each webcam channel's verified cams into src/data/dynamic/providers.json
as mode LIVE_CAMS; the application then rotates them in ten-minute slots.

  python3 scripts/live_cams.py discover   # YouTube live searches, cached in /tmp
  python3 scripts/live_cams.py build      # re-check every cam on its watch page and write providers.json

A cam ships only if, at verification, it is live now, has been live for at least six hours (a
standing webcam, not an event), plays embedded, is viewable in the UK and is family-safe,
and its title reads as a webcam and passes the network's content rules. Airports, space and faith
channels stay off air, and nothing about flight, space or worship is admitted anywhere.
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROVIDERS = ROOT / "src" / "data" / "dynamic" / "providers.json"
RAW = Path("/tmp/retrotv-cams-raw.json")
CHECKED = Path("/tmp/retrotv-cams-checked.json")
HEADERS = {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    "accept-language": "en-GB,en;q=0.9",
    "cookie": "SOCS=CAI; CONSENT=YES+cb",
}
LIVE_FILTER = "EgJAAQ=="
MIN_LIVE_HOURS = 6
PER_CHANNEL = 80
PER_PUBLISHER = 12


def rx(words: str) -> re.Pattern:
    return re.compile(r"(?<![a-z])(" + words + r")(?![a-z])", re.I)


EUROPE = (
    r"europe|italy|italia|venice|venezia|rome|roma|florence|firenze|milan|milano|naples|napoli|sicily|sicilia|sardinia|amalfi|positano|"
    r"lake como|garda|dolomit\w*|trieste|genoa|genova|bologna|verona|pisa|spain|españa|espana|madrid|barcelona|valencia|seville|sevilla|"
    r"mallorca|majorca|ibiza|tenerife|gran canaria|lanzarote|benidorm|malaga|marbella|france|paris|nice|cannes|marseille|lyon|bordeaux|"
    r"chamonix|germany|deutschland|berlin|munich|münchen|hamburg|cologne|köln|frankfurt|dresden|netherlands|holland|amsterdam|rotterdam|"
    r"utrecht|belgium|brussels|bruges|antwerp|switzerland|schweiz|zermatt|zurich|zürich|geneva|lucerne|interlaken|austria|wien|vienna|"
    r"salzburg|innsbruck|tirol|tyrol|prague|praha|czech|poland|krakow|kraków|warsaw|gdansk|hungary|budapest|croatia|dubrovnik|split|"
    r"slovenia|ljubljana|bled|greece|athens|santorini|mykonos|crete|corfu|rhodes|portugal|lisbon|lisboa|porto|algarve|madeira|ireland|"
    r"dublin|galway|scotland|edinburgh|glasgow|wales|cardiff|england|uk|britain|london|brighton|cornwall|liverpool|manchester|york|"
    r"norway|oslo|bergen|tromsø|tromso|sweden|stockholm|gothenburg|denmark|copenhagen|finland|helsinki|iceland|reykjavik|estonia|tallinn|"
    r"latvia|riga|lithuania|vilnius|malta|valletta|cyprus|monaco|montenegro|kotor|albania|serbia|belgrade|romania|bucharest|bulgaria|"
    r"sofia|luxembourg|andorra|san marino|liechtenstein|faroe"
)
ASIA = (
    r"asia|japan|tokyo|osaka|kyoto|shibuya|shinjuku|akihabara|yokohama|sapporo|hokkaido|okinawa|fukuoka|nagoya|hiroshima|kobe|nara|"
    r"fuji|korea|seoul|busan|taiwan|taipei|kaohsiung|thailand|bangkok|phuket|pattaya|chiang mai|koh samui|vietnam|hanoi|saigon|"
    r"ho chi minh|da nang|singapore|malaysia|kuala lumpur|penang|indonesia|bali|jakarta|philippines|manila|cebu|boracay|india|mumbai|"
    r"delhi|goa|hong kong|macau|china|beijing|shanghai|nepal|kathmandu|sri lanka|maldives|cambodia|laos|mongolia|kazakhstan|uzbekistan|"
    r"dubai|abu dhabi|uae|qatar|doha|oman|muscat|ライブカメラ|東京|大阪"
)
AMERICAS = (
    r"america|usa|u\.s\.|united states|new york|nyc|times square|manhattan|brooklyn|los angeles|hollywood|san francisco|san diego|"
    r"seattle|portland|chicago|boston|miami|orlando|key west|florida|tampa|clearwater|daytona|new orleans|nashville|austin|texas|dallas|"
    r"houston|las vegas|vegas|arizona|phoenix|sedona|colorado|denver|utah|salt lake|jackson hole|wyoming|montana|yellowstone|alaska|"
    r"california|malibu|santa monica|venice beach|huntington|laguna|oregon|washington|maine|vermont|new hampshire|massachusetts|"
    r"cape cod|rhode island|connecticut|new jersey|jersey shore|atlantic city|pennsylvania|philadelphia|pittsburgh|ohio|michigan|detroit|"
    r"wisconsin|minnesota|missouri|st\. louis|kansas|iowa|illinois|indiana|kentucky|tennessee|georgia|atlanta|savannah|carolina|"
    r"myrtle beach|charleston|outer banks|virginia|maryland|baltimore|ocean city|delaware|washington dc|louisiana|mississippi|alabama|"
    r"gulf shores|arkansas|oklahoma|nebraska|dakota|idaho|nevada|lake tahoe|new mexico|canada|toronto|vancouver|montreal|quebec|"
    r"ottawa|calgary|banff|niagara|nova scotia|halifax|mexico|méxico|cancun|cancún|playa del carmen|tulum|cabo|puerto vallarta|"
    r"caribbean|jamaica|bahamas|aruba|curaçao|curacao|barbados|puerto rico|st\. maarten|sint maarten|cayman|bermuda|dominican|"
    r"punta cana|cuba|costa rica|panama|belize|guatemala|honduras|brazil|brasil|rio de janeiro|são paulo|sao paulo|argentina|"
    r"buenos aires|chile|santiago|peru|lima|colombia|bogotá|bogota|cartagena|medellín|medellin|ecuador|uruguay|montevideo|patagonia"
)
AFRICA = (
    r"africa|south africa|cape town|johannesburg|durban|kruger|kenya|nairobi|mombasa|namibia|namib|botswana|okavango|tanzania|"
    r"serengeti|zanzibar|kilimanjaro|morocco|marrakech|casablanca|egypt|cairo|giza|pyramids|tunisia|ghana|accra|nigeria|lagos|senegal|"
    r"dakar|madagascar|mauritius|seychelles|uganda|rwanda|zambia|zimbabwe|victoria falls|ethiopia|africam|djuma|tembe|mpala|sabi sand"
)
PACIFIC = (
    r"australia|sydney|melbourne|brisbane|perth|adelaide|darwin|cairns|gold coast|sunshine coast|bondi|manly|byron|queensland|"
    r"tasmania|hobart|new zealand|auckland|wellington|queenstown|christchurch|rotorua|hawaii|hawai'i|honolulu|waikiki|maui|oahu|"
    r"kauai|kona|big island|fiji|tahiti|bora bora|samoa|tonga|guam|vanuatu|cook islands"
)

# number -> (name, identity, searches, what the title must mention or None). Mixed channels draw on every cam.
CHANNELS: dict[int, tuple[str, str, list[str], str | None]] = {
    850: ("Live World", "Live World: famous places live, around the clock", [
        "famous landmarks live cam", "live cam 4k world", "eiffel tower live cam", "times square live cam", "shibuya crossing live cam",
        "venice live cam", "niagara falls live cam", "sydney harbour live cam", "dubai live cam", "abbey road live cam",
        "rome live cam trevi", "prague live cam", "santorini live cam", "rio de janeiro live cam", "hong kong live cam",
    ], None),
    851: ("World Cams", "World Cams: live webcams from every continent", [
        "world live cams 24/7", "live webcam 24/7", "earthcam live", "skylinewebcams live", "live camera stream 4k",
        "webcam en direct", "webcam live italia", "live webcam germany", "ライブカメラ 24時間", "live cam village square",
        "town square live cam", "live cam plaza", "live cam market square",
    ], None),
    852: ("City Cams", "City Cams: city streets and skylines live", [
        "city live cam", "city skyline live cam", "downtown live cam", "live street cam", "tokyo live cam", "paris live cam",
        "berlin live cam", "barcelona live cam", "chicago live cam", "las vegas live cam", "new orleans live cam", "seoul live cam",
        "bangkok live cam", "amsterdam live cam", "istanbul live cam", "toronto live cam", "singapore live cam",
    ], r"city|town|downtown|street|square|skyline|plaza|avenue|centre|center|district|crossing|strip|old town|" + EUROPE + "|" + ASIA + "|" + AMERICAS),
    853: ("London Live", "London Live: London's streets and river live", [
        "london live cam", "abbey road live cam", "london thames live cam", "tower bridge live cam", "london street live cam",
        "piccadilly live cam", "london skyline live", "westminster live cam", "london traffic live camera", "camden live cam",
        "london webcam", "london live camera 24/7", "river thames webcam", "london bridge live cam", "canary wharf live cam",
        "greenwich live cam", "london eye live cam", "trafalgar square live", "big ben live cam", "london city view live",
        "london rooftop live cam", "london weather cam live", "st pauls live cam", "kings cross live cam", "london marathon cam",
        "thames barrier live", "london docklands live cam", "london from above live", "earthcam london", "london live view",
    ], r"london|thames|abbey road|westminster|piccadilly|trafalgar|tower bridge|big ben|camden|soho|oxford street|canary wharf|greenwich|kings cross"),
    854: ("New York Live", "New York Live: New York City live", [
        "new york live cam", "times square live cam", "nyc live cam", "manhattan skyline live cam", "brooklyn bridge live cam",
        "new york street live cam", "earthcam new york", "nyc harbor live cam", "central park live cam", "hudson river live cam",
    ], r"new york|nyc|manhattan|times square|brooklyn|queens|bronx|staten island|central park|hudson|empire state|wall street|fifth avenue|5th avenue"),
    855: ("Europe Live", "Europe Live: Europe's towns, cities and coasts live", [
        "europe live cam", "italy live cam", "spain live cam", "france live cam", "germany live webcam", "switzerland live cam",
        "austria live cam", "greece live cam", "portugal live cam", "netherlands live cam", "norway live cam", "croatia live cam",
        "ireland live cam", "scotland live cam", "iceland live cam", "prague live cam", "budapest live cam", "malta live cam",
    ], EUROPE),
    856: ("Asia Live", "Asia Live: Asia's cities and coasts live", [
        "japan live cam", "tokyo live camera", "osaka live cam", "korea live cam", "taiwan live cam", "thailand live cam",
        "vietnam live cam", "bali live cam", "philippines live cam", "hong kong live cam", "singapore live cam", "india live cam",
        "nepal live cam", "maldives live cam", "ライブカメラ 東京", "ライブカメラ 海", "dubai live cam",
    ], ASIA),
    857: ("Americas Live", "Americas Live: North, Central and South America live", [
        "usa live cam", "florida live cam", "california live cam", "canada live cam", "mexico live cam", "caribbean live cam",
        "brazil live cam", "argentina live cam", "key west live cam", "jackson hole live cam", "banff live cam", "costa rica live cam",
        "puerto rico live cam", "chile live cam", "colombia live cam", "hawaii live cam", "alaska live cam",
    ], AMERICAS),
    858: ("Africa Live", "Africa Live: Africa's wildlife, cities and coasts live", [
        "africa live cam", "africam live", "south africa live cam", "cape town live cam", "namibia waterhole live cam",
        "kenya live cam", "botswana live cam", "tanzania live cam", "morocco live cam", "egypt live cam", "kruger live cam",
        "mauritius live cam", "zanzibar live cam", "safari live cam 24/7",
    ], AFRICA),
    859: ("Australia & Pacific", "Australia & Pacific: Australia, New Zealand and the islands live", [
        "australia live cam", "sydney live cam", "gold coast live cam", "bondi beach live cam", "melbourne live cam",
        "new zealand live cam", "queenstown live cam", "hawaii live cam", "waikiki live cam", "maui live cam", "fiji live cam",
        "tahiti live cam", "perth live cam", "brisbane live cam",
    ], PACIFIC),
    860: ("Beaches Live", "Beaches Live: beaches and surf live", [
        "beach live cam", "beach cam 24/7", "surf cam live", "playa live cam", "praia ao vivo", "plage webcam en direct",
        "spiaggia webcam live", "florida beach live cam", "hawaii beach live cam", "australia beach cam live", "caribbean beach live cam",
        "boardwalk live cam", "beach bar live cam", "tropical beach live cam", "strand webcam live",
    ], r"beach|playa|praia|plage|spiaggia|strand|surf|shore|coast|boardwalk|pier|seafront|beachfront|sea view|ocean view|seaside|lido|bay|waikiki|bondi"),
    861: ("Harbours Live", "Harbours Live: harbours, ports and marinas live", [
        "harbor live cam", "harbour live cam", "port live cam ships", "marina live cam", "ship cam live", "ferry live cam",
        "port of rotterdam live", "ship traffic live cam", "lighthouse live cam", "fishing harbour live cam", "canal boats live cam",
        "cruise port live cam", "bay live cam boats", "yacht harbour live cam", "hamburg port live cam",
    ], r"harbou?r|port|marina|dock|docks|pier|ferry|ferries|ships?|shipping|boats?|yachts?|lighthouse|quay|seaport|cruise|waterfront|canal|bay|strait|channel|locks?"),
    863: ("Railcams", "Railcams: railways and stations live", [
        "railcam live", "train cam live", "virtual railfan live", "railroad live cam", "train station live cam", "railway live cam uk",
        "japan train live camera", "trein live cam", "bahn live cam", "railfan live 24/7", "freight train live cam",
        "tram live cam", "metro live cam", "level crossing live cam", "電車 ライブカメラ",
    ], r"rail|rails|railway|railroad|railcam|railfan|train|trains|station|junction|crossing|trein|bahn|tram|metro|subway|locomotive|freight|amtrak|電車|鉄道"),
    864: ("Roads & Traffic", "Roads & Traffic: roads, junctions and bridges live", [
        "traffic live cam", "highway live cam", "motorway live camera", "intersection live cam", "freeway live cam",
        "traffic camera live 24/7", "bridge traffic live cam", "shibuya scramble live", "tunnel live cam", "road live cam",
        "interstate live cam", "busy intersection live", "roundabout live cam", "toll plaza live cam",
    ], r"traffic|road|roads|highway|motorway|freeway|interstate|intersection|crossing|street|bridge|junction|avenue|boulevard|tunnel|roundabout|scramble|toll|route"),
    865: ("Mountains Live", "Mountains Live: mountains and ski slopes live", [
        "mountain live cam", "alps live cam", "ski resort live cam", "zermatt live cam", "matterhorn live cam", "rocky mountains live cam",
        "jackson hole live cam", "whistler live cam", "dolomites live cam", "chamonix live cam", "glacier live cam", "mount fuji live cam",
        "everest live cam", "snow live cam", "bergwebcam live",
    ], r"mountains?|alps|alpine|ski|snow|peak|summit|glacier|valley|resort|matterhorn|zermatt|everest|rockies|rocky|jackson hole|mont|berg|piste|dolomit\w*|fuji|whistler|aspen|vail|chamonix|tatra|himalaya\w*|andes|pass"),
    866: ("Rivers Live", "Rivers Live: rivers, lakes and falls live", [
        "river live cam", "niagara falls live cam", "waterfall live cam", "rhine live cam", "danube live cam", "mississippi river live cam",
        "lake live cam", "canal live cam", "thames live cam", "seine live cam", "river boats live cam", "locks live cam river",
        "lake tahoe live cam", "lake geneva live cam", "fjord live cam",
    ], r"rivers?|rhine|rhein|danube|donau|thames|seine|mississippi|niagara|falls|waterfall|lock|locks|canal|creek|dam|lake|lakes|fjord|loch|stream|reservoir"),
    867: ("Weather Live", "Weather Live: skies and weather live", [
        "weather cam live", "sky cam live", "live weather camera", "cloud cam live", "sunset live cam", "sunrise live cam",
        "snow cam live", "rain live cam", "fog live cam", "weather webcam 24/7", "skyline weather cam", "wind live cam",
    ], r"weather|sky|skies|clouds?|sunset|sunrise|snow|rain|fog|wind|storm|forecast|skyline|horizon|panorama"),
    868: ("Storm Cams", "Storm Cams: waves, wind, snow and storms live", [
        "storm live cam", "waves live cam", "big waves live cam", "lightning live cam", "tornado cam live", "hurricane live cam",
        "blizzard live cam", "storm watch live cam", "wave cam live 24/7", "surf report live cam", "typhoon live camera", "台風 ライブカメラ",
    ], r"storm|storms|thunder|lightning|tornado|hurricane|typhoon|cyclone|waves?|surf|rain|wind|blizzard|snow|台風"),
    869: ("Wildlife Live", "Wildlife Live: wild animals live", [
        "wildlife live cam", "animal live cam", "explore.org live", "africam live", "waterhole live cam", "bear cam live",
        "wolf live cam", "deer cam live", "elephant live cam", "nature cam live 24/7", "forest live cam animals", "pond live cam wildlife",
        "beaver cam live", "fox cam live", "safari live cam",
    ], r"wildlife|animals?|africam|waterhole|safari|bears?|wolf|wolves|deer|elephants?|lions?|giraffes?|nature|forest|beavers?|moose|raccoons?|fox|foxes|explore|pond|hippo\w*|rhino\w*|zebras?|badgers?|otters?|squirrels?|feeder|nest|wild"),
    870: ("Bird Cams", "Bird Cams: nests and feeders live", [
        "bird cam live", "bird feeder live cam", "eagle cam live", "osprey cam live", "owl cam live", "nest cam live",
        "cornell bird cams", "falcon cam live", "stork live cam", "puffin cam live", "hummingbird cam live", "penguin cam live",
        "heron cam live", "albatross cam live", "vogel webcam live",
    ], r"birds?|eagles?|osprey|owls?|hawks?|falcons?|storks?|herons?|nests?|feeder|puffins?|penguins?|albatross|hummingbirds?|swans?|ducks?|kingfisher|robins?|cornell|feederwatch|vogel\w*|kestrel|condor|cranes?|pelicans?|flamingos?|parrots?"),
    871: ("Ocean Cams", "Ocean Cams: under the sea and along the shore live", [
        "underwater live cam", "reef cam live", "aquarium live cam", "jellyfish cam live", "shark cam live", "kelp forest cam live",
        "ocean live cam", "sea live cam", "coral reef live cam", "whale cam live", "sea otter cam live", "fish tank live cam 24/7",
        "monterey bay aquarium live", "sea lion cam live",
    ], r"ocean|sea|reef|coral|underwater|aquarium|jellyfish|jellies|sharks?|whales?|dolphins?|kelp|fish|seals?|otters?|sea lions?|marine|bay|shore|coast|waves?"),
    872: ("Zoos & Sanctuaries", "Zoos & Sanctuaries: zoos, rescues and farms live", [
        "zoo live cam", "animal sanctuary live cam", "panda cam live", "giraffe cam live", "elephant sanctuary live cam", "gorilla cam live",
        "koala cam live", "otter cam live", "farm animals live cam", "puppy cam live", "rescue live cam animals", "goat cam live",
        "horse live cam", "pig sanctuary live cam", "donkey sanctuary live cam",
    ], r"zoo|sanctuary|aquarium|rescue|pandas?|elephants?|giraffes?|gorillas?|penguins?|otters?|koalas?|shelter|farm|pigs?|goats?|horses?|donkeys?|puppy|puppies|dogs?|alpacas?|llamas?|sloths?|lemurs?|meerkats?|rhinos?|zebras?|tigers?|lions?|bears?"),
    875: ("Aurora Live", "Aurora Live: the northern lights and Arctic skies live", [
        "northern lights live cam", "aurora live cam", "aurora borealis live", "lapland live cam", "abisko live cam",
        "churchill northern lights live", "yellowknife aurora live", "tromso live cam", "iceland live cam night", "fairbanks aurora cam",
        "kiruna live cam", "finland aurora live",
    ], r"aurora|northern lights|borealis|lapland|abisko|churchill|yellowknife|tromsø|tromso|fairbanks|kiruna|iceland|arctic|polar|norway|finland|svalbard|greenland"),
    876: ("Volcano Cams", "Volcano Cams: volcanoes live", [
        "volcano live cam", "volcano webcam 24/7", "iceland volcano live", "etna live cam", "stromboli live cam", "kilauea live cam",
        "popocatepetl live cam", "sakurajima live camera", "fuego volcano live", "lava live cam", "桜島 ライブカメラ", "vulkan webcam live",
    ], r"volcano\w*|volcan\w*|vulkan\w*|eruption|lava|kilauea|kīlauea|etna|stromboli|fagradalsfjall|reykjanes|grindav\w*|popocat\w*|sakurajima|fuego|mauna|桜島|火山"),
    877: ("Slow World", "Slow World: quiet places live, nothing hurried", [
        "relaxing live cam", "slow tv live", "peaceful live cam 4k", "garden live cam", "lake view live cam", "countryside live cam",
        "village live cam", "forest live cam 24/7", "pond live cam", "meadow live cam", "harbour view relaxing live", "calm sea live cam",
    ], None),
    878: ("Night Cams", "Night Cams: cities and skies after dark, live", [
        "night city live cam", "night sky live cam", "city lights live cam", "live cam at night", "skyline night live cam",
        "neon live cam", "starry sky live cam", "moonrise live cam", "night street live cam", "tokyo night live cam",
    ], None),
    879: ("Cat Cams", "Cat Cams: cats and kittens live", [
        "cat cam live", "kitten cam live", "cats live stream 24/7", "kitten academy live", "cat cafe live cam", "cat shelter live cam",
        "foster kittens live", "cat rescue live cam", "cats live 24/7 cam", "猫 ライブカメラ", "kitty cam live", "cat house live cam",
        "sanctuary cats live", "big cat rescue live",
    ], r"cats?|kittens?|kitty|kitties|feline|meow|neko|猫|ねこ|ネコ|catcafe"),
}
MIXED = {850, 851, 877, 878}
NEVER = {862, 873, 874}

CAMISH = re.compile(
    r"(web)?cams?\b|webcam|camera|kamera|cámara|camara|câmera|telecamera|ライブカメラ|live ?view|live ?feed|livecam|railcam|railfan|"
    r"live stream(ing)? (from|of)|streaming from|en direct|ao vivo|in diretta|en vivo|24/7|live 24",
    re.I,
)
AVOID = {
    853: re.compile(r"ontario|canada|new london|little london|connecticut|\bct\b|jamaica|kentucky|ohio", re.I),
    879: re.compile(r"\b(birds?|birdies|squirrels?|chipmunks?|feeders?|lizards?|frogs?|mice|mouse|bugs|pet games)\b", re.I),
}
CAM_PUBLISHER = re.compile(r"cam|webcam|railfan|explore|live ?view|skyline|teleport|kitten academy|africam|cornell", re.I)
BLOCK = re.compile(
    r"\b(church(es)?|cathedral|basilica|chapel|mosque|temple|shrine|monastery|vatican|pope|papal|pray\w*|worship|holy|sacred|mass|sermon|"
    r"bible|quran|mecca|makkah|medina|kaaba|jerusalem|western wall|pilgrim\w*|"
    r"airports?|aircraft|airplanes?|aeroplanes?|planes?|plane ?spotting|spotting|runway|aviation|airlines?|flights?|jets?|helicopters?|"
    r"heliport|air ?shows?|lax|jfk|heathrow|gatwick|schiphol|"
    r"space|iss|nasa|spacex|starbase|starship|rockets?|launch|satellites?|orbit\w*|telescopes?|astronom\w*|planets?|moon ?landing|"
    r"earth from space|"
    r"lofi|lo-fi|beats|radio|playlist|podcast|asmr|dj set|music video|concert|karaoke|jazz|"
    r"couples?|living room|real life|"
    r"minecraft|fortnite|gta|roblox|gameplay|gaming|simulator|train sim|euro truck|"
    r"breaking news|news live|live news|24/7 news|election|protest|war|gaza|ukraine|israel|russia|frontline|police scanner|shooting|"
    r"bitcoin|crypto|trading|forex|stocks?|chat ?room|q&a|"
    r"bikini|sexy|nude|hot girls?|onlyfans|twerk|"
    r"screensaver|ambien(ce|t)|relaxing music|sleep music|study music|meditation|rain sounds|fireplace|drone footage|walking tour|"
    r"walk|walking|irl|driving|dashcam|replay|timelapse|time-lapse|highlights|compilation|best of|recorded|funny|cartoons?|episodes?|"
    r"tom and jerry|movie|film|chase|chasing|chasers?)\b",
    re.I,
)
NOISE = re.compile(
    r"[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F]|#\S+|\b(live|4k|8k|hd|uhd|24/7|24h|webcam|web cam|cam|camera|stream(ing)?|"
    r"streamed|now|ライブカメラ|livecam|live ?view|in live|en direct|ao vivo|in diretta|en vivo)\b|\(\s*\)|\[\s*\]",
    re.I,
)


def search(query: str) -> list[dict]:
    url = "https://www.youtube.com/results?" + urllib.parse.urlencode({"search_query": query, "sp": LIVE_FILTER})
    html = urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=30).read().decode("utf-8", "replace")
    match = re.search(r"var ytInitialData = (\{.*?\});</script>", html)
    if not match:
        return []
    found: list[dict] = []

    def walk(node: object) -> None:
        if isinstance(node, dict):
            video = node.get("videoRenderer")
            if isinstance(video, dict) and "videoId" in video:
                owner = (video.get("ownerText") or {}).get("runs") or [{}]
                found.append({
                    "id": video["videoId"],
                    "title": "".join(run.get("text", "") for run in (video.get("title") or {}).get("runs", [])),
                    "publisher": owner[0].get("text", ""),
                })
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(json.loads(match.group(1)))
    return found


def discover() -> None:
    raw = json.loads(RAW.read_text()) if RAW.exists() else {"searches": {}}
    for number, (_, _, queries, _) in CHANNELS.items():
        for query in queries:
            if query in raw["searches"]:
                continue
            try:
                raw["searches"][query] = search(query)
            except Exception as error:  # noqa: BLE001
                print(f"{number} {query!r}: search failed ({type(error).__name__})")
                continue
            print(f"{number} {query!r}: {len(raw['searches'][query])} live results")
            time.sleep(0.4)
    RAW.write_text(json.dumps(raw, ensure_ascii=False))


def watch_record(video_id: str) -> dict | None:
    """The public watch page's own player record, read keylessly: what an embed from the UK would get."""
    url = "https://www.youtube.com/watch?" + urllib.parse.urlencode({"v": video_id})
    html = urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=30).read().decode("utf-8", "replace")
    match = re.search(r"var ytInitialPlayerResponse = (\{.*?\});(?:var|</script>)", html)
    if not match:
        return None
    player = json.loads(match.group(1))
    details = player.get("videoDetails", {})
    playability = player.get("playabilityStatus", {})
    micro = player.get("microformat", {}).get("playerMicroformatRenderer", {})
    live = micro.get("liveBroadcastDetails", {})
    watching = re.search(r'"([\d,.]+) watching( now)?"', html)
    return {
        "title": details.get("title", ""),
        "publisher": details.get("author", ""),
        "channelId": details.get("channelId", ""),
        "isLive": bool(details.get("isLive")) and bool(live.get("isLiveNow")),
        "startedAt": live.get("startTimestamp"),
        "ended": bool(live.get("endTimestamp")),
        "playable": playability.get("status") == "OK",
        "embeddable": bool(playability.get("playableInEmbed")),
        "familySafe": micro.get("isFamilySafe", True) is not False,
        "countries": micro.get("availableCountries") or [],
        "viewers": int(re.sub(r"[^\d]", "", watching.group(1)) or 0) if watching else 0,
    }


def records(ids: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}

    def one(video_id: str) -> tuple[str, dict | None]:
        try:
            return video_id, watch_record(video_id)
        except Exception:  # noqa: BLE001
            return video_id, None

    with ThreadPoolExecutor(max_workers=8) as pool:
        for done, (video_id, record) in enumerate(pool.map(one, ids), 1):
            if record:
                out[video_id] = record
            if done % 250 == 0:
                print(f"  checked {done}/{len(ids)}")
    return out


def standing(video: dict, now: datetime) -> bool:
    """Live now and for hours already, playable embedded, viewable in the UK and open to all."""
    started = video["startedAt"]
    return bool(
        video["isLive"]
        and not video["ended"]
        and video["playable"]
        and video["embeddable"]
        and video["familySafe"]
        and (not video["countries"] or "GB" in video["countries"])
        and started
        and datetime.fromisoformat(started.replace("Z", "+00:00")) <= now - timedelta(hours=MIN_LIVE_HOURS)
    )


def display_name(title: str, publisher: str) -> str:
    text = NOISE.sub(" ", title)
    parts = [re.sub(r"\s+", " ", part).strip(" -–—|·:,.!") for part in re.split(r"\s[-–—|·:]\s|\s\|\s|\|", text)]
    parts = [part for part in parts if len(part) > 2 and part.lower() != publisher.lower() and not re.fullmatch(r"(from|of|in|at|the)\b.*", part, re.I)]
    name = " · ".join(parts[:2]) if parts else publisher or title
    return (name[:72].rsplit(" ", 1)[0] + "…") if len(name) > 74 else name


def publisher_rotation(cams: list[dict]) -> list[dict]:
    """Most-watched first, but never the same publisher twice running while another has a cam left."""
    queues: dict[str, list[dict]] = {}
    for cam in sorted(cams, key=lambda item: -item["viewers"]):
        queues.setdefault(cam["publisher"], []).append(cam)
    order: list[dict] = []
    while any(queues.values()):
        for name in sorted(queues, key=lambda key: -(queues[key][0]["viewers"] if queues[key] else -1)):
            if queues[name]:
                order.append(queues[name].pop(0))
    return order


def build() -> None:
    raw = json.loads(RAW.read_text())
    found: dict[int, dict[str, dict]] = {}
    for number, (_, _, queries, _) in CHANNELS.items():
        for query in queries:
            for item in raw["searches"].get(query, []):
                found.setdefault(number, {}).setdefault(item["id"], item)
    ids = sorted({video for per in found.values() for video in per})
    print(f"{len(ids)} distinct live results to verify")
    now = datetime.now(timezone.utc)
    cache = json.loads(CHECKED.read_text()) if CHECKED.exists() else {}
    fresh = cache.get("checkedAt") and datetime.fromisoformat(cache["checkedAt"]) > now - timedelta(hours=2)
    known = set(cache.get("ids", [])) if fresh else set()
    verified = {**(cache["records"] if fresh else {}), **records([video_id for video_id in ids if video_id not in known])}
    CHECKED.write_text(json.dumps({"checkedAt": cache["checkedAt"] if fresh else now.isoformat(), "ids": sorted(known | set(ids)), "records": verified}))
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    def admissible(video_id: str) -> dict | None:
        video = verified.get(video_id)
        if not video or not standing(video, now):
            return None
        title = re.sub(r"\s+", " ", video["title"]).strip()
        publisher = video["publisher"]
        if BLOCK.search(title) or BLOCK.search(publisher):
            return None
        if not (CAMISH.search(title) or CAM_PUBLISHER.search(publisher)):
            return None
        return {
            "sourceId": "yt:" + video["channelId"],
            "videoId": video_id,
            "service": display_name(title, publisher),
            "publisher": publisher,
            "verifiedAt": stamp,
            "title": title,
            "viewers": video["viewers"],
        }

    cams: dict[int, list[dict]] = {}
    everything: dict[str, dict] = {}
    for number, (_, _, _, must) in CHANNELS.items():
        wanted = re.compile(r"(?<![a-z])(" + must + r")(?![a-z])", re.I) if must else None
        chosen = []
        for video_id in found.get(number, {}):
            cam = admissible(video_id)
            if not cam:
                continue
            everything[video_id] = cam
            if wanted and not wanted.search(cam["title"] + " " + cam["publisher"]):
                continue
            if number in AVOID and AVOID[number].search(cam["title"] + " " + cam["publisher"]):
                continue
            chosen.append(cam)
        cams[number] = chosen
    # The mixed channels fill out from every verified cam once their own searches are in.
    for number in MIXED:
        have = {cam["videoId"] for cam in cams[number]}
        extra = [cam for cam in sorted(everything.values(), key=lambda item: -item["viewers"]) if cam["videoId"] not in have]
        cams[number] = cams[number] + extra

    doc = json.loads(PROVIDERS.read_text())
    for number, (name, identity, _, _) in CHANNELS.items():
        if number in NEVER:
            continue
        per_publisher: dict[str, int] = {}
        kept = []
        for cam in publisher_rotation(cams[number]):
            if per_publisher.get(cam["publisher"], 0) >= PER_PUBLISHER:
                continue
            per_publisher[cam["publisher"]] = per_publisher.get(cam["publisher"], 0) + 1
            kept.append({key: cam[key] for key in ("sourceId", "videoId", "service", "publisher", "verifiedAt")})
            if len(kept) >= PER_CHANNEL:
                break
        if kept:
            doc["channels"][str(number)] = {"mode": "LIVE_CAMS", "identity": identity, "cams": kept}
        else:
            doc["channels"].pop(str(number), None)
        print(f"{number} {name}: {len(kept)} cams from {len(per_publisher)} publishers")
    if "--dry" in sys.argv:
        return
    PROVIDERS.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    {"discover": discover, "build": build}[sys.argv[1]]()
