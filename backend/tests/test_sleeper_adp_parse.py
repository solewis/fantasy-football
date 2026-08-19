import json
from pathlib import Path

from app.ingest.sleeper_adp import (
    PROJECTIONS_URL_TEMPLATE,
    fetch_raw_projections,
    parse_adp_entries,
)

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "sleeper_projections_sample.json"


def load_fixture() -> list[dict]:
    return json.loads(FIXTURE_PATH.read_text())


def test_parse_adp_entries_extracts_all_real_formats_for_a_player():
    records = parse_adp_entries(load_fixture(), season="2026")

    lamar_records = {r["format"]: r["adp"] for r in records if r["platform_player_id"] == "4881"}

    assert lamar_records == {
        "std": 15.0,
        "ppr": 24.7,
        "half_ppr": 22.9,
        "2qb": 3.6,
        "dynasty_std": 7.9,
    }
    assert all(r["platform"] == "sleeper" and r["season"] == "2026" for r in records)


def test_parse_adp_entries_skips_unranked_sentinel_values():
    records = parse_adp_entries(load_fixture(), season="2026")

    lamar_formats = {r["format"] for r in records if r["platform_player_id"] == "4881"}

    assert "dynasty" not in lamar_formats
    assert "rookie" not in lamar_formats


def test_parse_adp_entries_keeps_high_but_real_adp_values():
    records = parse_adp_entries(load_fixture(), season="2026")

    deep_bench = [r for r in records if r["platform_player_id"] == "9999"]

    assert deep_bench == [
        {
            "platform": "sleeper",
            "platform_player_id": "9999",
            "season": "2026",
            "format": "std",
            "adp": 210.5,
        }
    ]


def test_parse_adp_entries_skips_rows_without_player_id():
    records = parse_adp_entries(load_fixture(), season="2026")

    assert all(r["platform_player_id"] != "" for r in records)
    assert not any(r["adp"] == 50.0 for r in records)


def test_parse_adp_entries_skips_rows_without_stats():
    records = parse_adp_entries(load_fixture(), season="2026")

    assert not any(r["platform_player_id"] == "1234" for r in records)


class _FakeResponse:
    def __init__(self, payload: list[dict]):
        self._payload = payload

    def raise_for_status(self) -> None:
        pass

    def json(self) -> list[dict]:
        return self._payload


class _FakeClient:
    def __init__(self, payload: list[dict]):
        self._payload = payload
        self.requested_url: str | None = None
        self.requested_params: list[tuple[str, str]] | None = None

    def get(self, url: str, params: list[tuple[str, str]]) -> _FakeResponse:
        self.requested_url = url
        self.requested_params = params
        return _FakeResponse(self._payload)

    def close(self) -> None:
        pass


def test_fetch_raw_projections_hits_expected_url_and_params_without_live_network():
    fake_client = _FakeClient([{"player_id": "1", "stats": {"adp_std": 1.0}}])

    raw = fetch_raw_projections("2026", positions=["QB", "RB"], client=fake_client)

    assert fake_client.requested_url == PROJECTIONS_URL_TEMPLATE.format(season="2026")
    assert ("season_type", "regular") in fake_client.requested_params
    assert ("position[]", "QB") in fake_client.requested_params
    assert ("position[]", "RB") in fake_client.requested_params
    assert raw == [{"player_id": "1", "stats": {"adp_std": 1.0}}]
