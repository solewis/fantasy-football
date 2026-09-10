from datetime import UTC, datetime

from app import sync_service
from app.models import League


def fake_sleeper_sync(count: int):
    def _sync(session):
        return count

    return _sync


def fake_sleeper_adp_sync(count: int):
    def _sync(session, season):
        return count

    return _sync


def fake_espn_players_sync(players_count: int, adp_count: int):
    def _sync(session, platform_league_id, season):
        return {"players_synced": players_count, "adp_synced": adp_count}

    return _sync


def seed_espn_league(session_factory) -> int:
    session = session_factory()
    league = League(
        platform="espn",
        platform_league_id="2026:999",
        name="The Denver League",
        season="2026",
        format="half_ppr",
        num_teams=12,
        roster_positions=["QB"],
        team_names={},
        rank_set_id=None,
        created_at=datetime.now(UTC),
    )
    session.add(league)
    session.commit()
    session.refresh(league)
    league_id = league.id
    session.close()
    return league_id


def test_sync_status_reports_never_synced_initially(api_client):
    client, _session_factory = api_client

    response = client.get("/sync/status", params={"season": "2026"})

    assert response.status_code == 200
    body = response.json()
    assert body["players"] == {"last_synced_at": None, "record_count": 0}
    assert body["adp"] == {"season": "2026", "last_synced_at": None, "record_count": 0}
    assert body["espn_players"] == {"last_synced_at": None, "record_count": 0}


def test_trigger_players_sync_then_status_reflects_it(api_client, monkeypatch):
    client, _session_factory = api_client
    monkeypatch.setattr(sync_service.sleeper, "sync", fake_sleeper_sync(11))

    sync_response = client.post("/sync/players")
    assert sync_response.status_code == 200
    assert sync_response.json()["record_count"] == 11
    assert sync_response.json()["last_synced_at"] is not None

    status_response = client.get("/sync/status", params={"season": "2026"})
    assert status_response.json()["players"]["last_synced_at"] is not None


def test_trigger_adp_sync_then_status_reflects_it(api_client, monkeypatch):
    client, _session_factory = api_client
    monkeypatch.setattr(sync_service.sleeper_adp, "sync", fake_sleeper_adp_sync(9))

    sync_response = client.post("/sync/adp", params={"season": "2026"})
    assert sync_response.status_code == 200
    body = sync_response.json()
    assert body["season"] == "2026"
    assert body["record_count"] == 9
    assert body["last_synced_at"] is not None

    status_response = client.get("/sync/status", params={"season": "2026"})
    assert status_response.json()["adp"]["last_synced_at"] is not None


def test_trigger_espn_players_sync_then_status_reflects_it(api_client, monkeypatch):
    client, session_factory = api_client
    seed_espn_league(session_factory)
    monkeypatch.setattr(sync_service.espn_players, "sync", fake_espn_players_sync(6, 6))

    sync_response = client.post("/sync/espn-players")
    assert sync_response.status_code == 200
    body = sync_response.json()
    assert body["record_count"] == 6
    assert body["adp_record_count"] == 6
    assert body["last_synced_at"] is not None

    status_response = client.get("/sync/status", params={"season": "2026"})
    assert status_response.json()["espn_players"]["last_synced_at"] is not None


def test_trigger_espn_players_sync_without_a_saved_league_is_400(api_client):
    client, _session_factory = api_client

    response = client.post("/sync/espn-players")

    assert response.status_code == 400
