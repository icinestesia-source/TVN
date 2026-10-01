"""Programme-level reuse of dedicated publishers for channels their home catalogues already cover in part.

Each programme is chosen individually; its source does not become eligible for the channel. The
source/channel pairs are approved in fit.ts (PROGRAMME_REUSE); this script writes the chosen ids to
playable.json "programmeRoutes" for those channels only.

824 Stations: a deterministic title rule over the two rail publishers. The programme's subject must be a
station (history, architecture, operation, profile, opening, naming). Journeys, series episodes, walks,
songs, promos and line tours are excluded even when stations appear.

437 Mountains, 438 Rivers, 441 Forests, 442 Polar World: ids reviewed one by one from the nature, earth
science and environmental publishers. The programme's primary subject must be the landform or biome
(or a named example); wildlife merely filmed there, travel, compilations, news roundups and raw
monitoring footage are excluded.

234 Manga Culture tops up VIZ with manga-form programmes from museum and comics-criticism publishers.
197 Behind the Scenes, 242 Arcade, 254 Science Fiction Culture: ids reviewed one by one. 197 is the making of
screen and stage productions; 242 is arcade hardware, cabinets and coin-op history; 254 is SF screen culture
(makers, criticism, fandom, sound). The three lists are disjoint and exclude factual space.

454-458 the law channels, 463 Policing History: individual lectures, documentaries and archive films whose
subject is that branch of law (or the history of policing). 815 Internet History: the building and fate of
networks and early web companies. 818 Radio History: the history of broadcasting and wireless. 843 Literature
Archive and 844 Theatre Archive: archival interviews and films of writers and of stage people, never current
programming, so they stay distinct from 497 Literature and 049 Stage.

Pass 19 channels (history, law and technology, archives, business, sport, food, lifestyle, geography, engineering
and the film double-bill and creature channels) are frozen in scripts/pass19_routes.py and merged here.

usage: python3 scripts/programme_reuse.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pass19_routes import CURATED_P19, POOLS_P19  # noqa: E402
from pass20_routes import CURATED_P20, POOLS_P20  # noqa: E402
from pass22_routes import CURATED_P22, POOLS_P22  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / "public/independent/playable.json"

STATION_SOURCES = {"src_jago_hazzard", "src_all_the_stations"}
STATION = re.compile(r"\bstations?\b|\bterminus\b", re.I)
NOT_STATION_SUBJECT = re.compile(
    r"\bepisode \d|\bday \d|\bwalk\b|\bsong\b|\bpilot\b|have\s+an?\s+adventure|in your language|\bin welsh\b|"
    r"\bdocumentary\b|don't panic|cocktail bar|metro line \d",
    re.I,
)

NATURE_SOURCES = {
    "src_free_documentary_nature", "src_real_wild", "src_terra_mater", "src_nick_zentner", "src_usgs",
    "src_iris_earthquake", "src_pbs_terra", "src_geologyhub", "src_shawn_willsey", "src_bbc_earth",
    "src_just_have_a_think", "src_unep",
}

MAKING_OF_SOURCES = {
    "src_doctor_who", "src_bbc_archive", "src_bbc_archive_broadcasting", "src_abc_news_indepth", "src_bbc_earth",
    "src_terra_mater", "src_stan_winston", "src_studiobinder", "src_shows_must_go_on", "src_oscars", "src_soundworks",
    "src_vanity_fair", "src_architectural_digest", "src_ed_sullivan", "src_british_movietone", "src_bfi",
}
ARCADE_SOURCES = {
    "src_modern_vintage_gamer", "src_8bit_guy", "src_digital_foundry", "src_gaming_historian", "src_lgr",
    "src_modern_mba", "src_james_bruton", "src_jimmy_diresta",
}
SF_CULTURE_SOURCES = {
    "src_doctor_who", "src_bfi", "src_bbc_archive", "src_nerdwriter", "src_lessons_screenplay", "src_soundworks",
    "src_oscars", "src_vanity_fair", "src_comic_tropes", "src_tv_academy_interviews", "src_polyphonic",
    "src_ace_editors", "src_british_movietone", "src_johnny_carson", "src_screen_junkies", "src_studiobinder",
}
MANGA_SOURCES = {"src_british_museum", "src_comic_tropes", "src_strip_panel_naked"}
LAW_SOURCES = {
    "src_gresham_law", "src_gresham_crime", "src_historia_civilis", "src_timeline", "src_legaleagle", "src_ted",
    "src_us_national_archives", "src_hay_festival", "src_thames_tv", "src_dw_documentary", "src_frontline",
}
POLICING_SOURCES = {
    "src_gresham_crime", "src_timeline", "src_nfb", "src_british_movietone", "src_huntley_social", "src_huntley_events",
    "src_chicago_film_archives", "src_thames_tv", "src_us_national_archives",
}
INTERNET_HISTORY_SOURCES = {
    "src_chm", "src_computerphile", "src_bbc_archive", "src_company_man", "src_logically_answered", "src_ripe_ncc", "src_oii",
}
RADIO_HISTORY_SOURCES = {"src_oceanliner_designs", "src_bbc_archive_broadcasting"}
LITERATURE_ARCHIVE_SOURCES = {"src_thames_tv", "src_bbc_archive", "src_dick_cavett", "src_nfb", "src_us_national_archives"}
THEATRE_ARCHIVE_SOURCES = {"src_dick_cavett", "src_us_national_archives", "src_chicago_film_archives", "src_ap_archive"}

CURATED = {
    234: [  # manga as culture: the form, its artists, drawing it and translating it (no anime episodes)
        "S26amggeL-k", "MgRXx7A88d4", "GdtF9RRc2P4", "-SHFVrhkJ0Q", "OnU8T_0hbi4",
        "IZO4H7pMVSk", "e_OtTTHgpyY", "CjwSq98pXm8", "4xzcljoHMrY", "GWlPEl8KTyY",
    ],
    197: [  # the making of film, television and stage productions (not craft tutorials, not generic explainers)
        "QR7-V0DINFE", "_XY46bCn-dY", "G2ykfNJnTjI", "GBCZsQ5aq2Y", "IeeD-uHE5AI", "qHngzLBXF4A",
        "iFLqcrDUTwA", "e2683rIsPpE", "YQOeyh5vcPw", "P47DrP640Rs",
        "lnTBQdhl1kY", "atJ1PHZLXec", "ou0drVSmHY0", "5yZcJwfJCKU", "x5nWRs_6Ahg", "1pgWBL_xqR8",
        "dNf8SdLFqoo", "rcKGvhY-c_c", "h3dnymxsUdQ", "Jcx3f7cMkxo", "vYXyyx0Ckgk",
        "tBQc3EM8hRM", "maXcwJKSTCw", "WoXc0KGEQc4", "HqV7mD2elgM", "BI9mDRWl3mw", "1iwumLz6lso", "OhFXz6MxKAM",
        "YV37UXmb1wI", "GpKQttja1R8", "0GyGCegUxJY",
        "AfUgRg4tjSY", "2jbvomqF3cg", "mTdUSNWu5DM", "5J6lvk5xdJM", "egb9duuJO9s", "HVDVIFn7U3I", "H2N-5ejkk7k",
        "VP1CTx-EES4", "U1_SkNjWJTE", "mO3RFljysYo", "rBleWc47MJA", "95RMGwYpaYE", "mGDieKE1_ZI", "jAtULl3ExUo",
        "WrKL432F86Q", "xcOh6iWq8DA",
        "OP9HZ-etS04", "qcepmZqNUUU", "ggT_qH2kTgA", "O7q9Hq86xw8", "1GA8Bb7xM1U", "AQreIttrLIE", "fC9H5jWiMng",
        "VZVu7HAw-fQ", "1y8xSKF7BPo", "dE7iHqprAHs", "GhBXbMnMfjA", "Xl-jw7HA12Q",
        "DlfHpIvTTco", "vwr6fdqqxeE", "fZ6xbHgL5Q8", "ZBVasS24N2A", "lNOdUSxoFjY", "Fq85Bz5L1fQ", "OiIxePlKZ1A",
        "37a5NWALud8", "OZR8ObMvmL4", "ROuBbgZNaPM",
    ],
    242: [  # arcade machines, coin-op history, arcade boards and cabinets (not home-console gaming)
        "4gOtFs-IbWs", "iraLfEz0tJo", "Iuo0njOI-qE", "ZjROhr4Vx5s", "91cUhy-NHX8", "JwPuuqTxV-I", "i3-3dvgYt7c",
        "HnZ3j-rZfmo", "dfexzgrWWF4", "FH2NKlE8frw", "jxc_K7RKRy0", "LFaxqJJLOZc", "pWnzd74Khx8",
        "hJrbAnQ1N9k", "lhMENwGh7vQ", "1t77rI-NUzE", "O9ufiuXRN-8", "dyiwHF67Gvg", "fThN20i4OcE", "vCtXZM8iG-o",
        "gpfhHfMnFVo", "zU13CW0oVGo", "XPAAvXrHE8Y", "yFNRUgRupkU", "wthz3Rb3wnA", "9FxOkMwQy3c", "cxOhy2d5MyE",
        "NMDpPRGuaq8",
    ],
    254: [  # science fiction as culture: makers, fandom, criticism and sound of SF screen works (no factual space)
        "rs2I7jkFqvg", "odOR9AEmwjM", "bSS7mc5JCbw", "n5pR4SU5jS8", "b-X9WhyWye4",
        "GXRlGULqHxg", "4T_sSSka9pA", "YgLYZPHXgXo", "XC7dsRbQVnc", "JO_LMc7YkBw", "M7Qm_UJML54",
        "gsIQa7sH5_Y", "4x9mplwN3Lo", "42jHc-_XsDo", "NdSGZ-RNdTw", "_tbvMzqk3F4",
        "pdxlzkiVmXY", "_L2MzJKWAuQ", "gn1NGA3nCKA", "b07U7DtAflY", "-9NpkbJfNrw", "1XhflLVfLJU", "QJ7XRu46hbg",
        "KA1uwpnmVAE",
        "Shs7UMYQzVM", "UZ21aGy99nw", "0TnNCpc5ld8", "6czYOLR3tBg", "YO7FXIs9n-c",
        "2ws3YfsAYDw", "7E6AcXUKSVA", "6s1ssDMUXZ4", "Ek-g0uDfbas",
        "WcKhkHHA5Mw", "-Q0WUfkM_3Y", "gBuNetd3Ec8",
        "zrzygziT11I", "L7sJRmqUTlI", "P84NMSruzjs", "8mpRlAb2xRw", "Mgk04KaER8U",
        "iC5ouyu3xs0", "jdylle_hPgQ", "PxUx08ZqC1I", "EJgpgfc8qU4", "qRgP-46AC_o",
        "obgD63BUdjE", "4nj_fqqnN50", "oCis8XqDA6A",
        "UmGAqU0sng0", "Lt-tS_4Wc8g", "-u9Qxxkbjmg", "M-C-0cxcaF4", "8V1g4HiHyWY",
        "C6mgj4bmqmk", "-KHcbp8szrY", "d2iJZe5-_Uk", "LGwpKeMjUxw",
        "GGpi2Jmbr4M", "WQiuvNqaOEw", "HMO03pHxmxM", "FUeoS2li-hI", "_pw2ixTxJz8", "di90VuXalTM", "hd0n8ZDjg4A",
        "M6lqgB32Mf0", "Vuo8C22v7cw",
    ],
    437: [  # named mountains and ranges, mountain geology and mountain ecosystems
        "lIhwCRsszDc", "rjLqcru-jd0", "0b0d0hT-iDA", "lXcKIoXN0Xw", "vm-JAbPW35o", "FtxHxQAifE0", "X3JpmR46Bzo",
        "MIAuG78hWnw", "eNTBML_AKLc", "rVFfDcQX_xo", "fj9SIpG2MCk", "YhaSWai0CXk", "zoTo6qo6F6Q", "DJ2rVlyEf4o",
        "UeESAHpYBt4", "nxg_RC7Ak98", "bc4UcGBuv4w", "NPNZ3jlZYdk", "oEK0BAfZPIc", "TkhJfJnLn8s",
        "b6jgDn4olFU", "t5hhkHxEq5g", "strox6p35wk", "y2IGNZjpmrc", "-JviaMGgAwY", "1QyEpbft8rw", "qu_trKbyoaE",
        "1PkKDW4fKeY", "t12Pc8aI16M", "f9euHLPk7ZI", "249kBr8Uwdk", "QqG6aStvX5E", "GhtyXb-ri9E", "fX0-xA7NdYA",
        "Q2h8WOM5zX4",
        "PysQ46HF6Q4", "Lpahl-1mvRk", "OKIEm0SRXKw", "cFWfs5KgS2g", "1FQS-eVf31Y", "km8xwPp8fnk", "oQrV4j1qA5Q",
        "uq7oBz_AX7U",
        "CPu0NLOiqp4", "W0LIzqVPsWA", "a09N0AcjOmA", "HADlPSzCnVc", "4fi3kqlJ3bU", "kM2xIOPxP6c", "UuUyXqzoHEE",
        "KH8QudkT5b4", "dg8x4lh02PM", "7dOqtJq8c88", "IL9N1hAuYLU", "ETkV7GnOM4w", "1-5_IlSiSM0", "lRNwbEUWaj4",
        "L44Eh_mslws", "--2to09j53U", "Lg_Y914Xqpk", "WCPJlZH4l4M", "VYV131Q-LM8", "8Y8d0TklFQc", "vdqFgV-NLbY",
        "VwhC2EoFBdM",
        "mp7cqti2wx4", "p5RohaQ3wfk", "JCZevn-XCtw", "DIqen6-uHY8",
        "XpWLqlp88Fo", "eZf-tP7anHs", "5VjaSFEf4BU", "owxtROejMB0", "gpsalbDE4_k", "vw6azxp1_YY",
    ],
    438: [  # named rivers, river systems, watersheds and river ecology
        "6uhIszcouTI", "GHU-kxs-yN0", "xgNpnkDuYN4", "HxCibCrrtuI",
        "XC7j6Jl0vFo", "wzj4zEpuqqM", "XXH2d7L7NSo", "1DOM1qLoSzE", "aIRgg12zYGU", "IQy6WcuWxTw", "oXoR34iXKF4",
        "bDqVaLT3Vn0", "G1ciKi0FRgc",
        "lCa4soKWu-A", "5U2JXUVdVS4", "6vzYwilLzkA", "8nHsXnZUq5U", "Gu8epX7Y4Pk", "j7_eGlENL2o", "aS1pe7j4AhI",
        "5MDwmdS_V14", "u4ay-vOg35A",
        "aixxk2sq6vA", "ctK3PbUsZsw", "N7_WsEB3QS0", "387QrnvGmuw",
        "akMAfAXMb9k", "GmaAwIyNmD0", "OyjZ3w8m2dA", "q62_r30UYRY", "GY5AT8TipBY", "-w6tF-1sJLM", "RLnFbd5FvFY",
        "iD3u3YsRoX8", "SrKw3N29ypA", "EIxgnP8LSlY", "1Q4N7_NTJnQ",
        "d3Lt58tTYFk", "HBE4vCCMaF8", "eGAVhTrVaXg", "znSN7ZFIaOg",
        "ycOuZzBjrFA", "oqyRAWsH9k8", "c1ecSor3hvs",
        "lZ05pfjG7fA", "bfqymcyN45U", "sf-PwqNapyU", "srtEpgeTS3U", "uZNMJyT5S3M", "RI1Y2hh2IJ4",
        "-ArJ3ByI9DU", "t2VFQEIdjv4", "H0BKaVbcC8I", "xG4yiPddQXQ", "hjHoTXjvxFc", "GsUnlXBeHKU",
    ],
    441: [  # forests, woodlands, rainforests, forest ecosystems and ecology
        "7p5QctXvusY", "oo9c9HC-pmM",
        "vl_lZO7Ttb4", "cwT3MrqQ8Gg", "ULWSh8I9718", "IrdtMeGoxPo", "x-wBJnxy4Dg", "4u7eTY0WYio", "9xuinz4eeLc",
        "meA4wKRxeGU",
        "hQiVwJ2jzOw", "sWOOdc_fkpY", "sTbSqTGXZTI", "egwi83EmqNw", "nO91a5G-NQs", "OPYb6alvxSo",
        "y9HlSWmDtLw", "YPvlGnYZQDY", "mRd8_Tu7YDs", "SwBgSbPvg7Q", "EDpCLIgfHXo", "LDdKOmvIKyg",
        "SMHT7dH6If0", "9Ud9KH7D3es", "-pejpFhQEWU", "f6JmiuEMoIc", "uRcAo1RiVNs",
        "avjJqaV8B1c", "8ibgkwouP4g",
        "5TfPVzl0btA", "A01ddGNHLoE", "FDI8A5cVv4I",
        "mN_MUnFVEpA", "A3jb2k93tZM", "zsLLqQIbolI", "PwTpcrNWgWM", "o_Sj1IzIF0k", "XMW5jWZrSCw",
    ],
    442: [  # Arctic and Antarctic environments, ecosystems, geography and polar ice
        "-M5BaYY-JjU", "BtQhb8sWJNw",
        "MIAuG78hWnw", "sE-Wb4ovm-U", "ExFIViLdC6c",
        "417TChiSnNc", "nAUPJjOy0kA",
        "WEfykvqMKqk", "dvBsQHz463w", "mqsnMZeRYjo", "prwsPKVkGsQ", "4b-smpJK23k",
        "IY3mXFXd3GU", "eGkJSEOd1R4", "k7AzHDaTHHo", "EuSMfdeIuh8", "085vQpDGZdw", "owxtROejMB0", "lWxoMYHmjLs",
        "oqyRAWsH9k8", "ih-ioHw1WxU", "tpUfcrSWnE0", "w5ot-1xQFGw", "g6Tj-Nbxrrg",
        "ZV-KTMEdy3Q", "5czb9K8PEZk", "z3N1TZ2dY9s", "FsAfZxyw3r0",
        "YYJIwGACKY8", "T0qRoeEcKtY", "vj4e-HhztDk", "rn32DV-bOIc", "kz6WxTH-p3o", "osmzTSYRJJE", "bDSS8DeIziQ",
        "YZGGaLgB2io", "tO_ZHg5OCAg", "hqRdu2riNlg", "m5wB2ur1S2w", "49NPdyUEos8", "8erFXZmp7fo", "A3tV_l-zTXA",
        "Hax7EPFysqY", "HjjOzOM_Zl8", "NgyZVMIaYAM", "A1ChxLmpbz4", "gH4cYf1nVy0", "IegLor-1khs",
        "AU0eNa4GrgU", "mWxSlsLFgZQ",
    ],
    458: [  # constitutions, constitutional change, judicial power and sovereignty
        "K5G0odvmQJ0", "QUsdf6lWPwk", "5l2Iw1VmXwY", "Qs6KlbDVB3I", "3MGeMliunU4", "un7qnSXCVcQ", "vQDAssKOw7I",
        "5MtXU46DNbU", "rIKQp3gCBZw", "t5mV3qrUwdo", "KwacparrNWw",
        "ppGCbh8ggUs", "pIgMTsQXg3Q", "OPDpj59kkgk", "EDJwRUrK5ew", "sQpd9m4GBjs", "vQO-7INNkZE",
        "wOvvBWSBwU0", "eUQXo1N-OA8",
    ],
    456: [  # human rights law, civil rights and accountability for abuses
        "-CziXebc1R0", "-yXw2q_xCL0", "B5esxg0S3vk", "kdLEMQt_R8k", "p2SkZMCTVq4", "xDLtMYazlmc", "3tXiEPll-Oc",
        "SEYVkFd0T90", "8atXMqZ_w0M", "7TZefpIW20k", "oJ-hRWCSugI", "o6WiwTH-x54", "0zJaehBbvw4", "AEVy3z-6xYo",
        "_opQSHXzR_4",
    ],
    457: [  # the law of war, war crimes tribunals and international criminal justice
        "LeW3pvlxLUo", "zSqeLJCXzXI", "TN8fy50N-38", "cCEX7jV2cx8", "0aVspfOUpCw", "PSFjGXKS59Q",
    ],
    454: [  # criminal law, trials, juries, punishment and criminal defence
        "HfThLUBPsVM", "yoqSG10wP58", "1Y2rmYsMTfE", "BsTIHo-_A1k", "Im3cTV-KYWE", "8Lh2XDp2XNc", "Ocs85j0Jyxc",
        "1Y_TlU25uzw", "lAgD8pvdQ7k", "_2rokxux5cU", "r3WL_ot76CM",
    ],
    455: [  # family law, civil litigation, property in the body, copyright and civil claims
        "IPFExoEL_20", "Qvl1ZqoZqsc", "WuxbUzq1yso", "Mr3aTlsOJCk", "YupNMovMQtc", "mCy7LmX5Eq4", "Y56f-HELnkk",
        "3In6W2Iaglc", "B9jcQ3wk1yc", "p6ePMt1IGO4", "iLdSVuws0X4", "iaF0R7TiuTg", "83eE9ggE2q8", "u7Qi7t5Wabg",
        "oVW0-efpR-A", "5A_i-sB9H0Q", "zgsL5yW3bao",
    ],
    463: [  # police forces, policing practice and its history
        "X8JEREWLZ0c", "X37NsO7vD58", "3GnwTMObwkk", "oRjfiQZfWNY", "60YE55mt6iU", "KkQOl05bDaE", "xKmNwys16vc",
        "DgClGva2dao", "17R7QvIVwKI", "z6q09BNjDPc", "aScZWVio44k", "dGeICaYnuo8", "rQp-fo3fCyk",
    ],
    815: [  # ARPANET-era networks, the web's arrival and the rise and fall of early internet companies
        "ji_nzyiOKME", "zqcoPrvXSqg", "edUN8OabWCQ", "zrvqWEeQcmE", "CZTz6ZKPUl8", "Z2yr0W0BQXE", "3cJPI3Un00A",
        "ybpy-oIjiB0", "iB9LMQJ6-F8", "iI_uW0R90JI", "8T8DNQOrnAI", "tbmspfj4GvM",
    ],
    818: ["fLMJ9kAvk20", "losIILG9zsk"],  # Marconi's wireless at sea; 1980s pirate radio
    843: [  # archival interviews and films of writers
        "prRbTnX3dsw", "FJkqQiQw6G8", "XJun7546t_s", "mGcty8WJ6Vw", "VCKl4OGppnM", "U6Z6y4WSemA",
        "WWwOi17WHpE", "hcYTpKHsWpY", "Nb1w_qoioOk", "Djr89D8szlc", "qd-8ASYqb3I", "qvCArgTJMf8",
    ],
    844: [  # archival interviews and films of stage actors, directors and theatres
        "76fTFa_p5h8", "Awnv69OSXSc", "7fUwi9euQRI", "NY0U2pufa0M", "FGxaNqEUrQ0", "2T3TQxPzq8I", "HfW83fyVdzU",
        "DbQJP81P0KI", "sB--ZdmhuD8", "dca0uJQOQtM", "1Mdf-03jT5M",
    ],
}


POOLS = {
    824: STATION_SOURCES, 197: MAKING_OF_SOURCES, 234: MANGA_SOURCES, 242: ARCADE_SOURCES, 254: SF_CULTURE_SOURCES,
    454: LAW_SOURCES, 455: LAW_SOURCES, 456: LAW_SOURCES, 457: LAW_SOURCES, 458: LAW_SOURCES, 463: POLICING_SOURCES,
    815: INTERNET_HISTORY_SOURCES, 818: RADIO_HISTORY_SOURCES, 843: LITERATURE_ARCHIVE_SOURCES, 844: THEATRE_ARCHIVE_SOURCES,
}


def stations(items: list) -> list[str]:
    return [video for video, title, _s, source, *_ in items
            if source in STATION_SOURCES and STATION.search(title) and not NOT_STATION_SUBJECT.search(title)]


def main() -> None:
    doc = json.loads(CATALOGUE.read_text())
    rows = {row[0]: row for row in doc["items"]}
    routes: dict[str, list[str]] = doc.get("programmeRoutes", {})
    chosen = {824: stations(doc["items"]), **CURATED, **CURATED_P19, **CURATED_P20, **CURATED_P22}
    for channel, ids in chosen.items():
        pool = POOLS_P22.get(channel) or POOLS_P20.get(channel) or POOLS_P19.get(channel) or POOLS.get(channel, NATURE_SOURCES)
        missing = [video for video in ids if video not in rows]
        foreign = [video for video in ids if video in rows and rows[video][3] not in pool]
        if missing or foreign or len(set(ids)) != len(ids):
            raise SystemExit(f"{channel}: missing {missing} foreign {foreign} duplicates {len(ids) - len(set(ids))}")
        routes[str(channel)] = ids
        hours = sum(rows[video][2] for video in ids) / 3600
        sources: dict[str, float] = {}
        for video in ids:
            sources[rows[video][3]] = sources.get(rows[video][3], 0) + rows[video][2] / 3600
        split = ", ".join(f"{source[4:]} {value:.1f}" for source, value in sorted(sources.items(), key=lambda kv: -kv[1]))
        print(f"{channel}: {len(ids)} programmes, {hours:.1f} h, {len(sources)} sources ({split})")
    doc["programmeRoutes"] = routes
    CATALOGUE.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
