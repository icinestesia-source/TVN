#!/usr/bin/env python3
"""Targeted acquisition: one named official YouTube source per channel need.

Adds (or refreshes) rows in public/independent/playable.json for the sources in
TARGETS only. Every video is checked with videos.list: public, embeddable, not
live, not age-restricted, viewable in GB, within the duration window, and free
of blocked subjects. Nothing is downloaded; playback stays on the IFrame player.

  python3 scripts/add_targeted_sources.py --probe @Handle ...   # resolve handles only
  python3 scripts/add_targeted_sources.py                       # refresh TARGETS
  python3 scripts/add_targeted_sources.py --only src_a src_b    # refresh some TARGETS
"""
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://www.googleapis.com/youtube/v3/"
CATALOGUE = Path("public/independent/playable.json")
DESCRIPTIONS = Path("/tmp/retrotv-descriptions.json")
# videoId -> upload day (YYYY-MM-DD) as the Data API reports it; written to the catalogue's `uploaded` map.
UPLOADED: dict[str, str] = {}
sys.path.insert(0, str(Path(__file__).parent))
from validate_youtube_catalogue import BLOCKED  # noqa: E402
from source_registry import assert_registry  # noqa: E402

NO_AIR_OR_SPACE = (r"#shorts|\blive\b|podcast|q ?& ?a|flight|airline|airport|aircraft|aviation|\bplanes?\b|\bjets?\b|helicopter|drones?\b|"
                   r"\bspace\b|rocket|satellite|nasa|spacex|orbit|lunar|\bmoon\b|\bmars\b|astronom|telescope")
P17_EXCLUDE = (NO_AIR_OR_SPACE + r"|trailer|teaser|promo|sneak peek|announcement|coming soon|red carpet|premiere event|waiting room|"
               r"sponsored|reaction|reacts|compilation|best (moments|of)|supercut|recap|bloopers|clip\b|\bclips\b|interview only|"
               r"church|chapel|religio|bible|prayer|\bgod\b")
P17_ANIME_EXCLUDE = P17_EXCLUDE + r"|\bamv\b|fan ?made|fan edit|opening theme|ending theme|creditless|\bpv\b|\bcm\b|livestream|premiere|preview"
P18_EXCLUDE = (P17_EXCLUDE + r"|webinar|press conference|press briefing|highlights|in \d+ (seconds|minutes)|shop|gift guide|unboxing|haul|giveaway|"
               r"subscribe|merch|faith|worship|sermon|theolog|mosque|temple|cathedral|pilgrim|astrophysic|cosmolog|galax|exoplanet")
GRUNGE_EXCLUDE = (r"official audio|\baudio\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|unboxing|"
                  r"\bpreview\b|announce|pre-?order|out now|available now|merch|podcast|reaction|\bad\b|commercial|\bspot\b")
MUSIC_EXCLUDE = GRUNGE_EXCLUDE + r"|listening party|q ?& ?a|livestream|premiere|behind the scenes|reacts?\b|gospel|hymn|worship"
GRUNGE_ACTS = (r"nirvana|kurt cobain|pearl jam|eddie vedder|soundgarden|chris cornell|alice in chains|layne staley|jerry cantrell|mudhoney|"
               r"screaming trees|mark lanegan|melvins|\btad\b|green river|mother love bone|temple of the dog|mad season|stone temple pilots|"
               r"scott weiland|courtney love|^hole\b|^l7\b|babes in toyland|the gits|7 year bitch|skin yard|malfunkshun|\bgrunge\b")

