from app.ingest.espn_players import parse_adp_entries, parse_players

# Shape below is trimmed down from a real response captured live against a
# real private ESPN league.
RAW_PLAYERS = {
    "players": [
        {
            "id": 4429795,
            "onTeamId": 0,
            "player": {
                "id": 4429795,
                "fullName": "Jahmyr Gibbs",
                "defaultPositionId": 2,
                "proTeamId": 8,
                "draftRanksByRankType": {
                    "STANDARD": {"rank": 1, "rankType": "STANDARD"},
                    "PPR": {"rank": 2, "rankType": "PPR"},
                    "ELIMINATION": {"rank": 3, "rankType": "ELIMINATION"},
                    "SUPERFLEX": {"rank": 7, "rankType": "SUPERFLEX"},
                },
                "ownership": {"averageDraftPosition": 1.49, "percentOwned": 99.89},
            },
        },
        {
            "id": 4360450,
            "onTeamId": 0,
            "player": {
                "id": 4360450,
                "fullName": "Denver D/ST",
                "defaultPositionId": 16,
                "proTeamId": 7,
                "draftRanksByRankType": {
                    "STANDARD": {"rank": 150, "rankType": "STANDARD"},
                },
                "ownership": {"averageDraftPosition": 165.2, "percentOwned": 40.0},
            },
        },
        {
            "id": 4362628,
            "onTeamId": 0,
            "player": {
                "id": 4362628,
                "fullName": "Ja'Marr Chase",
                "defaultPositionId": 3,
                "proTeamId": 4,
                "draftRanksByRankType": {
                    "STANDARD": {"rank": 3, "rankType": "STANDARD"},
                    "PPR": {"rank": 1, "rankType": "PPR"},
                },
                "ownership": {"averageDraftPosition": 2.1, "percentOwned": 99.9},
            },
        },
        {
            # missing fullName -- should be skipped, like Sleeper's parser does
            "id": 999999,
            "onTeamId": 0,
            "player": {"id": 999999, "defaultPositionId": 2},
        },
    ]
}


def test_parse_players_extracts_name_position_and_team():
    records = parse_players(RAW_PLAYERS)

    assert records[0] == {
        "platform": "espn",
        "platform_player_id": "4429795",
        "name": "Jahmyr Gibbs",
        "position": "RB",
        "team": "DET",
    }


def test_parse_players_maps_wr_position():
    """Regression test: player.defaultPositionId (WR=3) is a different ESPN
    vocabulary from a roster's lineupSlotCounts slot IDs (WR=4 there) -- RB
    and DEF happen to coincide across both, which let a bug reusing the
    roster-slot map here go unnoticed until live verification against real
    WR players came back with position: null."""
    records = parse_players(RAW_PLAYERS)

    chase = next(r for r in records if r["platform_player_id"] == "4362628")
    assert chase["position"] == "WR"


def test_parse_players_maps_defense_position_and_team():
    records = parse_players(RAW_PLAYERS)

    defense = next(r for r in records if r["platform_player_id"] == "4360450")
    assert defense["position"] == "DEF"
    assert defense["team"] == "DEN"


def test_parse_players_skips_entries_missing_a_name():
    records = parse_players(RAW_PLAYERS)

    assert "999999" not in [r["platform_player_id"] for r in records]


def test_parse_adp_entries_maps_standard_and_ppr_directly():
    records = parse_adp_entries(RAW_PLAYERS, season="2026")

    gibbs = [r for r in records if r["platform_player_id"] == "4429795"]
    std = next(r for r in gibbs if r["format"] == "std")
    ppr = next(r for r in gibbs if r["format"] == "ppr")
    assert std["adp"] == 1.0
    assert ppr["adp"] == 2.0


def test_parse_adp_entries_averages_std_and_ppr_for_half_ppr():
    records = parse_adp_entries(RAW_PLAYERS, season="2026")

    gibbs = [r for r in records if r["platform_player_id"] == "4429795"]
    half_ppr = next(r for r in gibbs if r["format"] == "half_ppr")
    assert half_ppr["adp"] == 1.5  # average of std (1) and ppr (2)


def test_parse_adp_entries_omits_half_ppr_when_ppr_rank_is_missing():
    """Denver D/ST only has a STANDARD rank in the fixture -- no PPR rank
    means no half_ppr row can be derived (nothing to average against)."""
    records = parse_adp_entries(RAW_PLAYERS, season="2026")

    defense_formats = {r["format"] for r in records if r["platform_player_id"] == "4360450"}
    assert defense_formats == {"std"}


def test_parse_adp_entries_sets_the_given_season():
    records = parse_adp_entries(RAW_PLAYERS, season="2026")

    assert all(r["season"] == "2026" for r in records)
