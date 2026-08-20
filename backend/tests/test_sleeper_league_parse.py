import httpx
import pytest

from app.ingest.sleeper_league import (
    SleeperFetchError,
    fetch_raw_league,
    parse_league_meta,
    parse_team_names,
)

RAW_LEAGUE = {
    "name": "Sunday Funday",
    "season": "2026",
    "total_rosters": 10,
    "scoring_settings": {"rec": 0.5},
    "roster_positions": [
        "QB",
        "RB",
        "RB",
        "WR",
        "WR",
        "TE",
        "FLEX",
        "K",
        "DEF",
        "BN",
        "BN",
        "BN",
        "BN",
        "BN",
    ],
}

RAW_ROSTERS = [
    {"roster_id": 1, "owner_id": "111"},
    {"roster_id": 2, "owner_id": "222"},
    {"roster_id": 3, "owner_id": None},  # unclaimed slot
    {"roster_id": 4, "owner_id": "999"},  # owner not in the users list
]

RAW_USERS = [
    {"user_id": "111", "display_name": "jarhead10", "metadata": {"team_name": "Bourrow my Toe"}},
    {"user_id": "222", "display_name": "RowdyOwls", "metadata": {}},
]


def test_parse_league_meta_extracts_settings_and_suggests_format():
    meta = parse_league_meta(RAW_LEAGUE)

    assert meta == {
        "name": "Sunday Funday",
        "season": "2026",
        "num_teams": 10,
        "roster_positions": RAW_LEAGUE["roster_positions"],
        "suggested_format": "half_ppr",
    }


@pytest.mark.parametrize(
    "rec,expected",
    [(0.0, "std"), (1.0, "ppr"), (0.5, "half_ppr"), (0.75, None), (None, None)],
)
def test_parse_league_meta_maps_rec_points_to_format(rec, expected):
    raw = {**RAW_LEAGUE, "scoring_settings": {"rec": rec}}

    meta = parse_league_meta(raw)

    assert meta["suggested_format"] == expected


def test_parse_league_meta_raises_when_required_fields_missing():
    with pytest.raises(SleeperFetchError):
        parse_league_meta({"name": "Sunday Funday"})


def test_parse_team_names_uses_custom_team_name_when_set():
    team_names = parse_team_names(RAW_ROSTERS, RAW_USERS)

    assert team_names["1"] == "Bourrow my Toe"


def test_parse_team_names_falls_back_to_display_name():
    team_names = parse_team_names(RAW_ROSTERS, RAW_USERS)

    assert team_names["2"] == "RowdyOwls"


def test_parse_team_names_falls_back_to_generic_label_when_unowned():
    team_names = parse_team_names(RAW_ROSTERS, RAW_USERS)

    assert team_names["3"] == "Team 3"


def test_parse_team_names_falls_back_to_generic_label_when_owner_unknown():
    team_names = parse_team_names(RAW_ROSTERS, RAW_USERS)

    assert team_names["4"] == "Team 4"


class _FakeErrorResponse:
    """Sleeper returns a real HTTP 404 for an unknown league id (not a 200/null body)."""

    def raise_for_status(self) -> None:
        request = httpx.Request("GET", "https://api.sleeper.app/v1/league/bad-id")
        response = httpx.Response(404, request=request)
        raise httpx.HTTPStatusError("Not Found", request=request, response=response)


class _FakeErrorClient:
    def get(self, url: str) -> _FakeErrorResponse:
        return _FakeErrorResponse()

    def close(self) -> None:
        pass


def test_fetch_raw_league_raises_sleeper_fetch_error_on_http_404():
    with pytest.raises(SleeperFetchError):
        fetch_raw_league("bad-id", client=_FakeErrorClient())
