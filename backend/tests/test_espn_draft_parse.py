import httpx
import pytest

from app.ingest.espn_draft import (
    ESPNDraftFetchError,
    fetch_raw_draft,
    parse_draft_meta,
    parse_picks,
    resolve_platform_draft_id,
)

# Shape below is trimmed down (2 teams/2 rounds) from a real response captured
# live against a real private ESPN league (12 teams/15 rounds, snake, not yet
# started) -- draftDetail.picks is fully pre-populated with playerId: -1 for
# every not-yet-made pick, confirmed live.
RAW_DRAFT = {
    "seasonId": 2026,
    "settings": {"draftSettings": {"type": "SNAKE"}},
    "draftDetail": {
        "drafted": False,
        "inProgress": False,
        "picks": [
            {
                "overallPickNumber": 1,
                "roundId": 1,
                "roundPickNumber": 1,
                "teamId": 10,
                "playerId": -1,
            },
            {
                "overallPickNumber": 2,
                "roundId": 1,
                "roundPickNumber": 2,
                "teamId": 3,
                "playerId": 4046,
            },
            {
                "overallPickNumber": 3,
                "roundId": 2,
                "roundPickNumber": 1,
                "teamId": 3,
                "playerId": -1,
            },
            {
                "overallPickNumber": 4,
                "roundId": 2,
                "roundPickNumber": 2,
                "teamId": 10,
                "playerId": -1,
            },
        ],
    },
}


def test_resolve_platform_draft_id_is_the_identity():
    """ESPN has no separate draft object -- the league id doubles as the
    draft id, unlike Sleeper's separate draft_id lookup."""
    assert resolve_platform_draft_id("2026:1963950844") == "2026:1963950844"


def test_parse_draft_meta_extracts_season_teams_rounds():
    meta = parse_draft_meta(RAW_DRAFT)

    assert meta["season"] == "2026"
    assert meta["num_teams"] == 2
    assert meta["num_rounds"] == 2


def test_parse_draft_meta_derives_slot_to_team_id_from_round_one():
    meta = parse_draft_meta(RAW_DRAFT)

    assert meta["slot_to_team_id"] == {"1": 10, "2": 3}


def test_parse_draft_meta_raises_on_auction_league():
    raw = {
        **RAW_DRAFT,
        "settings": {"draftSettings": {"type": "AUCTION"}},
    }

    with pytest.raises(ESPNDraftFetchError, match="snake"):
        parse_draft_meta(raw)


def test_parse_draft_meta_raises_when_no_picks_configured():
    raw = {**RAW_DRAFT, "draftDetail": {"picks": []}}

    with pytest.raises(ESPNDraftFetchError):
        parse_draft_meta(raw)


def test_parse_picks_skips_unmade_picks():
    """playerId: -1 means "not yet picked" -- ESPN pre-populates every slot,
    unlike Sleeper's picks endpoint which simply omits them."""
    records = parse_picks(RAW_DRAFT)

    assert records == [{"pick_number": 2, "platform_player_id": "4046"}]


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


def test_fetch_raw_draft_raises_on_404():
    with pytest.raises(ESPNDraftFetchError):
        fetch_raw_draft("2026:9999999999", client=_FakeErrorClient(404))
