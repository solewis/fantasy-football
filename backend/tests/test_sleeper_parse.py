import json
from pathlib import Path

from app.ingest.sleeper import SLEEPER_PLAYERS_URL, fetch_raw_players, parse_players

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "sleeper_players_sample.json"


def load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text())


def test_parse_players_normalizes_known_shapes():
    records = parse_players(load_fixture())

    by_id = {r["platform_player_id"]: r for r in records}

    assert by_id["4046"] == {
        "platform": "sleeper",
        "platform_player_id": "4046",
        "name": "Patrick Mahomes",
        "position": "QB",
        "team": "KC",
    }
    # DST entries have no full_name, only first/last
    assert by_id["SF"]["name"] == "San Francisco 49ers"
    # free agents can have no team
    assert by_id["9999"]["team"] is None


def test_parse_players_skips_null_entries():
    records = parse_players(load_fixture())

    assert "0" not in {r["platform_player_id"] for r in records}
    assert len(records) == 3


class _FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return self._payload


class _FakeClient:
    def __init__(self, payload: dict):
        self._payload = payload
        self.requested_url: str | None = None

    def get(self, url: str) -> _FakeResponse:
        self.requested_url = url
        return _FakeResponse(self._payload)

    def close(self) -> None:
        pass


def test_fetch_raw_players_hits_expected_url_without_live_network():
    fake_client = _FakeClient({"1": {"full_name": "A B"}})

    raw = fetch_raw_players(client=fake_client)

    assert fake_client.requested_url == SLEEPER_PLAYERS_URL
    assert raw == {"1": {"full_name": "A B"}}
