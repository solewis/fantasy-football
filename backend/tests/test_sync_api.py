from app import sync_service


def fake_sleeper_sync(count: int):
    def _sync(session):
        return count

    return _sync


def fake_sleeper_adp_sync(count: int):
    def _sync(session, season):
        return count

    return _sync


def test_sync_status_reports_never_synced_initially(api_client):
    client, _session_factory = api_client

    response = client.get("/sync/status", params={"season": "2026"})

    assert response.status_code == 200
    body = response.json()
    assert body["players"] == {"last_synced_at": None, "record_count": 0}
    assert body["adp"] == {"season": "2026", "last_synced_at": None, "record_count": 0}


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
