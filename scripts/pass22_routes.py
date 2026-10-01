"""Pass 22 curated routes: the remaining front doors, chosen per programme and frozen here.

Selected once by a deterministic rule (hash order within each publisher, excluded subjects removed, disjoint from every
other curated list). POOLS_P22 is the set of publishers each channel may draw from; scripts/programme_reuse.py validates
every id against it before writing programmeRoutes.
"""

CURATED_P22 = {
    # Archive: the main-network front door for archive television, a few programmes from each archive broadcaster
    19: [
        'ur8zm-q5ROo', 'BwFD66SMBUM', '2ougxJ9GPKY', 'Z7vCu_4Hd6g', 'yQesCbCXyTM', 'pa8-Frhk5-E', 'SrU9t7oHaXo', 'AkuxXmrbHwY',
        'OG2cIYmuHlc', 'yOA3NR6rQ28', '7YegRvoNiLY', 'LFc08Xj6XPw', '_jr5-93WVpY', 'QOK_NmGSVc8', 'zD7OgAdCObs', 'uVZ6nE1lRTg',
        'BUnaZkdzXBA', 'FAoCwLrPhrY', '8K2MXsKFzkQ', '4QX64YbqGUo', 'XKpoSsTNdew', 'U3T-pk9-Rfo', '8qsph1qw_4o', 'uHekt82_Ee8',
        'W0c3sQyn2wo', 'z0QqifHG3F8',
    ],
    # Geography Mix: a rotating geography magazine, a few programmes from each geography channel publisher
    61: [
        '84qrX75K5UY', 'j-h5uJdPjT4', '47qIuIfUkOQ', 'DOGe_znM4OU', 'qLyU_uTlp2Q', 't4WDCc_UHds', 'b-oL5Tw9M7A', 'DbiI9ainetY',
        'aMbG6RwYy-Q', 'XPHgT3W_OXw', 'UvgDyYfMW0s', 'H3ZxWolRkJM', 'ofI6-bL3pqY', 'GCZbU8wpwpw', 'E3rUsooxV40', 'eLhZjFNsUOc',
        'hXnfhL8Yy44', 'nlgEpZ9QbfA', 'RR2VQOV5tM4', 'mm5Yt28Z_hg', 'F6OE2WXAc6s', 'dSfdhWUZKfQ', 'pR5D6FZIaOI',
    ],
    # Magazine: magazine-format strands only (This Morning; BBC Tonight, Nationwide, Tomorrow's World, Wogan, Film 93)
    78: [
        'Po3pcCNDAMU', 'X4xNTIiGThY', 'KKMHdXBxW2Y', 'YSqeVcEMzH4', 'WXkqdVR735w', '73KvLWM-vlY', '27nNGwZTWI4', 'WgbvBsv3zFw',
        '1X6VSIHdg1I', 'ycqCwgXE4wU', 'ZgdKkOK9Mtg', 'V_NIPrmV4tA', '3oXhw8m-3rk', '2gBZtsJEaTo', 'hkjtsP3v5KE', 'Haow7PXR89w',
        'grhcGPYLPYg', 'DPS6MjtOIuc', 'xhq2x_8M9t8', 'pXGlybglr28', 'BmVN5NRx3wg', 'DADDxdxxgiQ',
    ],
    # Specialist: the specialist category front door, two programmes from each specialist home publisher
    800: [
        '0BFQcdfAMa4', '1fsK8LjAtp8', 'dln2dQyLNVU', '4qT0e9j826g', 'LjYYkd4T5wo', 'Jt9w-0gquoA', 'QLJSdNYcdpk', 'WVnwfwXnNiQ',
        'B30W9j2LsIY', 'R2fw2g6WFbg', 'paHTRIgWYFE', 'MKGQfcUhLU4', 'iHkak1OL4nQ', 'zFajtbe-TKg', '0VrCh92NrQY', 'dkDv7XKxQGA',
        '7gUm6zdmiCY', 'RkBuQA90fMo', '1cFT_jnH2Ok', '_8KIU9p3fc0', '7YyuKmkYbtk', '5TNWjQLj9Cw', 'tXYX5YXjYaA', 'Vz343kVzU5I',
        's3Ai-VjmRPo', 'IA0sWopdLxs', 'Vsv1C-k9Bo4', 'PgMmKHD3-oQ', '4GUj_PX8zBY', 'd86Dj3d4gbM', 'zcStxzHaliM', '3QAuyIe6w_g',
        'mP17z3SRJNs', 'BkxEP_K85hk',
    ],
    # Bands: one official video per act that Wikidata records as a musical group (scripts/data/wikidata-song-performers.json)
    564: [
        'AOh9LHhpryM', 'Wm54XyLwBAk', 'gvsaWu_dBqE', '2Ui_Q4qBDJY', 'MEb2CecR11I', 'nREV8bQJ1MA', 'Oc6zXSdYXm8', 'txTqtm58AqM',
        'Uhpu2N4rQZM', 'Ij0bj7SpP0w', 'ZpUYjpKg9KY', 'THtqUDitQ4I', 'HR5J5jUDcnA', 'ETxmCCsMoD0', 'DXvMT_mVbqw', 'Jfoxsfhi-kk',
        'Vjw92oUduEM', 'qnkuBUAwfe0', '6dLf45s67hM', '9wPHxQMgdKs', 'UelDrZ1aFeY', 'pkcJEvMcnEg', 'zjpSX6fCPDc', 'd7ew_jIxLa8',
        '-uT9LfvGx5I', 'nddTokI9hHY', 'XEwGPe0H_po', 'LWJYaep-0sg', 'Te3_VlimRw0', 'hxhdhBRP06Y', 'fYSazphh_C8', 'mXuUAtAtMtM',
        'IN0KkGeEURw', 'oIIxlgcuQRU', 'OSNVo6bZGUs', 'pO-3U5m9N0w', 'i5pUOVC50Y8', 'NZ8XxTkXc2c', 'YYtBF1OVciU', '6dOwHzCHfgA',
        'pIgZ7gMze7A', 'XJGTwhl1Nrw', '9wfpXI5PKlw', '7v2GDbEmjGE', 'Q2H6pTtEVlo', '3Wj8Yxa309E', 'gaL-G9zVxzk', 'yt9Ma1W_0wI',
        'V1O726-a0UI', 'CDl9ZMfj6aE', 'WDswiT87oo8', 'btPJPFnesV4', 'l5aZJBLAu1E', 'lgCZN1rU5co', 'hgnhVcyLy1I', '9NDjt4FzFWY',
        'Rn8kmgv8xjM', 'uIbXvaE39wM', 'L3hYEwCmMhY', 'wxoKS5cmEZU', 'kwEZRPkAAu8', '3YxaaGgTQYM', 'LGD9i718kBU', 'X4hm52SP-ls',
        'M43wsiNBwmo', 'NHozn0YXAeE', 'ZyhrYis509A', '2judm5t9Qdo', 'ttggMJeUAo4', 'X5z-jjWyAJQ', '8lnviIWjliE', 'SnMyroAH0rg',
        'aCcO5F4FaHI', 'Xi8O7JdA4Sg', 'd8ekz_CSBVg', 'Ff9efKdyz84', 'BJk6gZuPKRE', 'JkK8g6FMEXE', 'bQiGqGMT8i4', 'Q3V8yvAJ-DQ',
        'RLhFT7YXnoI', '9GkVhgIeGJQ', '4JkIs37a2JE', 'bohVV_KlSHw', 'iAP9AF6DCu4', 'w-rv2BQa2OU', 'apBWI6xrbLY', 'UULIfPLMuDw',
        'QKmaG5f9Zsg', '7QU1nvuxaMA', 'qCHPBDN2Tp0', 'aFkcAH-m9W0', 'ujNeHIo7oTE', 'qBwDf8lwYkU', '2Rkx6b5vFdQ', 'qZCPgfEZvzQ',
        'vF3MB0U6DO8', 'WQnAxOQxQIU', 'YUXH2DqVOC8', 'Oextk-If8HQ', '_50-gOeBilc', 'JFxH4kky6z4', 'N2ICtCO8TCw', 'XJCWdqZ0RSg',
        '6FEDrU85FLE', 'zI4D1QOLGuM',
    ],
}

