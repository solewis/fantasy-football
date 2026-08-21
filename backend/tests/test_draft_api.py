from datetime import UTC, datetime

from app.ingest import sleeper_draft, sleeper_league
from app.models import League, PlatformPlayer


def seed_league(session_factory, **overrides) -> int:
    session = session_factory()
    league = League(
        platform="sleeper",
        platform_league_id="777",
        name="Test League",
        season="2026",
        format="half_ppr",
        num_teams=2,
        roster_positions=["QB", "RB"],
        team_names={"10": "My Team", "3": "Rival"},
        rank_set_id=None,
        created_at=datetime.now(UTC),
    )
    for key, value in overrides.items():
        setattr(league, key, value)
    session.add(league)
    session.commit()
    session.refresh(league)
    league_id = league.id
    session.close()
    return league_id


def seed(session_factory) -> None:
    session = session_factory()
    session.add_all(
        [
            PlatformPlayer(
                platform="sleeper",
                platform_player_id="1",
                name="Josh Allen",
                position="QB",
                team="BUF",
            ),
            PlatformPlayer(
                platform="sleeper",
                platform_player_id="2",
                name="Bijan Robinson",
                position="RB",
                team="ATL",
            ),
        ]
    )
    session.commit()
    session.close()


def create_draft(client, **overrides):
    payload = {
        "season": "2026",
        "format": "half_ppr",
        "num_teams": 2,
        "num_rounds": 2,
        "my_slot": 1,
    }
    payload.update(overrides)
    response = client.post("/drafts", json=payload)
    assert response.status_code == 200
    return response.json()


def test_post_draft_creates_and_returns_status(api_client):
    client, session_factory = api_client
    seed(session_factory)

    body = create_draft(client)

    assert body["draft"]["num_teams"] == 2
    assert body["picks"] == []
    assert body["next_pick_number"] == 1
    assert body["is_complete"] is False


def test_get_draft_status_for_unknown_id_is_404(api_client):
    client, _session_factory = api_client

    response = client.get("/drafts/999")

    assert response.status_code == 404


def test_post_pick_then_status_reflects_it(api_client):
    client, session_factory = api_client
    seed(session_factory)
    draft_id = create_draft(client)["draft"]["id"]

    pick_response = client.post(f"/drafts/{draft_id}/picks", json={"platform_player_id": "1"})
    assert pick_response.status_code == 200
    assert pick_response.json() == {"pick_number": 1}

    status = client.get(f"/drafts/{draft_id}").json()
    assert [p["platform_player_id"] for p in status["picks"]] == ["1"]
    assert status["next_pick_number"] == 2


def test_post_pick_duplicate_player_is_400(api_client):
    client, session_factory = api_client
    seed(session_factory)
    draft_id = create_draft(client)["draft"]["id"]
    client.post(f"/drafts/{draft_id}/picks", json={"platform_player_id": "1"})

    response = client.post(f"/drafts/{draft_id}/picks", json={"platform_player_id": "1"})

    assert response.status_code == 400


def test_delete_last_pick_undoes_it(api_client):
    client, session_factory = api_client
    seed(session_factory)
    draft_id = create_draft(client)["draft"]["id"]
    client.post(f"/drafts/{draft_id}/picks", json={"platform_player_id": "1"})

    response = client.delete(f"/drafts/{draft_id}/picks")

    assert response.status_code == 200
    assert response.json() == {"pick_number": 1}
    status = client.get(f"/drafts/{draft_id}").json()
    assert status["picks"] == []


def test_delete_last_pick_on_empty_draft_returns_null(api_client):
    client, session_factory = api_client
    seed(session_factory)
    draft_id = create_draft(client)["draft"]["id"]

    response = client.delete(f"/drafts/{draft_id}/picks")

    assert response.status_code == 200
    assert response.json() is None


def test_queue_get_empty_then_put_then_get_reflects_order(api_client):
    client, session_factory = api_client
    seed(session_factory)
    draft_id = create_draft(client)["draft"]["id"]

    assert client.get(f"/drafts/{draft_id}/queue").json() == []

    put_response = client.put(f"/drafts/{draft_id}/queue", json={"platform_player_ids": ["2", "1"]})
    assert put_response.status_code == 200
    assert put_response.json() == {"count": 2}

    rows = client.get(f"/drafts/{draft_id}/queue").json()
    assert [r["name"] for r in rows] == ["Bijan Robinson", "Josh Allen"]


def test_post_sleeper_draft_fetches_settings_from_sleeper(api_client, monkeypatch):
    client, session_factory = api_client
    seed(session_factory)
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {"season": "2026", "settings": {"teams": 2, "rounds": 2}},
    )

    response = client.post(
        "/drafts/sleeper",
        json={"platform_draft_id": "999", "format": "half_ppr", "my_slot": 1},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["draft"]["platform"] == "sleeper"
    assert body["draft"]["platform_draft_id"] == "999"
    assert body["draft"]["num_teams"] == 2


def test_post_sleeper_draft_bad_id_is_400(api_client, monkeypatch):
    client, _session_factory = api_client

    def boom(draft_id):
        raise sleeper_draft.SleeperFetchError("no such draft")

    monkeypatch.setattr(sleeper_draft, "fetch_raw_draft", boom)

    response = client.post(
        "/drafts/sleeper",
        json={"platform_draft_id": "bad-id", "format": "half_ppr", "my_slot": 1},
    )

    assert response.status_code == 400


def test_post_sync_adds_new_picks(api_client, monkeypatch):
    client, session_factory = api_client
    seed(session_factory)
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {"season": "2026", "settings": {"teams": 2, "rounds": 2}},
    )
    draft_id = client.post(
        "/drafts/sleeper",
        json={"platform_draft_id": "999", "format": "half_ppr", "my_slot": 1},
    ).json()["draft"]["id"]
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_picks",
        lambda draft_id: [{"pick_no": 1, "player_id": "1"}],
    )

    response = client.post(f"/drafts/{draft_id}/sync")

    assert response.status_code == 200
    body = response.json()
    assert [p["platform_player_id"] for p in body["picks"]] == ["1"]


