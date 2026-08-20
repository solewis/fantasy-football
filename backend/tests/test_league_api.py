from app.ingest import sleeper_league


def stub_sleeper(monkeypatch, meta=None, team_names=None):
    default_meta = {
        "name": "Sunday Funday",
        "season": "2026",
        "num_teams": 10,
        "roster_positions": ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"],
        "suggested_format": "half_ppr",
    }
    monkeypatch.setattr(sleeper_league, "fetch_raw_league", lambda league_id: {"stub": True})
    monkeypatch.setattr(sleeper_league, "parse_league_meta", lambda raw: meta or default_meta)
    monkeypatch.setattr(sleeper_league, "fetch_raw_rosters", lambda league_id: [])
    monkeypatch.setattr(sleeper_league, "fetch_raw_users", lambda league_id: [])
    monkeypatch.setattr(
        sleeper_league,
        "parse_team_names",
        lambda rosters, users: team_names if team_names is not None else {"1": "Team 1"},
    )


def create_league(client, **overrides):
    payload = {"platform_league_id": "999", "format": "half_ppr"}
    payload.update(overrides)
    response = client.post("/leagues", json=payload)
    assert response.status_code == 200
    return response.json()


def test_get_league_lookup_returns_preview(api_client, monkeypatch):
    client, _session_factory = api_client
    stub_sleeper(monkeypatch)

    response = client.get("/leagues/lookup", params={"platform_league_id": "999"})

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Sunday Funday"
    assert body["suggested_format"] == "half_ppr"


def test_get_league_lookup_bad_id_is_400(api_client, monkeypatch):
    client, _session_factory = api_client

    def boom(league_id):
        raise sleeper_league.SleeperFetchError("no such league")

    monkeypatch.setattr(sleeper_league, "fetch_raw_league", boom)

    response = client.get("/leagues/lookup", params={"platform_league_id": "bad-id"})

    assert response.status_code == 400


def test_post_league_creates_and_lists(api_client, monkeypatch):
    client, _session_factory = api_client
    stub_sleeper(monkeypatch, team_names={"1": "Bourrow my Toe"})

    body = create_league(client)

    assert body["name"] == "Sunday Funday"
    assert body["num_teams"] == 10
    assert body["team_names"] == {"1": "Bourrow my Toe"}
    assert body["rank_set_id"] is None

    listed = client.get("/leagues").json()
    assert [row["id"] for row in listed] == [body["id"]]


def test_post_league_bad_id_is_400(api_client, monkeypatch):
    client, _session_factory = api_client

    def boom(league_id):
        raise sleeper_league.SleeperFetchError("no such league")

    monkeypatch.setattr(sleeper_league, "fetch_raw_league", boom)

    response = client.post("/leagues", json={"platform_league_id": "bad-id", "format": "half_ppr"})

    assert response.status_code == 400


def test_post_league_sync_updates_settings(api_client, monkeypatch):
    client, _session_factory = api_client
    stub_sleeper(monkeypatch)
    league_id = create_league(client)["id"]

    stub_sleeper(
        monkeypatch,
        meta={
            "name": "Renamed League",
            "season": "2026",
            "num_teams": 12,
            "roster_positions": ["QB"],
            "suggested_format": "ppr",
        },
    )

    response = client.post(f"/leagues/{league_id}/sync")

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Renamed League"
    assert body["num_teams"] == 12
    assert body["format"] == "half_ppr"  # unchanged by sync


def test_post_league_sync_unknown_is_400(api_client):
    client, _session_factory = api_client

    response = client.post("/leagues/999/sync")

    assert response.status_code == 400


def test_patch_league_format(api_client, monkeypatch):
    client, _session_factory = api_client
    stub_sleeper(monkeypatch)
    league_id = create_league(client)["id"]

    response = client.patch(f"/leagues/{league_id}/format", json={"format": "ppr"})

    assert response.status_code == 200
    assert response.json()["format"] == "ppr"


def test_patch_league_rank_set_can_set_and_clear(api_client, monkeypatch):
    client, _session_factory = api_client
    stub_sleeper(monkeypatch)
    league_id = create_league(client)["id"]

    set_response = client.patch(f"/leagues/{league_id}/rank-set", json={"rank_set_id": 42})
    assert set_response.json()["rank_set_id"] == 42

    clear_response = client.patch(f"/leagues/{league_id}/rank-set", json={"rank_set_id": None})
    assert clear_response.json()["rank_set_id"] is None


def test_delete_league_removes_it(api_client, monkeypatch):
    client, _session_factory = api_client
    stub_sleeper(monkeypatch)
    league_id = create_league(client)["id"]

    response = client.delete(f"/leagues/{league_id}")

    assert response.status_code == 204
    assert client.get("/leagues").json() == []
