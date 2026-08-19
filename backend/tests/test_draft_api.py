from app.models import PlatformPlayer


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
