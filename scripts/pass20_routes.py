"""Pass 20 curated routes: main-network and creator front doors, chosen per programme and frozen here.

Each channel lists its programmes explicitly. POOLS_P20 is the set of publishers a channel may draw from;
scripts/programme_reuse.py validates every id against it before writing programmeRoutes.
"""

CURATED_P20 = {
    # Learning: full-length public lectures, a few from each teaching institution
    90: [
        'pISdCeZCYEg', 'rgfsxYAMksA', 'QtELtYe0-cs', 'LCAqdqo-SJU', 'vbmzYz5dEPA', 'DaNuwuokitU', 'oVvjABccnnE', 'AMVHId-sG_8',
        'jgvZxgeTk28', '-cBo-9tCgr0', 'C3yGuoiYga0', 'eOI-o-QduZ8', 'cCG_Rvd-bn0', 'WQLFEYwZ0Qw', '_Lauwoz6Jjg', '_3iQ3zJEIko',
        'yoeTie0wJeM', 'AtnoOt1Lpdg', 'pXucMf2dEYw', 'w2NmeCP40YA', 'Qn8KxQnebdc', 'Hi7dWMveaaE', 'DZlviqZ4iN0', 'pslgRNWIWYw',
        'v_rY1Hw_3go', 'zfHno163zRo', 'MLT0EAUu4Sc', 'VrK5dOSiAaM', 'P1rCc6JCwdU', 'cbwB8-keSUI', 'ONfVTtsmQ0c', 'nD3UiG49Q4w',
        'sPOuIyEJnbE', 'lbdYg_z_SAE', 'w7DohVZS5Yo', '8IGZ_M0OOmA', 'SNHUu7YkNjA', 'NUFEBioLPf8', 'LfcKh-ZeY20', '9w0PL2_-oAE',
        'K11xZTyZL90', 'oz0ArIoEJxs', 'nYLS6p9wFEc', 'AviLsmdmS9o', 'Kaa6Uh3PAd4', 'vtA6ZD2sBrg', 'ZUdlUawXB_w', 'ZoctbsL2FdI',
        'lTFoGzWEoWQ', '5HY3-otqSkQ', 'N-J0PnXSMTE', 'NaewBVUPUIk',
    ],
    # People: biographies and portraits of individual lives, from history documentaries, archive interviews and gallery films
    27: [
        'qhv_0RY3lD0', 'wDktwJoOYQ0', '5gr4gdZ07Ws', 'cETXUcYJeWk', 'c1upClgEFv0', 'haNNjgQVk7Y', 'WAlVtU7kH-s', '41CYcn2Z2CE',
        'oRjfiQZfWNY', 'D164NeKjJjM', 'K7lb6KWBanI', 'MhUQlid4Dwc', 'neJ6VeLK1SU', 'kQdpUBhothM', 'TJFA_vE1x5Y', 'pU1gk1ocg-A',
        'ENYeIydLtWI', 'aJVLyuk2cxI', 'YV4YGUAHPJU', '8O-fna8HrWw', 'IEPL-dx1Fgo', 'wma61_wfHqg', 'ROSywiZnRV8',
    ],
    # Indie Screen: independent short films across genres (drama, horror, science fiction, animation), equal shares per publisher
    84: [
        'mDvkux01G3A', 'X9MAf245Yag', 'c0VPJWt_f0w', 'NkMWgw6hNrE', '0aw6hyul_ac', 'e6Y9y7U5tsU', 'E-ppJsZo--o', 'oEBa64jBqHU',
        'Gi__cddQCNU', 'jQlX7sS1HaY', '3xXdtyT7ugo', 'cXzOM-VYgfQ', '-wEOUb1RkF0', 'R0GVNAg6OGg', 'ZTr81xVo57E', 'dt4Nz-69_Yk',
        'dO-1s9G0jUs', 'W0FIyP85z5A', 'ZFAW7u11R38', 'D-JXaclNEcY', 'hCd47WDgAsE', 'UDnEeVpnUGM', 'ikDbeXRDuzo', '3k8_IxOotPc',
        '48N3213TAao', 'FAVgPcl78mg', 'UU5WUc2KhKc', 'dHreXXzPSUc', 'Widp-Nbki6k', 'uo-JFfsn-PM', 'o5TXdN3LayA', 'V6_9YnTDR-s',
        'TJo-xajORwY', 'px3PB383658', 'ViPefqVtHEA', 'wnMqT8QbvaM', 'jJG887Itm4Q', '1jpnXNQZrO8', 'F_Ut2nhHI5U', 'l0y_bxMjBC4',
        'AzyIZzO9zgI', 'w75oqvMlXXE', 'JPalJ2l3x7E', 'fk9-CpxAQ2c', 'CEBpjIO-bq8', 'CquXkap8Slk', '1gzU7ARL4U8', '0A0dHSncKpQ',
        'dIrNA_hy0l8', '8G6mMto8DeU',
    ],
    # Creators: creator-owned long-form online shows, a few episodes from each creator
    292: [
        'NsxtQpczK10', '3gq6dlOfLBI', 'JIUjdI6VbwQ', 'GuJwQLYY3eg', 'Se7A2p8QcLo', '9TsfaBwDwEI', 'j4CJ7h3mX4Q', '7izh06YBxHY',
        'RjkoCg0Yd4w', 'XUmgIQIpg-E', 'JrO_tvMjqjo', 'Aj8lwyWKpa4', 'iJuGkwA7S1c', 'Om3IQ5HEQ8g', 'V0Xx0E8cs7U', 'PEKbJ-_gtoM',
        'THAupOYwJTs', 'J94TqEEPp1I', 'lk83N2u1ZmY', 'onqPvEFnFHE', 'yc1XRRpGAMA', 'Xd1KxW-8Mdc', 'mpZgqd37ZEM', 'ZSC7QU4Do4Y',
        'm4nPf0Es9cI', '6BUatQ10HA4', 'Ak4on5uTaTg', 'oWIqI11wtZ8', '1DZa6ZXMa98', 'hrT2-ixBjwY', 'ghEzErwS75U', 'EfBEc3yW7Q4',
        'fSEj5lHgYYo', 'SBRHjxNKwcE', 'mer2PKN2Zdg',
    ],
    # Community: the BBC Archive's Voice of the People collection of community-access, vox-pop and public-voice programmes
    88: [
        'YQElBkdj-ac', 'PVy5DD2oTxQ', 'eoM11P9PcsU', '-p8Q7020-Sw', 'JJpQvE_aN_4', 'VpSeO8r69GY', '0-nIK9yDhlc', 'wtEs87akUKs',
        '_AS6QwpHDv4', 'WYDWVQFGbIw', 'UWOzOBKMYns', '4d9dovi7D8Y', '_KjeXqzq6p8', 's0oTGkXDvBk', '3XCl9H2J0AQ', 'SHsfhoi7LXE',
        'cWilDTam_ng', 'OVz9p31Wtws', '6yfE9Ihr8F0', 'fBQNOji9wfw', 'sG3N4ZJHDlY', 'N6s8BdsEFtc', 'HgbugbUbslY', 'b4MAE8RT9jE',
        'a5Pg92fBybA', 'LmXJdmkuBRs', '7zzc6Lg5ogs', 'N08enXSPPK8', 'ufQc_XqhwII',
    ],
    # Local: films about particular British towns, villages, seaside resorts and local life (outside the 88 collection)
    89: [
        '4BjbAyMl0oU', 'PABsDX_9U1M', '6v51ZKJanfs', 'zckpSv0Lk-0', '-Q7toD9Svro', '25TzUxZRlZk', 'rWvwFPPtNug', 'qMh_-EtZhL4',
        'EVIZ2x9W2dA', 'TjRmwA1mGBY', 'CbbTveBLe5I', 'xZ1C1YKm44Q', 'CvvQ3g8vyko', 'T2wskV22YVM', 'VqwuhH4neXg', 'o29mV4mihKo',
        'XDFkrMc2RN4', 'JtyPadvikJo', 'GkMNvBXokqI', 'opUGAkWyGHE', 'pVebsID16Eg', 'iKy4Zml7SaQ', 'KagG_ogr0Wc', 'tf8PjlOeAYY',
        'fpAelSmJavM',
    ],
}

POOLS_P20 = {
    90: {'src_gresham_crime', 'src_gresham_law', 'src_gresham_medicine', 'src_gresham_politics', 'src_harvard_chan', 'src_lbs', 'src_royal_institution', 'src_school_of_life', 'src_ted'},
    27: {'src_bbc_archive', 'src_bfi', 'src_epic_history', 'src_national_gallery', 'src_nfb', 'src_timeline'},
    84: {'src_alter', 'src_dust', 'src_nfb', 'src_omeleto'},
    292: {'src_cruising_the_cut', 'src_exploring_alternatives', 'src_mark_wiens', 'src_nerdwriter', 'src_patrick_boyle', 'src_tasting_history', 'src_wendover'},
    88: {'src_bbc_archive'},
    89: {'src_bbc_archive', 'src_british_movietone', 'src_huntley_events', 'src_huntley_social', 'src_thames_tv', 'src_travel_film_archive'},
}
