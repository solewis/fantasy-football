import httpx
import pytest

from app.ingest.espn_league import (
    ESPNFetchError,
    fetch_raw_league,
    normalize_platform_league_id,
    parse_league_meta,
    parse_team_names,
)

# Shapes below are trimmed down from a real response captured live against a
# real private ESPN league (half-PPR, 12 teams, standard roster).
RAW_LEAGUE = {
    "seasonId": 2026,
    "settings": {
        "name": "The Denver League",
        "size": 12,
        "isPublic": False,
        "rosterSettings": {
            "lineupSlotCounts": {
                "0": 1,  # QB
                "2": 2,  # RB
                "4": 2,  # WR
                "6": 1,  # TE
                "16": 1,  # D/ST -> DEF
                "17": 1,  # K
                "20": 6,  # BE -> BN
                "21": 1,  # IR -> BN
                "23": 1,  # RB/WR/TE -> FLEX
                "8": 0,  # unused (DT) -- should contribute nothing
            }
        },
        "scoringSettings": {
            "scoringItems": [
                {"statId": 43, "points": 6.0},
                {"statId": 53, "points": 0.5},  # Receptions -- half PPR
                {"statId": 42, "points": 0.1},
            ]
        },
    },
    "teams": [
        {"id": 1, "name": "Dime Time"},
        {"id": 2, "name": "IcePicks9595's Team"},
    ],
}


def test_parse_league_meta_extracts_settings_and_suggests_format():
    meta = parse_league_meta(RAW_LEAGUE)

    assert meta["name"] == "The Denver League"
    assert meta["season"] == "2026"
    assert meta["num_teams"] == 12
    assert meta["suggested_format"] == "half_ppr"


def test_parse_league_meta_expands_slot_counts_into_flat_array():
    meta = parse_league_meta(RAW_LEAGUE)

    positions = meta["roster_positions"]
    assert positions.count("QB") == 1
    assert positions.count("RB") == 2
    assert positions.count("WR") == 2
    assert positions.count("TE") == 1
    assert positions.count("DEF") == 1
    assert positions.count("K") == 1
    assert positions.count("FLEX") == 1
    # bench (20) + IR (21) both fold into "BN"
    assert positions.count("BN") == 7
    # a zero-count slot type contributes nothing
    assert "DT" not in positions
    assert len(positions) == 1 + 2 + 2 + 1 + 1 + 1 + 1 + 7


@pytest.mark.parametrize(
    "points,expected",
    [(0.0, "std"), (1.0, "ppr"), (0.5, "half_ppr"), (0.75, None)],
)
def test_parse_league_meta_maps_reception_points_to_format(points, expected):
    raw = {
        **RAW_LEAGUE,
        "settings": {
            **RAW_LEAGUE["settings"],
            "scoringSettings": {"scoringItems": [{"statId": 53, "points": points}]},
        },
    }

    meta = parse_league_meta(raw)

    assert meta["suggested_format"] == expected


def test_parse_league_meta_raises_when_required_fields_missing():
    with pytest.raises(ESPNFetchError):
        parse_league_meta({"settings": {"name": "The Denver League"}})


def test_parse_team_names_uses_the_teams_own_name():
    team_names = parse_team_names(RAW_LEAGUE)

    assert team_names == {"1": "Dime Time", "2": "IcePicks9595's Team"}


def test_normalize_platform_league_id_combines_bare_id_with_default_season():
    normalized = normalize_platform_league_id("1963950844")

    assert normalized == "2026:1963950844"


def test_normalize_platform_league_id_is_idempotent():
    already_normalized = normalize_platform_league_id("2025:1963950844")

    assert already_normalized == "2025:1963950844"


def test_fetch_raw_league_raises_on_malformed_id():
    with pytest.raises(ESPNFetchError):
        fetch_raw_league("not-a-valid-id")


class _FakeErrorResponse:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code

    def raise_for_status(self) -> None:
        request = httpx.Request("GET", "https://lm-api-reads.fantasy.espn.com/...")
        response = httpx.Response(self.status_code, request=request)
        raise httpx.HTTPStatusError("error", request=request, response=response)


class _FakeErrorClient:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code

    def get(self, url: str, **kwargs) -> _FakeErrorResponse:
        return _FakeErrorResponse(self.status_code)

    def close(self) -> None:
        pass


def test_fetch_raw_league_raises_a_clear_error_on_401():
    with pytest.raises(ESPNFetchError, match="espn_s2/SWID"):
        fetch_raw_league("2026:1963950844", client=_FakeErrorClient(401))


def test_fetch_raw_league_raises_on_404():
    with pytest.raises(ESPNFetchError):
        fetch_raw_league("2026:9999999999", client=_FakeErrorClient(404))
