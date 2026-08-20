import httpx
import pytest

from app.ingest.sleeper_draft import (
    SleeperFetchError,
    fetch_raw_draft,
    parse_draft_meta,
    parse_picks,
)

RAW_DRAFT = {
    "type": "snake",
    "status": "drafting",
    "season": "2026",
    "settings": {"teams": 10, "rounds": 14},
    "draft_id": "123456789",
    "slot_to_roster_id": {"1": 10, "2": 3},
}

RAW_PICKS = [
    {
        "pick_no": 1,
        "round": 1,
        "draft_slot": 1,
        "roster_id": 3,
        "player_id": "4046",
        "metadata": {"first_name": "Patrick", "last_name": "Mahomes"},
    },
    {
        "pick_no": 2,
        "round": 1,
        "draft_slot": 2,
        "roster_id": 7,
        "player_id": "SF",
        "metadata": {"first_name": "San Francisco", "last_name": "49ers"},
    },
    # Future/unmade pick placeholder -- no player selected yet.
    {
        "pick_no": 3,
        "round": 1,
        "draft_slot": 3,
        "roster_id": 1,
        "player_id": None,
        "metadata": {},
    },
]


def test_parse_draft_meta_extracts_season_teams_rounds():
    meta = parse_draft_meta(RAW_DRAFT)

    assert meta == {
        "season": "2026",
        "num_teams": 10,
        "num_rounds": 14,
        "slot_to_roster_id": {"1": 10, "2": 3},
    }


def test_parse_draft_meta_raises_when_settings_missing():
    with pytest.raises(SleeperFetchError):
        parse_draft_meta({"season": "2026", "settings": {}})


def test_parse_draft_meta_defaults_slot_to_roster_id_to_empty_pre_draft():
    raw = {**RAW_DRAFT, "slot_to_roster_id": None}

    meta = parse_draft_meta(raw)

    assert meta["slot_to_roster_id"] == {}


def test_parse_picks_normalizes_made_picks():
    records = parse_picks(RAW_PICKS)

    assert records == [
        {"pick_number": 1, "platform_player_id": "4046"},
        {"pick_number": 2, "platform_player_id": "SF"},
    ]


def test_parse_picks_skips_picks_with_no_player():
    records = parse_picks(RAW_PICKS)

    assert all(r["pick_number"] != 3 for r in records)


class _FakeErrorResponse:
    """Sleeper returns a real HTTP 404 for an unknown draft id (not a 200/null body)."""

    def raise_for_status(self) -> None:
        request = httpx.Request("GET", "https://api.sleeper.app/v1/draft/bad-id")
        response = httpx.Response(404, request=request)
        raise httpx.HTTPStatusError("Not Found", request=request, response=response)


class _FakeErrorClient:
    def get(self, url: str) -> _FakeErrorResponse:
        return _FakeErrorResponse()

    def close(self) -> None:
        pass


def test_fetch_raw_draft_raises_sleeper_fetch_error_on_http_404():
    with pytest.raises(SleeperFetchError):
        fetch_raw_draft("bad-id", client=_FakeErrorClient())