def test_post_sync_on_manual_draft_is_400(api_client):
    client, session_factory = api_client
    seed(session_factory)
    draft_id = create_draft(client)["draft"]["id"]

    response = client.post(f"/drafts/{draft_id}/sync")

    assert response.status_code == 400


def test_post_pick_on_sleeper_draft_is_400(api_client, monkeypatch):
    client, session_factory = api_client
    seed(session_factory)
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {"season": "2026", "settings": {"teams": 2, "rounds": 2}},
    )
    draft_id = client.post(
        "/drafts/sleeper",
        json={"platform_draft_id": "999", "format": "half_ppr", "my_slot": 1},
    ).json()["draft"]["id"]

    response = client.post(f"/drafts/{draft_id}/picks", json={"platform_player_id": "1"})

    assert response.status_code == 400


def test_post_switch_to_manual_allows_picks_afterward(api_client, monkeypatch):
    client, session_factory = api_client
    seed(session_factory)
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {"season": "2026", "settings": {"teams": 2, "rounds": 2}},
    )
    draft_id = client.post(
        "/drafts/sleeper",
        json={"platform_draft_id": "999", "format": "half_ppr", "my_slot": 1},
    ).json()["draft"]["id"]

    switch_response = client.post(f"/drafts/{draft_id}/switch-to-manual")
    assert switch_response.status_code == 200
    assert switch_response.json()["draft"]["platform"] == "manual"

    pick_response = client.post(f"/drafts/{draft_id}/picks", json={"platform_player_id": "1"})
    assert pick_response.status_code == 200


def test_post_draft_from_league_creates_and_returns_status(api_client, monkeypatch):
    client, session_factory = api_client
    seed(session_factory)
    league_id = seed_league(session_factory)
    monkeypatch.setattr(sleeper_league, "fetch_raw_league", lambda league_id: {"draft_id": "555"})
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {
            "season": "2026",
            "settings": {"teams": 2, "rounds": 2},
            "slot_to_roster_id": {"1": 10, "2": 3},
        },
    )

    response = client.post("/drafts/league", json={"league_id": league_id, "my_slot": 1})

    assert response.status_code == 200
    body = response.json()
    assert body["draft"]["league_id"] == league_id
    assert body["draft"]["platform_draft_id"] == "555"
    assert body["draft"]["team_names"] == {"1": "My Team", "2": "Rival"}


def test_post_draft_from_league_unknown_league_is_400(api_client):
    client, _session_factory = api_client

    response = client.post("/drafts/league", json={"league_id": 999, "my_slot": 1})

    assert response.status_code == 400


def test_post_draft_from_league_no_active_draft_is_400(api_client, monkeypatch):
    client, session_factory = api_client
    league_id = seed_league(session_factory)
    monkeypatch.setattr(sleeper_league, "fetch_raw_league", lambda league_id: {})

    response = client.post("/drafts/league", json={"league_id": league_id, "my_slot": 1})

    assert response.status_code == 400


def test_post_draft_from_league_slot_out_of_range_is_400(api_client):
    client, session_factory = api_client
    league_id = seed_league(session_factory)  # num_teams=2

    response = client.post("/drafts/league", json={"league_id": league_id, "my_slot": 5})

    assert response.status_code == 400


def test_get_drafts_empty(api_client):
    client, _session_factory = api_client

    response = client.get("/drafts")

    assert response.status_code == 200
    assert response.json() == []


def test_get_drafts_unfiltered_returns_every_draft(api_client):
    client, session_factory = api_client
    seed(session_factory)
    create_draft(client)
    create_draft(client)

    response = client.get("/drafts")

    assert response.status_code == 200
    assert len(response.json()) == 2


def test_get_drafts_filters_by_league_id(api_client, monkeypatch):
    client, session_factory = api_client
    seed(session_factory)
    create_draft(client)  # a manual draft with no league -- must be excluded
    league_id = seed_league(session_factory)
    monkeypatch.setattr(sleeper_league, "fetch_raw_league", lambda league_id: {"draft_id": "555"})
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {"season": "2026", "settings": {"teams": 2, "rounds": 2}},
    )
    league_draft_id = client.post(
        "/drafts/league", json={"league_id": league_id, "my_slot": 1}
    ).json()["draft"]["id"]

    response = client.get(f"/drafts?league_id={league_id}")

    assert response.status_code == 200
    body = response.json()
    assert [row["id"] for row in body] == [league_draft_id]
    assert body[0]["pick_count"] == 0
    assert body[0]["next_pick_number"] == 1
    assert body[0]["is_complete"] is False