POOLS_P22 = {
    19: {'src_bbc_archive', 'src_dick_cavett', 'src_johnny_carson', 'src_thames_tv'},
    61: {'src_arte_travel', 'src_city_beautiful', 'src_free_documentary_travel', 'src_geography_now', 'src_geologyhub', 'src_schmidt_ocean', 'src_usgs'},
    78: {'src_bbc_archive', 'src_this_morning'},
    800: {'src_8bit_guy', 'src_92ny_books', 'src_american_theatre_wing', 'src_british_museum', 'src_chicago_film_archives', 'src_cruising_the_cut', 'src_eevblog', 'src_huntley_architecture', 'src_huntley_industrial', 'src_huntley_motoring', 'src_huntley_transport', 'src_national_gallery', 'src_network_rail', 'src_oceanliner_designs', 'src_severn_valley', 'src_tv_academy_interviews', 'src_us_national_archives'},
    564: {'src_aerosmith', 'src_arctic_monkeys', 'src_beach_boys', 'src_bee_gees', 'src_blur', 'src_bon_jovi', 'src_def_leppard', 'src_foo_fighters', 'src_guns_n_roses', 'src_imagine_dragons', 'src_insideout', 'src_jimmy_eat_world', 'src_khruangbin', 'src_kiss', 'src_motley_crue', 'src_my_bloody_valentine', 'src_my_chemical_romance', 'src_nine_inch_nails', 'src_nirvana', 'src_nuclear_blast', 'src_oasis', 'src_pearl_jam', 'src_rem', 'src_rhcp', 'src_rolling_stones', 'src_sigur_ros', 'src_smashing_pumpkins', 'src_soundgarden', 'src_the_beatles', 'src_the_cure', 'src_the_specials', 'src_vevo_2000s', 'src_vevo_80s', 'src_vevo_90s', 'src_vevo_abba', 'src_vevo_blondie', 'src_vevo_bob_marley', 'src_vevo_classics', 'src_zero_7'},
}
