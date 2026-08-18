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


def test_typo_falls_back_to_fuzzy_and_needs_review():
    exact_index, fuzzy_index = make_indexes()

    result = resolve_one("Patric Mahomes", "QB", exact_index, fuzzy_index)

    assert result["status"] == NEEDS_REVIEW
    assert result["candidates"][0]["platform_player_id"] == "1"


def test_dst_entry_surfaces_as_top_fuzzy_candidate():
    exact_index, fuzzy_index = make_indexes()

    result = resolve_one("49ers D/ST", "DEF", exact_index, fuzzy_index)

    assert result["status"] == NEEDS_REVIEW
    assert result["candidates"][0]["platform_player_id"] == "SF"


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
