from app.matching.candidates import build_exact_index, build_index
from app.matching.resolve import AUTO_MATCHED, CONFIRMED_NO_MATCH, NEEDS_REVIEW, resolve_one

PLATFORM_PLAYERS = [
    {"platform_player_id": "1", "name": "Patrick Mahomes", "position": "QB", "team": "KC"},
    # Two real players can share an exact name — position must disambiguate.
    {"platform_player_id": "2", "name": "Josh Allen", "position": "QB", "team": "BUF"},
    {"platform_player_id": "3", "name": "Josh Allen", "position": "LB", "team": "JAX"},
    {"platform_player_id": "SF", "name": "San Francisco 49ers", "position": "DEF", "team": "SF"},
]


def make_indexes():
    fuzzy_index = build_index(PLATFORM_PLAYERS)
    exact_index = build_exact_index(fuzzy_index)
    return exact_index, fuzzy_index


def test_unambiguous_exact_match_auto_resolves():
    exact_index, fuzzy_index = make_indexes()

    result = resolve_one("Patrick Mahomes II", "QB", exact_index, fuzzy_index)

    assert result["status"] == AUTO_MATCHED
    assert result["platform_player_id"] == "1"


def test_ambiguous_exact_match_without_position_needs_review():
    exact_index, fuzzy_index = make_indexes()

    result = resolve_one("Josh Allen", None, exact_index, fuzzy_index)

    assert result["status"] == NEEDS_REVIEW
    assert {c["platform_player_id"] for c in result["candidates"]} == {"2", "3"}


def test_ambiguous_exact_match_disambiguated_by_position():
    exact_index, fuzzy_index = make_indexes()

    result = resolve_one("Josh Allen", "LB", exact_index, fuzzy_index)

    assert result["status"] == AUTO_MATCHED
    assert result["platform_player_id"] == "3"


def test_obvious_typo_auto_matches_on_the_fuzzy_path():
    """ "Patric Mahomes" scores 100 against the QB with a 60-point margin over
    the runner-up. Sending that to a human is the friction that made a 400-row
    import not worth doing -- see AUTO_MATCH_SCORE.
    """
    exact_index, fuzzy_index = make_indexes()

    result = resolve_one("Patric Mahomes", "QB", exact_index, fuzzy_index)

    assert result["status"] == AUTO_MATCHED
    assert result["platform_player_id"] == "1"


def test_fuzzy_match_without_a_position_never_auto_matches():
    """A row with no position can't be checked against anything, and a high
    score alone is how a WR gets matched to a similarly-named linebacker.
    """
    exact_index, fuzzy_index = make_indexes()

    result = resolve_one("Patric Mahomes", None, exact_index, fuzzy_index)

    assert result["status"] == NEEDS_REVIEW
    assert result["candidates"][0]["platform_player_id"] == "1"


def test_fuzzy_match_below_the_threshold_still_needs_review():
    exact_index, fuzzy_index = make_indexes()

    result = resolve_one("Pat Mahone", "QB", exact_index, fuzzy_index)

    assert result["status"] == NEEDS_REVIEW


def test_two_near_tied_candidates_at_the_same_position_need_review():
    """Margin guard. "Tyler Johnsen" scores 97.3 against Johnson and 93.9
    against Johnston -- both above the score floor, 3.4 apart. Without the
    margin check whichever scored a hair higher would silently win, and there
    is no way to tell from the file which was meant.
    """
    players = [
        {"platform_player_id": "1", "name": "Tyler Johnson", "position": "WR", "team": "TB"},
        {"platform_player_id": "2", "name": "Tyler Johnston", "position": "WR", "team": "NYJ"},
    ]
    fuzzy_index = build_index(players)
    exact_index = build_exact_index(fuzzy_index)

    result = resolve_one("Tyler Johnsen", "WR", exact_index, fuzzy_index)

    assert result["status"] == NEEDS_REVIEW
    assert {c["platform_player_id"] for c in result["candidates"]} == {"1", "2"}


def test_dst_entry_matches_the_full_team_name():
    """ "49ers D/ST" against "San Francisco 49ers" is the subset-of-tokens case
    token_set_ratio was chosen for; it scores 100 and auto-matches.
    """
    exact_index, fuzzy_index = make_indexes()

    result = resolve_one("49ers D/ST", "DEF", exact_index, fuzzy_index)

    assert result["status"] == AUTO_MATCHED
    assert result["platform_player_id"] == "SF"


def test_previously_confirmed_mapping_short_circuits_to_auto_matched():
    exact_index, fuzzy_index = make_indexes()

    result = resolve_one(
        "Some Weird Nickname",
        None,
        exact_index,
        fuzzy_index,
        mapped_player_id="1",
        has_mapping=True,
    )

    assert result["status"] == AUTO_MATCHED
    assert result["platform_player_id"] == "1"
    assert result["candidates"] == []


def test_previously_confirmed_no_match_short_circuits():
    exact_index, fuzzy_index = make_indexes()

    result = resolve_one(
        "Definitely Not A Player", None, exact_index, fuzzy_index, has_mapping=True
    )

    assert result["status"] == CONFIRMED_NO_MATCH
    assert result["platform_player_id"] is None