# channel need -> source. channels: where rows are nominated; fit.ts decides airing.
TARGETS = [
    {"id": "src_orbital_bacon", "handle": "@OrbitalBacon", "name": "Orbital Bacon", "channels": [225], "min": 1200, "max": 400,
     "filter": r"saturday morning cartoons vol"},
    {"id": "src_iihf", "handle": "@IIHF", "name": "IIHF", "channels": [371], "min": 240, "max": 300},
    {"id": "src_wtt", "handle": "@WTTGlobal", "name": "World Table Tennis", "channels": [377], "min": 300, "max": 300},
    {"id": "src_pdc", "handle": "@OfficialPDC", "name": "Professional Darts Corporation", "channels": [367], "min": 240, "max": 300},
    {"id": "src_nfl", "handle": "@NFL", "name": "NFL", "channels": [370], "min": 300, "max": 300},
    {"id": "src_nfl_films", "handle": "@NFLFilms", "name": "NFL Films", "channels": [319], "min": 300, "max": 300},
    {"id": "src_wimbledon", "handle": "@Wimbledon", "name": "Wimbledon", "channels": [332], "min": 240, "max": 300},
    {"id": "src_rhs", "handle": "@The_RHS", "name": "Royal Horticultural Society", "channels": [760, 761, 762, 763], "min": 120, "max": 300},
    {"id": "src_national_theatre", "handle": "@NationalTheatre", "name": "National Theatre", "channels": [281], "min": 180, "max": 300},
    {"id": "src_shakespeares_globe", "handle": "@ShakespearesGlobe", "name": "Shakespeare's Globe", "channels": [280], "min": 180, "max": 300},
    {"id": "src_jalc", "handle": "@JALC", "name": "Jazz at Lincoln Center", "channels": [515], "min": 600, "max": 300},
    {"id": "src_hr_symphony", "handle": "@hrSinfonieorchester", "name": "hr-Sinfonieorchester – Frankfurt Radio Symphony", "channels": [525], "min": 900, "max": 300},
    {"id": "src_operavision", "handle": "@OperaVision", "name": "OperaVision", "channels": [526], "min": 1800, "max": 300},
    {"id": "src_opry", "handle": "@opry", "name": "Grand Ole Opry", "channels": [528], "min": 180, "max": 300},
    {"id": "src_shows_must_go_on", "handle": "@TheShowsMustGoOn", "name": "The Shows Must Go On!", "channels": [282], "min": 180, "max": 300},
    {"id": "src_rt_trailers", "handle": "@RottenTomatoesTRAILERS", "name": "Rotten Tomatoes Trailers", "channels": [120], "min": 60, "max": 500,
     "filter": r"trailer|teaser"},
    {"id": "src_timeline", "handle": "@TimelineChannel", "name": "Timeline – World History Documentaries",
     "channels": [400, 401, 403, 404, 405, 406, 407, 410, 412, 413, 428], "min": 1200, "max": 400,
     "exclude": r"biblical|tomb of christ|\bpopes?\b|conclave|mecca|holy relics|\bmoon\b|apollo|fighter (planes|aces)|luftwaffe|bombers?\b|flying bombs|\bplanes?\b|\bair (war|raid|force)\b"},
    {"id": "src_ww2", "handle": "@WorldWarTwo", "name": "World War Two (TimeGhost)", "channels": [412], "min": 600, "max": 300,
     "exclude": r"dogfights|stuka|\bplanes?\b|bombers?\b|luftwaffe|air (war|raid|force)"},
    {"id": "src_geography_now", "handle": "@GeographyNow", "name": "Geography Now", "channels": [430], "min": 300, "max": 300},
    {"id": "src_lonely_planet", "handle": "@lonelyplanet", "name": "Lonely Planet", "channels": [771], "min": 180, "max": 300},
    # pass 2: film, music, football, food, theatre
    {"id": "src_dw_documentary", "handle": "@DWDocumentary", "name": "DW Documentary", "channels": [108], "min": 1500, "max": 300,
     "exclude": r"\b(popes?|vatican|church|cathedral|monks?|nuns?|pilgrim\w*|mecca|faith|gods?|jihad\w*|priests?|imams?|rabbis?|cults?|planes?|airports?|airlines?|pilots?|flights?|space|mars)\b|space travel|da vinci code"},
    {"id": "src_omeleto", "handle": "@Omeleto", "name": "Omeleto", "channels": [107], "min": 300, "max": 300},
    {"id": "src_dust", "handle": "@watchdust", "name": "DUST", "channels": [144], "min": 300, "max": 300,
     "exclude": r"space|astro|moon|planet|cosmic|galax|orbit|\bmars\b|nasa|rocket"},
    {"id": "src_alter", "handle": "@watchALTER", "name": "ALTER", "channels": [140], "min": 300, "max": 300, "exclude": r"god's kingdom|exorcis"},
    {"id": "src_bfi", "handle": "@BritishFilmInstitute", "name": "BFI", "channels": [161], "min": 1200, "max": 300, "exclude": r"trailer|teaser"},
    {"id": "src_rockpalast", "handle": "@WDRrockpalast", "name": "WDR Rockpalast", "channels": [501], "min": 1200, "max": 300, "exclude": r"jazz|summerjam|k[öo]lner dom"},
    {"id": "src_boiler_room", "handle": "@boilerroom", "name": "Boiler Room", "channels": [554], "min": 1800, "max": 300, "scan": 5000},
    {"id": "src_cercle", "handle": "@Cercle", "name": "Cercle", "channels": [521], "min": 1800, "max": 300, "exclude": r"air (&|and) space|de l'air|de l'espace"},
    {"id": "src_vp_records", "handle": "@VPRecords", "name": "VP Records", "channels": [529], "min": 150, "max": 300},
    {"id": "src_soul_train", "handle": "@SoulTrain", "name": "Soul Train", "channels": [516], "min": 120, "max": 300},
    {"id": "src_athletic_fc", "handle": "@TheAthleticFC", "name": "The Athletic FC", "channels": [305], "min": 300, "max": 300},
    {"id": "src_copa90", "handle": "@Copa90", "name": "COPA90", "channels": [314], "min": 300, "max": 300},
    {"id": "src_wsl", "handle": "@BarclaysWSL", "name": "Barclays Women's Super League", "channels": [310], "min": 300, "max": 300},
    {"id": "src_mark_wiens", "handle": "@MarkWiens", "name": "Mark Wiens", "channels": [710], "min": 600, "max": 300},
    {"id": "src_chuds_bbq", "handle": "@ChudsBBQ", "name": "Chuds BBQ", "channels": [716], "min": 300, "max": 300},
    {"id": "src_rainbow_plant_life", "handle": "@RainbowPlantLife", "name": "Rainbow Plant Life", "channels": [715], "min": 300, "max": 300},
    {"id": "src_bake_with_jack", "handle": "@BakewithJack", "name": "Bake with Jack", "channels": [712], "min": 300, "max": 300},
    {"id": "src_preppy_kitchen", "handle": "@PreppyKitchen", "name": "Preppy Kitchen", "channels": [711], "min": 300, "max": 300,
     "filter": r"cake|cookie|bread|\bpies?\b|\bbake|baking|muffin|brownie|cupcake|\btart|pastry|scone|donut|doughnut|cheesecake|biscuit|croissant|macaron|loaf|rolls\b"},
    {"id": "src_royal_ballet_opera", "handle": "@royalballetandopera", "name": "Royal Ballet and Opera", "channels": [283], "min": 120, "max": 300,
     "filter": r"ballet|dancer|nutcracker|swan lake|giselle|copp[eé]lia|choreograph|sleeping beauty|romeo and juliet", "exclude": r"trailer|teaser|\bopera\b|chorus"},
    {"id": "src_sadlers_wells", "handle": "@SadlersWells", "name": "Sadler's Wells", "channels": [283], "min": 180, "max": 300, "exclude": r"trailer|teaser|opportunity week"},
    {"id": "src_cirque", "handle": "@cirquedusoleil", "name": "Cirque du Soleil", "channels": [286], "min": 600, "max": 300},
    # pass 3: manifest completion — one official or creator-owned publisher per channel need
    {"id": "src_nuclear_blast", "handle": "@NuclearBlastRecords", "name": "Nuclear Blast", "channels": [504], "min": 150, "max": 300, "scan": 3000, "exclude": "trailer|teaser|podblast|podcast|riffs & realms|unboxing|youtube space"},
    {"id": "src_epitaph", "handle": "@epitaph", "name": "Epitaph Records", "channels": [505], "min": 120, "max": 300, "scan": 3000},
    {"id": "src_insideout", "handle": "@insideoutmusic", "name": "InsideOut Music", "channels": [511], "min": 150, "max": 300, "exclude": "trailer|teaser"},
    {"id": "src_ukf_dnb", "handle": "@UKFDrumandBass", "name": "UKF Drum & Bass", "channels": [535], "min": 150, "max": 300, "scan": 3000},
    {"id": "src_npr_music", "handle": "@nprmusic", "name": "NPR Music", "channels": [556], "min": 600, "max": 300, "filter": "tiny desk|concert"},
    {"id": "src_colors", "handle": "@COLORSxSTUDIOS", "name": "COLORS", "channels": [557], "min": 120, "max": 300},
    {"id": "src_sofar", "handle": "@SofarSounds", "name": "Sofar Sounds", "channels": [576], "min": 120, "max": 300, "scan": 3000},
    {"id": "src_fender", "handle": "@Fender", "name": "Fender", "channels": [568], "min": 180, "max": 300},
    {"id": "src_bassbuzz", "handle": "@bassbuzz", "name": "BassBuzz", "channels": [569], "min": 180, "max": 300},
    {"id": "src_drumeo", "handle": "@drumeoofficial", "name": "Drumeo", "channels": [570], "min": 300, "max": 300, "exclude": "trailer|teaser"},
    {"id": "src_pianote", "handle": "@PianoteOfficial", "name": "Pianote", "channels": [571], "min": 300, "max": 300},
    {"id": "src_afro_nation", "handle": "@AfroNation", "name": "Afro Nation", "channels": [533], "min": 120, "max": 300, "exclude": "laughing leopard"},
    {"id": "src_gcn", "handle": "@gcn", "name": "Global Cycling Network", "channels": [333], "min": 300, "max": 300},
    {"id": "src_fia_wec", "handle": "@FIAWEC", "name": "FIA World Endurance Championship", "channels": [340], "min": 300, "max": 300},
    {"id": "src_sailgp", "handle": "@SailGP", "name": "SailGP", "channels": [353], "min": 300, "max": 300},
    {"id": "src_bbc_earth", "handle": "@BBCEarth", "name": "BBC Earth", "channels": [485], "min": 180, "max": 300, "exclude": "\ud83d\udd34|\\blive\\b|sounds|asmr|sleep"},
    {"id": "src_pbs_eons", "handle": "@eons", "name": "PBS Eons", "channels": [488], "min": 240, "max": 300, "exclude": "\\bmars\\b|asteroid|\\bplanets?\\b(?! earth)|space time"},
    {"id": "src_langfocus", "handle": "@langfocus", "name": "Langfocus", "channels": [496], "min": 240, "max": 300, "exclude": "\\bpopes?\\b"},
    {"id": "src_ted", "handle": "@TED", "name": "TED", "channels": [491], "min": 480, "max": 300, "scan": 3000, "exclude": "\\bspace\\b|spiritual|universe|cosmolog|drones?"},
    {"id": "src_jamie_oliver", "handle": "@JamieOliver", "name": "Jamie Oliver", "channels": [701], "min": 240, "max": 300},
    {"id": "src_made_with_lau", "handle": "@MadeWithLau", "name": "Made With Lau", "channels": [706], "min": 240, "max": 300},
    {"id": "src_adam_ragusea", "handle": "@aragusea", "name": "Adam Ragusea", "channels": [718], "min": 240, "max": 300},
    {"id": "src_tasting_history", "handle": "@TastingHistory", "name": "Tasting History with Max Miller", "channels": [719], "min": 300, "max": 300, "exclude": "airline|air travel"},
    {"id": "src_how_to_drink", "handle": "@HowToDrink", "name": "How To Drink", "channels": [727], "min": 240, "max": 300, "exclude": "\\bspace\\b"},
    {"id": "src_james_hoffmann", "handle": "@jameshoffmann", "name": "James Hoffmann", "channels": [728], "min": 240, "max": 300},
    {"id": "src_this_old_house", "handle": "@thisoldhouse", "name": "This Old House", "channels": [753], "min": 300, "max": 300},
    {"id": "src_stumpy_nubs", "handle": "@StumpyNubs", "name": "Stumpy Nubs", "channels": [755], "min": 300, "max": 300},
    {"id": "src_exploring_alternatives", "handle": "@exploringalternatives", "name": "Exploring Alternatives", "channels": [766], "min": 300, "max": 300},
    {"id": "src_defcon", "handle": "@DEFCONConference", "name": "DEF CON", "channels": [638], "min": 900, "max": 300},
    {"id": "src_mkbhd", "handle": "@mkbhd", "name": "Marques Brownlee", "channels": [649], "min": 300, "max": 300, "exclude": "drones?|\\bmoon\\b"},
    {"id": "src_gaming_historian", "handle": "@GamingHistorian", "name": "Gaming Historian", "channels": [246], "min": 300, "max": 300},
    {"id": "src_studiobinder", "handle": "@StudioBinder", "name": "StudioBinder", "channels": [193], "min": 300, "max": 300},
    {"id": "src_corridor_crew", "handle": "@CorridorCrew", "name": "Corridor Crew", "channels": [167], "min": 300, "max": 300, "filter": "vfx|effects|cgi|react|animators?|stunt", "exclude": "flight|\\bplanes?\\b|\\bspace\\b"},
    {"id": "src_8bit_guy", "handle": "@The8BitGuy", "name": "The 8-Bit Guy", "channels": [810], "min": 300, "max": 300},
    {"id": "src_british_museum", "handle": "@britishmuseum", "name": "The British Museum", "channels": [846], "min": 180, "max": 300, "exclude": "living with gods"},
    {"id": "src_national_gallery", "handle": "@NationalGallery", "name": "The National Gallery", "channels": [847], "min": 180, "max": 300},
    # pass 4: manifest completion, second batch
    {"id": "src_toolroom", "handle": "@toolroomrecords", "name": "Toolroom Records", "channels": [522], "min": 150, "max": 300, "scan": 3000},
    {"id": "src_sing_king", "handle": "@SingKingKaraoke", "name": "Sing King", "channels": [574], "min": 150, "max": 300, "scan": 3000},
    {"id": "src_coachella", "handle": "@coachella", "name": "Coachella", "channels": [559], "min": 900, "max": 300},
    {"id": "src_latin_grammys", "handle": "@LatinGRAMMYs", "name": "Latin GRAMMYs", "channels": [532], "min": 150, "max": 300},
    {"id": "src_filmmaker_iq", "handle": "@FilmmakerIQ", "name": "Filmmaker IQ", "channels": [170], "min": 300, "max": 300},
    {"id": "src_kermode_mayo", "handle": "@KermodeandMayo", "name": "Kermode and Mayo", "channels": [195], "min": 180, "max": 300, "scan": 3000},
    {"id": "src_every_frame", "handle": "@everyframeapainting", "name": "Every Frame a Painting", "channels": [194], "min": 180, "max": 300},
    {"id": "src_lessons_screenplay", "handle": "@lessonsfromthescreenplay", "name": "Lessons from the Screenplay", "channels": [164], "min": 300, "max": 300},
    {"id": "src_soundworks", "handle": "@SoundWorksCollection", "name": "SoundWorks Collection", "channels": [169], "min": 180, "max": 300},
    {"id": "src_oscars", "handle": "@Oscars", "name": "Oscars", "channels": [182], "min": 180, "max": 300, "scan": 3000},
    {"id": "src_foil_arms_hog", "handle": "@FoilArmsandHog", "name": "Foil Arms and Hog", "channels": [206], "min": 90, "max": 300},
    {"id": "src_lgr", "handle": "@LGR", "name": "LGR", "channels": [241], "min": 300, "max": 300},
    {"id": "src_lol_esports", "handle": "@lolesports", "name": "LoL Esports", "channels": [248], "min": 1200, "max": 300, "scan": 3000},
    {"id": "src_nerdwriter", "handle": "@Nerdwriter1", "name": "Nerdwriter1", "channels": [293], "min": 240, "max": 300},
    {"id": "src_bluey", "handle": "@BlueyOfficialChannel", "name": "Bluey", "channels": [236], "min": 300, "max": 300},
    {"id": "src_met_office", "handle": "@MetOffice", "name": "Met Office", "channels": [444], "min": 180, "max": 300, "scan": 4000, "filter": "explain|why |how |what is|climate|science|history"},
    {"id": "src_amoeba_sisters", "handle": "@AmoebaSisters", "name": "Amoeba Sisters", "channels": [473], "min": 180, "max": 300},
    {"id": "src_pasta_grannies", "handle": "@PastaGrannies", "name": "Pasta Grannies", "channels": [705], "min": 180, "max": 300},
    {"id": "src_chef_jean_pierre", "handle": "@ChefJeanPierre", "name": "Chef Jean-Pierre", "channels": [721], "min": 300, "max": 300},
    {"id": "src_move_with_nicole", "handle": "@MoveWithNicole", "name": "Move With Nicole", "channels": [737], "min": 300, "max": 300, "filter": "pilates"},
    {"id": "src_bernadette_banner", "handle": "@BernadetteBanner", "name": "Bernadette Banner", "channels": [758], "min": 300, "max": 300},
    {"id": "src_verypink_knits", "handle": "@verypinkknits", "name": "VeryPink Knits", "channels": [759], "min": 300, "max": 300},
    {"id": "src_freecodecamp", "handle": "@freecodecamp", "name": "freeCodeCamp.org", "channels": [634], "min": 600, "max": 300},
    {"id": "src_two_minute_papers", "handle": "@TwoMinutePapers", "name": "Two Minute Papers", "channels": [640], "min": 180, "max": 300},
    {"id": "src_asianometry", "handle": "@Asianometry", "name": "Asianometry", "channels": [646], "min": 300, "max": 300, "filter": "chip|semiconductor|tsmc|intel|\\bfabs?\\b|lithograph|transistor|asml|memory|dram|wafer|silicon|nvidia|\\bamd\\b|processor|cpu|gpu|foundry"},
    {"id": "src_ycombinator", "handle": "@ycombinator", "name": "Y Combinator", "channels": [606], "min": 300, "max": 300},
    {"id": "src_art_assignment", "handle": "@theartassignment", "name": "The Art Assignment", "channels": [845], "min": 240, "max": 300},
    # pass 5: manifest-driven acquisition, NEEDS_CONTENT tranche
    {"id": "src_filmrise_movies", "handle": "@FilmRiseMovies", "name": "FilmRise Movies", "channels": [101], "min": 3600, "max": 300, "exclude": "trailer|teaser|flight|\\bplanes?\\b|airline|airport|hijack"},
    {"id": "src_dry_bar", "handle": "@DryBarComedy", "name": "Dry Bar Comedy", "channels": [205], "min": 300, "max": 300, "scan": 3000},
    {"id": "src_gundam", "handle": "@GundamInfo", "name": "GUNDAM CHANNEL INTL", "channels": [229], "min": 1200, "max": 300, "exclude": "trailer|teaser|\\bpv\\b", "filter": "episode|\\bep\\.? ?\\d|movie"},
    {"id": "src_english_heritage", "handle": "@EnglishHeritage", "name": "English Heritage", "channels": [415], "min": 180, "max": 300},
    {"id": "src_schmidt_ocean", "handle": "@SchmidtOcean", "name": "Schmidt Ocean Institute", "channels": [439], "min": 300, "max": 300, "exclude": "rocket|\\bspace\\b|satellite|mars|planet"},
    {"id": "src_geologyhub", "handle": "@GeologyHub", "name": "GeologyHub", "channels": [443], "min": 300, "max": 300, "filter": "volcan|erupt|lava|magma|caldera|yellowstone|etna|kilauea|vesuvius|fagradalsfjall|krakatoa|tambora|pinatubo"},
    {"id": "src_legaleagle", "handle": "@LegalEagle", "name": "LegalEagle", "channels": [467], "min": 300, "max": 300},
    {"id": "src_overly_sarcastic", "handle": "@OverlySarcasticProductions", "name": "Overly Sarcastic Productions", "channels": [493], "min": 300, "max": 300, "filter": "myth|legend|\\bgods?\\b|monster|folklore|odyssey|iliad|norse|greek|egyptian|arthur|trickster", "exclude": "bible|jesus|christ|church|saint"},
    {"id": "src_sub_pop", "handle": "@subpop", "name": "Sub Pop", "channels": [503], "min": 150, "max": 340, "exclude": "official audio|lyric|visuali[sz]er|trailer|teaser|podcast|" + GRUNGE_ACTS},
    {"id": "src_audiotree", "handle": "@Audiotree", "name": "Audiotree", "channels": [552], "min": 900, "max": 300, "scan": 3000},
    {"id": "src_blogotheque", "handle": "@blogotheque", "name": "Blogothèque", "channels": [553], "min": 150, "max": 300},
    {"id": "src_polyphonic", "handle": "@Polyphonic", "name": "Polyphonic", "channels": [561], "min": 300, "max": 300},
    {"id": "src_produce_like_a_pro", "handle": "@ProduceLikeAPro", "name": "Produce Like A Pro", "channels": [565], "min": 600, "max": 300, "scan": 3000},
    {"id": "src_plain_bagel", "handle": "@ThePlainBagel", "name": "The Plain Bagel", "channels": [603], "min": 180, "max": 300},
    {"id": "src_ben_eater", "handle": "@BenEater", "name": "Ben Eater", "channels": [631], "min": 300, "max": 300},
    {"id": "src_linus_tech_tips", "handle": "@LinusTechTips", "name": "Linus Tech Tips", "channels": [633], "min": 480, "max": 300, "filter": "\\bpc\\b|gpu|cpu|build|motherboard|ssd|monitor|keyboard|laptop|cooling|\\bram\\b|nvidia|\\bamd\\b|intel|server|\\bnas\\b|hardware|graphics card", "exclude": "drones?|\\bplanes?\\b|flight|rocket|wan show"},
    {"id": "src_statquest", "handle": "@statquest", "name": "StatQuest with Josh Starmer", "channels": [641], "min": 300, "max": 300},
    {"id": "src_james_bruton", "handle": "@jamesbruton", "name": "James Bruton", "channels": [642], "min": 300, "max": 300, "exclude": "drones?|\\bplanes?\\b|aircraft|rocket|flight"},
    {"id": "src_efficient_engineer", "handle": "@TheEfficientEngineer", "name": "The Efficient Engineer", "channels": [651], "min": 180, "max": 300, "exclude": "aircraft|\\bwings?\\b|\\blift\\b|\\bplanes?\\b|rocket|\\bjet\\b|flight"},
    {"id": "src_electroboom", "handle": "@ElectroBOOM", "name": "ElectroBOOM", "channels": [652], "min": 300, "max": 300},
    {"id": "src_jay_leno", "handle": "@JayLenosGarage", "name": "Jay Leno's Garage", "channels": [672], "min": 600, "max": 300, "exclude": "\\bjet\\b|aircraft|\\bplanes?\\b|helicopter|rocket"},
    {"id": "src_best_ever_food", "handle": "@BestEverFoodReviewShow", "name": "Best Ever Food Review Show", "channels": [703], "min": 600, "max": 300},
    {"id": "src_rick_bayless", "handle": "@RickBayless", "name": "Rick Bayless", "channels": [709], "min": 180, "max": 300},
    {"id": "src_sugar_geek", "handle": "@SugarGeekShow", "name": "Sugar Geek Show", "channels": [713], "min": 300, "max": 300, "filter": "cake|cookie|dessert|frosting|buttercream|chocolate|\\bpie\\b|tart|pastry|sugar|candy|macaron|brownie|cheesecake|caramel|meringue|fondant|cupcake|ganache"},
    {"id": "src_manjulas_kitchen", "handle": "@Manjulaskitchen", "name": "Manjula's Kitchen", "channels": [714], "min": 180, "max": 300},
    {"id": "src_eater", "handle": "@eater", "name": "Eater", "channels": [720], "min": 480, "max": 300, "scan": 3000},
    {"id": "src_tom_merrick", "handle": "@BodyweightWarrior", "name": "Tom Merrick", "channels": [735], "min": 300, "max": 300, "filter": "mobility|flexib|stretch|\\bhips?\\b|shoulder|splits?|pancake|pike|routine|follow along|posture"},
    {"id": "src_blondihacks", "handle": "@Blondihacks", "name": "Blondihacks", "channels": [756], "min": 300, "max": 300, "filter": "lathe|mill|machin|metal|weld|\\btool|shaper|tap|drill|fixture|vise"},
    {"id": "src_huw_richards", "handle": "@HuwRichards", "name": "Huw Richards", "channels": [763], "min": 300, "max": 300},
    {"id": "src_kraig_adams", "handle": "@KraigAdams", "name": "Kraig Adams", "channels": [782], "min": 300, "max": 300},
    {"id": "src_ta_outdoors", "handle": "@TAOutdoors", "name": "TA Outdoors", "channels": [783], "min": 300, "max": 300},
    {"id": "src_vogue", "handle": "@Vogue", "name": "Vogue", "channels": [790], "min": 300, "max": 300, "scan": 3000, "filter": "fashion|runway|met gala|designer|outfit|wardrobe|\\bstyle|collection|couture|dress|closet|look"},
    {"id": "src_ham_radio_crash_course", "handle": "@HamRadioCrashCourse", "name": "Ham Radio Crash Course", "channels": [817], "min": 300, "max": 300, "exclude": "satellite|\\bspace\\b|\\biss\\b|rocket|aircraft|\\bplanes?\\b|aviation|balloon"},
    {"id": "src_sams_trains", "handle": "@SamsTrains", "name": "Sam'sTrains", "channels": [825], "min": 300, "max": 300},
    {"id": "src_cruising_the_cut", "handle": "@CruisingtheCut", "name": "Cruising The Cut", "channels": [834], "min": 300, "max": 300},
    # pass 6: manifest-driven acquisition, second NEEDS_CONTENT tranche
    {"id": "src_doctor_who", "handle": "@DoctorWho", "name": "Doctor Who", "channels": [216], "max": 300, "min": 300, "scan": 3000, "exclude": "trailer|teaser|reaction|unboxing"},
    {"id": "src_mr_bean", "handle": "@MrBean", "name": "Mr Bean", "channels": [237], "max": 300, "min": 1200, "scan": 3000},
    {"id": "src_popeye", "handle": "@PopeyeandFriendsOfficial", "name": "Popeye And Friends Official", "channels": [224], "max": 300, "min": 300},
    {"id": "src_stan_winston", "handle": "@StanWinstonSchool", "name": "Stan Winston School", "channels": [168], "max": 300, "min": 300, "exclude": "trailer|sale|discount|promo"},
    {"id": "src_digital_foundry", "handle": "@DigitalFoundry", "name": "Digital Foundry", "channels": [243], "max": 300, "min": 600, "scan": 3000, "filter": "playstation|\\bps[1-5]\\b|xbox|nintendo|switch|console|dreamcast|sega|gamecube|\\bn64\\b|snes|wii"},
    {"id": "src_braille_skate", "handle": "@BrailleSkateboarding", "name": "Braille Skateboarding", "channels": [355], "max": 300, "min": 300, "scan": 3000},
    {"id": "src_city_beautiful", "handle": "@CityBeautiful", "name": "City Beautiful", "channels": [435], "max": 300, "min": 300},
    {"id": "src_chubbyemu", "handle": "@chubbyemu", "name": "Chubbyemu", "channels": [475], "max": 300, "min": 300},
    {"id": "src_school_of_life", "handle": "@TheSchoolofLifeTV", "name": "The School of Life", "channels": [476], "max": 300, "min": 180, "exclude": "\\bgod\\b|religio|prayer|spiritual"},
    {"id": "src_nutrition_made_simple", "handle": "@NutritionMadeSimple", "name": "Nutrition Made Simple!", "channels": [740], "max": 300, "min": 300},
    {"id": "src_newport_folk", "handle": "@NewportFolkFest", "name": "Newport Folk Festival", "channels": [527], "max": 300, "min": 150},
    {"id": "src_rick_beato", "handle": "@RickBeato", "name": "Rick Beato", "channels": [566], "max": 300, "min": 600, "scan": 3000, "filter": "interview|songwrit|what makes this song|making of|song"},
    {"id": "src_great_british_chefs", "handle": "@GreatBritishChefs", "name": "Great British Chefs", "channels": [704], "max": 300, "min": 180},
    {"id": "src_flo_chinyere", "handle": "@FloChinyere", "name": "Flo Chinyere", "channels": [707], "max": 300, "min": 180, "filter": "nigerian|jollof|egusi|ogbono|okra|efo|moi moi|fufu|pounded yam|\\byam\\b|plantain|pepper soup|chin chin|puff puff|suya|akara|ofada|banga|afang|edikang|oha|nsala|garri|eba|african|soup|stew"},
    {"id": "src_running_channel", "handle": "@runningchannel", "name": "The Running Channel", "channels": [739], "max": 300, "min": 300, "scan": 3000},
    {"id": "src_architectural_digest", "handle": "@Archdigest", "name": "Architectural Digest", "channels": [751], "max": 300, "min": 300, "scan": 3000, "filter": "open door|tour|home|interior|design|house|apartment|renovat|room|loft"},
    {"id": "src_home_renovision", "handle": "@HomeRenoVisionDIY", "name": "Home RenoVision DIY", "channels": [754], "max": 300, "min": 300},
    {"id": "src_two_cents", "handle": "@TwoCentsPBS", "name": "Two Cents", "channels": [617], "max": 300, "min": 180},
    {"id": "src_ben_felix", "handle": "@BenFelixCSI", "name": "Ben Felix", "channels": [619], "max": 300, "min": 300},
    {"id": "src_networkchuck", "handle": "@NetworkChuck", "name": "NetworkChuck", "channels": [639], "max": 300, "min": 300, "filter": "network|router|wi-?fi|vpn|\\bdns\\b|\\bip\\b|subnet|switch|firewall|homelab|server|ccna|tcp|osi|vlan|ethernet|internet"},
    {"id": "src_alex_the_analyst", "handle": "@AlexTheAnalyst", "name": "Alex The Analyst", "channels": [644], "max": 300, "min": 300},
    {"id": "src_fortnine", "handle": "@FortNine", "name": "FortNine", "channels": [674], "max": 300, "min": 300, "filter": "motorcycle|moto|\\bbikes?\\b|rider|riding|helmet|harley|ducati|honda|yamaha|kawasaki|suzuki|\\bbmw\\b|\\bktm\\b|triumph|engine", "exclude": "mountain bike|\\bmtb\\b|boat|e-?bike|bicycle|pedal"},
    {"id": "src_casual_navigation", "handle": "@CasualNavigation", "name": "Casual Navigation", "channels": [681], "max": 300, "min": 300},
    {"id": "src_modern_mba", "handle": "@ModernMBA", "name": "Modern MBA", "channels": [693], "max": 300, "min": 300},
    {"id": "src_ali_abdaal", "handle": "@aliabdaal", "name": "Ali Abdaal", "channels": [698], "max": 300, "min": 300, "filter": "productiv|study|habit|focus|time management|notion|routine|procrastinat|goal|organi[sz]"},
    # pass 7: multi-source expansion (several sources may share one home channel)
    {"id": "src_pearl_jam", "handle": "@pearljam", "name": "Pearl Jam", "channels": [506], "max": 200, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"
     "|venture into cures|pig roast|\\bsk8\\b|panel discussion|yule log|lightning bolt|full length interview|gear bag|all in challenge|birthday package|on demand|\\bpreview\\b"},
    {"id": "src_alice_in_chains", "handle": "@aliceinchains", "name": "Alice In Chains", "channels": [506], "max": 300, "min": 120, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    {"id": "src_soundgarden", "handle": "@soundgarden", "name": "Soundgarden", "channels": [506], "max": 300, "min": 120, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    {"id": "src_nirvana", "handle": "@nirvana", "name": "Nirvana", "channels": [506], "max": 300, "min": 90, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    # music pass: grunge beyond Pearl Jam — official artist and VEVO channels only (no Topic/static-audio channels)
    *[{"id": sid, "handle": handle, "name": name, "channels": [506], "max": 300, "min": 120, "exclude": GRUNGE_EXCLUDE} for sid, handle, name in [
        ("src_nirvana_vevo", "UCzGrGrvf9g8CVVzh_LvGf-g", "Nirvana (Vevo)"),
        ("src_stone_temple_pilots", "UCocfdCiKujljqcGC-STMsCQ", "Stone Temple Pilots"),
        ("src_mudhoney", "UCDTbr5CIsgVAwXxUIfukV6w", "Mudhoney"),
        ("src_screaming_trees_vevo", "UCfkD7WftBqx0WyiEC4emrfQ", "Screaming Trees (Vevo)"),
        ("src_mad_season_vevo", "UCBVzMfppYBWZ9OdHBH3c-IA", "Mad Season (Vevo)"),
        ("src_melvins", "UCaoEPkhVvqVQVv-BoaQl5bQ", "Melvins"),
        ("src_mark_lanegan", "UCV6dSPsn3kcwFAY7bFTHl5w", "Mark Lanegan"),
        ("src_temple_of_the_dog", "UCgf3d2y9zlw2QvY7OlFt6uw", "Temple Of The Dog"),
        ("src_l7", "UCvNz35FxAbo7aRFWRRZsFVA", "L7"),
        ("src_hole_vevo", "UCaJkmYzCsJMLPXotZUXArSA", "Hole (Vevo)"),
        ("src_chris_cornell", "UCf0pcytyiYVYy3UOs52nsQg", "Chris Cornell"),
    ]],
    {"id": "src_sub_pop_grunge", "handle": "@subpop", "name": "Sub Pop – Grunge", "channels": [506], "min": 120, "max": 300,
     "filter": rf"^(?=.*({GRUNGE_ACTS}))(?=.*(official video|\blive\b|session))", "exclude": GRUNGE_EXCLUDE},
    {"id": "src_much_grunge", "handle": "UCRf0VlZul2nR65s-FD_85rQ", "name": "Much – Grunge Archive", "channels": [506], "min": 240, "max": 300, "scan": 9000,
     "filter": GRUNGE_ACTS, "exclude": GRUNGE_EXCLUDE + r"|react|first time|#shorts"},
    {"id": "src_mtv_grunge", "handle": "UCxAICW_LdkfFYwTqTHHE0vg", "name": "MTV – Grunge Archive", "channels": [506], "min": 240, "max": 300, "scan": 5400,
     "filter": GRUNGE_ACTS, "exclude": GRUNGE_EXCLUDE + r"|react|\bvmas?\b|#shorts"},
    # music pass: thin and single-artist genre channels — official artist, label, broadcaster, festival and maker channels
    *[{"id": sid, "handle": handle, "name": name, "channels": [ch], "max": cap, "min": 120, "exclude": MUSIC_EXCLUDE} for sid, handle, name, ch, cap in [
        ("src_duran_duran", "@DuranDuran", "Duran Duran", 508, 60), ("src_depeche_mode", "@depechemode", "Depeche Mode", 508, 60),
        ("src_talking_heads", "@TalkingHeads", "Talking Heads", 508, 60), ("src_new_order", "@NewOrder", "New Order", 508, 60),
        ("src_human_league", "@TheHumanLeague", "The Human League", 508, 60), ("src_tears_for_fears_vevo", "@TearsForFearsVEVO", "Tears For Fears (Vevo)", 508, 60),
        ("src_led_zeppelin", "@ledzeppelin", "Led Zeppelin", 512, 60), ("src_pink_floyd", "@PinkFloyd", "Pink Floyd", 512, 60),
        ("src_the_doors", "@thedoors", "The Doors", 512, 60), ("src_jimi_hendrix", "@JimiHendrix", "Jimi Hendrix", 512, 60),
        ("src_tom_petty", "@TomPetty", "Tom Petty & The Heartbreakers", 512, 60), ("src_bruce_springsteen", "@brucespringsteen", "Bruce Springsteen", 512, 60),
        ("src_eric_clapton", "@EricClapton", "Eric Clapton", 512, 60), ("src_the_who_vevo", "@TheWhoVEVO", "The Who (Vevo)", 512, 60),
        ("src_joe_bonamassa", "UCcCa2gD7AEA-6SVN8nZw_IA", "Joe Bonamassa", 514, 80), ("src_bb_king", "@BBKing", "B.B. King", 514, 60),
        ("src_gary_clark_jr", "@GaryClarkJr", "Gary Clark Jr.", 514, 60),
        ("src_vulf", "@vulf", "Vulfpeck", 517, 80), ("src_lettuce", "@LettuceFunk", "Lettuce", 517, 80), ("src_snarky_puppy", "@snarkypuppy", "Snarky Puppy", 517, 60),
        ("src_run_the_jewels", "@RunTheJewels", "Run The Jewels", 520, 60), ("src_wu_tang_clan", "@WuTangClan", "Wu-Tang Clan", 520, 60),
        ("src_public_enemy", "@PublicEnemy", "Public Enemy (Channel ZERO)", 520, 60),
        ("src_playing_for_change", "@PlayingForChange", "Playing For Change", 531, 150), ("src_tinariwen", "@Tinariwen", "Tinariwen", 531, 60),
        ("src_pulp", "UC5FrSWytdXh-sKJHjSaiyLg", "Pulp", 507, 60),
        ("src_suede", "UCdNf1p4SVbcFWKJULVNvl3A", "Suede", 507, 60), ("src_the_verve_vevo", "@TheVerveVEVO", "The Verve (Vevo)", 507, 60),
        ("src_supergrass", "UCvEVRo07OAojKg8ekpk1Lyw", "Supergrass", 507, 60), ("src_manics", "UC0fmT1J9iVv_wzLUN7E-aJA", "Manic Street Preachers", 507, 60),
        ("src_manics_vevo", "UCgkt10hEZXC6nGwkqeEWK5Q", "Manic Street Preachers (Vevo)", 507, 60),
        ("src_siouxsie_vevo", "UCkOByxhQ3me30cFlcA9VdSw", "Siouxsie And The Banshees (Vevo)", 509, 60), ("src_bauhaus", "UCxtEHoDaGH83DiqzFR6nMcw", "Bauhaus", 509, 60),
        ("src_ride", "UCIesQAH8Z8SbA2rR6Ujx_Xw", "Ride", 510, 60), ("src_cocteau_twins", "UCXmBg9Kz7RJ8MUGz-vtXR2w", "Cocteau Twins", 510, 60),
        ("src_diiv", "@DIIV", "DIIV", 510, 60),
        ("src_madness", "UC0iYPVu2agNaaqbnHFPCBFQ", "Madness", 530, 80), ("src_the_selecter", "UCWCvnELYdQPd22Q6YR4GR-g", "The Selecter", 530, 60),
        ("src_the_beat", "UCtvV29Qigs3qw7FSqioGHsA", "The Beat", 530, 60), ("src_toots", "@TootsandtheMaytals", "Toots and the Maytals", 530, 60),
        ("src_lollapalooza", "@lollapalooza", "Lollapalooza", 559, 150), ("src_roskilde", "@roskildefestival", "Roskilde Festival", 559, 100),
        ("src_keb_mo", "@kebmo", "Keb' Mo'", 514, 60), ("src_beth_hart", "@bethhartmusic", "Beth Hart", 514, 60),
        ("src_the_cult", "@thecultofficial", "The Cult", 509, 60), ("src_she_wants_revenge_vevo", "@ShewantsRevenge", "She Wants Revenge (Vevo)", 509, 60),
        ("src_songhoy_blues", "@SonghoyBlues", "Songhoy Blues", 531, 60), ("src_angelique_kidjo", "@AngeliqueKidjo", "Angelique Kidjo", 531, 60),
        ("src_primavera_sound", "@PrimaveraSound", "Primavera Sound", 559, 100), ("src_sziget", "@szigetofficial", "Sziget Festival", 559, 100),
        ("src_bonnaroo", "@bonnaroo", "Bonnaroo", 559, 100),
    ]],
    *[{"id": f"src_vevo_{slug}", "handle": handle, "name": f"{name} (Vevo)", "channels": [592], "channel_title": r"vevo$", "max": 60, "min": 120, "exclude": MUSIC_EXCLUDE}
      for slug, handle, name in [("foo_fighters", "@FooFightersVEVO", "Foo Fighters"), ("the_killers", "@TheKillersVEVO", "The Killers"), ("kings_of_leon", "@KingsOfLeonVEVO", "Kings Of Leon")]],
    {"id": "src_1xtra_hiphop", "handle": "@1Xtra", "name": "BBC Radio 1Xtra – Hip-Hop", "channels": [520], "min": 120, "max": 150, "scan": 3200,
     "filter": r"fire in the booth|freestyle|\brap\b|hip.?hop|cypher", "exclude": MUSIC_EXCLUDE},
    {"id": "src_hot97", "handle": "@HOT97", "name": "HOT 97 – Freestyles and Performances", "channels": [520], "min": 180, "max": 150, "scan": 4000,
     "filter": r"freestyle|performs|performance|cypher", "exclude": MUSIC_EXCLUDE + r"|interview|reacts?\b|prank|podcast"},
    {"id": "src_tomorrowland", "handle": "@tomorrowland", "name": "Tomorrowland", "channels": [534], "min": 1800, "max": 200, "scan": 3400, "exclude": MUSIC_EXCLUDE + r"|aftermovie"},
    {"id": "src_anjunabeats", "handle": "@Anjunabeats", "name": "Anjunabeats", "channels": [534], "min": 1800, "max": 150, "scan": 3600, "exclude": MUSIC_EXCLUDE},
    {"id": "src_pitchfork_classic", "handle": "@pitchfork", "name": "Pitchfork – Album Stories", "channels": [562], "min": 600, "max": 150, "scan": 3100,
     "filter": r"\bclassic\b|album|making of|story of|anniversary|documentary", "exclude": MUSIC_EXCLUDE + r"|review|reacts?\b|over/under|verses|what's in my bag|cooking"},
    {"id": "src_mix_with_the_masters", "handle": "@MixWithTheMasters", "name": "Mix with the Masters", "channels": [567], "min": 600, "max": 200, "exclude": MUSIC_EXCLUDE},
    {"id": "src_moog", "handle": "UC3ZR8kjzs1pf6aH_SMiT3Pw", "name": "Moog Music", "channels": [572], "min": 180, "max": 150, "exclude": MUSIC_EXCLUDE},
    {"id": "src_loopop", "handle": "@loopop", "name": "loopop", "channels": [572], "min": 480, "max": 150, "exclude": MUSIC_EXCLUDE},
    {"id": "src_korg", "handle": "@KorgOfficial", "name": "KORG", "channels": [572], "min": 300, "max": 100, "scan": 1800, "filter": r"synth|minilogue|monologue|prologue|opsix|wavestate|modwave|ms-20|arp|volca|drumlogue|multi/poly|nautilus|kronos", "exclude": MUSIC_EXCLUDE},
    {"id": "src_blur", "handle": "@blur", "name": "Blur", "channels": [507], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    {"id": "src_oasis", "handle": "@OasisVEVO", "name": "Oasis", "channels": [507], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    {"id": "src_the_cure", "handle": "@thecure", "name": "The Cure", "channels": [509], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    {"id": "src_nile_rodgers", "handle": "@nilerodgers", "name": "Nile Rodgers & CHIC", "channels": [518], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    {"id": "src_gloria_gaynor", "handle": "@GloriaGaynor", "name": "Gloria Gaynor", "channels": [518], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing|gospel|\\bgod\\b|jesus|\\blord\\b|church|praise|worship|holy|christmas|hallelujah|amazing grace|hymn|carol"},
    {"id": "src_bee_gees", "handle": "@BeeGees", "name": "Bee Gees", "channels": [518], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing", "filter": "stayin|night fever|jive talkin|you should be dancing|more than a woman|tragedy|how deep|too much heaven|nights on broadway|fanny|love you inside out|boogie child|disco"},
    {"id": "src_resident_advisor", "handle": "@residentadvisor", "name": "Resident Advisor", "channels": [523], "max": 300, "min": 600, "filter": "techno"},
    {"id": "src_mixmag", "handle": "@mixmag", "name": "Mixmag", "channels": [523], "max": 300, "min": 600, "scan": 3000, "filter": "techno"},
    {"id": "src_the_specials", "handle": "@thespecials", "name": "The Specials", "channels": [530], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    {"id": "src_massive_attack", "handle": "@massiveattack", "name": "Massive Attack", "channels": [536], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    {"id": "src_zero_7", "handle": "@zero7", "name": "Zero 7", "channels": [536], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    {"id": "src_nine_inch_nails", "handle": "@NIN", "name": "Nine Inch Nails", "channels": [537], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    {"id": "src_my_chemical_romance", "handle": "@mychemicalromance", "name": "My Chemical Romance", "channels": [538], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    {"id": "src_fall_out_boy", "handle": "@falloutboy", "name": "Fall Out Boy", "channels": [538], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    {"id": "src_paramore", "handle": "@paramore", "name": "Paramore", "channels": [538], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    {"id": "src_jimmy_eat_world", "handle": "@jimmyeatworld", "name": "Jimmy Eat World", "channels": [538], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing|podcast|pass-through frequencies"},
    {"id": "src_dashboard_confessional", "handle": "@dashboardconfessional", "name": "Dashboard Confessional", "channels": [538], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    {"id": "src_sigur_ros", "handle": "@sigurros", "name": "Sigur Rós", "channels": [539], "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|behind the scenes|unboxing"},
    {"id": "src_seth_meyers", "handle": "@LateNightSeth", "name": "Late Night with Seth Meyers", "channels": [266], "max": 150, "min": 480},
    {"id": "src_colbert", "handle": "@ColbertLateShow", "name": "The Late Show with Stephen Colbert", "channels": [266], "max": 150, "min": 480},
    {"id": "src_team_coco", "handle": "@teamcoco", "name": "Team Coco", "channels": [264], "max": 300, "min": 480, "filter": "full episode|needs a friend|where everybody knows"},
    {"id": "src_fallon", "handle": "@fallontonight", "name": "The Tonight Show Starring Jimmy Fallon", "channels": [266], "max": 150, "min": 480},
    {"id": "src_the_office", "handle": "@TheOffice", "name": "The Office", "channels": [207], "max": 300, "min": 300, "exclude": "trailer|teaser"},
    {"id": "src_parks_and_rec", "handle": "@parksandrecreation", "name": "Parks and Recreation", "channels": [207], "max": 300, "min": 300, "exclude": "trailer|teaser"},
    {"id": "src_friends", "handle": "@Friends", "name": "Friends", "channels": [207], "max": 300, "min": 300, "exclude": "trailer|teaser"},
    {"id": "src_whose_line", "handle": "@WhoseLineIsItAnyway", "name": "Whose Line Is It Anyway?", "channels": [209], "max": 300, "min": 300, "exclude": "trailer|teaser"},
    {"id": "src_taskmaster", "handle": "@Taskmaster", "name": "Taskmaster", "channels": [273], "max": 300, "min": 900, "scan": 1800},
    # pass 8: full multi-source build-out; class DEDICATED_HOME = acquired reservoir belongs to its one home channel
    {"id": "src_radiohead", "handle": "@radiohead", "name": "Radiohead", "channels": [502], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_rem", "handle": "@REMhq", "name": "R.E.M.", "channels": [502], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_smashing_pumpkins", "handle": "@smashingpumpkins", "name": "Smashing Pumpkins", "channels": [502], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_rhcp", "handle": "@RedHotChiliPeppers", "name": "Red Hot Chili Peppers", "channels": [502], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_foo_fighters", "handle": "@foofighters", "name": "Foo Fighters", "channels": [502], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_acdc", "handle": "@acdc", "name": "AC/DC", "channels": [513], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_guns_n_roses", "handle": "@GunsNRoses", "name": "Guns N' Roses", "channels": [513], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_aerosmith", "handle": "@Aerosmith", "name": "Aerosmith", "channels": [513], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_def_leppard", "handle": "@DefLeppard", "name": "Def Leppard", "channels": [513], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_kiss", "handle": "@kiss", "name": "KISS", "channels": [513], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_bon_jovi", "handle": "@bonjovi", "name": "Bon Jovi", "channels": [513], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_motley_crue", "handle": "@MotleyCrue", "name": "Mötley Crüe", "channels": [513], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_usher", "handle": "@usher", "name": "Usher", "channels": [519], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_alicia_keys", "handle": "@aliciakeys", "name": "Alicia Keys", "channels": [519], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_brandy", "handle": "@brandy", "name": "Brandy", "channels": [519], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_ne_yo", "handle": "@neyo", "name": "NE-YO", "channels": [519], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_home_free", "handle": "@homefreeguys", "name": "Home Free", "channels": [573], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing|hymn|gospel|amazing grace|hallelujah|\\bgod\\b|jesus|christmas|holy"},
    {"id": "src_kings_singers", "handle": "@TheKingsSingers", "name": "The King's Singers", "channels": [573], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing|hymn|mass\\b|psalm|anthem|motet|ave maria|christmas|carol|\\bgod\\b|holy"},
    {"id": "src_polyphia", "handle": "@polyphia", "name": "Polyphia", "channels": [575], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_animals_as_leaders", "handle": "@AnimalsAsLeaders", "name": "Animals As Leaders", "channels": [575], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_postmodern_jukebox", "handle": "@PostmodernJukebox", "name": "Postmodern Jukebox", "channels": [577], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_hammock", "handle": "@HammockMusic", "name": "Hammock", "channels": [524], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_popcornflix", "handle": "@Popcornflix", "name": "Popcornflix", "channels": [102], "class": "DEDICATED_HOME", "max": 300, "min": 3600, "exclude": "trailer|teaser|flight|\\bplanes?\\b|airline|airport|hijack|space station|astronaut"},
    {"id": "src_movie_central", "handle": "@MovieCentral", "name": "Movie Central", "channels": [106], "class": "DEDICATED_HOME", "max": 300, "min": 3600, "exclude": "trailer|teaser|flight|\\bplanes?\\b|airline|airport|hijack|space station|astronaut", "scan": 1500},
    {"id": "src_filmrise_documentaries", "handle": "@FilmRiseDocumentaries", "name": "FilmRise Documentaries", "channels": [160], "class": "DEDICATED_HOME", "max": 300, "min": 2400, "exclude": "trailer|teaser|flight|\\bplanes?\\b|airline|airport|hijack|space station|astronaut"},
    {"id": "src_adult_swim", "handle": "@adultswim", "name": "Adult Swim", "channels": [223], "class": "DEDICATED_HOME", "max": 300, "min": 600, "exclude": "trailer|teaser|promo|\\blive\\b|stream", "scan": 1500},
    {"id": "src_vanity_fair", "handle": "@VanityFair", "name": "Vanity Fair", "channels": [279], "class": "DEDICATED_HOME", "max": 150, "min": 300, "exclude": "pilot|air combat|aircraft|\\bplanes?\\b|astronaut|\\bspace\\b|nasa|rocket"},
    {"id": "src_entertainment_tonight", "handle": "@EntertainmentTonight", "name": "Entertainment Tonight", "channels": [279], "class": "DEDICATED_HOME", "max": 150, "min": 600},
    {"id": "src_epic_history", "handle": "@EpicHistoryTV", "name": "Epic History", "channels": [416], "class": "DEDICATED_HOME", "max": 300, "min": 300, "exclude": "crusade|\\bchurch\\b|pope"},
    {"id": "src_historia_civilis", "handle": "@HistoriaCivilis", "name": "Historia Civilis", "channels": [416], "class": "DEDICATED_HOME", "max": 300, "min": 300},
    {"id": "src_toldinstone", "handle": "@toldinstone", "name": "toldinstone", "channels": [416], "class": "DEDICATED_HOME", "max": 300, "min": 300, "exclude": "jesus|christian|\\bgods?\\b|temple|religio"},
    {"id": "src_history_guy", "handle": "@TheHistoryGuyChannel", "name": "The History Guy", "channels": [417], "class": "DEDICATED_HOME", "max": 300, "min": 300, "filter": "america|\\bu\\.?s\\.?\\b|usa|civil war|revolutionary|president|confedera|union army|texas|california|new york|chicago|alamo|lincoln|washington|frontier|wild west|prohibition|gettysburg", "exclude": "aircraft|\\bplanes?\\b|flight|pilot|bomber|space|rocket|air force"},
    {"id": "src_american_battlefield_trust", "handle": "@AmericanBattlefieldTrust", "name": "American Battlefield Trust", "channels": [417], "class": "DEDICATED_HOME", "max": 300, "min": 300, "exclude": "\\blive\\b|q&a"},
    {"id": "src_kings_and_generals", "handle": "@KingsandGenerals", "name": "Kings and Generals", "channels": [419], "class": "DEDICATED_HOME", "max": 300, "min": 600, "filter": "china|chinese|japan|samurai|shogun|mongol|genghis|korea|india|mughal|ming|qing|tang dynasty|han dynasty|song dynasty|khmer|vietnam|burma|siam|manchu|three kingdoms|sengoku", "exclude": "aircraft|\\bplanes?\\b|pilot|air force|kamikaze"},
    {"id": "src_shawn_willsey", "handle": "@shawnwillsey", "name": "Shawn Willsey: Geology Explained", "channels": [487], "class": "DEDICATED_HOME", "max": 300, "min": 300, "exclude": "\\bmars\\b|planet|\\bmoon\\b|asteroid|meteor|space"},
    {"id": "src_sam_the_cooking_guy", "handle": "@samthecookingguy", "name": "Sam the Cooking Guy", "channels": [708], "class": "DEDICATED_HOME", "max": 300, "min": 480},
    {"id": "src_kenji", "handle": "@JKenjiLopezAlt", "name": "J. Kenji López-Alt", "channels": [724], "class": "DEDICATED_HOME", "max": 300, "min": 300},
    {"id": "src_madfit", "handle": "@MadFit", "name": "MadFit", "channels": [734], "class": "DEDICATED_HOME", "max": 300, "min": 600, "filter": "cardio|hiit|dance|fat burn|aerobic|sweat|jump"},
    {"id": "src_heather_robertson", "handle": "@HeatherRobertsoncom", "name": "Heather Robertson", "channels": [734], "class": "DEDICATED_HOME", "max": 300, "min": 600, "filter": "cardio|hiit|fat burn|sweat|tabata|jump"},
    {"id": "src_grow_with_jo", "handle": "@GrowWithJo", "name": "growwithjo", "channels": [738], "class": "DEDICATED_HOME", "max": 300, "min": 600, "filter": "walk"},
    {"id": "src_outdoor_boys", "handle": "@OutdoorBoys", "name": "Outdoor Boys", "channels": [781], "class": "DEDICATED_HOME", "max": 300, "min": 600, "filter": "camp|shelter|tent|overnight|survival|snow cave|igloo|cabin|bushcraft"},
    {"id": "src_kevin_powell", "handle": "@KevinPowell", "name": "Kevin Powell", "channels": [637], "class": "DEDICATED_HOME", "max": 300, "min": 480},
    {"id": "src_web_dev_simplified", "handle": "@WebDevSimplified", "name": "Web Dev Simplified", "channels": [637], "class": "DEDICATED_HOME", "max": 300, "min": 480},
    {"id": "src_techworld_nana", "handle": "@TechWorldwithNana", "name": "TechWorld with Nana", "channels": [645], "class": "DEDICATED_HOME", "max": 300, "min": 480},
    {"id": "src_be_a_better_dev", "handle": "@BeABetterDev", "name": "Be A Better Dev", "channels": [645], "class": "DEDICATED_HOME", "max": 300, "min": 480},
    {"id": "src_eevblog", "handle": "@EEVblog", "name": "EEVblog", "channels": [816], "class": "DEDICATED_HOME", "max": 300, "min": 600, "exclude": "drones?|rocket|satellite|\\bspace\\b|aircraft"},
    {"id": "src_greatscott", "handle": "@greatscottlab", "name": "GreatScott!", "channels": [816], "class": "DEDICATED_HOME", "max": 300, "min": 300},
    {"id": "src_bigclive", "handle": "@bigclivedotcom", "name": "bigclivedotcom", "channels": [816], "class": "DEDICATED_HOME", "max": 300, "min": 600},
    {"id": "src_modern_vintage_gamer", "handle": "@ModernVintageGamer", "name": "Modern Vintage Gamer", "channels": [813], "class": "DEDICATED_HOME", "max": 300, "min": 600},
    {"id": "src_cartoon_network_uk", "handle": "@CartoonNetworkUK", "name": "Cartoon Network UK", "channels": [222], "class": "DEDICATED_HOME", "max": 300, "min": 600, "exclude": "trailer|teaser|promo", "scan": 1500},
    {"id": "src_nickelodeon_uk", "handle": "@NickelodeonUK", "name": "Nickelodeon UK", "channels": [222], "class": "DEDICATED_HOME", "max": 300, "min": 600, "exclude": "trailer|teaser|promo", "scan": 1500},
    {"id": "src_pc_gamer", "handle": "@pcgamer", "name": "PC Gamer", "channels": [244], "class": "DEDICATED_HOME", "max": 300, "min": 600, "scan": 1500, "exclude": "中文|日本語|한국어|espa[nñ]ol|portugu[eê]s|deutsch|fran[cç]ais|sign language|\\bbsl\\b|livestream|flight simulator|\\bplanes?\\b|aircraft|\\bspace\\b|starfield|elite dangerous|star citizen"},
    {"id": "src_mock_the_week", "handle": "@MockTheWeek", "name": "Mock The Week", "channels": [265], "class": "DEDICATED_HOME", "max": 300, "min": 300},
    {"id": "src_eminem", "handle": "@EminemVEVO", "name": "Eminem (Vevo)", "channels": [593], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_kendrick_lamar", "handle": "@KendrickLamarVEVO", "name": "Kendrick Lamar (Vevo)", "channels": [593], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_50_cent", "handle": "@50CentVEVO", "name": "50 Cent (Vevo)", "channels": [593], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_khruangbin", "handle": "@khruangbin", "name": "Khruangbin", "channels": [575], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_economics_explained", "handle": "@EconomicsExplained", "name": "Economics Explained", "channels": [614], "class": "DEDICATED_HOME", "max": 300, "min": 300},
    {"id": "src_imagine_dragons", "handle": "@ImagineDragonsVEVO", "name": "Imagine Dragons (Vevo)", "channels": [592], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_arctic_monkeys", "handle": "@ArcticMonkeysVEVO", "name": "Arctic Monkeys (Vevo)", "channels": [592], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_mahogany", "handle": "@MahoganySessions", "name": "Mahogany Sessions", "channels": [558], "class": "DEDICATED_HOME", "max": 300, "min": 150, "scan": 1500},
    {"id": "src_paste", "handle": "@PasteMagazine", "name": "Paste Magazine", "channels": [586], "class": "DEDICATED_HOME", "max": 300, "min": 900, "scan": 1500, "filter": "full session|live|concert|performance"},
    {"id": "src_this_morning", "handle": "@thismorning", "name": "This Morning", "channels": [267], "class": "DEDICATED_HOME", "max": 200, "min": 300, "scan": 1500},
    {"id": "src_loose_women", "handle": "@loosewomen", "name": "Loose Women", "channels": [267], "class": "DEDICATED_HOME", "max": 150, "min": 300, "scan": 1500},
    {"id": "src_slowdive", "handle": "@slowdiveband", "name": "Slowdive", "channels": [510], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_my_bloody_valentine", "handle": "@mbvofficial", "name": "my bloody valentine", "channels": [510], "class": "DEDICATED_HOME", "max": 300, "min": 150, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_screen_junkies", "handle": "@screenjunkies", "name": "Screen Junkies", "channels": [251], "class": "DEDICATED_HOME", "max": 300, "min": 300, "exclude": "\\bspace\\b|astronaut|\\bplanes?\\b|pilot"},
    {"id": "src_dead_meat", "handle": "@DeadMeat", "name": "Dead Meat", "channels": [256], "class": "DEDICATED_HOME", "max": 300, "min": 600, "scan": 1500},
    {"id": "src_court_tv", "handle": "@COURTTV", "name": "Court TV", "channels": [468], "class": "DEDICATED_HOME", "max": 200, "min": 1200, "scan": 1500},
    # pass 13: high-yield batch. channels [] with DEDICATED [] = era-only: airs solely where a verified original year routes it.
    {"id": "src_rt_classic_trailers", "handle": "UCTCjFFoX1un-j7ni4B6HJ3Q", "name": "Rotten Tomatoes Classic Trailers", "channels": [], "max": 5000, "min": 30, "scan": 5000,
     "filter": r"trailer|teaser", "exclude": r"compilation|trailers\b|\breel\b|supercut|mash-?up|\btop \d+|\bbest\b|every |re-?release|anniversary|restor|remaster|re-?issue|\b4k\b|\b3-?d\b|imax|special edition|director'?s cut|extended|flight|\bplanes?\b|airline|airport|hijack|space station|astronaut"},
    {"id": "src_ed_sullivan", "handle": "@TheEdSullivanShow", "name": "The Ed Sullivan Show", "channels": [], "max": 5000, "min": 90, "scan": 4500,
     "exclude": r"comedy|comedian|sketch|puppet|topo gigio|magician|juggl|acrobat|circus|interview|trailer|teaser|#shorts|gospel|hymn|\bgod\b|jesus|prayer|christmas|easter|ave maria|church"},
    {"id": "src_the_beatles", "handle": "@thebeatles", "name": "The Beatles", "channels": [], "max": 300, "min": 90, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_rolling_stones", "handle": "@TheRollingStones", "name": "The Rolling Stones", "channels": [], "max": 300, "min": 90, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_roy_orbison", "handle": "@RoyOrbison", "name": "Roy Orbison", "channels": [], "max": 300, "min": 90, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_beach_boys", "handle": "@TheBeachBoys", "name": "The Beach Boys", "channels": [], "max": 300, "min": 90, "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing"},
    {"id": "src_vevo_classics", "handle": "@Vevo", "name": "Vevo – Legends & Classics playlists", "channels": [], "playlists_only": True, "channel_title": r"vevo$",
     "playlists": ["PLZxSVxATJoBo", "PL9tY0BWXOZFthIsypeOS1X3qHYriHDQ-o", "PL9tY0BWXOZFva3IT-Oe4HRKhRlMNNgO01"], "max": 1000, "min": 120,
     "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing|gospel|hymn|\\bgod\\b|jesus|worship|praise|christmas"},
    {"id": "src_vevo_80s", "handle": "@Vevo", "name": "Vevo – '80s playlists", "channels": [], "playlists_only": True, "channel_title": r"vevo$",
     "playlists": ["PL9tY0BWXOZFuMkpfC3ttVfZQl7Kfjz1zr", "PL9tY0BWXOZFutrV9ptOM2gTIXo2x1RcdB"], "max": 1000, "min": 120,
     "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing|gospel|hymn|\\bgod\\b|jesus|worship|praise|christmas"},
    {"id": "src_vevo_90s", "handle": "@Vevo", "name": "Vevo – '90s playlists", "channels": [], "playlists_only": True, "channel_title": r"vevo$",
     "playlists": ["PL9tY0BWXOZFtCYYiFndg8iCepdEStORoa", "PL9tY0BWXOZFv1CS6ZBFr64ysF7KLuKxDV", "PL9tY0BWXOZFvQ6_cPgtm_9hXJDwI2m318", "PL9tY0BWXOZFsxLJ4OpQdK9GwvZWHqHLBH"], "max": 1000, "min": 120,
     "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing|gospel|hymn|\\bgod\\b|jesus|worship|praise|christmas"},
    {"id": "src_vevo_2000s", "handle": "@Vevo", "name": "Vevo – 2000s playlists", "channels": [], "playlists_only": True, "channel_title": r"vevo$",
     "playlists": ["PL9tY0BWXOZFtw25cyS1csxKtKgyrePAov", "PL9tY0BWXOZFtv-Q1GN2jDWKRA5bV4-eON", "PL9tY0BWXOZFtS4XvtLPowdio3WN5dgFsv", "PL9tY0BWXOZFs8tyrjfwNmZbetymP8F1_W",
                   "PL9tY0BWXOZFs9hqviEGuC1dqMJfqHtS88", "PL9tY0BWXOZFsaZ5qO2W7_vmn_XZwDa02F"], "max": 1000, "min": 120,
     "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing|gospel|hymn|\\bgod\\b|jesus|worship|praise|christmas"},
    *[{"id": f"src_vevo_{slug}", "handle": handle, "name": f"{name} (Vevo)", "channels": [], "channel_title": r"vevo$", "max": 300, "min": 120,
       "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|full album|album stream|podcast|unboxing|gospel|hymn|\\bgod\\b|jesus|worship|praise|christmas"}
      for slug, handle, name in [
          ("abba", "@ABBAVEVO", "ABBA"), ("queen", "@QueenVEVO", "Queen"), ("elton_john", "@EltonJohnVEVO", "Elton John"), ("bob_marley", "@BobMarleyVEVO", "Bob Marley"),
          ("fleetwood_mac", "@FleetwoodMacVEVO", "Fleetwood Mac"), ("stevie_wonder", "@StevieWonderVEVO", "Stevie Wonder"), ("diana_ross", "@DianaRossVEVO", "Diana Ross"),
          ("ewf", "@EarthWindandFireVEVO", "Earth, Wind & Fire"), ("blondie", "@BlondieVEVO", "Blondie"), ("carpenters", "@CarpentersVEVO", "Carpenters"),
          ("donna_summer", "@DonnaSummerVEVO", "Donna Summer"), ("barry_white", "@BarryWhiteVEVO", "Barry White"), ("marvin_gaye", "@MarvinGayeVEVO", "Marvin Gaye"),
          ("temptations", "@TheTemptationsVEVO", "The Temptations"), ("smokey_robinson", "@SmokeyRobinsonVEVO", "Smokey Robinson"), ("dolly_parton", "@DollyPartonVEVO", "Dolly Parton"),
          ("simon_garfunkel", "@SimonGarfunkelVEVO", "Simon & Garfunkel")]],
    {"id": "src_vevo_live", "handle": "@Vevo", "name": "Vevo – Live Performances", "channels": [598], "channel_title": r"vevo$", "scan": 3000,
     "playlists": ["PLQMWO_mH7_bU", "PLR5IQkkV9SEM", "PL9tY0BWXOZFsU8VLv7Ma-P0F50wFVYiV8", "PL9tY0BWXOZFvk5PADOe1JGBPsPkauy3oJ", "PL9tY0BWXOZFtgdyHl1GJoI_Psrq0uBNIg",
                   "PL9tY0BWXOZFv0yWPKk7lB8LsQJjo3tCov", "PL9tY0BWXOZFvD8Fhi3y_4gJ9Zy9Unc_yI", "PL9tY0BWXOZFtH3Y3NHvQrCJ8aruQaHZd6", "PL9tY0BWXOZFuigEL4C0je6LvQIs5CHTh3"],
     "max": 1000, "min": 120, "filter": r"\blive\b|performance|vevo lift|vevo ctrl|session",
     "exclude": "official audio|\\baudio\\b|lyric|visuali[sz]er|trailer|teaser|#shorts|interview|meaning|footnotes|behind the scenes|podcast|gospel|hymn|\\bgod\\b|jesus|worship|praise|christmas"},
    {"id": "src_vevo_dscvr", "handle": "@vevodscvr", "name": "Vevo DSCVR", "channels": [599], "max": 1000, "min": 120, "scan": 1500,
     "exclude": "trailer|teaser|#shorts|interview|podcast|gospel|hymn|\\bgod\\b|jesus|worship|praise|christmas"},
    {"id": "src_spinnin", "handle": "@SpinninRecords", "name": "Spinnin' Records", "channels": [578], "max": 300, "min": 120, "scan": 4000, "filter": r"remix|\brework\b|\bedit\)|\bvip\b|bootleg|flip\)",
     "exclude": "lyric|visuali[sz]er|#shorts|trailer|teaser|podcast|mix \\d|mixtape|dj set|live set|radio show"},
    {"id": "src_ultra", "handle": "@UltraRecords", "name": "Ultra Records", "channels": [578], "max": 300, "min": 120, "scan": 4000, "filter": r"remix|\brework\b|\bvip\b|bootleg|flip\)",
     "exclude": "lyric|visuali[sz]er|#shorts|trailer|teaser|podcast|mix \\d|mixtape|dj set|live set|radio show"},
    {"id": "src_armada", "handle": "@ArmadaMusicTV", "name": "Armada Music", "channels": [578], "max": 300, "min": 120, "scan": 4000, "filter": r"remix|\brework\b|\bvip\b|bootleg|flip\)",
     "exclude": "lyric|visuali[sz]er|#shorts|trailer|teaser|podcast|mix \\d|mixtape|dj set|live set|radio show|a state of trance|asot|episode"},
    {"id": "src_monstercat", "handle": "@Monstercat", "name": "Monstercat", "channels": [578], "max": 300, "min": 120, "scan": 2600, "filter": r"remix|\brework\b|\bvip\b|bootleg|flip\)",
     "exclude": "lyric|visuali[sz]er|#shorts|trailer|teaser|podcast|mix \\d|mixtape|dj set|live set|radio show|call of the wild|album mix"},
    # rail: one publisher identity per channel
    {"id": "src_hs2", "handle": "@HS2Ltd", "name": "HS2 Ltd", "channels": [665], "max": 300, "min": 120, "exclude": r"aviation|aircraft|airport|helicopter|#shorts|job|careers|recruit"},
    {"id": "src_jago_hazzard", "handle": "@jagohazzard", "name": "Jago Hazzard", "channels": [678], "max": 300, "min": 300,
     "filter": r"rail|train|station|\bline\b|tube|underground|\btram|locomotive|metro|signal|junction|track|platform|branch|viaduct|tunnel|carriage|\bgwr\b|\blner\b|elizabeth|overground|\bdlr\b", "exclude": r"aircraft|\bplanes?\b|airport|airline|aviation|\bspace\b"},
    {"id": "src_nrm", "handle": "@NatRailwayMuseum", "name": "National Railway Museum", "channels": [679], "max": 300, "min": 90, "exclude": r"aircraft|aviation|\bspace\b|#shorts"},
    {"id": "src_all_the_stations", "handle": "@AllTheStations", "name": "All The Stations", "channels": [774], "max": 300, "min": 300, "exclude": r"aircraft|\bplanes?\b|airport|airline|flight"},
    {"id": "src_severn_valley", "handle": "UCoaT_geZ6GwRscQgOlchh_w", "name": "Severn Valley Railway", "channels": [821], "max": 300, "min": 60, "exclude": r"#shorts|\bjobs?\b|volunteer(ing)? opportunit|santa|christmas"},
    {"id": "src_bluebell", "handle": "@BluebellRail", "name": "Bluebell Railway", "channels": [821], "max": 300, "min": 60, "exclude": r"#shorts|\bjobs?\b|santa|christmas"},
    {"id": "src_kwvr", "handle": "@KwvrUkRailway", "name": "Keighley and Worth Valley Railway", "channels": [821], "max": 300, "min": 60, "exclude": r"#shorts|\bjobs?\b|santa|christmas"},
    {"id": "src_network_rail", "handle": "@NetworkRail", "name": "Network Rail", "channels": [822], "max": 300, "min": 90, "exclude": r"#shorts|aviation|aircraft|helicopter|\bjobs?\b|careers|apprentice|recruit|podcast"},
    {"id": "src_rail_relaxation", "handle": "@RailRelaxation", "name": "Rail Relaxation", "channels": [823], "max": 300, "min": 900},
    # slow TV / walking / travel
    {"id": "src_railcowgirl", "handle": "@RailCowGirl", "name": "RailCowGirl", "channels": [95], "max": 300, "min": 2700, "exclude": r"#shorts|\blive\b|stream"},
    {"id": "src_j_utah", "handle": "@JUtah", "name": "J Utah", "channels": [95], "max": 300, "min": 2700, "filter": r"driv", "exclude": r"#shorts|\blive\b|stream|airport|flight|walk"},
    {"id": "src_prowalk", "handle": "@prowalktours", "name": "Prowalk Tours", "channels": [775], "max": 300, "min": 1200, "filter": r"walk", "exclude": r"drone|scooter|\bbike\b|cycling|\bboat\b|airport|#shorts|\blive\b"},
    {"id": "src_rambalac", "handle": "@rambalac", "name": "Rambalac", "channels": [775], "max": 300, "min": 1200, "filter": r"walk|stroll", "exclude": r"drive|driving|\bbike\b|cycling|train|airport|#shorts|\blive\b|shrine|temple"},
    {"id": "src_wind_walk", "handle": "@WindWalkTravelVideos", "name": "Wind Walk Travel Videos", "channels": [775], "max": 300, "min": 1200, "filter": r"walk", "exclude": r"drive|driving|drone|airport|#shorts|\blive\b|church|cathedral|temple|mosque|shrine"},
    {"id": "src_kara_and_nate", "handle": "@KaraandNate", "name": "Kara and Nate", "channels": [57], "max": 300, "min": 480, "exclude": r"flight|airline|airport|\bplanes?\b|first class|business class|pilot|cruise ship|#shorts|q ?& ?a|podcast|house tour|pregnan|baby"},
    {"id": "src_lost_leblanc", "handle": "@LostLeBlanc", "name": "Lost LeBlanc", "channels": [57], "max": 300, "min": 300, "exclude": r"flight|airline|airport|\bplanes?\b|first class|business class|pilot|#shorts|podcast|how i make money|camera gear"},
    {"id": "src_wolters_world", "handle": "@WoltersWorld", "name": "Wolters World", "channels": [772], "max": 300, "min": 300, "scan": 3300,
     "filter": r"\bcity\b|cities|things to do|what to (see|do)|\bdays? in\b|weekend in|visiting|downtown|old town|neighbo(u)?rhoods?",
     "exclude": r"flight|airline|airport|\bplanes?\b|pilot|cruise|#shorts|\blive\b|podcast|q ?& ?a|church|cathedral|temple|mosque|vatican"},
    # nature / earth: one identity per channel
    {"id": "src_free_documentary_nature", "handle": "@FreeDocumentaryNature", "name": "Free Documentary – Nature", "channels": [23], "max": 300, "min": 1200,
     "exclude": r"\bspace\b|astro|\bmoon\b|planets\b|cosmic|galax|orbit|\bmars\b|nasa|rocket|satellite|aircraft|aviation|flight|\bplanes?\b"},
    # Nat Geo Animals and Love Nature were probed and rejected: almost their whole catalogues are blocked in GB.
    {"id": "src_real_wild", "handle": "@RealWild", "name": "Real Wild", "channels": [66], "max": 300, "min": 1200,
     "exclude": r"\bspace\b|astro|\bmoon\b|planets\b|cosmic|galax|orbit|\bmars\b|nasa|rocket|satellite|aircraft|aviation|flight|\bplanes?\b|#shorts|\blive\b"},
    {"id": "src_brave_wilderness", "handle": "@BraveWilderness", "name": "Brave Wilderness", "channels": [66], "max": 300, "min": 480,
     "exclude": r"\bspace\b|aircraft|aviation|flight|\bplanes?\b|#shorts|\blive\b|podcast|q ?& ?a|merch"},
    {"id": "src_terra_mater", "handle": "@TerraMater", "name": "Terra Mater", "channels": [784], "max": 300, "min": 600,
     "exclude": r"\bspace\b|astro|\bmoon\b|planets\b|cosmic|galax|orbit|\bmars\b|nasa|rocket|satellite|aircraft|aviation|flight|\bplanes?\b|#shorts|\blive\b|trailer|teaser"},
    {"id": "src_the_dodo", "handle": "@TheDodo", "name": "The Dodo", "channels": [788], "max": 600, "min": 180, "scan": 3000,
     "exclude": r"\bspace\b|aircraft|aviation|flight|\bplanes?\b|airport|#shorts|\blive\b|podcast|church|prayer"},
    {"id": "src_nick_zentner", "handle": "@GeologyNick", "name": "Nick Zentner", "channels": [65], "max": 300, "min": 600,
     "exclude": r"\bspace\b|astro|\bmoon\b|planets?\b|cosmic|galax|orbit|\bmars\b|nasa|rocket|satellite|asteroid|meteor|impact crater|aircraft|aviation|flight|\bplanes?\b|\blive\b|q ?& ?a"},
    {"id": "src_usgs", "handle": "@USGS", "name": "USGS", "channels": [431], "max": 300, "min": 120,
     "exclude": r"\bspace\b|astro|\bmoon\b|lunar|planets?\b|cosmic|galax|orbit|\bmars\b|nasa|rocket|satellite|landsat|asteroid|meteor|aircraft|aviation|flight|\bplanes?\b|drone|uas\b|helicopter|webinar|\blive\b|#shorts"},
    {"id": "src_iris_earthquake", "handle": "@IRISEarthquakeScience", "name": "IRIS Earthquake Science", "channels": [431], "max": 300, "min": 60,
     "exclude": r"\bspace\b|astro|\bmoon\b|lunar|planets?\b|cosmic|galax|orbit|\bmars\b|nasa|rocket|satellite|asteroid|meteor|aircraft|aviation|flight|\bplanes?\b|webinar|\blive\b|#shorts"},
    {"id": "src_pbs_terra", "handle": "@PBSTerra", "name": "PBS Terra", "channels": [483], "max": 300, "min": 300,
     "filter": r"earth|climate|ocean|\bsea\b|volcan|earthquake|glacier|\bice\b|forest|river|desert|weather|storm|hurricane|nature|evolution|fossil|dinosaur|extinct|species|animal|wildlife|soil|rain|drought|flood|wildfire|coral|reef",
     "exclude": r"\bspace\b|astro|\bmoon\b|lunar|planets\b|exoplanet|cosmic|galax|universe|orbit|\bmars\b|venus|jupiter|nasa|rocket|satellite|asteroid|meteor|alien|aircraft|aviation|flight|\bplanes?\b|\bgods?\b|religio"},
    # football / sport
    {"id": "src_premier_league", "handle": "@premierleague", "name": "Premier League", "channels": [307], "max": 300, "min": 180, "scan": 2500, "exclude": r"#shorts|\blive\b|fantasy|\bfpl\b|trailer|teaser|podcast|ea sports fc|\bgaming\b"},
    {"id": "src_uefa", "handle": "@UEFA", "name": "UEFA", "channels": [308], "max": 300, "min": 180, "scan": 3000, "exclude": r"#shorts|\blive\b|draw|trailer|teaser|podcast|efootball|\bgaming\b|futsal"},
    {"id": "src_bundesliga", "handle": "@bundesliga", "name": "Bundesliga", "channels": [308], "max": 300, "min": 180, "scan": 2500, "exclude": r"#shorts|\blive\b|trailer|teaser|podcast|ea sports fc|\bgaming\b"},
    {"id": "src_england_football", "handle": "@England", "name": "England", "channels": [311], "max": 300, "min": 180, "scan": 2500, "exclude": r"#shorts|\blive\b|trailer|teaser|podcast|ea sports fc|\bgaming\b|lionesses|women|\bwsl\b"},
    {"id": "src_concacaf", "handle": "@Concacaf", "name": "Concacaf", "channels": [311], "max": 300, "min": 300, "scan": 3000, "exclude": r"#shorts|\blive\b|trailer|teaser|podcast|\bgaming\b|futsal|beach soccer|draw"},
    {"id": "src_coaches_voice", "handle": "@TheCoachesVoice", "name": "Coaches' Voice", "channels": [313], "max": 300, "min": 180,
     "filter": r"tactic|explained|analysis|how .{1,40} (play|plays|played|won|works?|press|build)|masterclass|system|formation|pressing|breakdown|in-game|playbook|role of|coach(es|ing)?\b",
     "exclude": r"#shorts|\blive\b|trailer|teaser|podcast"},
    {"id": "src_wwe_vault", "handle": "@WWEVault", "name": "WWE Vault", "channels": [329], "max": 300, "min": 300, "scan": 3400, "exclude": r"#shorts|\blive\b|podcast|trailer|teaser"},
    {"id": "src_wcw", "handle": "@WCW", "name": "WCW", "channels": [329], "max": 300, "min": 300, "exclude": r"#shorts|\blive\b|podcast|trailer|teaser"},
    {"id": "src_fis_alpine", "handle": "@fisalpine", "name": "FIS Alpine", "channels": [356], "max": 300, "min": 120, "scan": 3000, "exclude": r"#shorts|\blive\b|stream|podcast"},
    {"id": "src_tgr", "handle": "@tetongravityresearch", "name": "Teton Gravity Research", "channels": [356], "max": 300, "min": 300,
     "filter": r"\bski|snow|powder|avalanche|winter|backcountry|freeride|couloir|alpine|big mountain",
     "exclude": r"heli|wingsuit|paraglid|\bplanes?\b|aircraft|flight|base jump|surf|\bbike|\bmtb\b|mountain bik|kayak|#shorts|\blive\b"},
    {"id": "src_ecb", "handle": "@officialenglandcricket", "name": "England & Wales Cricket Board", "channels": [360], "max": 300, "min": 180, "scan": 3000, "exclude": r"#shorts|\blive\b|stream|podcast|\bicc\b"},
    {"id": "src_cricket_au", "handle": "@cricketcomau", "name": "cricket.com.au", "channels": [360], "max": 300, "min": 180, "scan": 3000, "exclude": r"#shorts|\blive\b|stream|podcast|\bicc\b"},
    # Pass 14. Broadcast history first, so the BBC Archive general pool below skips its picks.
    {"id": "src_bbc_archive_broadcasting", "handle": "@BBCArchive", "name": "BBC Archive – Broadcasting History", "channels": [893], "max": 300, "min": 120, "scan": 2000,
     "filter": r"history of (tv|television|broadcasting|the bbc|radio)|television centre|tv centre|broadcasting house|test card|transmitter|colou?r (tv|television)|first (tv|television|broadcast)|"
               r"television (studio|camera|set)|outside broadcast|announcer|continuity|newsreader|how (tv|television|radio) (is|was) made|behind the scenes|pirate radio|teletext|ceefax|"
               r"\b(\d+) years of (bbc|television|radio|tv)|birth of (tv|television)|bbc (television|radio|tv) (begins|began|opens|launch)|television service|radio times|licence fee",
     "exclude": r"#shorts|\blive\b|classic bbc sport|classic bbc music|football|records"},
    {"id": "src_tv_academy_interviews", "handle": "UCj4PxzfWBNV9vIdEPkglrrg", "name": "Television Academy Foundation – The Interviews", "channels": [893], "max": 300, "min": 360, "scan": 6000,
     "exclude": r"#shorts|\blive\b|trailer|promo"},
    {"id": "src_paley_center", "handle": "@PaleyCenter", "name": "The Paley Center for Media", "channels": [893], "max": 300, "min": 900, "scan": 3110,
     "filter": r"retrospective|reunion|anniversary|legacy|remember|history|classic|golden age|pioneer|looks back|original cast|tribute|\b19[4-9]\d\b|paley archive|rewind",
     "exclude": r"#shorts|\blive\b|trailer|teaser|sneak peek|first look|paleyimpact|holocaust"},
    {"id": "src_thames_tv", "handle": "@ThamesTV", "name": "Thames TV", "channels": [288], "max": 300, "min": 300, "scan": 4414, "exclude": r"#shorts|\blive\b|trailer|teaser"},
    {"id": "src_bbc_archive", "handle": "@BBCArchive", "name": "BBC Archive", "channels": [288], "max": 300, "min": 180, "scan": 2000, "exclude": r"#shorts|\blive\b|trailer|teaser"},
    {"id": "src_johnny_carson", "handle": "@JohnnyCarson", "name": "Johnny Carson", "channels": [289], "max": 300, "min": 300, "exclude": r"#shorts|\blive\b|trailer|podcast"},
    {"id": "src_carol_burnett", "handle": "@carolburnettshow", "name": "The Carol Burnett Show", "channels": [289], "max": 300, "min": 300, "exclude": r"#shorts|\blive\b|trailer|podcast"},
    {"id": "src_us_national_archives", "handle": "@usnationalarchives", "name": "US National Archives", "channels": [808], "max": 300, "min": 300, "scan": 3940,
     "filter": r"\bfilms?\b|newsreel|footage|documentary|motion picture|public (information|service)|information film|\bpsa\b|\breel\b|\(19\d\d\)|\b19[0-7]\d\b",
     "exclude": r"#shorts|\blive\b|lecture|\btalk\b|webinar|conversation|discussion|panel|\bbook\b|author|genealogy|podcast|q ?& ?a|tutorial|how to|interview|symposium|ceremony|naturalization|remarks|flight|avrocar|aircraft|airplane|memphis belle|midway|thunderbolt|b-\d\d|bomber|squadron|pilot|flying|\bair\b|teaching|primary sources|formidable|educator|exhibit|\bplanes?\b|aviation|air force|\bspace\b|beyond earth|rocket|missile|satellite|\(\d{4} \w+ \d+\)|presents"},
    {"id": "src_iwm", "handle": "@ImperialWarMuseums", "name": "Imperial War Museums", "channels": [808], "max": 300, "min": 300,
     "filter": r"\bfilms?\b|newsreel|footage|documentary|information film|\breel\b|\(19\d\d\)|archive",
     "exclude": r"#shorts|\blive\b|lecture|\btalk\b|webinar|conversation|discussion|panel|\bbook\b|author|podcast|q ?& ?a|interview|exhibition|visit"},
    {"id": "src_national_archives_uk", "handle": "@TheNationalArchivesUK", "name": "The National Archives UK", "channels": [808], "max": 300, "min": 180,
     "filter": r"\bfilms?\b|newsreel|footage|public information|information film|\bcoi\b|\breel\b|\(19\d\d\)",
     "exclude": r"#shorts|\blive\b|lecture|\btalk\b|webinar|conversation|discussion|panel|\bbook\b|author|podcast|q ?& ?a|interview|family history|genealogy"},
    {"id": "src_yorkshire_film_archive", "handle": "@YorkshireFilmArchive", "name": "Yorkshire and North East Film Archive", "channels": [808], "max": 300, "min": 120, "exclude": r"#shorts|\blive\b|trailer|sharing memories|celebrating|project|group"},
    {"id": "src_frontline", "handle": "@frontline", "name": "FRONTLINE PBS", "channels": [914], "max": 300, "min": 1500, "exclude": r"#shorts|\blive\b|trailer|preview|\bclip\b|podcast"},
    {"id": "src_abc_news_indepth", "handle": "@ABCNewsIndepth", "name": "ABC News In-depth", "channels": [914], "max": 300, "min": 1500, "scan": 3000,
     "filter": r"four corners|australian story|foreign correspondent|documentary|compass", "exclude": r"#shorts|\blive\b|trailer|podcast|press conference|q ?& ?a"},
    {"id": "src_cna_insider", "handle": "@CNAInsider", "name": "CNA Insider", "channels": [914], "max": 300, "min": 1200, "scan": 3000, "exclude": r"#shorts|\blive\b|trailer|podcast|\bclip\b"},
    # business / industry: manufacturing before the CNBC documentary pool
    {"id": "src_bi_manufacturing", "handle": "@businessinsider", "name": "Business Insider – Manufacturing", "channels": [622], "max": 300, "min": 300, "scan": 3000,
     "filter": r"factor(y|ies)|how .{0,50}\b(is|are|gets?) made|manufactur|production line|assembly line|\bmills?\b|foundry|forg(e|ing)\b|made in (a|the|america|britain|japan|china)|mass.produc|how .{0,40}(make|makes|produce|produces)",
     "exclude": r"#shorts|\blive\b|aircraft|airplane|\bplanes?\b|jet|aviation|rocket|boeing|airbus|missile|drone|satellite|\bspace\b|movies insider|for (tv|movies)|price is right|drag queens|made with pride|commercials|millions\b|fortune|travel dares"},
    {"id": "src_insider_manufacturing", "handle": "@Insider", "name": "Insider – Manufacturing", "channels": [622], "max": 300, "min": 300, "scan": 3000,
     "filter": r"factor(y|ies)|how .{0,50}\b(is|are|gets?) made|manufactur|production line|assembly line|\bmills?\b|foundry|forg(e|ing)\b|mass.produc|how .{0,40}(make|makes|produce|produces)",
     "exclude": r"#shorts|\blive\b|aircraft|airplane|\bplanes?\b|jet|aviation|rocket|boeing|airbus|missile|drone|satellite|\bspace\b|movies insider|for (tv|movies)|price is right|drag queens|made with pride|commercials|millions\b|fortune|travel dares"},
    {"id": "src_cnbc_manufacturing", "handle": "@CNBC", "name": "CNBC – Manufacturing", "channels": [622], "max": 300, "min": 300, "scan": 3000,
     "filter": r"factor(y|ies)|how .{0,50}\b(is|are|gets?) made|manufactur|production line|assembly line|\bmills?\b|foundry|mass.produc|inside (the|a) .{0,30}(plant|factory)",
     "exclude": r"#shorts|\blive\b|aircraft|airplane|\bplanes?\b|jet|aviation|rocket|boeing|airbus|missile|drone|satellite|\bspace\b|movies insider|for (tv|movies)|price is right|drag queens|made with pride|commercials|millions\b|fortune|travel dares"},
    {"id": "src_stanford_gsb", "handle": "@StanfordGSB", "name": "Stanford Graduate School of Business", "channels": [600], "max": 300, "min": 900, "scan": 3000,
     "exclude": r"#shorts|\blive\b|commencement|graduation|admissions|class of|reunion|alumni|info session|faith|religio|connect|student association|virtual|your journey|webinar|community|welcome|orientation|club|conference|ceremony|diploma|deans"},
    {"id": "src_hbr", "handle": "@HarvardBusinessReview", "name": "Harvard Business Review", "channels": [600], "max": 300, "min": 240, "exclude": r"#shorts|\blive\b|podcast trailer|subscribe"},
    {"id": "src_cnbc_make_it", "handle": "@CNBCMakeIt", "name": "CNBC Make It", "channels": [600], "max": 300, "min": 300, "scan": 3191,
     "filter": r"business|company|companies|entrepreneur|startup|founder|\bceo\b|boss|brand|million|billion|small business|side hustle|franchise|work(place|ers)?\b|career",
     "exclude": r"#shorts|\blive\b|millennial money|retire|budget breakdown|what i spend|living on"},
    {"id": "src_company_man", "handle": "UCQMyhrt92_8XM0KgZH6VnRg", "name": "Company Man", "channels": [615], "max": 300, "min": 300, "exclude": r"#shorts|\blive\b|q ?& ?a|podcast"},
    {"id": "src_business_casual", "handle": "@BusinessCasual", "name": "Business Casual", "channels": [615], "max": 300, "min": 300, "exclude": r"#shorts|\blive\b|podcast"},
    {"id": "src_logically_answered", "handle": "@LogicallyAnswered", "name": "Logically Answered", "channels": [615], "max": 300, "min": 300,
     "filter": r"history|rise|fall|downfall|collapse|story|what happened|how .{0,40}(became|built|lost|died|failed|grew)|empire|decline|origins?",
     "exclude": r"#shorts|\blive\b|podcast"},
    {"id": "src_bloomberg_originals", "handle": "UCUMZ7gohGI9HcU9VNsr2FJQ", "name": "Bloomberg Originals", "channels": [629], "max": 300, "min": 1200, "scan": 4000,
     "exclude": r"#shorts|\blive\b|podcast|wall street week|balance of power|surveillance|the close|the open|daybreak|full show|markets|stream|\btv\b|interview|speaks|conversation|brilliant ideas|investigates|immigration|trump|contagion|election|\bwar\b|military|photograph|art\b|artist|talks\b|politics"},
    {"id": "src_cnbc_documentary", "handle": "@CNBC", "name": "CNBC – Documentaries", "channels": [629], "max": 300, "min": 1500, "scan": 3000,
     "exclude": r"#shorts|\blive\b|shark tank|the profit|squawk|closing bell|full episode of|stream|podcast|interview|price update|moderat|discussion|conference|summit|panel|\d{1,2}/\d{1,2}/\d{2,4}"},
    {"id": "src_economist", "handle": "@TheEconomist", "name": "The Economist", "channels": [629], "max": 300, "min": 900,
     "filter": r"econom|business|compan|market|trade|tariff|inflation|\bbanks?\b|money|financ|industr|boom|bust|\bai\b|oil|energy|prices?|debt|jobs|wealth|capitalis|crypto|stock|billion|corporate|workers?",
     "exclude": r"#shorts|\blive\b|podcast|trailer|\bwar\b|military|weapon|intelligence|babbage|checks and balance|drum tower|money talks|convention|election|campaign|interview|debate|festival"},
    {"id": "src_megaprojects", "handle": "UC0woBco6Dgcxt0h8SwyyOmw", "name": "Megaprojects", "channels": [663], "max": 300, "min": 600,
     "filter": r"build|built|construct|\bcity\b|cities|bridge|tunnel|\bdams?\b|canal|railway|\brail\b|metro|tower|skyscraper|\bwall\b|river|\bport\b|harbou?r|stadium|pipeline|highway|motorway|\broads?\b|island|megacity|capital|infrastructure|reservoir|barrier|aqueduct|palace|mine\b|megastructure",
     "exclude": r"\bf-\d+|eagle|submarine|warfare|warship|destroyer|frigate|battleship|\btanks?\b|nuclear|bomb|cathedral|church|temple|mosque|#shorts|\blive\b|aircraft|airplane|\bplanes?\b|\bjets?\b|aviation|airport|air base|airship|zeppelin|carrier|bomber|fighter|helicopter|rocket|missile|\bspace\b|satellite|station|launch|nasa|apollo|shuttle|orbit|lunar|\bmoon\b|\bmars\b|telescope|nuclear (weapon|bomb|test)|manhattan project|\bwar\b|military|army|navy|tank|weapon|cancelled"},
    {"id": "src_the_build", "handle": "UCN3aYbtQ7yCqk9DM56B0kEw", "name": "The Build", "channels": [663], "max": 300, "min": 300,
     "exclude": r"#shorts|\blive\b|podcast|aircraft|airport|aviation|\bspace\b|rocket|satellite"},
    # travel / ambient
    {"id": "src_nature_relaxation_films", "handle": "@NatureRelaxationFilms", "name": "Nature Relaxation Films", "channels": [94], "max": 300, "min": 1800,
     "exclude": r"music|piano|guitar|lofi|black screen|dark screen|\blive\b|stream|#shorts|aerial|drone|flight|\bspace\b|earth from|\biss\b|meditation|sleep|static|screensaver|fireplace|\bfire\b|christmas|tv art|aquarium"},
    {"id": "src_scenic_nature_relaxation", "handle": "UCKV_9NXnNbCpI19w22ucd3A", "name": "Scenic Nature Relaxation", "channels": [94], "max": 300, "min": 1800,
     "exclude": r"music|piano|guitar|lofi|black screen|dark screen|\blive\b|stream|#shorts|aerial|drone|flight|\bspace\b|earth from|\biss\b|meditation|sleep|static|screensaver|fireplace|\bfire\b|christmas|tv art|aquarium"},
    {"id": "src_balu_nature", "handle": "UCUTOwFZ5grVnUMvvleA_JMg", "name": "Balu – Relaxing Nature in 4K", "channels": [94], "max": 300, "min": 1800,
     "exclude": r"music|piano|guitar|lofi|black screen|dark screen|\blive\b|stream|#shorts|aerial|drone|flight|\bspace\b|earth from|\biss\b|meditation|sleep|static|screensaver|fireplace|\bfire\b|christmas|tv art|aquarium"},
    {"id": "src_relaxation_film", "handle": "UCPotnGNahFjLWjfsq4KYvuQ", "name": "Relaxation Film", "channels": [94], "max": 300, "min": 1800,
     "exclude": r"music|piano|guitar|lofi|black screen|dark screen|\blive\b|stream|#shorts|aerial|drone|flight|\bspace\b|earth from|\biss\b|meditation|sleep|static|screensaver|fireplace|\bfire\b|christmas|tv art|aquarium"},
    {"id": "src_arte_travel", "handle": "@ARTEtvDocumentary", "name": "ARTE.tv Documentary – Travel", "channels": [448], "max": 300, "min": 1500,
     "filter": r"journey|travel|road trip|coast|island|voyage|route|along the|expedition|by train|on the road|landscapes?|villages?|across|discover|the (alps|andes|nile|danube|amazon|himalaya)|europe'?s (coasts|mountains|rivers)|trip",
     "exclude": r"#shorts|\blive\b|war\b|ukraine|gaza|israel|putin|trump|election|military|army|drugs?|cartel|crime|terror|weapon|refugee|migrant|flight|airport|aircraft"},
    {"id": "src_free_documentary_travel", "handle": "@freedocumentary", "name": "Free Documentary – Travel", "channels": [448], "max": 300, "min": 1800,
     "filter": r"journey|travel|road trip|coast|island|voyage|route|along the|expedition|by train|on the road|villages?|across|discover|trip|people of|life in|cultures?",
     "exclude": r"#shorts|\blive\b|war\b|military|army|weapon|flight|airport|aircraft|\bspace\b|wildlife|animals?|predators?|\bsharks?\b|prison|gang|crime|drugs?|haunted|ghost|mystery"},
    {"id": "src_kombi_life", "handle": "@KombiLife", "name": "Kombi Life", "channels": [773], "max": 300, "min": 600, "exclude": r"#shorts|\blive\b|q ?& ?a|podcast|boat|sail|flight|airport|\bbuild\b|tour of our"},
    {"id": "src_itchy_boots", "handle": "@ItchyBoots", "name": "Itchy Boots", "channels": [773], "max": 300, "min": 600, "scan": 900, "exclude": r"#shorts|\blive\b|q ?& ?a|podcast|flight|airport|\bplanes?\b|trailer"},
    {"id": "src_travel_tiny_budget", "handle": "UCjs2gk48IqM2j7kwaKqYYYg", "name": "Travel Big with a Tiny Budget", "channels": [777], "max": 300, "min": 300,
     "filter": r"budget (trip|travel|plan|tour|guide)|low budget|on a budget|cheap|\$\d|₹\s?\d|under \d|save money|backpack|hostel|shoestring",
     "exclude": r"#shorts|\blive\b|flight|airline|airport|\bplanes?\b|temple|church|mosque|shrine"},
    {"id": "src_nomadic_matt", "handle": "@NomadicMatt", "name": "Nomadic Matt", "channels": [777], "max": 300, "min": 180,
     "filter": r"budget|cheap|\$\d|£\d|€\d|afford|save money|saving|backpack|hostel|free|for less|shoestring|low.cost|under \d|how much|cost|money|deals?",
     "exclude": r"#shorts|\blive\b|flight|airline|airport|\bplanes?\b|credit card|airfare|points|miles|freelance|writing|olympics|free travel|rent\b"},
    {"id": "src_older_backpacker", "handle": "UCDigfZFKxdPcMtg-ldrj1-A", "name": "OlderBackpacker", "channels": [777], "max": 300, "min": 300,
     "filter": r"budget|cheap|\$\d|£\d|€\d|afford|save money|backpack|hostel|shoestring|low.cost|under \d|how much|cost of",
     "exclude": r"#shorts|\blive\b|flight|airline|airport|\bplanes?\b|temple|church|mosque|shrine|q ?& ?a"},
    {"id": "src_holiday_expert", "handle": "UC_028dXp-sotGWR0ofrvjOg", "name": "Holiday Expert", "channels": [777], "max": 300, "min": 300,
     "filter": r"budget|cheap|\$\d|£\d|€\d|afford|save money|bargain|low.cost|under £|for less|deal",
     "exclude": r"#shorts|\blive\b|flight|airline|airport|\bplanes?\b|cruise|all.inclusive resort review|temple|church|mosque|qsuite|business class|first class|lounge|wedding|million"},
    {"id": "src_hopscotch", "handle": "UC0Tf8LUUtL3E24Dr28vXkbA", "name": "Hopscotch the Globe", "channels": [777], "max": 300, "min": 300,
     "filter": r"budget travel|travel hacks|broke|cheap|cost to travel|backpack|hostel|shoestring|travel on a budget|money.saving",
     "exclude": r"#shorts|\blive\b|flight|airline|airport|\bplanes?\b|first class|business class|temple|church|mosque|luxury|dalai|lama|monk|\brv\b|camper|airstream|home|house|van life"},
    # science / medicine: anatomy (structure) and physiology (function) split by title
    {"id": "src_our_changing_climate", "handle": "@OurChangingClimate", "name": "Our Changing Climate", "channels": [489], "max": 300, "min": 300, "exclude": r"#shorts|\blive\b|podcast|flight|airline|aviation|\bplanes?\b|\bspace\b|satellite"},
    {"id": "src_just_have_a_think", "handle": "@JustHaveaThink", "name": "Just Have a Think", "channels": [489], "max": 300, "min": 600, "exclude": r"#shorts|\blive\b|podcast|flight|airline|aviation|\bplanes?\b|\bspace\b|satellite|aircraft"},
    {"id": "src_unep", "handle": "@UNEP", "name": "UN Environment Programme", "channels": [489], "max": 300, "min": 180, "longest": 3600, "scan": 2718,
     "exclude": r"#shorts|\blive\b|webinar|press conference|statement|speech|session|plenary|assembly|opening|closing|remarks|briefing|launch|flight|aviation|\bspace\b|satellite|meeting|forum|dialogue|committee|conference|gala|summit|high-level|panel|discussion|consultation|ceremony|award|segment|roundtable|event|day \d|\binc-|oewg|trailer|song|chairman|commissioner|\bvs\b|\(part \d\)|brief on|\d{1,2}/\d{1,2}/\d{2}|final$|[\u0400-\u04ff\u0600-\u06ff\u4e00-\u9fff]"},
    {"id": "src_climate_town", "handle": "@ClimateTown", "name": "Climate Town", "channels": [489], "max": 300, "min": 300, "exclude": r"#shorts|\blive\b|podcast|flight|airline|aviation|\bplanes?\b|\bspace\b"},
    {"id": "src_ninja_nerd_anatomy", "handle": "@NinjaNerdOfficial", "name": "Ninja Nerd – Anatomy", "channels": [747], "max": 300, "min": 300,
     "filter": r"anatomy|anatomical", "exclude": r"#shorts|\blive\b|physiology|patholog|pharmac|clinical|disease|syndrome|treatment|exam|quiz"},
    {"id": "src_kenhub", "handle": "@Kenhub", "name": "Kenhub", "channels": [747], "max": 300, "min": 120,
     "exclude": r"#shorts|\blive\b|physiology|patholog|pharmac|quiz|study tips|how to study|mnemonic|shorts"},
    {"id": "src_anatomyzone", "handle": "@AnatomyZone", "name": "AnatomyZone", "channels": [747], "max": 300, "min": 120, "exclude": r"#shorts|\blive\b|physiology|patholog|q ?& ?a"},
    {"id": "src_ninja_nerd_physiology", "handle": "@NinjaNerdOfficial", "name": "Ninja Nerd – Physiology", "channels": [748], "max": 300, "min": 300,
     "filter": r"physiology|physiologic", "exclude": r"#shorts|\blive\b|anatomy|patholog|pharmac|clinical|disease|syndrome|treatment|exam|quiz"},
    {"id": "src_armando_physiology", "handle": "@armandohasudungan", "name": "Armando Hasudungan – Physiology", "channels": [748], "max": 300, "min": 180,
     "filter": r"physiology|function of|how (the|does)|mechanism|regulation|cycle|action potential|cardiac output|hormone|homeostasis",
     "exclude": r"#shorts|\blive\b|anatomy|patholog|pathophysiolog|approach to|disorder|osteoporo|fracture|pharmac|disease|syndrome|treatment|infection|cancer|drug"},
    {"id": "src_osmosis_physiology", "handle": "@osmosis", "name": "Osmosis – Physiology", "channels": [748], "max": 300, "min": 180, "scan": 1904,
     "filter": r"physiology", "exclude": r"#shorts|\blive\b|anatomy|patholog|pharmac|disease|syndrome|treatment|nursing|nclex"},
    {"id": "src_khan_medicine_physiology", "handle": "@khanacademymedicine", "name": "Khan Academy Medicine – Physiology", "channels": [748], "max": 300, "min": 180,
     "filter": r"physiology",
     "exclude": r"transcription|c-section|surgery|birth|pregnan|#shorts|\blive\b|anatomy|patholog|pharmac|disease|syndrome|treatment|infection|cancer|drug|diagnos"},
    # lifestyle / makers
    {"id": "src_paul_sellers", "handle": "UCc3EpWncNq5QL0QhwUNQb7w", "name": "Paul Sellers", "channels": [688], "max": 300, "min": 600, "exclude": r"#shorts|\blive\b|q ?& ?a|podcast"},
    {"id": "src_steve_ramsey", "handle": "UCBB7sYb14uBtk8UqSQYc9-w", "name": "Steve Ramsey – Woodworking for Mere Mortals", "channels": [688], "max": 300, "min": 300, "exclude": r"#shorts|\blive\b|q ?& ?a|podcast|giveaway|gift guide|black friday"},
    {"id": "src_jimmy_diresta", "handle": "@JimmyDiResta", "name": "Jimmy DiResta", "channels": [688], "max": 300, "min": 300, "exclude": r"#shorts|\blive\b|q ?& ?a|podcast|giveaway"},
    {"id": "src_laura_kampf", "handle": "@LauraKampf", "name": "Laura Kampf", "channels": [688], "max": 300, "min": 300, "exclude": r"#shorts|\blive\b|q ?& ?a|podcast|giveaway"},
    {"id": "src_budget_bytes", "handle": "UC17vdVOZBVxTSDcldUBBlRg", "name": "Budget Bytes", "channels": [723], "max": 300, "min": 240, "exclude": r"#shorts|\blive\b|podcast"},
    {"id": "src_miguel_barclay", "handle": "UCXsD_ap_LoLfVFUMYMFwyJQ", "name": "Miguel Barclay – One Pound Meals", "channels": [723], "max": 300, "min": 45, "exclude": r"#shorts|\blive\b"},
    {"id": "src_weissman_budget", "handle": "@JoshuaWeissman", "name": "Joshua Weissman – But Cheaper", "channels": [723], "max": 300, "min": 300,
     "filter": r"but cheaper|budget|cheap|\$\d|broke|afford|save money|under \$|for \$|dollar", "exclude": r"#shorts|\blive\b|\$\d{3,}|expensive|luxury|fancy|restaurant"},
    {"id": "src_fitness_blender", "handle": "@FitnessBlender", "name": "Fitness Blender", "channels": [732], "max": 300, "min": 900, "exclude": r"#shorts|\blive\b|q ?& ?a|what i eat|vlog|podcast|meal|recipe"},
    {"id": "src_body_coach", "handle": "@TheBodyCoachTV", "name": "The Body Coach TV", "channels": [732], "max": 300, "min": 900, "exclude": r"#shorts|\blive\b|q ?& ?a|what i eat|vlog|podcast|meal|recipe"},
    {"id": "src_ps_fit", "handle": "UCBINFWq52ShSgUFEoynfSwg", "name": "PS Fit (POPSUGAR Fitness)", "channels": [732], "max": 300, "min": 900, "exclude": r"#shorts|\blive\b|q ?& ?a|what i eat|vlog|podcast|meal|recipe"},
    {"id": "src_belgrave_villa", "handle": "UCKUIPcAsg6zlG_qCMucq3AA", "name": "Belgrave Villa Renovation", "channels": [765], "max": 300, "min": 300, "exclude": r"#shorts|\blive\b|q ?& ?a|haul|shopping|house tour of (a|my) friend|podcast"},
    {"id": "src_restoring_number_four", "handle": "UC0Im1sZzPfRr6511BeazyQg", "name": "Restoring Number Four", "channels": [765], "max": 300, "min": 300, "exclude": r"#shorts|\blive\b|q ?& ?a|haul|podcast"},
    {"id": "src_chateau_diaries", "handle": "@TheChateauDiaries", "name": "The Chateau Diaries", "channels": [765], "max": 300, "min": 600,
     "filter": r"renovat|wallpaper|plaster|\broof|flooring|ceiling|shutters|stonework|restor(e|ing|ation) (of )?(the |a |our )?(chateau|château|rooms?|tower|walls?|floors?|staircase|fireplace|windows?|kitchen|bathroom|salon|library|bedroom|attic)",
     "exclude": r"#shorts|\blive\b|q ?& ?a|haul|garden|declutter|kondo|automaton|visit|fashion|outfit|wedding|dinner party|chapel|church|christmas|easter|guests|patreon"},
    # pass 15b: backlog acquisition. One official, institutional or creator-owned publisher family per channel; all DEDICATED_HOME.
    {"id": "src_wendover", "handle": "@Wendoverproductions", "name": "Wendover Productions", "channels": [623], "max": 300, "min": 480,
     "filter": r"logistic|supply|shipping|container|freight|cargo|\bports?\b|warehous|deliver|truck|trade|distribut|packag|inventory|cold chain|grocer|shortage|parcel|postal|mail",
     "exclude": NO_AIR_OR_SPACE},
    {"id": "src_engineering_rosie", "handle": "@EngineeringwithRosie", "name": "Engineering with Rosie", "channels": [669], "max": 300, "min": 300,
     "filter": r"solar|wind|batter|energy|geothermal|hydro|heat pump|renewable|\bgrid\b|power|tidal|storage|thermal|panel|turbine", "exclude": NO_AIR_OR_SPACE},
    {"id": "src_eric_strebel", "handle": "@EricStrebel", "name": "Eric Strebel", "channels": [659], "max": 300, "min": 240, "exclude": NO_AIR_OR_SPACE + r"|unboxing|giveaway|channel update"},
    {"id": "src_design_museum", "handle": "@DesignMuseum", "name": "Design Museum", "channels": [658], "max": 300, "min": 180, "exclude": NO_AIR_OR_SPACE + r"|trailer|shop|gift"},
    {"id": "src_bof", "handle": "@BusinessofFashion", "name": "The Business of Fashion", "channels": [627], "max": 300, "min": 300, "exclude": NO_AIR_OR_SPACE},
    {"id": "src_starter_story", "handle": "@starterstory", "name": "Starter Story", "channels": [613], "max": 300, "min": 300, "exclude": NO_AIR_OR_SPACE + r"|my \$|course|reacting"},
    {"id": "src_lbs", "handle": "@LondonBusinessSchool", "name": "London Business School", "channels": [608], "max": 300, "min": 300,
     "filter": r"manag|leader|strateg|organi[sz]|\bteams?\b|decision|culture|negotiat|change|innovation|workplace|boss|hybrid work|talent|people", "exclude": NO_AIR_OR_SPACE + r"|graduation|welcome|programme overview|admissions|alumni|class of"},
    {"id": "src_bank_of_england", "handle": "UCY70MMJ8Rj4wtwt7bVN6hIA", "name": "Bank of England", "channels": [618], "max": 300, "min": 150,
     "exclude": NO_AIR_OR_SPACE + r"|press conference|speech|statement|hearing|mpc|agenda|webinar|panel|conference|q&a|questions"},
    {"id": "src_chief_makoi", "handle": "@ChiefMAKOi", "name": "Chief MAKOi", "channels": [657], "max": 300, "min": 300, "exclude": NO_AIR_OR_SPACE + r"|salary|vlog|giveaway|merch"},
    {"id": "src_oceanliner_designs", "handle": "@OceanlinerDesigns", "name": "Oceanliner Designs", "channels": [832], "max": 300, "min": 300,
     "exclude": NO_AIR_OR_SPACE + r"|warships?|battleships?|\bnavy\b|naval|u-boats?|submarines?|\bwar\b|military"},
    {"id": "src_road_guy_rob", "handle": "@RoadGuyRob", "name": "Road Guy Rob", "channels": [835], "max": 300, "min": 240, "exclude": NO_AIR_OR_SPACE},
    {"id": "src_huntley_industrial", "handle": "@HuntleyFilmArchives", "name": "Huntley Film Archives – Industry", "channels": [809], "max": 300, "min": 180, "scan": 6000,
     "filter": r"industr|factor(y|ies)|\bmills?\b|\bmines?\b|mining|colliery|coal|steel|iron|foundry|manufactur|\bworks\b|shipyard|shipbuild|engineering|textile|cotton|wool|brewery|pottery|glass|assembly|production|power station|chemical|workers",
     "exclude": NO_AIR_OR_SPACE + r"|\bwar\b|army|navy|naval|\braf\b|bombs?|soldiers?|military|troops|weapons?|munitions?|church|chapel|cathedral|crime|punishment|police|court"},
    {"id": "src_huntley_transport", "handle": "@HuntleyFilmArchives", "name": "Huntley Film Archives – Transport", "channels": [839], "max": 300, "min": 180, "scan": 6000,
     "filter": r"\bbus(es)?\b|trams?\b|trolleybus|\btrains?\b|railway|locomotive|\bsteam\b|motor|\bcars?\b|lorr(y|ies)|trucks?|\broads?\b|motorway|canal|barges?|ferr(y|ies)|liner|traffic|transport|cycling|bicycle|underground",
     "exclude": NO_AIR_OR_SPACE + r"|\bwar\b|army|navy|naval|\braf\b|bombs?|soldiers?|military|troops|weapons?|munitions?|tanks?\b|church|chapel|cathedral|motorcade|bioscope|model|toys?\b|toyland|animation|fair\b"},
    {"id": "src_ap_archive", "handle": "@APArchive", "name": "AP Archive", "channels": [945], "max": 300, "min": 150, "scan": 5000, "exclude": NO_AIR_OR_SPACE + r"|\bpope\b|vatican|church|mosque|rushes|fashion|couture|catwalk|runway|premiere|red carpet|perfume|voxpop|celebrit|singer|actor|actress|film festival|launches|model|\bstars?\b|music|concert|album|awards?\b|party in the park|designs?\b|collection|junket|galliano|dior|interview with|sit down|\bcast\b|\bfilm\b|movie|role|lff"},
    {"id": "src_british_movietone", "handle": "@BritishMovietone", "name": "British Movietone", "channels": [945], "max": 300, "min": 90, "scan": 5000, "exclude": NO_AIR_OR_SPACE + r"|\bpope\b|vatican|church|mosque"},
    {"id": "src_comic_tropes", "handle": "@ComicTropes", "name": "Comic Tropes", "channels": [252], "max": 300, "min": 300, "exclude": NO_AIR_OR_SPACE + r"|haul|unboxing|channel update|livestream|inktober|drawing|inking|\bink\b|sketch|art stream|stream|commission|draw|fortnite|lego|knockoff|\bbuild\b|sale\b|claim|joevember|news & reviews", "longest": 4800},
    {"id": "src_strip_panel_naked", "handle": "@StripPanelNaked", "name": "Strip Panel Naked", "channels": [252], "max": 300, "min": 240, "exclude": NO_AIR_OR_SPACE},
    {"id": "src_button_poetry", "handle": "@ButtonPoetry", "name": "Button Poetry", "channels": [842], "max": 300, "min": 90, "scan": 3000, "exclude": NO_AIR_OR_SPACE + r"|god|jesus|prayer|church|psalm"},
    {"id": "src_poetry_foundation", "handle": "@PoetryFoundation", "name": "Poetry Foundation", "channels": [842], "max": 300, "min": 90, "exclude": NO_AIR_OR_SPACE + r"|god|jesus|prayer|church|psalm"},
    {"id": "src_hay_festival", "handle": "@HayFestivalOfficial", "name": "Hay Festival", "channels": [92], "max": 300, "min": 600, "exclude": NO_AIR_OR_SPACE + r"|trailer|highlights reel|god|faith|religio"},
    {"id": "src_josh_revell", "handle": "UCSawmZ2PP6R7EURKRMNYXMw", "name": "Josh Revell", "channels": [345], "max": 300, "min": 600, "exclude": NO_AIR_OR_SPACE},
    {"id": "src_goodwood", "handle": "UC8rador8CU-pTJ6p7WNiv6w", "name": "Goodwood Road & Racing", "channels": [344], "max": 300, "min": 600,
     "filter": r"revival|members'? meeting|historic|classic|vintage|goodwood trophy|tt celebration|glover trophy|st mary'?s trophy|whitsun|fordwater|sussex trophy|richmond trophy|full race",
     "exclude": NO_AIR_OR_SPACE + r"|timelapse|preview|tickets|fashion|dress"},
    {"id": "src_clints_reptiles", "handle": "@ClintsReptiles", "name": "Clint's Reptiles", "channels": [478], "max": 300, "min": 300,
     "filter": r"evolut|ancest|fossil|dinosaur|origin|species|tree of life|related|lineage|descend|extinct|clade|taxonom|classif|cousins|closest|vertebrat|mammal|amniote|tetrapod", "exclude": NO_AIR_OR_SPACE},
    {"id": "src_ben_g_thomas", "handle": "@BenGThomas", "name": "Ben G Thomas", "channels": [478], "max": 300, "min": 300,
     "filter": r"evolv|evolut|prehistoric|fossil|dinosaur|extinct|jurassic|cretaceous|triassic|permian|devonian|cambrian|carboniferous|ancestor|megalodon|mammoth|ice age|new look of|origin of|palaeo|paleo|bones?heads",
     "exclude": NO_AIR_OR_SPACE + r"|loch ness|cryptid|monster explained|bigfoot"},
    {"id": "src_li_ziqi", "handle": "@cnliziqi", "name": "Li Ziqi", "channels": [789], "max": 300, "min": 300, "exclude": NO_AIR_OR_SPACE + r"|temple|buddha|festival of"},
    {"id": "src_dianxi_xiaoge", "handle": "@dianxixiaoge", "name": "Dianxi Xiaoge", "channels": [789], "max": 300, "min": 300, "exclude": NO_AIR_OR_SPACE + r"|temple|buddha"},
    {"id": "src_wsl_surf", "handle": "@WSL", "name": "World Surf League", "channels": [359], "max": 300, "min": 600, "exclude": NO_AIR_OR_SPACE + r"|stream|preview|press|portugu[eê]s|vlog"},
    {"id": "src_steve_wallis", "handle": "UCSnqXeK94-iNmwqGO__eJ5g", "name": "Steve Wallis", "channels": [780], "max": 300, "min": 600, "exclude": NO_AIR_OR_SPACE},
    {"id": "src_headspace", "handle": "@headspace", "name": "Headspace", "channels": [743], "max": 300, "min": 300,
     "filter": r"meditat|mindful|breath|calm|stress|anxi|relax|present moment|awareness|let go|grounding|body scan|compassion|gratitude",
     "exclude": NO_AIR_OR_SPACE + r"|music|playlist|sleepcast|asmr|ad\b|commercial|unicorn island|dear headspace|marriage|dating"},
    {"id": "src_tracey_marks", "handle": "@DrTraceyMarks", "name": "Dr. Tracey Marks", "channels": [742], "max": 300, "min": 300,
     "exclude": NO_AIR_OR_SPACE + r"|god|religio|spiritual|church|prayer|medication review|sponsor"},
    # pass 16: deep content expansion. Splits of one broad publisher take disjoint programmes (earlier split wins) from one cached scan.
    {"id": "src_huntley_motoring", "handle": "@HuntleyFilmArchives", "name": "Huntley Film Archives – Motoring", "channels": [836], "max": 300, "min": 120, "scan": 22000,
     "filter": r"\bcars?\b|motor(ing|ist|ists|car|cars| racing| show)|automobile|vintage car|veteran car|rally|grand prix|racing car|brooklands|le mans|austin|morris|rolls.royce|jaguar|\bford\b|bentley|\bmg\b|sports car|garage",
     "exclude": NO_AIR_OR_SPACE + r"|\bwar\b|army|navy|naval|\braf\b|bombs?|soldiers?|military|troops|weapons?|tanks?\b|church|chapel|cathedral|model|toys?\b|animation|crash test dumm|gerald ford|wartime"},
    {"id": "src_huntley_sailing", "handle": "@HuntleyFilmArchives", "name": "Huntley Film Archives – Sailing", "channels": [833], "max": 300, "min": 120, "scan": 22000,
     "filter": r"sailing|\bsails?\b|yachts?|yachting|regatta|dinghy|dinghies|schooner|clipper|tall ships?|windjammer|\bcowes\b|barques?|square.rigg|boat race|\browing\b|lifeboats?",
     "exclude": NO_AIR_OR_SPACE + r"|\bwar\b|army|navy|naval|\braf\b|bombs?|soldiers?|military|troops|weapons?|battleship|warship|submarine|u-boat|church|chapel|model|toys?\b|animation|airborne|refugee|wartime|parasail"},
    {"id": "src_huntley_architecture", "handle": "@HuntleyFilmArchives", "name": "Huntley Film Archives – Architecture", "channels": [848], "max": 300, "min": 120, "scan": 22000,
     "filter": r"architect|\bbuildings?\b|housing|houses|\bnew homes\b|flats|tower blocks?|new towns?|town planning|slum|estate\b|construction|demolition|skyscraper|bridges?|country house|stately|castle|palace|streets?cape|city of the future|prefab|cottage",
     "exclude": NO_AIR_OR_SPACE + r"|\bwar\b|army|navy|naval|\braf\b|bombs?|soldiers?|military|troops|weapons?|church|chapel|cathedral|abbey|temple|mosque|model|toys?\b|animation|homes? movies?|care homes?|children's homes?|wartime"},
    {"id": "src_huntley_social", "handle": "@HuntleyFilmArchives", "name": "Huntley Film Archives – Everyday Life", "channels": [422], "max": 300, "min": 120, "scan": 22000,
     "filter": r"everyday life|daily life|life in|family|families|children|schools?|school ?children|women|housewi|shopping|market day|seaside|holiday|leisure|pubs?\b|dance hall|fashion|kitchen|washing|domestic|youth|teenagers|working class|high street|social|community|village life|people of",
     "exclude": NO_AIR_OR_SPACE + r"|\bwar\b|army|navy|naval|\braf\b|bombs?|soldiers?|military|troops|weapons?|church|chapel|cathedral|nun|monk|temple|mosque|sex|nud|strip|birth|surgery|operation|model|toys?\b|animation|home movie|christian|wartime|\blife of\b"},
    {"id": "src_huntley_events", "handle": "@HuntleyFilmArchives", "name": "Huntley Film Archives – Historic Events", "channels": [429], "max": 300, "min": 120, "scan": 22000,
     "filter": r"coronation|jubilee|\broyal\b|\bkings?\b|\bqueens?\b|\bprinces?\b|\bprincess\b|funeral|parade|procession|pageant|ceremony|exhibition|festival of britain|empire|strike|protest|march|election|visit|opening of|celebrations?|anniversary|centenary|olympic|world'?s fair|expo",
     "exclude": NO_AIR_OR_SPACE + r"|\bwar\b|army|navy|naval|\braf\b|bombs?|soldiers?|military|troops|weapons?|church|chapel|cathedral|pope|bishop|temple|mosque|model|toys?\b|animation|home movie|wartime|cooking|recipe"},
    {"id": "src_travel_film_archive", "handle": "@travelfilmarchive", "name": "Travel Film Archive", "channels": [779], "max": 300, "min": 120,
     "exclude": NO_AIR_OR_SPACE + r"|\bwar\b|military|temple|church|mosque|shrine|pilgrim|nud|spanish earth|lodge|reunion|convention"},
    {"id": "src_chicago_film_archives", "handle": "@chicagofilmarchives", "name": "Chicago Film Archives", "channels": [801], "max": 300, "min": 180,
     "exclude": NO_AIR_OR_SPACE + r"|\bwar\b|military|church|temple|mosque|trailer|fundraiser|gala|screening announcement"},
    {"id": "src_gresham_law", "handle": "@GreshamCollege", "name": "Gresham College – Law", "channels": [451], "max": 300, "min": 1800, "scan": 4000, "dedupe": True,
     "filter": r"\blaw\b|laws\b|legal|lawyers?|courts?\b|judges?|judicia|justice|constitution|magna carta|\btrials?\b|jury|rights|legislat|common law|statute|supreme court",
     "exclude": NO_AIR_OR_SPACE + r"|god|christ|church|relig|bible|theolog|faith|islam|jewish law|canon law|crime|criminal|prison|punish|murder|police|court (in exile|at war|at play|divided)|royal courts|tudor court|charles i'?s court|agincourt|astrophysic|moses|divine|bosch|shostakovich|health gap|groundwater|machine learning|infrastructure polic"},
    {"id": "src_gresham_crime", "handle": "@GreshamCollege", "name": "Gresham College – Crime", "channels": [462], "max": 300, "min": 1800, "scan": 4000, "dedupe": True,
     "filter": r"crime|criminal|criminolog|prisons?|punish|murder|police|policing|forensic|detective|offend|violence|fraud|terroris|gangs?\b|sentenc",
     "exclude": NO_AIR_OR_SPACE + r"|god|christ|church|relig|bible|theolog|faith|islam|bug world|malnutrition|hazing|military|policing the community in"},
    {"id": "src_gresham_medicine", "handle": "@GreshamCollege", "name": "Gresham College – History of Medicine", "channels": [746], "max": 300, "min": 1800, "scan": 4000, "dedupe": True,
     "filter": r"(history|historical|victorian|medieval|ancient|early modern|georgian|tudor|18th|19th|nineteenth|eighteenth|origins?|story) .*(medic|surgery|surgeon|disease|plague|epidemic|pandemic|hospital|doctor|physician|anatom|vaccin|nurs|pharmac|cholera|smallpox|madness|asylum)|(medic|surgery|surgeon|disease|plague|epidemic|pandemic|hospital|doctor|physician|anatom|vaccin|nurs|cholera|smallpox|madness|asylum).*(history|historical|victorian|medieval|past|through the ages)",
     "exclude": NO_AIR_OR_SPACE + r"|god|christ|church|relig|bible|theolog|faith|islam|miracle|pilgrim"},
    {"id": "src_gresham_politics", "handle": "@GreshamCollege", "name": "Gresham College – Political History", "channels": [423], "max": 300, "min": 1800, "scan": 4000, "dedupe": True,
     "filter": r"prime ministers?|parliament|politic|elections?|democracy|monarch|government|statesm|revolution|churchill|gladstone|disraeli|thatcher|empire|republic|reform act|cabinet|chartis|suffrag",
     "exclude": NO_AIR_OR_SPACE + r"|god|christ|church|relig|bible|theolog|faith|islam|pope|\bwar\b|military|battle|protestant|missions|climate|cancer|evolution|agricultural|gardens|poetic|art, power|painting|fabric|fashion|nude|reality television|sail to steam|lawyer|judicial|judging|jury|legal profession"},
    {"id": "src_rai", "handle": "UC3rzUoVJSYVnahC1p87XQtA", "name": "Royal Anthropological Institute", "channels": [494], "max": 300, "min": 600, "dedupe": True,
     "exclude": NO_AIR_OR_SPACE + r"|god|christ|church|relig|ritual|shaman|spirit|sacred|faith|islam|muslim|trailer|agm|annual general|award|career insights"},
    {"id": "src_lse_sociology", "handle": "UCK08_B5SZwoEUk2hDPMOijQ", "name": "LSE – Sociology", "channels": [495], "max": 300, "min": 1800, "scan": 4000, "dedupe": True,
     "filter": r"sociolog|inequalit|social class|\bclass\b|social mobility|society|race and|racism|gender|families|work and|precarious|poverty|welfare|migration|cities|urban|social change",
     "exclude": NO_AIR_OR_SPACE + r"|god|christ|church|relig|faith|islam|papal|believer|catholic|election night|budget|monetary|interest rates|\bwar\b|ukraine|gaza|israel|putin|climate|economic development|on the economy"},
    {"id": "src_sag_foundation", "handle": "@SAGAFTRAFoundation", "name": "SAG-AFTRA Foundation", "channels": [163], "max": 300, "min": 1200, "dedupe": True,
     "exclude": NO_AIR_OR_SPACE + r"|trailer|donate|gala|awards? (show|ceremony)|livestream|voiceover|voice acting|casting director|agents?|financial|tax|union|podcast"},
    {"id": "src_ace_editors", "handle": "UCy0xVMmQdIOTGO82lDH4EJA", "name": "American Cinema Editors", "channels": [166], "max": 300, "min": 600, "dedupe": True,
     "exclude": NO_AIR_OR_SPACE + r"|awards? (show|ceremony)|gala|trailer|pre-?show|opening \+|president'?s (message|welcome)|parade of nominees|student competition|summer of support|connect-support"},
    {"id": "src_patrick_willems", "handle": "@patrickhwillems", "name": "Patrick (H) Willems", "channels": [196], "max": 300, "min": 600, "exclude": NO_AIR_OR_SPACE + r"|short film|announcement|sketch|week of writing|high school reunion|quarantine"},
    {"id": "src_thomas_flight", "handle": "@ThomasFlight", "name": "Thomas Flight", "channels": [196], "max": 300, "min": 480, "exclude": NO_AIR_OR_SPACE + r"|camera|gear|lens|sponsor|coca-cola"},
    {"id": "src_comicstorian", "handle": "@Comicstorian", "name": "Comicstorian", "channels": [253], "max": 300, "min": 600,
     "filter": r"superman|batman|spider.?man|avengers|x-men|justice league|wonder woman|iron man|hulk|thor|flash|green lantern|captain america|marvel|\bdc\b|superhero|wolverine|deadpool|venom|daredevil|fantastic four",
     "exclude": NO_AIR_OR_SPACE + r"|livestream|q ?& ?a|news|rumou?r|trailer|reaction|podcast|gameplay|stream\b|fortnite|marvel rivals|midnight suns|\bmcu\b|tier list|movie|theory"},
    {"id": "src_trash_theory", "handle": "@TrashTheory", "name": "Trash Theory", "channels": [560], "max": 300, "min": 480, "exclude": NO_AIR_OR_SPACE + r"|livestream|trailer|announcement|simpsons"},
    {"id": "src_linux_foundation", "handle": "@LinuxfoundationOrg", "name": "The Linux Foundation", "channels": [635], "max": 300, "min": 900, "scan": 3000,
     "filter": r"open source|linux|kernel|foss|open ?ssf|community|maintain|licen[cs]|git\b|contribut|cncf|kubernetes|developer",
     "exclude": NO_AIR_OR_SPACE + r"|sponsor|sponsored|keynote: .*(platinum|gold)|webinar|promo|ad\b|certification|exam|training course|announce|closing game"},
    {"id": "src_brick_immortar", "handle": "@BrickImmortar", "name": "Brick Immortar – Structural Failures", "channels": [653], "max": 300, "min": 300,
     "filter": r"bridge|collapse|walkway|oil rig|theater|lessons learned",
     "exclude": NO_AIR_OR_SPACE + r"|livestream|merch|duck|ferry|\bfv\b|\bss\b|ship|boat|\buss\b|uscgc|rail|texas tower"},
    {"id": "src_mellow", "handle": "@mellowclimbing", "name": "Mellow Climbing", "channels": [384], "max": 300, "min": 300, "exclude": NO_AIR_OR_SPACE + r"|paraglid|skydiv|wingsuit|base jump|trailer|teaser"},
    {"id": "src_indigo_traveller", "handle": "@IndigoTraveller", "name": "Indigo Traveller", "channels": [776], "max": 300, "min": 600, "exclude": NO_AIR_OR_SPACE + r"|q ?& ?a|announcement|update|temple|church|mosque|funding north korea|packing list|addressing"},
    {"id": "src_eva_zu_beck", "handle": "@evazubeck", "name": "Eva zu Beck", "channels": [776], "max": 300, "min": 600, "exclude": NO_AIR_OR_SPACE + r"|q ?& ?a|announcement|update|gear|what'?s in my|temple|church|mosque|spicy questions|went viral|subs!|dream dog|reacts"},
    {"id": "src_brad_stanfield", "handle": "@DrBradStanfield", "name": "Dr Brad Stanfield", "channels": [744], "max": 300, "min": 300,
     "filter": r"ag(e|ing|eing)|longevity|older|live longer|lifespan|healthspan|senior|over (40|50|60|65)|muscle|bone|brain health|dementia|exercise",
     "exclude": NO_AIR_OR_SPACE + r"|sponsor|discount|supplement brand|q ?& ?a|balls|unfair advantage"},
    {"id": "src_clutterbug", "handle": "@Clutterbug", "name": "Clutterbug", "channels": [768], "max": 300, "min": 300,
     "filter": r"organi[sz]|declutter|tidy|storage|clean|minimal|clutter|pantry|closet|garage|routine",
     "exclude": NO_AIR_OR_SPACE + r"|haul|shopping|q ?& ?a|vlog|giveaway|gift ideas"},
    {"id": "src_cannes_lions", "handle": "@CannesLions", "name": "Cannes Lions", "channels": [611], "max": 300, "min": 900,
     "exclude": NO_AIR_OR_SPACE + r"|awards? (show|ceremony)|winners?|shortlist|jury|trailer|teaser|highlights?|tickets|register|at home with|vice tv|coronavirus"},
    {"id": "src_patrick_boyle", "handle": "@PBoyle", "name": "Patrick Boyle – Market History", "channels": [694], "max": 300, "min": 600,
     "filter": r"history|historic|ltcm|john law|south sea|conman|2008|1987|tulip|dot-com|insider trading scandals|corporate frauds of the century|greensill|enron|rise and fall",
     "exclude": NO_AIR_OR_SPACE + r"|\bai\b|bitcoin|tariff|openai|electric vehicle|luxury|berkshire|truss|milei|germany|wealth transfer|forbes|arrested|charged|next hedge fund|golden (age|era) of fraud|nikola|adani|art market|china|car market|secondary market|dozy"},
    {"id": "src_92ny_books", "handle": "@92ndStreetY", "name": "92NY – Books and Authors", "channels": [840], "max": 300, "min": 1800, "scan": 4000, "dedupe": True,
     "filter": r"novel|author|book|poet|poetry|writer|fiction|memoir|reading|literary|literature|unterberg",
     "exclude": NO_AIR_OR_SPACE + r"|god|faith|jewish|torah|rabbi|christian|relig|bible|concert|music|dance|chamber|orchestra|jazz|cabaret|nickelodeon|big fish|broadway|cities are leading|hbo|the son:|let him go|memory:|iñárritu|women in film|late night|marvel|senator|yom hashoah|holocaust|cookbook|ottolenghi|points guy|workbook|jewelry|reid hoffman|lieutenant general|amazon's z|screenplays"},
    # pass 17: entertainment, television and culture. Each series has one primary home; drama and anime are classified per series.
    {"id": "src_dick_cavett", "handle": "@TheDickCavettShow", "name": "The Dick Cavett Show", "channels": [76], "max": 300, "min": 600, "dedupe": True,
     "exclude": P17_EXCLUDE + r"|god|relig|church|preacher|evangel"},
    {"id": "src_hot_ones", "handle": "@FirstWeFeast", "name": "First We Feast – Hot Ones", "channels": [76], "max": 200, "min": 900, "scan": 3500,
     "filter": r"hot ones", "exclude": P17_EXCLUDE + r"|versus|truth or dab|the last dab|sauce|gauntlet|season \d+ (premiere|finale) trailer|hot ones jr|kids"},
    {"id": "src_gerry_anderson", "handle": "@GerryAndersonTV", "name": "Gerry Anderson", "channels": [219], "max": 300, "min": 1200,
     "exclude": P17_EXCLUDE + r"|yule log|fireplace|best character moments|which is your favourite|gerry anderson day|audio adventure|marathon"},
    {"id": "src_degrassi", "handle": "@Degrassi", "name": "Degrassi – The Official Channel", "channels": [238], "max": 300, "min": 1200, "scan": 1800,
     "exclude": P17_EXCLUDE + r"|hangout|reunion|interview|podcast|\bcast\b|watch party|rewatch"},
    {"id": "src_pemberley", "handle": "@PemberleyDigital", "name": "Pemberley Digital", "channels": [239], "max": 300, "min": 180, "exclude": P17_EXCLUDE},
    {"id": "src_lizzie_bennet", "handle": "@LizzieBennet", "name": "The Lizzie Bennet Diaries", "channels": [239], "max": 300, "min": 180, "exclude": P17_EXCLUDE},
    {"id": "src_kindatv", "handle": "@KindaTV", "name": "KindaTV", "channels": [239], "max": 300, "min": 600,
     "exclude": P17_EXCLUDE + r"|full season|pre-?show|periscope|fan expo|comic con|viewing party|festival|read by|chapter \d|\bdoes\b|younow|panel"},
    {"id": "src_wheel_of_fortune", "handle": "@WheelofFortune", "name": "Wheel of Fortune – Vintage", "channels": [275], "max": 300, "min": 1200, "scan": 2800,
     "filter": r"vintage|classic|full episode|19[789]\d|throwback|retro", "exclude": P17_EXCLUDE},
    {"id": "src_rsc", "handle": "@theRSC", "name": "Royal Shakespeare Company", "channels": [49], "max": 300, "min": 1200, "exclude": P17_EXCLUDE},
    {"id": "src_stratford", "handle": "@stratfordfestival", "name": "Stratford Festival", "channels": [49], "max": 300, "min": 1200,
     "filter": r"shakespeare|theatre|theater|\bplays?\b|playwright|production|director|\bcast\b|actor|acting|stage|showstarters|meet the festival|in conversation|hamlet|lear|macbeth|tempest|coriolanus|othello|romeo|dream|twelfth night|richard|henry|musical",
     "exclude": P17_EXCLUDE + r"|forum 20\d\d|symposium|drag race|lives matter|disillusion|politic|climate|election"},
    {"id": "src_royal_court", "handle": "@royalcourttheatre", "name": "Royal Court Theatre", "channels": [49], "max": 300, "min": 1200,
     "exclude": P17_EXCLUDE + r"|modern morality|green\?|politic|election"},
    {"id": "src_lincoln_center", "handle": "@LincolnCenter", "name": "Lincoln Center – Theatre and Dance", "channels": [49], "max": 300, "min": 1200,
     "filter": r"theat|\bplays?\b|playwright|ballet|dance|choreograph|broadway|musical|stage|drama|in conversation|puppet",
     "exclude": P17_EXCLUDE + r"|concert|orchestra|jazz|songbook|choir|symphony|quartet|film|workshop with|pop-up classroom|activate|summit"},
    {"id": "src_vanguard", "handle": "@cardfightvanguard", "name": "Cardfight!! Vanguard", "channels": [228], "max": 300, "min": 1200, "scan": 1300, "exclude": P17_ANIME_EXCLUDE},
    {"id": "src_beyblade", "handle": "@BeybladeOfficial", "name": "BEYBLADE English", "channels": [228], "max": 300, "min": 1200, "scan": 2100, "exclude": P17_ANIME_EXCLUDE},
    {"id": "src_viz_manga", "handle": "@VIZMedia", "name": "VIZ – Manga", "channels": [234], "max": 300, "min": 150, "scan": 3100, "filter": r"manga|mangaka|shonen jump|shojo beat",
     "exclude": P17_ANIME_EXCLUDE + r"|episode|dub|opening|ending|\bop\b|\bed\b|funimationcon|gift guide|animetal|% off|\\bsale\\b|\\breact\\b|seis manos|madlibs|official video|stereopony|news from|prep for anime"},
    {"id": "src_rsl", "handle": "@RSLiterature", "name": "The Royal Society of Literature", "channels": [497], "max": 300, "min": 1200, "dedupe": True,
     "exclude": P17_EXCLUDE + r"|agm|annual general|fellows? (ceremony|election)|awards? ceremony|prize ceremony|fundrais|careers in literature"},
    {"id": "src_british_library_lit", "handle": "@britishlibrary", "name": "British Library – Literature", "channels": [497], "max": 300, "min": 1200, "dedupe": True,
     "filter": r"literat|novel|poet|poetry|writer|author|fiction|dickens|austen|brontë|bronte|shakespeare|woolf|orwell|tolkien|books?\b|manuscript|reading",
     "exclude": P17_EXCLUDE + r"|business|ip centre|entrepreneur|startup|sacred|medieval faith|gospel|qur|torah|politic|election|science|maps?\b"},
    {"id": "src_atlas_obscura", "handle": "@atlasobscura", "name": "Atlas Obscura", "channels": [96], "max": 300, "min": 300,
     "exclude": P17_EXCLUDE + r"|temple|shrine|monaster|cathedral|relic|pilgrim|sponsor|presented by|gastro obscura|food truck|\\bbars?\\b|speakeasy|recipe|spaghetti|wine|bread|restaurant|cocktail|dish\\b"},
    {"id": "src_crunchyroll_action", "handle": "@Crunchyroll", "name": "Crunchyroll – Action", "channels": [228], "max": 300, "min": 1200, "scan": 3000,
     "filter": r"episode", "exclude": P17_ANIME_EXCLUDE + r"|awards|music",
     "series": r"meiji gekken|black torch|gachiakuta|jujutsu kaisen|tomb raider king|marriagetoxin|may i ask for one final thing|onmyo kaiten"},
    {"id": "src_crunchyroll_fantasy", "handle": "@Crunchyroll", "name": "Crunchyroll – Fantasy", "channels": [230], "max": 300, "min": 1200, "scan": 3000,
     "filter": r"episode", "exclude": P17_ANIME_EXCLUDE + r"|awards|music",
     "series": r"sentenced to be a hero|witch hat atelier|agents of the four seasons|adventurer's daily grind|warrior princess and the barbaric king|new saga|banished court magician|beginning after the end|classroom of a black cat|exiled heavy knight|villainess is adored|goodbye, lara"},
    {"id": "src_crunchyroll_drama", "handle": "@Crunchyroll", "name": "Crunchyroll – Drama", "channels": [231], "max": 300, "min": 1200, "scan": 3000,
     "filter": r"episode", "exclude": P17_ANIME_EXCLUDE + r"|awards|music",
     "series": r"hana-kimi|i want to love you till your dying day|roll over and die|please excuse my younger brothers"},
    {"id": "src_crunchyroll_comedy", "handle": "@Crunchyroll", "name": "Crunchyroll – Comedy", "channels": [232], "max": 300, "min": 1200, "scan": 3000,
     "filter": r"episode", "exclude": P17_ANIME_EXCLUDE + r"|awards|music",
     "series": r"nyaight of the living cat|bean counter|kaiju girl caramelise|cute girl in the hero|i want to end this love game|go for it, nakamura|part-time torturer|kaya.?chan|let's play|pass the monster meat|draw this, then die|dekin no mogura"},
    # pass 18: law, technology, archive and culture. One home per publisher split; archive homes take archival material only.
    {"id": "src_intl_criminal_court", "handle": "@IntlCriminalCourt", "name": "International Criminal Court", "channels": [457], "max": 300, "min": 900, "scan": 3200, "exclude": P18_EXCLUDE + r"|\b(floor|french|arabic|sango|acholi|spanish|mandarin|chinese|russian|swahili|lingala|kinyarwanda|georgian|bambara|tamasheq)\b|réunion|plénière|simulación|concurso|concours|version française|la cpi|cérémonie|prestation de serment|année judiciaire|judicial year|[\u0600-\u06ff\u0400-\u04ff\u4e00-\u9fff]|d.{1,2}clarations de cl.{1,2}ture|asia-pacific|kick-off|aep\d|audience|affaire|procès|proces\b|déclaration|conférence|juicio|caso\b|situación|moot|assembly of states|\basp\b|plenary|election of|commemorat|special session|asia pacific forum"},
    {"id": "src_uksc_constitutional", "handle": "@UKSupremeCourt", "name": "UK Supreme Court – Constitutional Cases", "channels": [458], "max": 300, "min": 600, "scan": 3600,
     "filter": r"prime minister|devolution|legal continuity|withdrawal from the (eu|european union)|lord advocate|unison|public law project|rule of law|article 50|constitution|prorog|sovereign", "exclude": P18_EXCLUDE + r"|scottishpower|hmrc|times newspapers|flood|miller v (ministry|moj|miller|the king)|allison|james miller|morrison|veale|christian|taiwanese|x v the lord advocate"},
    {"id": "src_uksc_human_rights", "handle": "@UKSupremeCourt", "name": "UK Supreme Court – Human Rights Cases", "channels": [456], "max": 40, "min": 600, "scan": 3600,
     "filter": r"nihrc|northern ireland human rights|mclaughlin|gallagher|finucane|dillon|mcevoy|brown v parole|human rights|convention rights", "exclude": P18_EXCLUDE},
    {"id": "src_harvard_law_constitutional", "handle": "@HarvardLawSchool", "name": "Harvard Law School – Constitutional Law", "channels": [458], "max": 300, "min": 1200, "dedupe": True,
     "filter": r"constitution|first amendment|second amendment|fourteenth amendment|equal protection|due process|supreme court|judicial review|separation of powers|federalism|scalia|ginsburg|breyer|kagan|justice (?!for)|insular cases", "exclude": P18_EXCLUDE + r"|reunion|commencement|class day|admissions|alumni|gala|fundrais" + r"|new ledes|environmental law|innovation justice|aaron's law|gene patent|access to justice|melcer|hirc|diversity and social justice|caselaw|criminal justice|policing|nader|covid|covering the supreme court|lazarus|celebrating justice|gants|remembering scalia|berkowitz|courting death|myanmar|opening ceremony|open legal data|innovation, justice"},
    {"id": "src_harvard_law_international", "handle": "@HarvardLawSchool", "name": "Harvard Law School – International Law", "channels": [457], "max": 300, "min": 1200, "dedupe": True,
     "filter": r"international law|international court|treaty|treaties|law of war|laws of war|humanitarian law|war crimes|genocide|nuremberg|united nations|global governance|law of the sea|sanctions|extradition|transnational|international criminal", "exclude": P18_EXCLUDE + r"|reunion|commencement|class day|admissions|alumni|gala|fundrais"},
    {"id": "src_harvard_law_human_rights", "handle": "@HarvardLawSchool", "name": "Harvard Law School – Human Rights", "channels": [456], "max": 300, "min": 1200, "dedupe": True,
     "filter": r"human rights|civil rights|civil liberties|asylum|refugee|torture|dignity|discrimination|racial justice|voting rights|freedom of (speech|expression)|privacy rights|women's rights|disability rights", "exclude": P18_EXCLUDE + r"|reunion|commencement|class day|admissions|alumni|gala|fundrais"},
    {"id": "src_harvard_law_criminal", "handle": "@HarvardLawSchool", "name": "Harvard Law School – Criminal Law", "channels": [454], "max": 300, "min": 1200, "dedupe": True,
     "filter": r"criminal|prosecut|defen[cs]e attorney|public defender|wrongful conviction|death penalty|capital punishment|sentencing|incarcerat|mass incarceration|plea bargain|bail\b|policing|fourth amendment|miranda|innocence|exonerat", "exclude": P18_EXCLUDE + r"|reunion|commencement|class day|admissions|alumni|gala|fundrais" + r"|new ledes|international criminal|abortion"},
    {"id": "src_harvard_law_civil", "handle": "@HarvardLawSchool", "name": "Harvard Law School – Civil Law", "channels": [455], "max": 300, "min": 1200, "dedupe": True,
     "filter": r"contract|tort|property law|civil procedure|litigation|class action|family law|corporate law|private law|antitrust|intellectual property|copyright|patent|trademark|bankruptcy|remedies|restitution|liability", "exclude": P18_EXCLUDE + r"|reunion|commencement|class day|admissions|alumni|gala|fundrais" + r"|national monuments"},
    {"id": "src_oxford_law_international", "handle": "@OxfordLawFaculty", "name": "Oxford Law Faculty – International Law", "channels": [457], "max": 300, "min": 1200, "dedupe": True,
     "filter": r"international|treaty|treaties|law of war|humanitarian|war crimes|genocide|united nations|global|law of the sea|sanctions|european union law|\beu law|investment arbitration|world trade", "exclude": P18_EXCLUDE + r"|admissions|open day|alumni|gala|fundrais|careers" + r"|global peripheries|common good|tax and globali[sz]ation|broken.windows|borders within"},
    {"id": "src_oxford_law_human_rights", "handle": "@OxfordLawFaculty", "name": "Oxford Law Faculty – Human Rights", "channels": [456], "max": 300, "min": 1200, "dedupe": True,
     "filter": r"human rights|civil liberties|asylum|refugee|torture|dignity|discrimination|equality|freedom of (speech|expression|religion)|privacy|european convention|echr|strasbourg", "exclude": P18_EXCLUDE + r"|admissions|open day|alumni|gala|fundrais|careers" + r"|internship|funding"},
    {"id": "src_oxford_law_constitutional", "handle": "@OxfordLawFaculty", "name": "Oxford Law Faculty – Constitutional Law", "channels": [458], "max": 300, "min": 1200, "dedupe": True,
     "filter": r"constitution|parliament|sovereignty|judicial review|separation of powers|rule of law|devolution|prerogative|public law|administrative law|brexit", "exclude": P18_EXCLUDE + r"|admissions|open day|alumni|gala|fundrais|careers"},
    {"id": "src_oxford_law_criminal", "handle": "@OxfordLawFaculty", "name": "Oxford Law Faculty – Criminal Law", "channels": [454], "max": 300, "min": 1200, "dedupe": True,
     "filter": r"criminal|crime|prosecut|sentencing|punishment|prison|evidence|police|policing|jury|homicide|murder|fraud", "exclude": P18_EXCLUDE + r"|admissions|open day|alumni|gala|fundrais|careers"},
    {"id": "src_oxford_law_civil", "handle": "@OxfordLawFaculty", "name": "Oxford Law Faculty – Civil Law", "channels": [455], "max": 300, "min": 1200, "dedupe": True,
     "filter": r"contract|tort|property|trusts?\b|equity|unjust enrichment|restitution|private law|commercial law|company law|family law|civil procedure|litigation|obligations|roman law|civil law|comparative law|negligence|insolvency", "exclude": P18_EXCLUDE + r"|admissions|open day|alumni|gala|fundrais|careers" + r"|grand final"},
    {"id": "src_un_human_rights", "handle": "@UNOHCHR", "name": "UN Human Rights", "channels": [456], "max": 300, "min": 600, "scan": 1800,
     "filter": r"human rights|rights|universal declaration|dignity|torture|discrimination|freedom|equality|justice", "exclude": P18_EXCLUDE + r"|statement|message from|minute|psa|spot\b|campaign|#standup|song|video contest|countdown|press" + r"|celebrat|frontline heroes|concert"},
    {"id": "src_huntley_police", "handle": "@HuntleyFilmArchives", "name": "Huntley Film Archives – Police", "channels": [463], "max": 300, "min": 120, "scan": 22000,
     "filter": r"police|policemen|policewom|policing|constables?|bobbies|scotland yard|\bc\.?i\.?d\.?\b|detectives?|sheriff|mounties|mounted police|traffic cops?|patrol car|police (dogs?|box|station|college|training)|crime prevention|fingerprint",
     "exclude": NO_AIR_OR_SPACE + r"|\bwar\b|army|navy|naval|\braf\b|military|troops|soldiers?|church|chapel|cathedral|model|toys?\b|animation|home movie|wartime|military police|\brmp\b"},
    {"id": "src_huntley_radio", "handle": "@HuntleyFilmArchives", "name": "Huntley Film Archives – Radio", "channels": [818], "max": 300, "min": 120, "scan": 22000,
     "filter": r"\bradios?\b|wireless|broadcasting|marconi|transmitters?|radio (station|set|factory|studio|programme|show)|\bbbc\b|valves?\b|crystal set|loudspeaker|microphone|announcer",
     "exclude": NO_AIR_OR_SPACE + r"|\bwar\b|army|navy|naval|\braf\b|military|troops|soldiers?|church|chapel|cathedral|model|toys?\b|animation|home movie|wartime|radio.?controlled|radiotherap|radioactiv|radiograph|x-ray|police radio" + r"|television|\btv\b"},
    {"id": "src_bbc_archive_radio", "handle": "@BBCArchive", "name": "BBC Archive – Radio History", "channels": [818], "max": 300, "min": 180, "scan": 5000,
     "filter": r"\bradio\b|wireless|\bdjs?\b|disc jockey|broadcasting house|pirate|radio (1|2|3|4|london|caroline|luxembourg)|home service|light programme|third programme|world service|marconi|\bdx\b|transistor|crystal set",
     "exclude": P18_EXCLUDE + r"|radioactiv|radiother|radiograph|radio.?controlled|radio telescope" + r"|pirate video|video games?"},
    {"id": "src_bvws", "handle": "@BVWS", "name": "British Vintage Wireless Society", "channels": [818], "max": 300, "min": 300, "exclude": P18_EXCLUDE + r"|shadow mask|walk around|fair\b"},
    {"id": "src_arrl_history", "handle": "@ARRLHQ", "name": "ARRL – Radio History", "channels": [818], "max": 300, "min": 300,
     "filter": r"histor|centennial|100 years|century|vintage|antique|heritage|maxim|marconi|spark|early radio|founding|legacy",
     "exclude": P18_EXCLUDE + r"|contest|field day|board|webinar|\brfi\b|election|dues|membership|fema|photo album|dedication|joe taylor|vice president"},
    {"id": "src_ripe_ncc", "handle": "@RIPENCC", "name": "RIPE NCC", "channels": [636], "max": 300, "min": 900,
     "exclude": P18_EXCLUDE + r"|general meeting|\bgm\b|agm|board|budget|charging scheme|membership|election|welcome|opening|closing|registration|training course|certified professionals|lir|member lounge" + r"|#|\bday \d|main room|side room|room \d|full day|livestream"},
    {"id": "src_ietf", "handle": "@ietf", "name": "IETF – Internet Engineering Task Force", "channels": [636], "max": 300, "min": 1500, "scan": 6200,
     "filter": r"plenary|tutorial|irtf|anrw|applied networking|deep dive|\biab\b|keynote|panel|lecture",
     "exclude": P18_EXCLUDE + r"|newcomers|hackathon|side meeting|bof\b|working group chairs|ietf \d+ welcome|admin|remote participation|meetecho|lunch|social"},
    {"id": "src_realpars", "handle": "@realpars", "name": "RealPars", "channels": [643], "max": 300, "min": 300,
     "exclude": P18_EXCLUDE + r"|course|enrol|discount|coupon|our team|membership|free trial|black friday" + r"|starlink|satellite|\bsql\b|excel|vba|python"},
    {"id": "src_ieee_spectrum", "handle": "@IEEESpectrum", "name": "IEEE Spectrum", "channels": [685], "max": 300, "min": 300,
     "exclude": P18_EXCLUDE + r"|sponsored|brought to you|webinar|whitepaper|video friday|ces \d+|product|contest|wins|award" + r"|radio spectrum|south pole|geomagnetic|solar storm|evtol|aerial|\bfly|diy|brew your|solder|maker faire|arduino|kitty|championship|competition|red bull|guitar|arcade|tour of nyc|techie's tour|algae|stem crisis|career|dean\b|president|medal|oppenheimer|fukushima|coal|fracking|banned bulbs|microcar|apple's future|hot chip|flexi-disk|ignition facility"},
    {"id": "src_long_now", "handle": "@longnow", "name": "The Long Now Foundation – Future Technology", "channels": [685], "max": 300, "min": 1800, "dedupe": True,
     "filter": r"technolog|future|robot|\bai\b|artificial intelligence|machine|comput|energy|nuclear|fusion|genetic|biotech|synthetic biology|engineering|invent|innovation|quantum|internet|digital|network|clock",
     "exclude": P18_EXCLUDE + r"|religio|spiritual|myth|ritual|history of the|ancient|medieval|economy|election|democracy|war\b" + r"|cosmos|dark matter|dark energy|universe|networks and power|languages|wakanda|afrofutur|climate futures|logic for the future|feel the future|saving time|quarantine|indigenous|speculative futures|breathing|hijacked|human rights|lost landscapes|future of cities|crazier than|used to be the future|geoengineering|reflecting sunlight|food of the future|wildlife|twelve clocks|archaeology"},
    {"id": "src_royal_society_future", "handle": "@royalsociety", "name": "The Royal Society – Future Technology", "channels": [685], "max": 300, "min": 1200, "scan": 1800, "dedupe": True,
     "filter": r"future|artificial intelligence|\bai\b|machine learning|robot|quantum|autonomous|nanotech|synthetic biology|gene editing|crispr|emerging technolog|fusion|batter(y|ies)|computing|digital|data science",
     "exclude": P18_EXCLUDE + r"|history of|prize|medal|award ceremony|fellows|admission|fellowship|summer science exhibition|careers?" + r"|universe|\bdark\b|climate|brains?\b|biology|lates"},
    {"id": "src_henry_ford", "handle": "@TheHenryFord", "name": "The Henry Ford – Inventions", "channels": [686], "max": 300, "min": 240,
     "filter": r"invent|innovation nation|innovator|innovation|patent|prototype|edison|wright|tesla|first (ever|of its kind)|breakthrough|how (it|they) (was|were) made|genius",
     "exclude": P18_EXCLUDE + r"|membership|tickets|event recap|holiday nights|hallowe|wright brothers|airplane|plane|flight|fly" + r"|aviat|yule|jackson home|lincoln|webster|depression|wol(f|ves)|restaurant|stadium|rink|animals|makeup|limousine|presidential|mattox"},
    {"id": "src_nihf", "handle": "@NationalInventorsHallofFame", "name": "National Inventors Hall of Fame", "channels": [686], "max": 300, "min": 180,
     "filter": r"invent|inductee|innovat|patent|creator of|pioneer",
     "exclude": P18_EXCLUDE + r"|camp invention|summer camp|collegiate|sponsor|gala|ceremony|red carpet|livestream|sizzle|thank you" + r"|announc|celebrat|partners in|educators?|students|museum tour"},
    {"id": "src_science_museum", "handle": "@ScienceMuseum", "name": "Science Museum – Inventions", "channels": [686], "max": 300, "min": 240,
     "filter": r"invent|inventor|invention|innovat|engine|machine|patent|prototype|first|how .* works|genius|babbage|watt|stephenson|marconi|telephone|television|computer",
     "exclude": P18_EXCLUDE + r"|lates|late night|membership|tickets|halloween|christmas|family|sleepover|apollo|astronaut|space|rocket|flight|aviation" + r"|zero|pirate radio"},
    {"id": "src_oii", "handle": "@oiioxford", "name": "Oxford Internet Institute", "channels": [690], "max": 300, "min": 1200, "dedupe": True,
     "exclude": P18_EXCLUDE + r"|admissions|open day|graduate|dphil|msc|careers|prospective|welcome|alumni"},
    {"id": "src_berkman_klein", "handle": "@BKCHarvard", "name": "Berkman Klein Center for Internet & Society", "channels": [690], "max": 300, "min": 1500, "dedupe": True,
     "exclude": P18_EXCLUDE + r"|fellows? (showcase|call)|open house|lunch series trailer|welcome|anniversary gala" + r"|covid|isttf|age verification|vaccine"},
    {"id": "src_internet_historian", "handle": "@InternetHistorian", "name": "Internet Historian", "channels": [690], "max": 300, "min": 480, "exclude": P18_EXCLUDE + r"|incognito mode|patreon" + r"|ever given|man in cave|concordia|fancy|f3ncy|varus|going camping|balloon boy|pool's closed|very serious business"},
    {"id": "src_folding_ideas", "handle": "@FoldingIdeas", "name": "Folding Ideas – Digital Culture", "channels": [690], "max": 300, "min": 900,
     "filter": r"nft|crypto|line goes up|metaverse|web ?3|internet|online|youtube|influencer|social media|content|algorithm|mlm|minecraft|game|gamer|digital|video essay|creator|mrbeast|grift",
     "exclude": P18_EXCLUDE + r"|american tail|assassin's creed"},
    {"id": "src_chm_interviews", "handle": "@ComputerHistory", "name": "Computer History Museum – Oral Histories and Conversations", "channels": [691], "max": 300, "min": 1200, "scan": 2200, "dedupe": True,
     "filter": r"oral history|in conversation|conversation with|fireside|interview|revolutionar|a conversation|talks? with|in dialogue|sits down with|chat with",
     "exclude": P18_EXCLUDE + r"|gala|fellow awards? (ceremony|gala)|donor|member|exhibit tour|trailer"},
    {"id": "src_chm_internet", "handle": "@ComputerHistory", "name": "Computer History Museum – Internet History", "channels": [815], "max": 300, "min": 600, "scan": 2200, "dedupe": True,
     "filter": r"internet|arpanet|\bweb\b|world wide web|e-?mail|ethernet|tcp/?ip|packet switch|browser|netscape|mosaic|search engine|hypertext|online|networking|\bnet\b|aloha|usenet|bbs|modem|xerox parc|cyberspace|dot.?com|social media|wikipedia|google|yahoo",
     "exclude": P18_EXCLUDE + r"|gala|donor|member" + r"|broadcom|online computation|listen to your email|\bsna\b"},
    {"id": "src_dwarkesh", "handle": "@DwarkeshPatel", "name": "Dwarkesh Patel – Technology Interviews", "channels": [691], "max": 300, "min": 2400,
     "filter": r"\bai\b|agi|compute|chips?\b|semiconductor|model|scaling|openai|anthropic|deepmind|google|meta|engineer|software|robot|tech|nvidia|tsmc|transformer|neural|learning|algorithm|programming|computer|startup|founder",
     "exclude": P18_EXCLUDE + r"|history of|empire|china's|war\b|historian|dynasty|napoleon|stalin|mao|rome|genghis|economy of|clip" + r"|mckenzie|money laundering|xi jinping|tyler cowen|ultralearning|learning tools|macaskill|longtermism|manifold|\bama\b|career advice|tech elites|utopia|infinite ethics|aliens|share of the economy|china is killing|gwern|deutsch"},
    {"id": "src_cch", "handle": "@TheCentreforComputingHistory", "name": "The Centre for Computing History – Conversations", "channels": [691], "max": 300, "min": 1200,
     "filter": r"interview|in conversation|oral history|talks about|chris curry",
     "exclude": P18_EXCLUDE + r"|fundrais|volunteer|christmas|family day|workshop|coding club|arcade night" + r"|abug|techtalk|tech talk|exhibitor|retrofest|panel talk|ashens"},
    {"id": "src_christies", "handle": "@Christies", "name": "Christie's – Collecting", "channels": [795], "max": 300, "min": 300, "scan": 1700,
     "filter": r"collect|collector|collecting|collection of|connoisseur|expert guide|how to (identify|spot|tell|care|start)|history of|origins|masterpiece|provenance|restor|conserv",
     "exclude": P18_EXCLUDE + r"|auction preview|sale preview|now open|live auction|bid|lot \d|results|record price|sold for|preview|exhibition opening|evening sale|day sale|online sale|handbag|watch(es)? sale|wine sale" + r"|livestream|wine|whisk|sneaker"},
    {"id": "src_sothebys", "handle": "@Sothebys", "name": "Sotheby's – Collecting", "channels": [795], "max": 300, "min": 300, "scan": 3950,
     "filter": r"collect|collector|collecting|collection of|connoisseur|expert guide|how to (identify|spot|tell|care|start)|history of|origins|masterpiece|provenance|restor|conserv",
     "exclude": P18_EXCLUDE + r"|auction preview|sale preview|now open|live auction|bid|lot \d|results|record price|sold for|preview|exhibition opening|evening sale|day sale|online sale|handbag|watch(es)? sale|wine sale|real estate|property|realty|home tour|listing" + r"|auction premiere|evening auction|watch the entire|to be offered|sells? for|soars|sets new|how to start|whisk|wine|sneaker|\d+ june 20"},
    {"id": "src_strong_museum", "handle": "@museumofplay", "name": "The Strong National Museum of Play", "channels": [795], "max": 300, "min": 300,
     "filter": r"hall of fame|game saves|toys?\b|toymakers|odyssey|collection|preserv", "exclude": P18_EXCLUDE + r"|membership|tickets|hours|camp|birthday|party|summer|holiday|new exhibit opens|press" + r"|storytime|women in games|cocktails|butterfl|get in the game"},
    {"id": "src_ifixit", "handle": "@iFixitYourself", "name": "iFixit – Repair Skills", "channels": [798], "max": 300, "min": 240,
     "filter": r"how to|repair|replace|replacement|fix|fixing|guide|maintenance|mend|restore|troubleshoot|clean",
     "exclude": P18_EXCLUDE + r"|teardown|review|unboxing|sponsor|right to repair (bill|law|act|hearing)|testif|lobby|legislat|news|announc|podcast|iphone \d+ (vs|or)|we (tried|tested)|is it worth" + r"|rundown|macworld|\bcall\b|awards|disgusting"},
    {"id": "src_british_red_cross", "handle": "@BritishRedCross", "name": "British Red Cross – First Aid", "channels": [798], "max": 300, "min": 60,
     "filter": r"first aid|how to|cpr|choking|bleeding|burns?|recovery position|unresponsive|seizure|heart attack|stroke|asthma|broken bone|sprain|head injury|poison|allergic",
     "exclude": P18_EXCLUDE + r"|appeal|donat|fundrais|volunteer|ukraine|gaza|refugee|crisis|conflict|disaster|emergency response|flood|campaign|shop" + r"|#|wheelchair|teaching resource|teach first aid|loneliness|climate|worries|draw bodies|saved a woman"},
    {"id": "src_chrisfix", "handle": "@ChrisFix", "name": "ChrisFix – Car Care Basics", "channels": [798], "max": 300, "min": 300,
     "filter": r"how to|change|replace|fix|repair|check|maintenance|clean|detail|jump|flat tyre|flat tire|oil|brakes?|battery|wipers?|headlights?|coolant|spark plugs?|beginner",
     "exclude": P18_EXCLUDE + r"|sponsor|giveaway|build|project car|turbo|drift|race|racing|dyno|swap|restoration of|abandoned|burnout|supercharg|horsepower|mustang build|widebody" + r"|corvette|lift your truck|dual brake|tint|metal etch|extra money|led bed|asmr"},
    {"id": "src_lannan", "handle": "@LannanFoundation", "name": "Lannan Foundation – Readings and Conversations", "channels": [843], "max": 300, "min": 1800, "filter": r"\breading\b|poetry|arthur sze|eisenberg|wideman|jericho brown|nguyen phan|heffernan|(hemon|mcdermott|miéville|mccann|deborah levy|danticat|elizabeth alexander|ewing|richard powers|sebastian barry|teju cole|wallace shawn), conversation", "exclude": P18_EXCLUDE},
    {"id": "src_american_theatre_wing", "handle": "@AmericanTheatreWing", "name": "American Theatre Wing – Working in the Theatre", "channels": [844], "max": 300, "min": 1200, "dedupe": True,
     "filter": r"working in the theat(re|er)|theatre wing seminars?|seminar|downstage center|panel|in conversation|conversation with|master class|masterclass|career guides?|legends|history",
     "exclude": P18_EXCLUDE + r"|tony awards? (nominations|press|red carpet|ceremony)|gala|fundrais|donat|livestream|dance off" + r"|master class|pandemic|in conversation with"},
    {"id": "src_va_design", "handle": "@VAMuseum", "name": "V&A – Design History", "channels": [849], "max": 300, "min": 300,
     "filter": r"history|historic|how was it made\? (donatello|carving grinling)|postmodern|brutalism|modernis|dieter rams|porcelain|silk|pearls|18th-century|medieval|ancient|hieroglyph|british design stories|poster|shoe design|architecture at the v&a",
     "exclude": P18_EXCLUDE + r"|membership|tickets|late|christmas|family|kids|shop|dress up|fashion week|wedding|makeup|beauty" + r"|costume|musical|vampire|ghost|amulet|asmr|make your own|catsuit|tracksuit|residen|privacy by design|videogame"},
    {"id": "src_cooper_hewitt", "handle": "@CooperHewitt", "name": "Cooper Hewitt – Design History", "channels": [849], "max": 300, "min": 1200, "scan": 1250, "dedupe": True,
     "filter": r"histor|morse|bauhaus|modern|legacy|tiffany|girard|glaser|piranesi|du bois|pleats|liebes|evolutions|store stories",
     "exclude": P18_EXCLUDE + r"|national design awards? (ceremony|gala)|gala|fundrais|teen|kids|family|member|design camp|smithsonian design week" + r"|making home with justice|imaginary forces|ross barney|lucia derespinis|behnaz|designer's studio|daniela villegas|infinite archive|hans tan|future of design|du bois through research"},
    {"id": "src_vitra", "handle": "@VitraDesignMuseum", "name": "Vitra Design Museum", "channels": [849], "max": 300, "min": 180, "filter": r"eames|panton|thonet|bentwood|rams|bauhaus|papanek|shakers|german design 1949|typology|schaudepot|radical design|ron arad|plastic", "exclude": P18_EXCLUDE + r"|shop|campus tour|tickets" + r"|muscon|festakt|kunst am bau|erleben|global shift|hello, robot|garden futures|ecal"},
    {"id": "src_eames_office", "handle": "@EamesOffice", "name": "Eames Office", "channels": [849], "max": 300, "min": 120, "exclude": P18_EXCLUDE + r"|shop|store|sale" + r"|powers of ten|copernicus|eratosthenes|solar|elephant|day of the dead|russian subtitles|excerpt|translation|voice over|aquarium"},
    {"id": "src_trailers_from_hell", "handle": "@TrailersFromHell", "name": "Trailers From Hell", "channels": [891], "max": 900, "min": 90, "scan": 1850,
     "exclude": NO_AIR_OR_SPACE + r"|podcast|livestream|patreon|merch|announcement|church|religio|bible|prayer|\bgod\b" + r"|commandments|king of kings|jesus|christ\b|gospel|apollo|\bmoon|space|astronaut|rocket|\bmars\b|planet|airport|airplane|aviator|top gun|air force|flying"},
    {"id": "src_gbh_archives", "handle": "@GBHArchives", "name": "GBH Archives", "channels": [892], "max": 300, "min": 300, "exclude": P18_EXCLUDE + r"|virgo|cluster|flying|fly over|from the sky|alien|exteriors|scenics|mind-body|butterfl|bees\b|powwow"},
    # Pass 19: classic feature films; only films matched to a Wikidata release year (scripts/film_years.py) join a decade channel.
    {"id": "src_film_detective", "handle": "@TheFilmDetective", "name": "The Film Detective", "channels": [103], "max": 1000, "min": 3600, "scan": 2100,
     "exclude": NO_AIR_OR_SPACE + r"|trailer|teaser|clip\b|podcast|interview|episode|season \d|s\d+ ?e\d+|\bpart \d|compilation|marathon|documentary|"
                r"church|religio|bible|biblical|prayer|\bgod\b|jesus|christ\b|gospel|saint|miracle|apollo|\bmoon\b|astronaut|pilot|air force|bomber|squadron|flying|wings"},
    {"id": "src_nfb_experimental", "handle": "@NFB", "name": "NFB – experimental films (McLaren, Lambart, Lipsett)", "channels": [116], "playlists_only": True, "min": 60, "max": 300,
     "playlists": ["PLHerjfWGX0CUzNtp0Ex5sl2jsGUj_7fyz", "PLHerjfWGX0CWKyEVfWV0XDoE6YVhDZ7ra", "PLHerjfWGX0CUqCS6OON11BRP4ys1SKth-"],
     "exclude": NO_AIR_OR_SPACE + r"|trailer|making of|interview|documentary about"},
    {"id": "src_icheme", "handle": "@IChemE", "name": "Institution of Chemical Engineers (IChemE)", "channels": [654], "min": 600, "max": 300,
     "exclude": NO_AIR_OR_SPACE + r"|award|ceremony|gala|member|chartered|agm|annual general|election|president|trailer|promo|advert|sponsor|recruit|careers?\b|conference highlights|welcome to"
                r"|volunteer|trustee|governance|congress|network|coronavirus|women in engineering|hackathon|showcase|in conversation|disabilit|social mobility|other version|brian cox|myth busting"},
    {"id": "src_dogwoof", "handle": "@dogwoof", "name": "Dogwoof", "channels": [139], "min": 45, "max": 800, "longest": 600,
     "filter": r"\btrailer\b",
     "exclude": NO_AIR_OR_SPACE + r"|#|exclusive clip|\bclip\b|featurette|behind the|interview|q ?& ?a|balloonist|spaceship|church|religio|faith|god\b|pope|monk|nun\b|mosque|bible"},
]

# music pass: per-publisher refinements after checking each channel's longest uploads (radio shows, podcasts, loops, compilations, panels)
MUSIC_REFINE = {
    "src_temple_of_the_dog": {"exclude": r"pseudo video"},
    "src_duran_duran": {"exclude": r"whooosh|\bradio\b"},
    "src_the_doors": {"exclude": r"very best|greatest hits|tales from the matrix|live thursday"},
    "src_led_zeppelin": {"exclude": r"press conference|listening event"},
    "src_gary_clark_jr": {"exclude": r"listening session|questions with"},
    "src_wu_tang_clan": {"exclude": r"\bloop\b|instrumental|library"},
    "src_public_enemy": {"filter": r"public enemy|chuck d|flavor flav", "exclude": r"c-doc|body hat|weekly|\bep\.? ?\d|episode"},
    "src_toots": {"exclude": r"disc \d"},
    "src_hot97": {"exclude": r"discuss|wrap ?up|reveal|talks?\b|interview|update|explains|says|details|responds|speaks"},
    "src_1xtra_hiphop": {"exclude": r"dancehall|talks|seani b|big yard|reggae|afrobeats|amapiano|r&b"},
    "src_anjunabeats": {"exclude": r"panel|fundraiser|kitchen"},
    "src_lollapalooza": {"exclude": r"interview|paws"},
    "src_moog": {"exclude": r"firmware"},
    "src_joe_bonamassa": {"exclude": r"nerdville"},
    "src_angelique_kidjo": {"exclude": r"twitter|conversation|birthday"},
    "src_keb_mo": {"exclude": r"discuss"},
    "src_the_cult": {"exclude": r"dark energy"},
    "src_ride": {"exclude": r"universe"},
}
for _target in TARGETS:
    _refine = MUSIC_REFINE.get(_target["id"], {})
    if "exclude" in _refine:
        _target["exclude"] = f"{_target['exclude']}|{_refine['exclude']}" if _target.get("exclude") else _refine["exclude"]
    if "filter" in _refine:
        _target["filter"] = _refine["filter"]


def key() -> str:
    return Path("/tmp/.retrotv_key").read_text().strip()


API_CACHE = Path("/tmp/retrotv-api-cache.json")
CACHED_PATHS = {"playlistItems", "videos"}
_cache: dict | None = None


def cached(path: str, params: dict) -> tuple[str, dict]:
    """Playlist pages and video records, reused so one scan of a broad publisher serves every split of it."""
    global _cache
    if _cache is None:
        _cache = json.loads(API_CACHE.read_text()) if API_CACHE.exists() else {}
    return path + "?" + urllib.parse.urlencode(sorted(params.items())), _cache


def save_cache() -> None:
    if _cache is not None:
        API_CACHE.write_text(json.dumps(_cache))


def get(path: str, **params) -> dict:
    if path in CACHED_PATHS:
        slot, store = cached(path, params)
        if slot not in store:
            store[slot] = fetch(path, **params)
        return store[slot]
    return fetch(path, **params)


def fetch(path: str, **params) -> dict:
    params["key"] = key()
    url = API + path + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code < 500 or attempt == 3:
                raise
            time.sleep(2 + attempt * 3)
            last = error
        except Exception as error:  # noqa: BLE001
            if attempt == 3:
                raise
            time.sleep(2 + attempt * 3)
            last = error
    raise last


def channel(handle: str) -> dict | None:
    if handle.startswith("UC"):
        items = get("channels", part="snippet,contentDetails,statistics", id=handle).get("items", [])
    else:
        items = get("channels", part="snippet,contentDetails,statistics", forHandle=handle).get("items", [])
    return items[0] if items else None


def seconds(iso: str) -> int:
    match = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    if not match:
        return 0
    d, h, m, s = (int(x or 0) for x in match.groups())
    return d * 86400 + h * 3600 + m * 60 + s


def uploads(playlist: str, limit: int) -> list[str]:
    ids, token = [], None
    while len(ids) < limit:
        page = get("playlistItems", part="contentDetails", playlistId=playlist, maxResults=50, **({"pageToken": token} if token else {}))
        ids += [item["contentDetails"]["videoId"] for item in page.get("items", [])]
        token = page.get("nextPageToken")
        if not token:
            break
    return ids[:limit]


def playable(video: dict, minimum: int, title_filter: str | None, exclude: str | None = None, maximum: int = 4 * 3600) -> tuple[bool, str]:
    status, details, snippet = video.get("status", {}), video.get("contentDetails", {}), video.get("snippet", {})
    title = re.sub(r"\s+", " ", snippet.get("title", ""))
    duration = seconds(details.get("duration", ""))
    region = details.get("regionRestriction", {})
    if status.get("privacyStatus") != "public" or not status.get("embeddable"):
        return False, "not public/embeddable"
    if snippet.get("liveBroadcastContent", "none") != "none":
        return False, "live"
    if details.get("contentRating", {}).get("ytRating") == "ytAgeRestricted":
        return False, "age restricted"
    if "GB" in region.get("blocked", []) or ("allowed" in region and "GB" not in region["allowed"]):
        return False, "not viewable in GB"
    if duration < minimum or duration > maximum:
        return False, "duration"
    if BLOCKED.search(title):
        return False, "blocked subject"
    if title_filter and not re.search(title_filter, title, re.I):
        return False, "off topic"
    if exclude and re.search(exclude, title, re.I):
        return False, "excluded subject"
    return True, ""


def owned_playlist(playlist: str, owner: str) -> bool:
    items = get("playlists", part="snippet", id=playlist).get("items", [])
    return bool(items) and items[0]["snippet"]["channelId"] == owner


def same_lecture(title: str) -> str:
    """Publishers that upload one lecture twice (with and without the speaker, or with slides) collapse to one title."""
    title = re.sub(r"\((video|slides|audio)[^)]*\)", "", title.split(" | ")[0], flags=re.I)
    parts = title.split(" - ")
    if len(parts) > 1 and not re.search(r"\d", parts[-1]):
        title = " - ".join(parts[:-1])
    return re.sub(r"[^a-z0-9]", "", title.lower())


def acquire(target: dict, scan: int, taken: set[str]) -> tuple[str, list]:
    """Uploads of the target's channel and/or playlists that channel itself publishes (owner verified)."""
    info = channel(target["handle"])
    if not info:
        raise SystemExit(f"{target['handle']}: channel not found")
    ids: list[str] = []
    if not target.get("playlists_only"):
        ids += uploads(info["contentDetails"]["relatedPlaylists"]["uploads"], target.get("scan", scan))
    for playlist in target.get("playlists", []):
        if not owned_playlist(playlist, info["id"]):
            print(f"{target['id']}: playlist {playlist} not published by {info['id']}; skipped")
            continue
        ids += uploads(playlist, 1000)
    ids = [video for video in dict.fromkeys(ids) if video not in taken]
    rows, rejected = [], {}
    descriptions = json.loads(DESCRIPTIONS.read_text()) if DESCRIPTIONS.exists() else {}
    for start in range(0, len(ids), 50):
        batch = get("videos", part="snippet,contentDetails,status", id=",".join(ids[start:start + 50]))
        for video in batch.get("items", []):
            ok, reason = playable(video, target.get("min", 60), target.get("filter"), target.get("exclude"), target.get("longest", 4 * 3600))
            if ok and target.get("channel_title") and not re.search(target["channel_title"], video["snippet"].get("channelTitle", ""), re.I):
                ok, reason = False, "publisher identity"
            if ok and target.get("series") and not re.search(target["series"], video["snippet"]["title"], re.I):
                ok, reason = False, "series homed elsewhere"
            if not ok:
                rejected[reason] = rejected.get(reason, 0) + 1
                continue
            snippet = video["snippet"]
            descriptions[video["id"]] = {"d": snippet.get("description", ""), "p": snippet.get("publishedAt", ""), "c": snippet.get("channelTitle", "")}
            if re.match(r"\d{4}-\d{2}-\d{2}", snippet.get("publishedAt", "")):
                UPLOADED[video["id"]] = snippet["publishedAt"][:10]
            rows.append([video["id"], snippet["title"], seconds(video["contentDetails"]["duration"]), target["id"], list(target["channels"]), "api"])
    DESCRIPTIONS.write_text(json.dumps(descriptions))
    save_cache()
    rows.sort(key=lambda row: -row[2])
    if target.get("dedupe"):
        rows = sorted({same_lecture(row[1]): row for row in reversed(rows)}.values(), key=lambda row: -row[2])
    rows = rows[: target.get("max", 300)]
    hours = sum(row[2] for row in rows) / 3600
    print(f"{target['id']}: {info['snippet']['title']} ({info['id']}) scanned {len(ids)} kept {len(rows)} ({hours:.0f} h) rejected {rejected}")
    return info["snippet"]["title"], rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", nargs="*")
    parser.add_argument("--scan", type=int, default=1500)
    parser.add_argument("--only", nargs="*", help="source ids to refresh; default all TARGETS")
    args = parser.parse_args()
    targets = [target for target in TARGETS if not args.only or target["id"] in args.only]
    if args.probe is not None:
        for handle in args.probe:
            info = channel(handle)
            if not info:
                print(f"{handle}: not found")
                continue
            snippet, stats = info["snippet"], info.get("statistics", {})
            print(f"{handle}: {snippet['title']} | {info['id']} | subs {stats.get('subscriberCount')} | videos {stats.get('videoCount')} | {snippet.get('description', '')[:160]!r}")
        return
    doc = json.loads(CATALOGUE.read_text())
    assert_registry(TARGETS, doc["sources"])
    for target in targets:
        try:
            taken = {row[0] for row in doc["items"] if row[3] != target["id"]}
            name, rows = acquire(target, args.scan, taken)
        except urllib.error.HTTPError as error:
            save_cache()
            if error.code == 403 and b"quota" in error.read().lower():
                remaining = [t["id"] for t in targets[targets.index(target):]]
                print(f"quota exhausted; resume with --only {' '.join(remaining)}")
                break
            print(f"{target['id']}: failed HTTP {error.code}")
            continue
        except SystemExit as error:
            print(f"{target['id']}: failed {error}")
            continue
        if not rows:
            print(f"{target['id']}: no eligible programmes; not added")
            continue
        doc["sources"][target["id"]] = target.get("name", name)
        routed = {video for ids in doc.get("programmeRoutes", {}).values() for video in ids}
        previous = {row[0]: row[4] for row in doc["items"] if row[3] == target["id"] and row[0] in routed}
        rows = [row[:4] + [previous[row[0]]] + row[5:] if row[0] in previous else row for row in rows]
        doc["items"] = [row for row in doc["items"] if row[3] != target["id"]] + rows
        doc.setdefault("uploaded", {}).update({row[0]: UPLOADED[row[0]] for row in rows if row[0] in UPLOADED})
        doc["generatedAt"] = int(time.time() * 1000)
        CATALOGUE.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    from source_register import write_register  # noqa: E402
    write_register()
    print(f"catalogue: {len(doc['items'])} rows")


if __name__ == "__main__":
    main()
